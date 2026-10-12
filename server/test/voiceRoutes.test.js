import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const m = vi.hoisted(() => ({
  transcribeAudio: vi.fn(),
  extractOperationData: vi.fn(),
  executeOperation: vi.fn(),
  queryStock: vi.fn(),
  getProducts: vi.fn(),
}));

vi.mock('../src/services/transcriptionService.js', () => ({ transcribeAudio: m.transcribeAudio }));
vi.mock('../src/services/aiService.js', () => ({ extractOperationData: m.extractOperationData }));
vi.mock('../src/services/sheetsService.js', () => ({
  executeOperation: m.executeOperation,
  queryStock: m.queryStock,
  getProducts: m.getProducts,
}));

import { app } from '../src/index.js';
import { generatePreview } from '../src/routes/voiceRoutes.js';

const audio = (over = {}) => ({ filename: 'rec.webm', contentType: 'audio/webm', ...over });
const post = (opts) => request(app).post('/api/voice/process').attach('audio', Buffer.alloc(500, 1), opts || audio());

let logSpy, errSpy;
beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('POST /api/voice/process', () => {
  it('multiples operaciones => 422 con mensaje de usuario y operations', async () => {
    m.transcribeAudio.mockResolvedValue('compre y vendi');
    const err = new Error('Se detectaron múltiples operaciones en una grabación. Grabá una operación por vez.');
    err.code = 'MULTIPLE_OPERATIONS';
    err.operations = ['COMPRA', 'VENTA'];
    m.extractOperationData.mockRejectedValue(err);
    const res = await post();
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/múltiples operaciones/);
    expect(res.body.details).toEqual(['COMPRA', 'VENTA']);
  });

  it('fallo de transcripcion => 422 sin filtrar el mensaje interno', async () => {
    m.transcribeAudio.mockRejectedValue(Object.assign(new Error('Transcription failed: 401 secret-detail'), { code: 'TRANSCRIPTION_FAILED' }));
    const res = await post();
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Transcription failed');
    expect(JSON.stringify(res.body)).not.toContain('secret-detail');
    expect(res.body).not.toHaveProperty('details');
  });

  it('fallo de IA => 500 sin details', async () => {
    m.transcribeAudio.mockResolvedValue('t');
    m.extractOperationData.mockRejectedValue(Object.assign(new Error('AI extraction failed: secret-detail'), { code: 'AI_EXTRACTION_FAILED' }));
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('AI extraction failed');
    expect(JSON.stringify(res.body)).not.toContain('secret-detail');
  });

  it('error inesperado => 500 generico sin details', async () => {
    m.transcribeAudio.mockRejectedValue(new Error('secret-detail'));
    const res = await post();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-detail');
    expect(res.body).not.toHaveProperty('details');
  });

  it('tipo de archivo invalido => 400 (no 500)', async () => {
    const res = await post({ filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/audio/i);
    expect(m.transcribeAudio).not.toHaveBeenCalled();
  });

  it('la extension sale del mimetype, no del originalname, y se usa tmpdir', async () => {
    let seen;
    m.transcribeAudio.mockImplementation(async (p) => { seen = p; return 'hola'; });
    m.extractOperationData.mockResolvedValue({ operation: 'CONSULTA', producto: 'remera' });
    const res = await post({ filename: 'evil.php', contentType: 'audio/webm;codecs=opus' });
    expect(res.status).toBe(200);
    expect(path.extname(seen)).toBe('.webm');
    expect(path.dirname(seen)).toBe(path.join(os.tmpdir(), 'vtsd-uploads'));
    expect(fs.existsSync(seen)).toBe(false); // limpiado
  });

  it('no loguea transcripcion ni payload de extraccion', async () => {
    m.transcribeAudio.mockResolvedValue('FRASE-SECRETA-DEL-CLIENTE');
    m.extractOperationData.mockResolvedValue({ operation: 'CONSULTA', producto: 'PRODUCTO-SECRETO' });
    const res = await post();
    expect(res.status).toBe(200);
    const logged = JSON.stringify([...logSpy.mock.calls, ...errSpy.mock.calls]);
    expect(logged).not.toContain('FRASE-SECRETA');
    expect(logged).not.toContain('PRODUCTO-SECRETO');
  });

  it('preview no contiene "undefined" con campos faltantes', async () => {
    m.transcribeAudio.mockResolvedValue('t');
    m.extractOperationData.mockResolvedValue({ operation: 'COMPRA', proveedor: null, metodo_pago: null, productos: [{ nombre: 'a', cantidad: 1 }] });
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.preview).not.toMatch(/undefined|null/);
  });
});

describe('generatePreview', () => {
  it.each([
    [{ operation: 'COMPRA' }],
    [{ operation: 'VENTA' }],
    [{ operation: 'NUEVO_PRODUCTO' }],
    [{ operation: 'AJUSTE' }],
    [{ operation: 'CONSULTA' }],
    [{ operation: 'COMPRA', productos: [{}] }],
  ])('sin campos %j no imprime undefined/null/NaN', (data) => {
    expect(generatePreview(data)).not.toMatch(/undefined|null|NaN/);
  });
});

describe('POST /api/voice/execute', () => {
  beforeEach(() => { process.env.GOOGLE_SHEETS_URL = 'https://example.test/exec'; });

  it('AJUSTE negativo pasa la validacion', async () => {
    m.executeOperation.mockResolvedValue({ success: true });
    const res = await request(app).post('/api/voice/execute').send({ operation: 'AJUSTE', data: { producto: 'remera', cantidad: -2 } });
    expect(res.status).toBe(200);
    expect(m.executeOperation).toHaveBeenCalledWith('AJUSTE', expect.objectContaining({ cantidad: -2 }));
  });

  it('error al ejecutar => 500 sin filtrar el mensaje', async () => {
    m.executeOperation.mockRejectedValue(new Error('secret-detail'));
    const res = await request(app).post('/api/voice/execute').send({ operation: 'AJUSTE', data: { producto: 'remera', cantidad: 1 } });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-detail');
  });

  it('body mayor a 100kb => 413', async () => {
    const res = await request(app).post('/api/voice/execute').send({ operation: 'COMPRA', data: { proveedor: 'x'.repeat(150 * 1024) } });
    expect(res.status).toBe(413);
  });

  it('JSON malformado => 400', async () => {
    const res = await request(app).post('/api/voice/execute').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
  });
});

describe('inventory routes', () => {
  it('stock: error => 500 sin details', async () => {
    m.queryStock.mockRejectedValue(new Error('secret-detail'));
    const res = await request(app).get('/api/inventory/stock?producto=remera');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-detail');
  });
  it('products: error => 500 sin details', async () => {
    m.getProducts.mockRejectedValue(new Error('secret-detail'));
    const res = await request(app).get('/api/inventory/products');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-detail');
  });
});

describe('health', () => {
  it('GET /api/health => ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('mensajes de error de upload', () => {
  it('tipo de archivo invalido => mensaje de tipo', async () => {
    const res = await post({ filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid file type/);
  });
  it('campo de archivo inesperado => mensaje de campo, no de tipo', async () => {
    const res = await request(app).post('/api/voice/process').attach('otro', Buffer.alloc(500, 1), audio());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/field/i);
    expect(res.body.error).not.toMatch(/file type/i);
  });
});
