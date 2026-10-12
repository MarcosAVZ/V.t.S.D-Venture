import { describe, it, expect } from 'vitest';
import {
  parseArNumber,
  purchaseImportSchema,
  purchaseExtractRequestSchema,
  purchaseMatchSchema,
  purchaseConfirmSchema,
} from '../src/schemas/purchaseSchemas.js';

const producto = (over = {}) => ({
  nombre_sugerido: 'Gorra gato bordado',
  titulo_corto: 'Gorra de béisbol con gato bordado para mujer',
  variante: 'color rojo rosa / talla única',
  cantidad: 1,
  unidades_por_paquete: 1,
  costo_paquete: 6762,
  ...over,
});
const extraction = (over = {}) => ({
  pedido: { id: 'PO-123', fecha: '2026-06-10', total: 57139 },
  productos: [producto()],
  ...over,
});

describe('parseArNumber', () => {
  it.each([
    ['ARS6.762', 6762],
    ['57.139', 57139],
    ['1.234.567', 1234567],
    ['2676', 2676],
    ['12,5', 12.5],
    ['1.234,56', 1234.56],
    ['ARS 10.739', 10739],
    ['$ 6.762', 6762],
    [6762, 6762],
    ['ARS4.944', 4944],
    ['ARS21.595', 21595],
    ['ARS 1.234,50', 1234.5],
    ['$6.762', 6762],
    ['ars6.762', 6762],
  ])('%s -> %s', (input, expected) => {
    expect(parseArNumber(input)).toBe(expected);
  });

  it('deja pasar lo no parseable para que zod lo rechace', () => {
    expect(parseArNumber('abc')).toBe('abc');
    expect(parseArNumber(null)).toBeUndefined();
    expect(parseArNumber('')).toBeUndefined();
  });
});

describe('purchaseImportSchema', () => {
  it('acepta una extraccion valida y coacciona formato AR', () => {
    const r = purchaseImportSchema.parse(extraction({
      pedido: { id: 'PO-1', fecha: '2026-06-10', total: '57.139' },
      productos: [producto({ costo_paquete: 'ARS6.762', cantidad: '2' })],
    }));
    expect(r.pedido.total).toBe(57139);
    expect(r.productos[0]).toMatchObject({ costo_paquete: 6762, cantidad: 2 });
  });

  it('pedido con nulls -> defaults vacios', () => {
    const r = purchaseImportSchema.parse(extraction({ pedido: { id: null, fecha: null, total: null } }));
    expect(r.pedido).toEqual({ id: '', fecha: '', total: 0 });
  });

  it('acepta lote sin productos (pagina de resumen)', () => {
    expect(purchaseImportSchema.parse(extraction({ productos: [] })).productos).toEqual([]);
  });

  it.each([
    ['costo negativo', { productos: [producto({ costo_paquete: -1 })] }],
    ['cantidad 0', { productos: [producto({ cantidad: 0 })] }],
    ['cantidad decimal', { productos: [producto({ cantidad: 1.5 })] }],
    ['costo Infinity', { productos: [producto({ costo_paquete: Infinity })] }],
    ['nombre vacio', { productos: [producto({ nombre_sugerido: '  ' })] }],
    ['mas de 50 filas', { productos: Array.from({ length: 51 }, () => producto()) }],
  ])('rechaza %s', (_n, over) => {
    expect(purchaseImportSchema.safeParse(extraction(over)).success).toBe(false);
  });

  it('trunca titulo y variante largos en vez de fallar', () => {
    const r = purchaseImportSchema.parse(extraction({
      productos: [producto({ titulo_corto: 'x'.repeat(500), variante: 'y'.repeat(500) })],
    }));
    expect(r.productos[0].titulo_corto).toHaveLength(80);
    expect(r.productos[0].variante).toHaveLength(200);
  });

  it('descarta campos extra (datos personales)', () => {
    const r = purchaseImportSchema.parse(extraction({
      pedido: { id: 'a', fecha: '2026-06-10', total: 1, nombre: 'Juan', telefono: '123' },
    }));
    expect(r.pedido).not.toHaveProperty('nombre');
    expect(r.pedido).not.toHaveProperty('telefono');
  });
});

