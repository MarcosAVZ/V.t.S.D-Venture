import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCreate, ctorOptions } = vi.hoisted(() => ({ mockCreate: vi.fn(), ctorOptions: [] }));
vi.mock('groq-sdk', () => ({
  default: class Groq {
    constructor(options) { ctorOptions.push(options); }
    chat = { completions: { create: mockCreate } };
  },
}));

import {
  extractPurchase,
  batchPages,
  computeChecksum,
  DEFAULT_VISION_MODEL,
} from '../src/services/purchaseExtractionService.js';

const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });
const p = (nombre, cantidad, costo, unidades_por_paquete = 1) => ({
  nombre_sugerido: nombre,
  titulo_corto: `${nombre} - titulo larguisimo del vendedor`,
  variante: 'talla única',
  cantidad,
  unidades_por_paquete,
  costo_paquete: costo,
});

// Modelled on a real receipt: 7 products, neceser x2 at 2676, order total 57139
const SAMPLE = {
  pedido: { id: 'PO-0000', fecha: '2026-06-10', total: 57139 },
  productos: [
    p('Gorra gato bordado', 1, 6762),
    p('Neceser organizador', 2, 2676),
    p('Funda celular', 1, 8990),
    p('Set pinzas', 1, 12500),
    p('Luz led', 1, 9876),
    p('Medias', 1, 7000),
    p('Llavero', 1, 6660),
  ],
};

const img = (n = 8) => ({ type: 'image', content: `data:image/jpeg;base64,${'A'.repeat(n)}` });

