import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeOperation, getProducts } from '../src/services/sheetsService.js';

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

/**
 * Fake Apps Script: handlers keyed by action. GET params come from the query string,
 * POST params from the JSON body.
 */
function fakeSheets(handlers) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const isPost = opts.method === 'POST';
    const params = isPost ? JSON.parse(opts.body) : Object.fromEntries(new URL(url).searchParams);
    calls.push(params);
    const h = handlers[params.action];
    if (!h) throw new Error(`unexpected action ${params.action}`);
    return h(params);
  });
  return calls;
}

const found = () => json({ success: true, found: true, product: { id: 7 } });

beforeEach(() => {
  process.env.GOOGLE_SHEETS_URL = 'https://example.test/exec';
});
afterEach(() => vi.restoreAllMocks());

describe('VENTA stock check', () => {
  const venta = { fecha: '2030-01-01', productos: [{ nombre: 'remera', cantidad: 3, precio_unitario: 10 }] };

  it('aborta si la verificacion de stock falla (success false)', async () => {
    const calls = fakeSheets({
      findProduct: found,
      queryStock: () => json({ success: false, error: 'boom' }),
      addSale: () => json({ success: true }),
    });
    const r = await executeOperation('VENTA', venta);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/stock/i);
    expect(calls.some((c) => c.action === 'addSale')).toBe(false);
  });

  it('aborta con Stock insuficiente', async () => {
    const calls = fakeSheets({
      findProduct: found,
      queryStock: () => json({ success: true, stock: 2 }),
      addSale: () => json({ success: true }),
    });
    const r = await executeOperation('VENTA', venta);
    expect(r.success).toBe(false);
    expect(r.error).toBe('Stock insuficiente');
    expect(calls.some((c) => c.action === 'addSale')).toBe(false);
  });

  it('vende con stock suficiente', async () => {
    fakeSheets({
      findProduct: found,
      queryStock: () => json({ success: true, stock: 3 }),
      addSale: () => json({ success: true, saleId: 1, stockRestante: 0 }),
    });
    expect((await executeOperation('VENTA', venta)).success).toBe(true);
  });
});

describe('AJUSTE stock check', () => {
  const run = (stockResp, cantidad) => {
    const calls = fakeSheets({
      findProduct: found,
      queryStock: () => json(stockResp),
      adjustStock: () => json({ success: true }),
    });
    return executeOperation('AJUSTE', { producto: 'remera', cantidad, motivo: 'x' }).then((r) => ({ r, calls }));
  };

  it('aborta si la verificacion de stock falla', async () => {
    const { r, calls } = await run({ success: false }, -1);
    expect(r.success).toBe(false);
    expect(calls.some((c) => c.action === 'adjustStock')).toBe(false);
  });

  it('ajuste negativo que deja stock >= 0 pasa', async () => {
    const { r } = await run({ success: true, stock: 5 }, -5);
    expect(r.success).toBe(true);
  });

  it('ajuste negativo que dejaria stock < 0 se rechaza', async () => {
    const { r, calls } = await run({ success: true, stock: 5 }, -6);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Stock insuficiente/);
    expect(calls.some((c) => c.action === 'adjustStock')).toBe(false);
  });

  it('ajuste positivo mayor al stock actual pasa (antes se rechazaba)', async () => {
    const { r } = await run({ success: true, stock: 5 }, 10);
    expect(r.success).toBe(true);
  });
});

describe('respuestas HTTP de Apps Script', () => {
  it('GET con status no-ok lanza error claro', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(getProducts()).rejects.toThrow(/status 500/);
  });

  it('GET con content-type no JSON lanza error claro (no SyntaxError)', async () => {
    globalThis.fetch = vi.fn(async () => new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const err = await getProducts().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SyntaxError);
    expect(err.message).toMatch(/text\/html/);
  });

  it('POST con content-type no JSON lanza error claro', async () => {
    globalThis.fetch = vi.fn(async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await expect(
      executeOperation('NUEVO_PRODUCTO', { producto: 'x', precio: 1, precio_venta: 1, stock_inicial: 0 })
    ).rejects.toThrow(/text\/html/);
  });
});

describe('fechas de movimientos', () => {
  afterEach(() => vi.useRealTimers());
  const handlers = () => ({
    createProduct: () => json({ success: true, product: { id: 9 } }),
    addMovement: () => json({ success: true, movementId: 1 }),
    findProduct: found,
    queryStock: () => json({ success: true, stock: 5 }),
    adjustStock: () => json({ success: true }),
  });
  const movement = (calls) => calls.find((c) => c.action === 'addMovement');

  it('NUEVO_PRODUCTO usa la fecha recibida para el movimiento de stock inicial', async () => {
    const calls = fakeSheets(handlers());
    await executeOperation('NUEVO_PRODUCTO', { producto: 'x', precio: 1, precio_venta: 1, stock_inicial: 3, fecha: '2026-06-10' });
    expect(movement(calls).fecha).toBe('2026-06-10');
  });

  it('NUEVO_PRODUCTO sin fecha usa hoy en Argentina', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T01:00:00Z'));
    const calls = fakeSheets(handlers());
    await executeOperation('NUEVO_PRODUCTO', { producto: 'x', precio: 1, precio_venta: 1, stock_inicial: 3 });
    expect(movement(calls).fecha).toBe('2026-06-10');
  });

  it('AJUSTE usa hoy en Argentina', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T01:00:00Z'));
    const calls = fakeSheets(handlers());
    await executeOperation('AJUSTE', { producto: 'x', cantidad: 1, motivo: 'm' });
    expect(calls.find((c) => c.action === 'adjustStock').fecha).toBe('2026-06-10');
  });
});