describe('purchaseImportSchema: precios lista/promo (el modelo transcribe, el codigo decide)', () => {
  const sinCosto = () => { const { costo_paquete: _c, ...rest } = producto(); return rest };
  const parseProd = (over) => purchaseImportSchema.safeParse(extraction({ productos: [{ ...sinCosto(), ...over }] }));
  const first = (r) => r.data.productos[0];

  it('usa la promo cuando existe y es valida (medias magneticas)', () => {
    const r = parseProd({ precio_lista_texto: 'ARS44.635', precio_promo_texto: 'ARS21.595' });
    expect(r.success).toBe(true);
    expect(first(r)).toMatchObject({ costo_paquete: 21595, precio_lista_texto: 'ARS44.635', precio_promo_texto: 'ARS21.595', alerta_precio: false });
  });
  it.each([undefined, null, '', 'sin dato'])('promo %s => usa la lista', (promo) => {
    const r = parseProd({ precio_lista_texto: 'ARS2.676', precio_promo_texto: promo });
    expect(first(r)).toMatchObject({ costo_paquete: 2676, alerta_precio: false });
  });
  it('promo mayor o igual a la lista => se usa la promo pero con alerta_precio', () => {
    expect(first(parseProd({ precio_lista_texto: 'ARS4.944', precio_promo_texto: 'ARS9.494' }))).toMatchObject({ costo_paquete: 9494, alerta_precio: true });
    expect(first(parseProd({ precio_lista_texto: 'ARS4.944', precio_promo_texto: 'ARS4.944' })).alerta_precio).toBe(true);
  });
  it('sin textos parseables usa el numero como ultimo recurso; sin nada => falla (reintento)', () => {
    expect(first(parseProd({ precio_lista_texto: '???', costo_paquete: 2676 })).costo_paquete).toBe(2676);
    expect(parseProd({ precio_lista_texto: '???' }).success).toBe(false);
    expect(parseProd({}).success).toBe(false);
  });
  it('ya no acepta costo_paquete_texto (se descarta)', () => {
    expect(parseProd({ costo_paquete_texto: 'ARS4.944' }).success).toBe(false);
  });
  it('acota el largo de los textos', () => {
    const r = parseProd({ precio_lista_texto: 'ARS4.944' + 'x'.repeat(300), precio_promo_texto: 'ARS1.000' + 'y'.repeat(300), costo_paquete: 5 });
    expect(first(r).precio_lista_texto.length).toBeLessThanOrEqual(50);
    expect(first(r).precio_promo_texto.length).toBeLessThanOrEqual(50);
  });
});

describe('purchaseImportSchema: packs y campos vacios', () => {
  it('unidades_por_paquete default 1 cuando falta o es null', () => {
    const { unidades_por_paquete: _u, ...sin } = producto();
    expect(purchaseImportSchema.parse(extraction({ productos: [sin] })).productos[0].unidades_por_paquete).toBe(1);
    expect(purchaseImportSchema.parse(extraction({ productos: [producto({ unidades_por_paquete: null })] })).productos[0].unidades_por_paquete).toBe(1);
  });
  it('coacciona string y acepta hasta 500', () => {
    expect(purchaseImportSchema.parse(extraction({ productos: [producto({ unidades_por_paquete: '10' })] })).productos[0].unidades_por_paquete).toBe(10);
    expect(purchaseImportSchema.safeParse(extraction({ productos: [producto({ unidades_por_paquete: 500 })] })).success).toBe(true);
  });
  it.each([0, 501, 2.5, -1, 'x'])('rechaza unidades_por_paquete %s', (v) => {
    expect(purchaseImportSchema.safeParse(extraction({ productos: [producto({ unidades_por_paquete: v })] })).success).toBe(false);
  });
  it('acepta costo con decimales (precio de paquete)', () => {
    expect(purchaseImportSchema.parse(extraction({ productos: [producto({ costo_paquete: 2159.5 })] })).productos[0].costo_paquete).toBe(2159.5);
  });
  it('id y fecha vacios son validos', () => {
    const r = purchaseImportSchema.parse(extraction({ pedido: { id: '', fecha: '', total: 0 } }));
    expect(r.pedido).toEqual({ id: '', fecha: '', total: 0 });
  });
  it('pedido sin total => 0', () => {
    expect(purchaseImportSchema.parse(extraction({ pedido: { id: 'a', fecha: '' } })).pedido.total).toBe(0);
  });
});