beforeEach(() => {
  mockCreate.mockReset();
  delete process.env.GROQ_VISION_MODEL;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('computeChecksum', () => {
  it('ok dentro del 1%', () => {
    const c = computeChecksum(SAMPLE.productos, 57139);
    expect(c.suma).toBe(57140);
    expect(c.ok).toBe(true);
  });
  it('falla fuera del 1%', () => {
    expect(computeChecksum(SAMPLE.productos, 80000).ok).toBe(false);
  });
  it('estado ok / diferencia', () => {
    expect(computeChecksum(SAMPLE.productos, 57139)).toMatchObject({ estado: 'ok', ok: true });
    expect(computeChecksum(SAMPLE.productos, 80000)).toMatchObject({ estado: 'diferencia', ok: false });
  });
  it.each([0, undefined, null, NaN])('total desconocido (%s) => estado desconocido, no es una diferencia', (t) => {
    const c = computeChecksum(SAMPLE.productos, t);
    expect(c).toMatchObject({ estado: 'desconocido', ok: null, diferenciaPct: null });
    expect(c.suma).toBe(57140);
  });
  it('usa precio de paquete x cantidad (no divide por unidades)', () => {
    const packs = [p('Calcetines', 1, 21595, 10), p('Calcetines B', 1, 4944, 4)];
    expect(computeChecksum(packs, 26539)).toMatchObject({ estado: 'ok', suma: 26539 });
  });
});

describe('batchPages', () => {
  it('agrupa de a maxImages', () => {
    const batches = batchPages([img(), img(), img(), img(), img()], { maxImages: 3, maxChars: 1e6, maxPages: Infinity });
    expect(batches.map((b) => b.length)).toEqual([3, 2]);
  });
  it('corta por tamaño acumulado', () => {
    const batches = batchPages([img(100), img(100), img(100)], { maxImages: 3, maxChars: 250, maxPages: Infinity });
    expect(batches.map((b) => b.length)).toEqual([2, 1]);
  });
  it('por defecto UNA pagina por request (acota los tokens de salida)', () => {
    const batches = batchPages([img(), img(), { type: 'text', content: 'hola' }]);
    expect(batches.map((b) => b.length)).toEqual([1, 1, 1]);
  });
  it('una pagina mas grande que el limite va sola', () => {
    expect(batchPages([img(500)], { maxImages: 3, maxChars: 100, maxPages: Infinity })).toHaveLength(1);
  });
});

describe('extractPurchase', () => {
  it('camino feliz con paginas de imagen: 7 productos y checksum ok', async () => {
    mockCreate.mockResolvedValue(reply(SAMPLE));
    const r = await extractPurchase([img()]);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(r.productos).toHaveLength(7);
    expect(r.productos[1]).toMatchObject({ nombre_sugerido: 'Neceser organizador', cantidad: 2, costo_paquete: 2676 });
    expect(r.pedido.total).toBe(57139);
    expect(r.checksum).toMatchObject({ ok: true, suma: 57140, total: 57139 });
  });

  it('arma el mensaje con imagenes y texto, JSON mode y modelo por defecto', async () => {
    mockCreate.mockResolvedValue(reply(SAMPLE));
    await extractPurchase([img(), { type: 'text', content: 'texto de la pagina' }]);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const args = mockCreate.mock.calls[0][0];
    expect(args.model).toBe(DEFAULT_VISION_MODEL);
    expect(args.response_format).toEqual({ type: 'json_object' });
    const imageMsg = args.messages.find((m) => m.role === 'user');
    expect(imageMsg.content.filter((c) => c.type === 'image_url')).toHaveLength(1);
    const textMsg = mockCreate.mock.calls[1][0].messages.find((m) => m.role === 'user');
    expect(textMsg.content.some((c) => c.type === 'text' && c.text.includes('texto de la pagina'))).toBe(true);
  });

  it('el prompt pide buscar unidades por paquete en variante Y titulo, y costo por paquete', async () => {
    mockCreate.mockResolvedValue(reply(SAMPLE));
    await extractPurchase([img()]);
    const system = mockCreate.mock.calls[0][0].messages.find((m) => m.role === 'system').content;
    expect(system).toContain('unidades_por_paquete');
    expect(system).toMatch(/variante[\s\S]*t[ií]tulo/i);
    expect(system).toMatch(/1 PC/);
  });

  it('el prompt ya no pide al modelo elegir el precio (lo decide el codigo)', async () => {
    mockCreate.mockResolvedValue(reply(SAMPLE));
    await extractPurchase([img()]);
    const system = mockCreate.mock.calls[0][0].messages.find((m) => m.role === 'system').content;
    expect(system).not.toMatch(/NUNCA[^.\n]*precio de lista/i);
    expect(system).not.toContain('costo_paquete');
  });

  it('el prompt pide transcribir lista y promo (sin elegir) digito por digito', async () => {
    mockCreate.mockResolvedValue(reply(SAMPLE));
    await extractPurchase([img()]);
    const system = mockCreate.mock.calls[0][0].messages.find((m) => m.role === 'system').content;
    expect(system).toContain('precio_lista_texto');
    expect(system).toContain('precio_promo_texto');
    expect(system).not.toContain('costo_paquete_texto');
    expect(system).toMatch(/Despu[eé]s de aplicadas las promociones/);
    expect(system).toMatch(/arriba a la derecha/i);
    expect(system).toMatch(/d[ií]gito por d[ií]gito/i);
    expect(system).toMatch(/no (calcules|normalices|elijas)/i);
    expect(system).toMatch(/null/);
    expect(system).toContain('ARS10.739');
    expect(system).toContain('ARS6.762');
    // bloque de precios antes del esquema JSON
    expect(system.indexOf('PRECIO')).toBeGreaterThan(-1);
    expect(system.indexOf('PRECIO')).toBeLessThan(system.indexOf('"pedido"'));
  });

  describe('precios lista/promo', () => {
    const conPrecios = (nombre, lista, promo, cantidad = 1, unidades = 1) => {
      const { costo_paquete: _c, ...rest } = p(nombre, cantidad, 0, unidades);
      return { ...rest, precio_lista_texto: lista, precio_promo_texto: promo };
    };
    const page = (...productos) => reply({ pedido: SAMPLE.pedido, productos });

    it('medias magneticas: lista ARS44.635, promo ARS21.595 => 21595', async () => {
      mockCreate.mockResolvedValue(page(conPrecios('Calcetines magneticos', 'ARS44.635', 'ARS21.595', 1, 10)));
      const r = await extractPurchase([img()]);
      expect(r.productos[0]).toMatchObject({
        costo_paquete: 21595, precio_lista_texto: 'ARS44.635', precio_promo_texto: 'ARS21.595', alerta_precio: false, unidades_por_paquete: 10,
      });
    });

    it('sin linea de promo => usa la lista', async () => {
      mockCreate.mockResolvedValue(page(conPrecios('Llavero', 'ARS6.660', null)));
      const r = await extractPurchase([img()]);
      expect(r.productos[0]).toMatchObject({ costo_paquete: 6660, alerta_precio: false });
    });

    it('promo >= lista => alerta_precio', async () => {
      mockCreate.mockResolvedValue(page(conPrecios('Calcetines coreanos', 'ARS4.944', 'ARS9.494')));
      expect((await extractPurchase([img()])).productos[0].alerta_precio).toBe(true);
    });

    it('item sin promo mientras otros la tienen => alerta_precio (tambien entre paginas)', async () => {
      mockCreate
        .mockResolvedValueOnce(page(conPrecios('A', 'ARS10.000', 'ARS6.000'), conPrecios('B', 'ARS5.000', null)))
        .mockResolvedValueOnce(reply({ pedido: { id: null, fecha: null, total: null }, productos: [conPrecios('C', 'ARS8.000', null)] }));
      const r = await extractPurchase([img(), img()]);
      expect(r.productos.map((x) => x.alerta_precio)).toEqual([false, true, true]);
    });

    it('si ningun item tiene promo no hay alertas', async () => {
      mockCreate.mockResolvedValue(page(conPrecios('A', 'ARS1.000', null), conPrecios('B', 'ARS2.000', null)));
      expect((await extractPurchase([img()])).productos.map((x) => x.alerta_precio)).toEqual([false, false]);
    });

    it('precios ilegibles y sin numero => reintenta una vez y luego usa la respuesta buena', async () => {
      mockCreate
        .mockResolvedValueOnce(page(conPrecios('A', '???', '???')))
        .mockResolvedValueOnce(page(conPrecios('A', 'ARS4.944', 'ARS2.000')));
      const r = await extractPurchase([img()]);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(r.productos[0].costo_paquete).toBe(2000);
    });

    it('ilegibles dos veces => PURCHASE_INVALID_DATA', async () => {
      mockCreate.mockResolvedValue(page(conPrecios('A', '???', null)));
      await expect(extractPurchase([img()])).rejects.toMatchObject({ code: 'PURCHASE_INVALID_DATA' });
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('muestra completa de 7 productos con textos: suma 57140 y checksum ok', async () => {
      const fmt = (n) => `ARS${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
      const items = [
        ['Gorra gato bordado', 1, 6762, 1], ['Neceser organizador', 2, 2676, 1], ['Calcetines coreanos', 1, 4944, 4],
        ['Calcetines magneticos', 1, 21595, 10], ['Calcetines tripulacion', 1, 8673, 5], ['Set pinzas', 1, 2845, 1], ['Luz led', 1, 6969, 1],
      ];
      const productos = items.map(([n, c, promo, u]) => conPrecios(n, fmt(Math.round(promo * 2.07)), fmt(promo), c, u));
      mockCreate.mockResolvedValue(reply({ pedido: { id: 'PO-1', fecha: '2026-06-10', total: 57139 }, productos }));
      const r = await extractPurchase([img()]);
      expect(r.productos).toHaveLength(7);
      expect(r.checksum).toMatchObject({ estado: 'ok', suma: 57140 });
      expect(r.productos.every((x) => x.alerta_precio === false)).toBe(true);
    });
  });

  it('registra tiempo, finish_reason y tokens de cada lote sin contenido', async () => {
    mockCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(SAMPLE) } }], usage: { completion_tokens: 321 } });
    await extractPurchase([img()]);
    const logged = console.log.mock.calls.flat().join(' ');
    expect(logged).toMatch(/batch 1\/1 .*\d+ms/);
    expect(logged).toContain('completion_tokens=321');
    expect(logged).not.toContain('Neceser');
  });

  it('conserva unidades_por_paquete y total desconocido', async () => {
    mockCreate.mockResolvedValue(reply({
      pedido: { id: '', fecha: '', total: null },
      productos: [p('Calcetines', 1, 21595, 10)],
    }));
    const r = await extractPurchase([img()]);
    expect(r.productos[0]).toMatchObject({ unidades_por_paquete: 10, costo_paquete: 21595 });
    expect(r.pedido).toEqual({ id: '', fecha: '', total: 0 });
    expect(r.checksum.estado).toBe('desconocido');
  });

  it('el prompt pide ignorar datos personales y usar el precio con promociones', async () => {
    mockCreate.mockResolvedValue(reply(SAMPLE));
    await extractPurchase([img()]);
    const system = mockCreate.mock.calls[0][0].messages.find((m) => m.role === 'system').content;
    expect(system).toMatch(/IGNOR/);
    expect(system).toMatch(/nombre.*tel[eé]fono.*direcci[oó]n/is);
    expect(system).toMatch(/tarjeta/i);
    expect(system).toMatch(/promociones/i);
  });

  it('usa GROQ_VISION_MODEL si esta definido', async () => {
    process.env.GROQ_VISION_MODEL = 'otro/modelo';
    mockCreate.mockResolvedValue(reply(SAMPLE));
    await extractPurchase([img()]);
    expect(mockCreate.mock.calls[0][0].model).toBe('otro/modelo');
  });

  it('una request por pagina: 2 paginas => 2 llamadas y resultados fusionados', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ pedido: SAMPLE.pedido, productos: SAMPLE.productos.slice(0, 3) }))
      .mockResolvedValueOnce(reply({ pedido: { id: null, fecha: null, total: null }, productos: SAMPLE.productos.slice(3) }));
    const r = await extractPurchase([img(), img()]);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(r.productos).toHaveLength(7);
    expect(r.pedido).toEqual(SAMPLE.pedido);
    expect(r.checksum.ok).toBe(true);
  });

  it('reintenta una vez si la validacion falla', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ pedido: SAMPLE.pedido, productos: [p('X', 0, 10)] }))
      .mockResolvedValueOnce(reply(SAMPLE));
    const r = await extractPurchase([img()]);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(r.productos).toHaveLength(7);
  });

  it('reintenta si el modelo devuelve JSON roto', async () => {
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: 'no json' } }] })
      .mockResolvedValueOnce(reply(SAMPLE));
    expect((await extractPurchase([img()])).productos).toHaveLength(7);
  });

  it('dos fallos de validacion => PURCHASE_INVALID_DATA', async () => {
    mockCreate.mockResolvedValue(reply({ pedido: SAMPLE.pedido, productos: [p('X', 0, 10)] }));
    await expect(extractPurchase([img()])).rejects.toMatchObject({ code: 'PURCHASE_INVALID_DATA' });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('sin productos tras fusionar => PURCHASE_INVALID_DATA', async () => {
    mockCreate.mockResolvedValue(reply({ pedido: SAMPLE.pedido, productos: [] }));
    await expect(extractPurchase([img()])).rejects.toMatchObject({ code: 'PURCHASE_INVALID_DATA' });
  });

  it('error de red/Groq => AI_EXTRACTION_FAILED con cause, sin reintento', async () => {
    const boom = new Error('network down');
    mockCreate.mockRejectedValue(boom);
    const err = await extractPurchase([img()]).catch((e) => e);
    expect(err.code).toBe('AI_EXTRACTION_FAILED');
    expect(err.cause).toBe(boom);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('checksum falso cuando la extraccion no cierra con el total', async () => {
    mockCreate.mockResolvedValue(reply({ ...SAMPLE, pedido: { ...SAMPLE.pedido, total: 99999 } }));
    expect((await extractPurchase([img()])).checksum.ok).toBe(false);
  });

  it('no loguea el contenido de las paginas ni la respuesta', async () => {
    mockCreate.mockResolvedValue(reply(SAMPLE));
    await extractPurchase([{ type: 'text', content: 'SECRETO-PERSONAL' }]);
    const logged = [...console.log.mock.calls, ...console.error.mock.calls].flat().join(' ');
    expect(logged).not.toContain('SECRETO-PERSONAL');
    expect(logged).not.toContain('Neceser');
  });
});

describe('max_tokens', () => {
  it('default 900, configurable con GROQ_VISION_MAX_TOKENS', async () => {
    mockCreate.mockResolvedValue(reply(SAMPLE));
    await extractPurchase([img()]);
    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(900);
    process.env.GROQ_VISION_MAX_TOKENS = '700';
    await extractPurchase([img()]);
    expect(mockCreate.mock.calls[1][0].max_tokens).toBe(700);
    delete process.env.GROQ_VISION_MAX_TOKENS;
  });
  it.each(['abc', '0', '-5', ''])('valor invalido %s => default', async (v) => {
    process.env.GROQ_VISION_MAX_TOKENS = v;
    mockCreate.mockResolvedValue(reply(SAMPLE));
    await extractPurchase([img()]);
    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(900);
    delete process.env.GROQ_VISION_MAX_TOKENS;
  });
});

describe('salida truncada', () => {
  it('finish_reason length => AI_OUTPUT_TRUNCATED sin reintento de parseo', async () => {
    mockCreate.mockResolvedValue({ choices: [{ finish_reason: 'length', message: { content: '{"pedido":{"id":"PO' } }] });
    await expect(extractPurchase([img()])).rejects.toMatchObject({ code: 'AI_OUTPUT_TRUNCATED' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe('prompt compacto', () => {
  it('usa titulo_corto, pide JSON en una linea y no pide el costo numerico', async () => {
    mockCreate.mockResolvedValue(reply(SAMPLE));
    await extractPurchase([img()]);
    const system = mockCreate.mock.calls[0][0].messages.find((m) => m.role === 'system').content;
    expect(system).toContain('titulo_corto');
    expect(system).not.toContain('titulo_original');
    expect(system).toMatch(/una sola l[ií]nea/i);
    expect(system).toMatch(/80 caracteres/);
    expect(system).not.toMatch(/"costo_paquete"/);
  });
});

describe('cliente Groq de vision', () => {
  it('se crea con maxRetries: 0 (el reintento/espera lo maneja la app, no el SDK)', async () => {
    vi.resetModules();
    ctorOptions.length = 0;
    const fresh = await import('../src/services/purchaseExtractionService.js');
    mockCreate.mockResolvedValue(reply(SAMPLE));
    await fresh.extractPurchase([img()]);
    expect(ctorOptions).toHaveLength(1);
    expect(ctorOptions[0]).toMatchObject({ maxRetries: 0 });
  });
});

describe('rate limit de Groq (429)', () => {
  const rateLimit = ({ headers, message } = {}) => Object.assign(
    new Error(message ?? '429 {"error":{"message":"Rate limit reached for model in organization org_SECRET123 on tokens per minute (TPM): Limit 1000, Used 0, Requested 1045. Please try again in 12.34s.","code":"rate_limit_exceeded"}}'),
    { status: 429, headers, error: { error: { code: 'rate_limit_exceeded' } } },
  );

  it('primer lote: AI_RATE_LIMITED con retryAfterSeconds del header, sin esperar ni reintentar', async () => {
    mockCreate.mockRejectedValue(rateLimit({ headers: { 'retry-after': '12' } }));
    const err = await extractPurchase([img()]).catch((e) => e);
    expect(err).toMatchObject({ code: 'AI_RATE_LIMITED', retryAfterSeconds: 12 });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('soporta headers tipo Headers (.get)', async () => {
    mockCreate.mockRejectedValue(rateLimit({ headers: new Headers({ 'retry-after': '7' }) }));
    expect((await extractPurchase([img()]).catch((e) => e)).retryAfterSeconds).toBe(7);
  });

  it.each([
    ['Please try again in 12.34s.', 13],
    ['Please try again in 1m5.2s.', 66],
    ['Please try again in 450ms.', 1],
  ])('parsea el retry-after del mensaje: %s', async (frase, esperado) => {
    mockCreate.mockRejectedValue(rateLimit({ message: `429 rate_limit_exceeded. ${frase}` }));
    expect((await extractPurchase([img()]).catch((e) => e)).retryAfterSeconds).toBe(esperado);
  });

  it('sin dato de espera => retryAfterSeconds undefined', async () => {
    mockCreate.mockRejectedValue(rateLimit({ message: '429 rate_limit_exceeded' }));
    const err = await extractPurchase([img()]).catch((e) => e);
    expect(err.code).toBe('AI_RATE_LIMITED');
    expect(err.retryAfterSeconds).toBeUndefined();
  });

  it('detecta rate_limit_exceeded por codigo aunque no haya status', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('x'), { error: { error: { code: 'rate_limit_exceeded' } } }));
    expect((await extractPurchase([img()]).catch((e) => e)).code).toBe('AI_RATE_LIMITED');
  });

  describe('entre lotes', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('loguea "rate limited, waiting Ns" cuando espera', async () => {
      mockCreate
        .mockResolvedValueOnce(reply(SAMPLE))
        .mockRejectedValueOnce(rateLimit({ headers: { 'retry-after': '2' } }))
        .mockResolvedValueOnce(reply({ pedido: { id: null, fecha: null, total: null }, productos: [] }));
      const promise = extractPurchase([img(), img()]);
      await vi.advanceTimersByTimeAsync(2100);
      await promise;
      expect(console.log.mock.calls.flat().join(' ')).toContain('[purchase] rate limited, waiting 2s');
    });

    it('espera el retry-after y reintenta ese lote una vez', async () => {
      mockCreate
        .mockResolvedValueOnce(reply({ pedido: SAMPLE.pedido, productos: SAMPLE.productos.slice(0, 3) }))
        .mockRejectedValueOnce(rateLimit({ headers: { 'retry-after': '2' } }))
        .mockResolvedValueOnce(reply({ pedido: { id: null, fecha: null, total: null }, productos: SAMPLE.productos.slice(3) }));
      const promise = extractPurchase([img(), img()]);
      await vi.advanceTimersByTimeAsync(1900);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(200);
      const r = await promise;
      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(r.productos).toHaveLength(7);
    });

    it('la espera se acota a 65s', async () => {
      mockCreate
        .mockResolvedValueOnce(reply(SAMPLE))
        .mockRejectedValueOnce(rateLimit({ headers: { 'retry-after': '500' } }))
        .mockResolvedValueOnce(reply({ pedido: { id: null, fecha: null, total: null }, productos: [] }));
      const promise = extractPurchase([img(), img()]);
      await vi.advanceTimersByTimeAsync(64_900);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(200);
      await promise;
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });

    it('si vuelve a dar 429 tras esperar => AI_RATE_LIMITED', async () => {
      mockCreate
        .mockResolvedValueOnce(reply(SAMPLE))
        .mockRejectedValue(rateLimit({ headers: { 'retry-after': '1' } }));
      const promise = extractPurchase([img(), img()]).catch((e) => e);
      await vi.advanceTimersByTimeAsync(2000);
      const err = await promise;
      expect(err.code).toBe('AI_RATE_LIMITED');
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });

  it('el log de error no incluye el cuerpo (org id) y si status, codigo y limites', async () => {
    mockCreate.mockRejectedValue(rateLimit({ headers: { 'retry-after': '3' } }));
    await extractPurchase([img()]).catch(() => {});
    const logged = console.error.mock.calls.flat().join(' ');
    expect(logged).not.toContain('org_SECRET123');
    expect(logged).toContain('429');
    expect(logged).toContain('rate_limit_exceeded');
    expect(logged).toMatch(/limit=1000/);
    expect(logged).toMatch(/requested=1045/);
  });
});

describe('procedencia por pagina y prompt para capturas', () => {
  it('cada producto lleva `pagina` (1-based, en el orden de las paginas enviadas)', async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ pedido: SAMPLE.pedido, productos: SAMPLE.productos.slice(0, 3) }))
      .mockResolvedValueOnce(reply({ pedido: { id: null, fecha: null, total: null }, productos: SAMPLE.productos.slice(3, 5) }))
      .mockResolvedValueOnce(reply({ pedido: { id: null, fecha: null, total: null }, productos: SAMPLE.productos.slice(5) }));
    const r = await extractPurchase([img(), img(), img()]);
    expect(r.productos.map((x) => x.pagina)).toEqual([1, 1, 1, 2, 2, 3, 3]);
  });

  it('la pagina cuenta las paginas enviadas, no las del PDF original', async () => {
    mockCreate.mockResolvedValue(reply({ pedido: SAMPLE.pedido, productos: [SAMPLE.productos[0]] }));
    const r = await extractPurchase([{ type: 'text', content: 'texto' }, img()]);
    expect(r.productos.map((x) => x.pagina)).toEqual([1, 2]);
  });

  it('el prompt habla de comprobante/captura y no asume un PDF', async () => {
    mockCreate.mockResolvedValue(reply(SAMPLE));
    await extractPurchase([img()]);
    const system = mockCreate.mock.calls[0][0].messages.find((m) => m.role === 'system').content;
    expect(system).toMatch(/captura/i);
    expect(system).toMatch(/foto/i);
    expect(system).not.toMatch(/PDF/);
    // las reglas de precio siguen vigentes
    expect(system).toContain('precio_lista_texto');
    expect(system).toContain('precio_promo_texto');
    expect(system).toMatch(/Despu[eé]s de aplicadas las promociones/);
  });
});
