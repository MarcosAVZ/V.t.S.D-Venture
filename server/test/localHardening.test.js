import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

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

import { createApp, getHostWarning } from '../src/index.js';

const EVIL = 'https://evil.example';
const execBody = { operation: 'AJUSTE', data: { producto: 'remera', cantidad: 1 } };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.executeOperation.mockResolvedValue({ success: true });
  m.transcribeAudio.mockResolvedValue('t');
  m.extractOperationData.mockResolvedValue({ operation: 'CONSULTA', producto: 'remera' });
  process.env.GOOGLE_SHEETS_URL = 'https://example.test/exec';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const audioPost = (app, origin) => {
  const r = request(app).post('/api/voice/process');
  if (origin) r.set('Origin', origin);
  return r.attach('audio', Buffer.alloc(500, 1), { filename: 'a.webm', contentType: 'audio/webm' });
};

describe.each([
  ['dev', { isProduction: false }],
  ['prod', { isProduction: true }],
])('Origin enforcement (%s)', (_name, opts) => {
  const app = createApp({ host: '127.0.0.1', port: 3000, ...opts });

  it('origin foraneo => 403 en POST /api/voice/execute', async () => {
    const res = await request(app).post('/api/voice/execute').set('Origin', EVIL).send(execBody);
    expect(res.status).toBe(403);
    expect(m.executeOperation).not.toHaveBeenCalled();
  });

  it('origin foraneo => 403 en multipart /api/voice/process (sin procesar el archivo)', async () => {
    const res = await audioPost(app, EVIL);
    expect(res.status).toBe(403);
    expect(m.transcribeAudio).not.toHaveBeenCalled();
  });

  it('Origin: null => 403', async () => {
    const res = await request(app).post('/api/voice/execute').set('Origin', 'null').send(execBody);
    expect(res.status).toBe(403);
  });

  it('origin foraneo => 403 tambien en GET /api/*', async () => {
    const res = await request(app).get('/api/health').set('Origin', EVIL);
    expect(res.status).toBe(403);
  });

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ])('origin permitido %s pasa', async (origin) => {
    const res = await request(app).post('/api/voice/execute').set('Origin', origin).send(execBody);
    expect(res.status).toBe(200);
    expect((await audioPost(app, origin)).status).toBe(200);
  });

  it('sin Origin pasa (curl / same-origin GET)', async () => {
    expect((await request(app).post('/api/voice/execute').send(execBody)).status).toBe(200);
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});

describe('Origin allow-list por entorno', () => {
  it('dev permite el dev server de Vite (localhost y 127.0.0.1 :5173)', async () => {
    const app = createApp({ host: '127.0.0.1', port: 3000, isProduction: false });
    for (const o of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      expect((await request(app).get('/api/health').set('Origin', o)).status).toBe(200);
    }
  });

  it('el puerto configurado se refleja en la lista', async () => {
    const app = createApp({ host: '127.0.0.1', port: 4567, isProduction: false });
    expect((await request(app).get('/api/health').set('Origin', 'http://localhost:4567')).status).toBe(200);
    expect((await request(app).get('/api/health').set('Origin', 'http://localhost:3000')).status).toBe(403);
  });

  it('prod permite solo las variantes locales: localhost/127.0.0.1 en PORT y en 5173', async () => {
    const app = createApp({ host: '127.0.0.1', port: 8080, isProduction: true });
    for (const o of ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://localhost:5173', 'http://127.0.0.1:5173']) {
      expect((await request(app).get('/api/health').set('Origin', o)).status).toBe(200);
    }
  });

  it.each([false, true])('el origin de fly.dev se rechaza (isProduction=%s)', async (isProduction) => {
    const app = createApp({ host: '127.0.0.1', port: 8080, isProduction });
    for (const o of ['https://vtsd-venture.fly.dev', 'https://otra-app.fly.dev']) {
      expect((await request(app).get('/api/health').set('Origin', o)).status).toBe(403);
    }
  });

  it('FLY_APP_NAME ya no agrega origenes', async () => {
    process.env.FLY_APP_NAME = 'mi-app';
    try {
      const app = createApp({ host: '127.0.0.1', port: 8080, isProduction: true });
      expect((await request(app).get('/api/health').set('Origin', 'https://mi-app.fly.dev')).status).toBe(403);
    } finally {
      delete process.env.FLY_APP_NAME;
    }
  });
});

describe('DNS rebinding (Host) en modo loopback', () => {
  const app = createApp({ host: '127.0.0.1', port: 3000, isProduction: false });

  it('Host foraneo => 403', async () => {
    const res = await request(app).get('/api/health').set('Host', 'evil.example:3000');
    expect(res.status).toBe(403);
  });

  it('Host foraneo => 403 tambien en POST', async () => {
    const res = await request(app).post('/api/voice/execute').set('Host', 'evil.example').send(execBody);
    expect(res.status).toBe(403);
    expect(m.executeOperation).not.toHaveBeenCalled();
  });

  it.each(['localhost', 'localhost:3000', '127.0.0.1', '127.0.0.1:3000', '[::1]', '[::1]:3000', 'LOCALHOST:3000'])(
    'Host %s => permitido',
    async (host) => {
      const res = await request(app).get('/api/health').set('Host', host);
      expect(res.status).toBe(200);
    }
  );

  it('/api/health funciona', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('HOST ::1 tambien es loopback', async () => {
    const a = createApp({ host: '::1', port: 3000, isProduction: false });
    expect((await request(a).get('/api/health').set('Host', 'evil.example')).status).toBe(403);
  });

  it('no aplica cuando HOST no es loopback (expuesto en la red)', async () => {
    const exposed = createApp({ host: '0.0.0.0', port: 8080, isProduction: true });
    const res = await request(exposed).get('/api/health').set('Host', '192.168.0.10:8080');
    expect(res.status).toBe(200);
  });
});

describe('aviso de arranque con HOST no loopback', () => {
  it.each(['127.0.0.1', 'localhost', '::1', '[::1]'])('sin aviso para %s', (host) => {
    expect(getHostWarning(host)).toBeNull();
  });
  it.each(['0.0.0.0', '192.168.0.10', '::', 'mi-pc.local'])('aviso claro para %s', (host) => {
    const warning = getHostWarning(host);
    expect(warning).toMatch(/WARNING/);
    expect(warning).toMatch(/sin autenticaci[oó]n|no authentication/i);
    expect(warning).toMatch(/red|network/i);
    expect(warning).toContain(host);
  });
});
