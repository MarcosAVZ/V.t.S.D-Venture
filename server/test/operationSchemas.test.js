import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateOperation } from '../src/schemas/operationSchemas.js';

const item = (over = {}) => ({ nombre: 'remera', cantidad: 2, precio_unitario: 10, ...over });

describe('AJUSTE cantidad', () => {
  const base = { operation: 'AJUSTE', producto: 'remera' };
  it('acepta negativos', () => {
    const r = validateOperation({ ...base, cantidad: -3 });
    expect(r.success).toBe(true);
    expect(r.data.cantidad).toBe(-3);
  });
  it('acepta positivos y strings numericos', () => {
    expect(validateOperation({ ...base, cantidad: '5' }).data.cantidad).toBe(5);
  });
  it('rechaza cero', () => {
    expect(validateOperation({ ...base, cantidad: 0 }).success).toBe(false);
  });
});

describe('COMPRA/VENTA cantidad sigue positiva', () => {
  it('rechaza negativos y cero', () => {
    for (const op of ['COMPRA', 'VENTA']) {
      expect(validateOperation({ operation: op, productos: [item({ cantidad: -1 })] }).success).toBe(false);
      expect(validateOperation({ operation: op, productos: [item({ cantidad: 0 })] }).success).toBe(false);
    }
  });
});

describe('fecha default se calcula por parse', () => {
  afterEach(() => vi.useRealTimers());
  it('usa la fecha actual de cada parse, no la de carga del modulo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-15T12:00:00Z'));
    const a = validateOperation({ operation: 'COMPRA', productos: [item()] });
    expect(a.data.fecha).toBe('2030-01-15');
    vi.setSystemTime(new Date('2031-06-20T12:00:00Z'));
    const b = validateOperation({ operation: 'VENTA', productos: [item()] });
    expect(b.data.fecha).toBe('2031-06-20');
  });
});

describe('limites de entrada', () => {
  it('rechaza strings demasiado largos', () => {
    const long = 'a'.repeat(201);
    expect(validateOperation({ operation: 'CONSULTA', producto: long }).success).toBe(false);
    expect(validateOperation({ operation: 'COMPRA', proveedor: long, productos: [item()] }).success).toBe(false);
  });
  it('hace trim de strings', () => {
    const r = validateOperation({ operation: 'CONSULTA', producto: '  remera  ' });
    expect(r.data.producto).toBe('remera');
  });
  it('rechaza producto vacio', () => {
    expect(validateOperation({ operation: 'CONSULTA', producto: '   ' }).success).toBe(false);
  });
  it('rechaza mas de 50 productos', () => {
    const productos = Array.from({ length: 51 }, () => item());
    expect(validateOperation({ operation: 'COMPRA', productos }).success).toBe(false);
    expect(validateOperation({ operation: 'COMPRA', productos: productos.slice(0, 50) }).success).toBe(true);
  });
  it('rechaza numeros no finitos', () => {
    expect(validateOperation({ operation: 'COMPRA', productos: [item({ cantidad: Infinity })] }).success).toBe(false);
    expect(validateOperation({ operation: 'COMPRA', productos: [item({ precio_unitario: Infinity })] }).success).toBe(false);
  });
  it('rechaza precios negativos', () => {
    expect(validateOperation({ operation: 'COMPRA', productos: [item({ precio_unitario: -1 })] }).success).toBe(false);
    expect(validateOperation({ operation: 'NUEVO_PRODUCTO', producto: 'x', precio: -1 }).success).toBe(false);
    expect(validateOperation({ operation: 'NUEVO_PRODUCTO', producto: 'x', precio_venta: -1 }).success).toBe(false);
    expect(validateOperation({ operation: 'NUEVO_PRODUCTO', producto: 'x', stock_inicial: -1 }).success).toBe(false);
  });
  it('sigue aceptando nulls del AI como default', () => {
    const r = validateOperation({ operation: 'NUEVO_PRODUCTO', producto: 'x', precio: null, precio_venta: null, stock_inicial: null });
    expect(r.success).toBe(true);
    expect(r.data.precio).toBe(0);
  });
});

describe('fecha default en hora Argentina (no UTC)', () => {
  afterEach(() => vi.useRealTimers());
  it('01:00 UTC del 11/06 sigue siendo 10/06 en Buenos Aires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T01:00:00Z'));
    expect(validateOperation({ operation: 'COMPRA', productos: [item()] }).data.fecha).toBe('2026-06-10');
  });
});
