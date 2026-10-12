import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const m = vi.hoisted(() => ({
  extractPurchase: vi.fn(),
  findProductByName: vi.fn(),
  executeOperation: vi.fn(),
}));

vi.mock('../src/services/purchaseExtractionService.js', () => ({ extractPurchase: m.extractPurchase }));
vi.mock('../src/services/sheetsService.js', () => ({
  executeOperation: m.executeOperation,
  findProductByName: m.findProductByName,
  queryStock: vi.fn(),
  getProducts: vi.fn(),
}));

import { createApp } from '../src/index.js';

const app = createApp({ host: '127.0.0.1', port: 3000, isProduction: false });
const img = { type: 'image', content: 'data:image/jpeg;base64,AAAA' };
const extractOk = {
  pedido: { id: 'PO-1', fecha: '2026-06-10', total: 100 },
  productos: [{ nombre_sugerido: 'Gorra', titulo_corto: 'Gorra larga', variante: '', cantidad: 1, unidades_por_paquete: 1, costo_paquete: 100 }],
  checksum: { estado: 'ok', ok: true, suma: 100, total: 100, diferenciaPct: 0 },
};

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  process.env.GOOGLE_SHEETS_URL = 'http://sheets.test';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GOOGLE_SHEETS_URL;
});

describe('POST /api/purchase/extract', () => {
  it('devuelve la extraccion validada', async () => {
    m.extractPurchase.mockResolvedValue(extractOk);
    const res = await request(app).post('/api/purchase/extract').send({ pages: [img] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(extractOk);
    expect(m.extractPurchase).toHaveBeenCalledWith([img]);
  });

  it('body invalido => 422 sin llamar al servicio', async () => {
    const res = await request(app).post('/api/purchase/extract').send({ pages: [] });
    expect(res.status).toBe(422);
    expect(m.extractPurchase).not.toHaveBeenCalled();
  });

  it('acepta body de ~1MB (limite propio de la ruta) pero el global sigue en 100kb', async () => {
    m.extractPurchase.mockResolvedValue(extractOk);
    const big = { type: 'image', content: `data:image/jpeg;base64,${'A'.repeat(1_000_000)}` };
    const ok = await request(app).post('/api/purchase/extract').send({ pages: [big] });
    expect(ok.status).toBe(200);

    const other = await request(app).post('/api/purchase/match').send({ nombres: ['a'], pad: 'x'.repeat(200_000) });
    expect(other.status).toBe(413);
    const voice = await request(app).post('/api/voice/execute').send({ pad: 'x'.repeat(200_000) });
    expect(voice.status).toBe(413);
  });

  it('mas de 15mb => 413', async () => {
    const huge = { type: 'image', content: `data:image/jpeg;base64,${'A'.repeat(16 * 1024 * 1024)}` };
    const res = await request(app).post('/api/purchase/extract').send({ pages: [huge] });
    expect(res.status).toBe(413);
  });

  it('PURCHASE_INVALID_DATA => 422 sin filtrar detalles internos', async () => {
    m.extractPurchase.mockRejectedValue(Object.assign(new Error('secret-detail'), { code: 'PURCHASE_INVALID_DATA' }));
    const res = await request(app).post('/api/purchase/extract').send({ pages: [img] });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).not.toContain('secret-detail');
  });

  it('AI_RATE_LIMITED => 429 con mensaje en español y retryAfterSeconds', async () => {
    m.extractPurchase.mockRejectedValue(Object.assign(new Error('org_SECRET123'), { code: 'AI_RATE_LIMITED', retryAfterSeconds: 13 }));
    const res = await request(app).post('/api/purchase/extract').send({ pages: [img] });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Se alcanzó el límite de uso de Groq. Esperá un minuto y volvé a intentar.', retryAfterSeconds: 13 });
    expect(res.headers['retry-after']).toBe('13');
    expect(JSON.stringify(res.body)).not.toContain('org_SECRET123');
  });

  it('AI_RATE_LIMITED sin dato de espera => sin retryAfterSeconds ni header', async () => {
    m.extractPurchase.mockRejectedValue(Object.assign(new Error('x'), { code: 'AI_RATE_LIMITED' }));
    const res = await request(app).post('/api/purchase/extract').send({ pages: [img] });
    expect(res.status).toBe(429);
    expect(res.body).not.toHaveProperty('retryAfterSeconds');
    expect(res.headers['retry-after']).toBeUndefined();
  });

  it('AI_OUTPUT_TRUNCATED => 422 con mensaje claro', async () => {
    m.extractPurchase.mockRejectedValue(Object.assign(new Error('x'), { code: 'AI_OUTPUT_TRUNCATED' }));
    const res = await request(app).post('/api/purchase/extract').send({ pages: [img] });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/demasiados productos/i);
  });

  it('AI_EXTRACTION_FAILED => 500 generico', async () => {
    m.extractPurchase.mockRejectedValue(Object.assign(new Error('secret-detail'), { code: 'AI_EXTRACTION_FAILED' }));
    const res = await request(app).post('/api/purchase/extract').send({ pages: [img] });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-detail');
  });

  it('error inesperado => 500 generico', async () => {
    m.extractPurchase.mockRejectedValue(new Error('secret-detail'));
    const res = await request(app).post('/api/purchase/extract').send({ pages: [img] });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-detail');
  });

  it('no loguea el contenido de las paginas', async () => {
    m.extractPurchase.mockRejectedValue(new Error('x'));
    await request(app).post('/api/purchase/extract').send({ pages: [{ type: 'text', content: 'DATO-PERSONAL' }] });
    const logged = [...console.log.mock.calls, ...console.error.mock.calls].flat().join(' ');
    expect(logged).not.toContain('DATO-PERSONAL');
  });
});