describe('purchaseExtractRequestSchema', () => {
  const img = { type: 'image', content: 'data:image/jpeg;base64,AAAA' };
  it('acepta paginas text e image', () => {
    expect(purchaseExtractRequestSchema.safeParse({ pages: [img, { type: 'text', content: 'hola' }] }).success).toBe(true);
  });
  it('rechaza 0 y mas de 10 paginas', () => {
    expect(purchaseExtractRequestSchema.safeParse({ pages: [] }).success).toBe(false);
    expect(purchaseExtractRequestSchema.safeParse({ pages: Array(11).fill(img) }).success).toBe(false);
  });
  it('rechaza imagenes que no son data URL jpeg/png', () => {
    expect(purchaseExtractRequestSchema.safeParse({ pages: [{ type: 'image', content: 'http://evil/x.jpg' }] }).success).toBe(false);
    expect(purchaseExtractRequestSchema.safeParse({ pages: [{ type: 'image', content: 'data:text/html;base64,AAAA' }] }).success).toBe(false);
  });
  it('rechaza type desconocido y texto gigante', () => {
    expect(purchaseExtractRequestSchema.safeParse({ pages: [{ type: 'x', content: 'a' }] }).success).toBe(false);
    expect(purchaseExtractRequestSchema.safeParse({ pages: [{ type: 'text', content: 'a'.repeat(60_000) }] }).success).toBe(false);
  });
});

describe('purchaseMatchSchema', () => {
  it('trimea y acota', () => {
    expect(purchaseMatchSchema.parse({ nombres: ['  gorra '] }).nombres).toEqual(['gorra']);
    expect(purchaseMatchSchema.safeParse({ nombres: [] }).success).toBe(false);
    expect(purchaseMatchSchema.safeParse({ nombres: Array(51).fill('a') }).success).toBe(false);
    expect(purchaseMatchSchema.safeParse({ nombres: [''] }).success).toBe(false);
    expect(purchaseMatchSchema.safeParse({ nombres: ['a'.repeat(201)] }).success).toBe(false);
  });
});

describe('purchaseConfirmSchema', () => {
  const row = (over = {}) => ({ nombre: 'Gorra', variante: '', cantidad: 2, costo_unitario: 100, existe: true, ...over });
  const body = (over = {}) => ({ pedido: { id: 'PO-1', fecha: '2026-06-10' }, productos: [row()], ...over });

  it('acepta body valido y precio_venta opcional', () => {
    expect(purchaseConfirmSchema.safeParse(body()).success).toBe(true);
    expect(purchaseConfirmSchema.parse(body({ productos: [row({ existe: false, precio_venta: 250 })] })).productos[0].precio_venta).toBe(250);
  });
  it('acepta costo por unidad con 2 decimales y fecha vacia', () => {
    expect(purchaseConfirmSchema.safeParse(body({ pedido: { id: '', fecha: '' }, productos: [row({ cantidad: 10, costo_unitario: 2159.5 })] })).success).toBe(true);
    expect(purchaseConfirmSchema.parse(body({ productos: [row({ costo_unitario: 1734.6 })] })).productos[0].costo_unitario).toBe(1734.6);
  });
  it('pedido es opcional', () => {
    expect(purchaseConfirmSchema.safeParse({ productos: [row()] }).success).toBe(true);
  });
  it.each([
    ['0 filas', { productos: [] }],
    ['51 filas', { productos: Array.from({ length: 51 }, () => row()) }],
    ['cantidad 0', { productos: [row({ cantidad: 0 })] }],
    ['cantidad decimal', { productos: [row({ cantidad: 1.2 })] }],
    ['costo negativo', { productos: [row({ costo_unitario: -5 })] }],
    ['precio_venta negativo', { productos: [row({ precio_venta: -1 })] }],
    ['nombre vacio', { productos: [row({ nombre: ' ' })] }],
    ['existe no booleano', { productos: [row({ existe: 'si' })] }],
    ['fecha invalida', { pedido: { id: 'a', fecha: 'ayer' } }],
  ])('rechaza %s', (_n, over) => {
    expect(purchaseConfirmSchema.safeParse(body(over)).success).toBe(false);
  });
});

