import { z } from 'zod';

const MAX_STR = 200;
const MAX_PRODUCTOS = 50;
const MAX_PACK_UNITS = 500;
const MAX_QTY = 100_000;
const MAX_MONEY = 100_000_000;
export const MAX_PAGES = 10;
const MAX_TEXT_CHARS = 50_000;
// Base64 JPEG/PNG of a page rendered at scale ~2 is well under this; the route body limit is the real cap
const MAX_IMAGE_CHARS = 8_000_000;

/**
 * Parses numbers written in Argentine format ("." thousands, "," decimals), with optional
 * currency prefix: "ARS6.762" -> 6762, "1.234,56" -> 1234.56.
 * Numbers pass through; null/'' -> undefined; anything unparseable is returned as-is so zod rejects it.
 */
export function parseArNumber(val) {
  if (val === null || val === undefined) return undefined;
  if (typeof val !== 'string') return val;
  const s = val.replace(/ars|\$|\s/gi, '');
  if (s === '') return undefined;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+(,\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  return val;
}

const money = z.preprocess(parseArNumber, z.number().finite().nonnegative().max(MAX_MONEY));
const moneyOrZero = z.preprocess(parseArNumber, z.number().finite().nonnegative().optional()).transform((v) => v ?? 0);
const qty = z.preprocess(parseArNumber, z.number().finite().int().min(1).max(MAX_QTY));

// Units inside one pack ("10 pares" -> 10). Missing/null means a single unit.
const packUnits = z.preprocess(
  (v) => { const n = parseArNumber(v); return n === undefined ? 1 : n },
  z.number().finite().int().min(1).max(MAX_PACK_UNITS),
);

const str = z.string().trim().min(1).max(MAX_STR);
// Long free text from the AI (titles, variants): truncate instead of failing the whole extraction
const clippedStr = z.preprocess(
  (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v.trim().slice(0, MAX_STR) : v),
  z.string().max(MAX_STR),
);
// Short title shown small in the UI (the model is asked for ~8 words / 80 chars; extra is cut, not an error)
const MAX_TITLE = 80;
const clippedTitle = z.preprocess(
  (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v.trim().slice(0, MAX_TITLE) : v),
  z.string().max(MAX_TITLE),
);
const optStr = z.preprocess((v) => (v === null ? undefined : v), z.string().trim().max(MAX_STR).optional()).transform((v) => v ?? '');

const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// YYYY-MM-DD that exists in the calendar (rejects 2026-13-45 and 2026-02-30)
function isRealDate(value) {
  const m = FECHA_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

// Strict: used for what the user confirms ('' = unknown, the import falls back to today)
const fecha = z.preprocess(
  (v) => (v === null || v === undefined ? '' : v),
  z.string().trim().refine((v) => v === '' || isRealDate(v), { message: 'Fecha debe ser YYYY-MM-DD' }),
);

// Lenient: used for the model output. A misread header ("10 jun 2026") must not reject the whole page
const fechaLenient = z.preprocess(
  (v) => (typeof v === 'string' && isRealDate(v.trim()) ? v.trim() : ''),
  z.string(),
);
const idLenient = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_STR) : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''),
  z.string(),
);
const totalLenient = z.preprocess(
  (v) => { const n = parseArNumber(v); return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0 },
  z.number(),
);

// The model only TRANSCRIBES both printed prices ("ARS44.635" list, "ARS21.595" after promotions);
// the code decides: promo when present and valid, else list, else a numeric costo_paquete as last resort.
const MAX_TEXTO = 50;
// "null", "-", "N/A"... written as text by the model mean "no value"
const ABSENT_TEXTS = new Set(['', 'null', 'none', 'undefined', '-', '--', 'n/a', 'na']);
const textoPrecio = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return ABSENT_TEXTS.has(t.toLowerCase()) ? undefined : t.slice(0, MAX_TEXTO);
  },
  z.string().optional(),
);

const validPrice = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

const productoSchema = z.object({
  nombre_sugerido: z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, MAX_STR) : v), z.string().min(1)),
  titulo_corto: clippedTitle,
  variante: clippedStr,
  cantidad: qty,
  unidades_por_paquete: packUnits,
  precio_lista_texto: textoPrecio,
  precio_promo_texto: textoPrecio,
  costo_paquete: z.unknown().optional(),
}).transform((p, ctx) => {
  const lista = parseArNumber(p.precio_lista_texto);
  const promo = parseArNumber(p.precio_promo_texto);
  const numeric = parseArNumber(p.costo_paquete);
  const costo = [promo, lista, numeric].find(validPrice);
  if (costo === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['costo_paquete'], message: 'Precio ilegible' });
    return z.NEVER;
  }
  return {
    nombre_sugerido: p.nombre_sugerido,
    titulo_corto: p.titulo_corto,
    variante: p.variante,
    cantidad: p.cantidad,
    unidades_por_paquete: p.unidades_por_paquete,
    costo_paquete: costo,
    precio_lista_texto: p.precio_lista_texto ?? '',
    precio_promo_texto: p.precio_promo_texto ?? '',
    // A promo that is not lower than the list price means one of the two was misread
    alerta_precio: validPrice(promo) && validPrice(lista) && promo >= lista,
  };
});

// What the vision model must return (strips unknown keys => personal data never survives)
export const purchaseImportSchema = z.object({
  pedido: z.preprocess(
    (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
    z.object({ id: idLenient, fecha: fechaLenient, total: totalLenient }),
  ),
  productos: z.array(productoSchema).max(MAX_PRODUCTOS),
});

// POST /api/purchase/extract body
export const purchaseExtractRequestSchema = z.object({
  pages: z.array(z.discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      content: z.string().min(1).max(MAX_TEXT_CHARS),
    }),
    z.object({
      type: z.literal('image'),
      content: z.string().max(MAX_IMAGE_CHARS).regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/),
    }),
  ])).min(1).max(MAX_PAGES),
});

// POST /api/purchase/match body
export const purchaseMatchSchema = z.object({
  nombres: z.array(str).min(1).max(MAX_PRODUCTOS),
});

// POST /api/purchase/import body (what the user confirmed in the review table)
export const purchaseConfirmSchema = z.object({
  pedido: z.object({ id: optStr, fecha }).optional(),
  productos: z.array(z.object({
    nombre: str,
    variante: optStr,
    cantidad: qty,
    costo_unitario: money,
    precio_venta: z.number().finite().nonnegative().max(MAX_MONEY).optional(),
    existe: z.boolean(),
  })).min(1).max(MAX_PRODUCTOS),
});