describe('hardening sigue aplicando a /api/purchase', () => {
  it('Origin foraneo => 403', async () => {
    const res = await request(app).post('/api/purchase/extract').set('Origin', 'http://evil.com').send({ pages: [img] });
    expect(res.status).toBe(403);
    expect(m.extractPurchase).not.toHaveBeenCalled();
  });
  it('Host foraneo => 403 (en las tres rutas)', async () => {
    for (const url of ['extract', 'match', 'import']) {
      const res = await request(app).post(`/api/purchase/${url}`).set('Host', 'evil.com').send({});
      expect(res.status).toBe(403);
    }
  });
  it('Origin permitido pasa', async () => {
    m.extractPurchase.mockResolvedValue(extractOk);
    const res = await request(app).post('/api/purchase/extract').set('Origin', 'http://localhost:5173').send({ pages: [img] });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/purchase/match', () => {
  it('devuelve existe/producto por nombre', async () => {
    m.findProductByName.mockImplementation(async (n) =>
      n === 'gorra' ? { success: true, found: true, product: { id: 'P1', nombre: 'Gorra', stock: 3, extra: 'x' } } : { success: true, found: false });
    const res = await request(app).post('/api/purchase/match').send({ nombres: ['gorra', 'zapato'] });
    expect(res.status).toBe(200);
    expect(res.body.resultados).toEqual([
      { nombre: 'gorra', existe: true, producto: { id: 'P1', nombre: 'Gorra', stock: 3 } },
      { nombre: 'zapato', existe: false },
    ]);
  });

  it('valida el body', async () => {
    const res = await request(app).post('/api/purchase/match').send({ nombres: [] });
    expect(res.status).toBe(422);
  });

  it('falla de Sheets => 500 generico (no marca "Nuevo" por error)', async () => {
    m.findProductByName.mockRejectedValue(new Error('secret-detail'));
    const res = await request(app).post('/api/purchase/match').send({ nombres: ['a'] });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-detail');
  });

  it('Sheets no configurado => 500', async () => {
    delete process.env.GOOGLE_SHEETS_URL;
    const res = await request(app).post('/api/purchase/match').send({ nombres: ['a'] });
    expect(res.status).toBe(500);
    expect(m.findProductByName).not.toHaveBeenCalled();
  });
});

describe('POST /api/purchase/import', () => {
  const row = (over = {}) => ({ nombre: 'Gorra', variante: 'rosa', cantidad: 2, costo_unitario: 100, existe: true, ...over });
  const send = (productos, pedido = { id: 'PO-9', fecha: '2026-06-10' }) =>
    request(app).post('/api/purchase/import').send({ pedido, productos });

  it('existente => COMPRA con fecha del pedido y id en proveedor', async () => {
    m.executeOperation.mockResolvedValue({ success: true });
    const res = await send([row()]);
    expect(res.status).toBe(200);
    expect(m.executeOperation).toHaveBeenCalledWith('COMPRA', expect.objectContaining({
      fecha: '2026-06-10',
      proveedor: expect.stringContaining('PO-9'),
      productos: [{ nombre: 'Gorra', cantidad: 2, precio_unitario: 100 }],
    }));
    expect(res.body.results).toEqual([{ index: 0, ok: true }]);
    expect(res.body.summary).toEqual({ ok: 1, failed: 0 });
  });

  it('nuevo => NUEVO_PRODUCTO con stock=cantidad, costo y precio_venta', async () => {
    m.executeOperation.mockResolvedValue({ success: true });
    await send([row({ existe: false, precio_venta: 250 })]);
    expect(m.executeOperation).toHaveBeenCalledWith('NUEVO_PRODUCTO', {
      producto: 'Gorra', precio: 100, precio_venta: 250, stock_inicial: 2, fecha: '2026-06-10',
    });
  });

  it('nuevo sin precio_venta => 0', async () => {
    m.executeOperation.mockResolvedValue({ success: true });
    await send([row({ existe: false })]);
    expect(m.executeOperation.mock.calls[0][1].precio_venta).toBe(0);
  });

  it('procesa en orden y devuelve resultados por fila sin abortar el lote', async () => {
    m.executeOperation
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'Producto no encontrado: B' })
      .mockRejectedValueOnce(new Error('secret-detail'));
    const res = await send([row({ nombre: 'A' }), row({ nombre: 'B' }), row({ nombre: 'C' })]);
    expect(res.status).toBe(200);
    expect(m.executeOperation).toHaveBeenCalledTimes(3);
    expect(res.body.results[0]).toEqual({ index: 0, ok: true });
    expect(res.body.results[1]).toEqual({ index: 1, ok: false, error: 'Producto no encontrado: B' });
    expect(res.body.results[2]).toMatchObject({ index: 2, ok: false });
    expect(JSON.stringify(res.body)).not.toContain('secret-detail');
    expect(res.body.summary).toEqual({ ok: 1, failed: 2 });
  });

  it('dos filas nuevas con el mismo nombre: la segunda va como COMPRA', async () => {
    m.executeOperation.mockResolvedValue({ success: true });
    await send([row({ existe: false, nombre: 'Gorra' }), row({ existe: false, nombre: ' gorra ' })]);
    expect(m.executeOperation.mock.calls[0][0]).toBe('NUEVO_PRODUCTO');
    expect(m.executeOperation.mock.calls[1][0]).toBe('COMPRA');
  });

  it('si la creacion falla, la fila homonima siguiente sigue intentando crear', async () => {
    m.executeOperation.mockResolvedValue({ success: false, error: 'x' });
    await send([row({ existe: false }), row({ existe: false })]);
    expect(m.executeOperation.mock.calls.map((c) => c[0])).toEqual(['NUEVO_PRODUCTO', 'NUEVO_PRODUCTO']);
  });

  it('sin pedido usa la fecha de hoy (no envia fecha vacia)', async () => {
    m.executeOperation.mockResolvedValue({ success: true });
    await request(app).post('/api/purchase/import').send({ productos: [row()] });
    expect(m.executeOperation.mock.calls[0][1].fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('importa UNIDADES con costo por unidad de 2 decimales (pack de 10 a 2159.5)', async () => {
    m.executeOperation.mockResolvedValue({ success: true });
    const res = await send([row({ cantidad: 10, costo_unitario: 2159.5 })]);
    expect(res.status).toBe(200);
    expect(m.executeOperation.mock.calls[0][1].productos[0]).toEqual({ nombre: 'Gorra', cantidad: 10, precio_unitario: 2159.5 });
  });

  describe('fecha vacia => hoy en Argentina (no UTC)', () => {
    afterEach(() => vi.useRealTimers());
    it('pedido.fecha vacia usa la fecha local AR', async () => {
      // 01:00 UTC del 11/06 = 22:00 del 10/06 en Buenos Aires
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-11T01:00:00Z') });
      m.executeOperation.mockResolvedValue({ success: true });
      await send([row()], { id: '', fecha: '' });
      expect(m.executeOperation.mock.calls[0][1].fecha).toBe('2026-06-10');
    });
    it('sin pedido tambien usa fecha AR', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-11T01:00:00Z') });
      m.executeOperation.mockResolvedValue({ success: true });
      await request(app).post('/api/purchase/import').send({ productos: [row()] });
      expect(m.executeOperation.mock.calls[0][1].fecha).toBe('2026-06-10');
    });
    it('id vacio => proveedor generico', async () => {
      m.executeOperation.mockResolvedValue({ success: true });
      await send([row()], { id: '', fecha: '' });
      expect(m.executeOperation.mock.calls[0][1].proveedor).toBe('Importación PDF');
    });
  });

  it.each([
    ['0 filas', []],
    ['cantidad 0', [row({ cantidad: 0 })]],
    ['costo negativo', [row({ costo_unitario: -1 })]],
  ])('valida body: %s => 422', async (_n, productos) => {
    const res = await send(productos);
    expect(res.status).toBe(422);
    expect(m.executeOperation).not.toHaveBeenCalled();
  });

  it('Sheets no configurado => 500 sin ejecutar', async () => {
    delete process.env.GOOGLE_SHEETS_URL;
    const res = await send([row()]);
    expect(res.status).toBe(500);
    expect(m.executeOperation).not.toHaveBeenCalled();
  });
});

describe('POST /api/purchase/import: reintentos sin duplicar productos', () => {
  const row = (over = {}) => ({ nombre: 'Gorra', variante: '', cantidad: 2, costo_unitario: 100, existe: false, ...over });
  const send = (productos, pedido = { id: 'PO-9', fecha: '2026-06-10' }) =>
    request(app).post('/api/purchase/import').send({ pedido, productos });
  const notFound = { success: true, found: false };
  const found = { success: true, found: true, product: { id: 'P1', nombre: 'Gorra' } };

  it('fila "nuevo" cuyo producto ya existe en la hoja => COMPRA, no NUEVO_PRODUCTO', async () => {
    m.findProductByName.mockResolvedValue(found);
    m.executeOperation.mockResolvedValue({ success: true });
    const res = await send([row()]);
    expect(m.findProductByName).toHaveBeenCalledWith('Gorra');
    expect(m.executeOperation).toHaveBeenCalledTimes(1);
    expect(m.executeOperation.mock.calls[0][0]).toBe('COMPRA');
    expect(res.body.results).toEqual([{ index: 0, ok: true }]);
  });

  it('fila "nuevo" que de verdad no existe => NUEVO_PRODUCTO con fecha del pedido', async () => {
    m.findProductByName.mockResolvedValue(notFound);
    m.executeOperation.mockResolvedValue({ success: true });
    await send([row()]);
    expect(m.executeOperation.mock.calls[0][0]).toBe('NUEVO_PRODUCTO');
    expect(m.executeOperation.mock.calls[0][1].fecha).toBe('2026-06-10');
  });

  it('si no se puede verificar la existencia, la fila falla y NO se crea nada', async () => {
    m.findProductByName.mockRejectedValue(new Error('secret-detail'));
    const res = await send([row()]);
    expect(m.executeOperation).not.toHaveBeenCalled();
    expect(res.body.results[0]).toMatchObject({ index: 0, ok: false });
    expect(JSON.stringify(res.body)).not.toContain('secret-detail');
  });

  it('"Producto creado pero error al registrar stock inicial" cuenta como creado: la fila homonima siguiente va por COMPRA', async () => {
    m.findProductByName.mockResolvedValue(notFound);
    m.executeOperation
      .mockResolvedValueOnce({ success: false, error: 'Producto creado pero error al registrar stock inicial: Gorra' })
      .mockResolvedValueOnce({ success: true });
    await send([row(), row()]);
    expect(m.executeOperation.mock.calls.map((c) => c[0])).toEqual(['NUEVO_PRODUCTO', 'COMPRA']);
  });

  it('reintento tras ese fallo parcial: el re-chequeo lo encuentra y registra el stock por COMPRA', async () => {
    m.findProductByName.mockResolvedValue(found);
    m.executeOperation.mockResolvedValue({ success: true });
    const res = await send([row()]);
    expect(m.executeOperation.mock.calls[0][0]).toBe('COMPRA');
    expect(m.executeOperation.mock.calls[0][1].productos[0]).toMatchObject({ nombre: 'Gorra', cantidad: 2 });
    expect(res.body.summary).toEqual({ ok: 1, failed: 0 });
  });

  it('fila existe:true no consulta findProduct (lo hace COMPRA)', async () => {
    m.executeOperation.mockResolvedValue({ success: true });
    await send([row({ existe: true })]);
    expect(m.findProductByName).not.toHaveBeenCalled();
  });
});