describe('purchaseImportSchema: encabezado tolerante', () => {
  const parseHeader = (pedido) => purchaseImportSchema.safeParse(extraction({ pedido }));

  it('fecha invalida ("10 jun 2026", 2026-13-45) => vacia, no rechaza la pagina', () => {
    for (const fecha of ['10 jun 2026', '2026-13-45', '2026-02-30', 12345]) {
      const r = parseHeader({ id: 'PO-1', fecha, total: 100 });
      expect(r.success).toBe(true);
      expect(r.data.pedido.fecha).toBe('');
    }
  });
  it('total invalido => 0 (desconocido)', () => {
    for (const total of ['abc', -5, {}, [], NaN]) {
      const r = parseHeader({ id: 'PO-1', fecha: '2026-06-10', total });
      expect(r.success).toBe(true);
      expect(r.data.pedido.total).toBe(0);
    }
  });
  it('id no string => string o vacio', () => {
    expect(parseHeader({ id: 12345, fecha: '', total: 1 }).data.pedido.id).toBe('12345');
    expect(parseHeader({ id: { a: 1 }, fecha: '', total: 1 }).data.pedido.id).toBe('');
  });
  it('pedido ausente => defaults', () => {
    const r = purchaseImportSchema.safeParse({ productos: [producto()] });
    expect(r.success).toBe(true);
    expect(r.data.pedido).toEqual({ id: '', fecha: '', total: 0 });
  });
  it('fecha valida y total AR siguen funcionando', () => {
    expect(parseHeader({ id: 'a', fecha: '2026-06-10', total: 'ARS57.139' }).data.pedido).toEqual({ id: 'a', fecha: '2026-06-10', total: 57139 });
  });
});

describe('purchaseImportSchema: promo ausente escrita como texto', () => {
  const sinCosto = () => { const { costo_paquete: _c, ...rest } = producto(); return rest };
  it.each(['null', 'NULL', '', '-', 'N/A', 'n/a', ' null '])('"%s" cuenta como sin promo', (promo) => {
    const r = purchaseImportSchema.parse(extraction({ productos: [{ ...sinCosto(), precio_lista_texto: 'ARS2.676', precio_promo_texto: promo }] }));
    expect(r.productos[0]).toMatchObject({ costo_paquete: 2676, precio_promo_texto: '', alerta_precio: false });
  });
});

describe('purchaseConfirmSchema: limites superiores y fechas reales', () => {
  const row = (over = {}) => ({ nombre: 'Gorra', variante: '', cantidad: 2, costo_unitario: 100, existe: true, ...over });
  const ok = (over, pedido) => purchaseConfirmSchema.safeParse({ pedido, productos: [row(over)] }).success;
  it('cantidad hasta 100000', () => {
    expect(ok({ cantidad: 100000 })).toBe(true);
    expect(ok({ cantidad: 100001 })).toBe(false);
  });
  it('costo_unitario y precio_venta hasta 100000000', () => {
    expect(ok({ costo_unitario: 100_000_000 })).toBe(true);
    expect(ok({ costo_unitario: 100_000_001 })).toBe(false);
    expect(ok({ precio_venta: 100_000_001 })).toBe(false);
  });
  it('rechaza fechas imposibles', () => {
    expect(ok({}, { id: 'a', fecha: '2026-13-45' })).toBe(false);
    expect(ok({}, { id: 'a', fecha: '2026-02-30' })).toBe(false);
    expect(ok({}, { id: 'a', fecha: '2026-02-28' })).toBe(true);
    expect(ok({}, { id: 'a', fecha: '2028-02-29' })).toBe(true);
  });
});
