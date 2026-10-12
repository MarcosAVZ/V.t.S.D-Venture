import Groq from 'groq-sdk';
import { purchaseImportSchema } from '../schemas/purchaseSchemas.js';

/**
 * Vision model for receipt extraction. Verified against https://console.groq.com/docs/vision
 * (Oct 2026): `qwen/qwen3.8-27b`, JSON mode supported with images, max 3 images per request,
 * 20MB limit for URL-image requests. The docs give no explicit base64 limit (older docs said 4MB),
 * so batches are also capped by total base64 size to stay conservative.
 * Override with the GROQ_VISION_MODEL env var.
 *
 * Output budget: the free tier allows ~1000 OUTPUT tokens per minute for this model, so the model output
 * is kept minimal (compact one-line JSON, short title, both prices as text) and each request covers ONE
 * page. Measured on the 7-product sample: ~240 characters, roughly 76 tokens per product (~560 tokens
 * for the whole sample). With max_tokens=900 (GROQ_VISION_MAX_TOKENS) about 11 products fit per page.
 */
export const DEFAULT_VISION_MODEL = 'qwen/qwen3.8-27b';
// Free tier also limits INPUT tokens (~8000/min, seen as `limit=8000 used=7992 requested=3718`) and each
// image costs ~3000 input tokens, so only ~2-3 pages/min fit: more pages wait on the 429 backoff below.
const MAX_IMAGES_PER_REQUEST = 1;
const MAX_PAGES_PER_REQUEST = 1;
const DEFAULT_MAX_TOKENS = 900;
const MAX_RATE_LIMIT_WAIT_SECONDS = 65;
const DEFAULT_RATE_LIMIT_WAIT_SECONDS = 30;
const MAX_CHARS_PER_REQUEST = 4 * 1024 * 1024;
const CHECKSUM_TOLERANCE = 0.01;

function maxTokens() {
  const n = Number.parseInt(process.env.GROQ_VISION_MAX_TOKENS ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_TOKENS;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let groq = null;
function getClient() {
  // maxRetries: 0 on purpose. groq-sdk (core.js, default maxRetries = 2) silently retries every 429 and
  // sleeps for the retry-after (up to 60s) inside a single call, which hid ~25s waits. Our own
  // AI_RATE_LIMITED handling and paced retry (extractBatchPaced) must be the only backoff.
  if (!groq) groq = new Groq({ maxRetries: 0 });
  return groq;
}

const SYSTEM_PROMPT = `Eres un sistema de extracción de datos de comprobantes de compra de tiendas online (por ejemplo Temu).

Recibís páginas de un comprobante, capturas de pantalla de la app o la web de la tienda, o fotos de un comprobante (imágenes o texto). Todas tienen los mismos campos: en una captura de la app los artículos se ven igual (título, variante, precio de lista, "Después de aplicadas las promociones", "×N"). Extraé SOLO los datos del pedido y de los artículos. Una captura puede mostrar solo una parte de la lista, y dos capturas consecutivas pueden repetir artículos: devolvé lo que ves en cada una.

PRIVACIDAD: IGNORÁ y NO devuelvas datos personales: nombre del comprador, teléfono, dirección, email, ni datos de pago (tarjeta). Si aparecen, no los copies en ningún campo.

PRECIO: para cada artículo transcribí DOS textos, exactamente como están impresos, copiando los caracteres dígito por dígito (incluido "ARS", los puntos y las comas):
- precio_lista_texto: el precio grande que aparece arriba a la derecha del artículo (ej. "ARS10.739").
- precio_promo_texto: el monto que sigue a "Después de aplicadas las promociones:" (ej. "ARS6.762"), o null si el artículo no tiene esa línea.
No elijas entre los dos, no calcules, no normalices, no redondees, no dividas por las unidades del paquete.

Devolvé exclusivamente JSON válido, COMPACTO: en una sola línea, sin saltos de línea ni espacios de más. Forma:
{"pedido":{"id":"ID de pedido (ej. PO-...) o null","fecha":"YYYY-MM-DD o null","total":número o null},"productos":[{"nombre_sugerido":"nombre CORTO de 2 a 5 palabras en español (ej. Gorra gato bordado)","titulo_corto":"solo las primeras ~8 palabras del título (máximo 80 caracteres)","variante":"variante tal como figura (color / talla / medida / cantidad de piezas) o null","cantidad":número entero >= 1 (el valor tras "×": cantidad de paquetes/líneas compradas),"unidades_por_paquete":número entero >= 1 (unidades que trae UN paquete, ver reglas),"precio_lista_texto":"ARS10.739","precio_promo_texto":"ARS6.762 o null"}]}

REGLAS:
- unidades_por_paquete: buscá cuántas unidades trae un paquete en la variante (la línea gris, ej. "10 pares", "Color Mezclado - 4 Pares") Y TAMBIÉN en el título (ej. "5 pares de calcetines..."). "10 Pares de Calcetines" a ARS21.595 ×1 es UN paquete de 10 pares: unidades_por_paquete = 10. Expresiones como "1 PC", "1 ud." o "1 pieza" significan 1. Si no se indica ninguna cantidad, usá 1.
- Formato numérico argentino: el punto es separador de miles. "ARS6.762" significa 6762. Devolvé números sin símbolos de moneda ni separadores de miles.
- La fecha como "10 jun 2026" debe devolverse como 2026-06-10.
- Las páginas con el resumen del pedido pueden no tener artículos: devolvé "productos": []. Las páginas de artículos pueden no tener resumen: devolvé null en los campos de "pedido".
- No inventes datos. Un producto por cada artículo listado, sin repetir.`;

/**
 * Splits pages into batches (default: ONE page per request, which bounds the output tokens of each call),
 * also respecting the per-request image limit and a total size budget.
 * A single page larger than the budget goes alone in its own batch.
 */
export function batchPages(pages, { maxImages = MAX_IMAGES_PER_REQUEST, maxChars = MAX_CHARS_PER_REQUEST, maxPages = MAX_PAGES_PER_REQUEST } = {}) {
  const batches = [];
  let current = [];
  let images = 0;
  let chars = 0;
  for (const page of pages) {
    const isImage = page.type === 'image';
    const size = page.content.length;
    const full = current.length > 0 && (current.length >= maxPages || (isImage && images + 1 > maxImages) || chars + size > maxChars);
    if (full) {
      batches.push(current);
      current = [];
      images = 0;
      chars = 0;
    }
    current.push(page);
    if (isImage) images += 1;
    chars += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Compares sum(costo_paquete * cantidad) with the order total (1% tolerance).
 * estado: 'ok' | 'diferencia' | 'desconocido' (no total to compare against: not a mismatch)
 */
export function computeChecksum(productos, total) {
  const suma = productos.reduce((acc, p) => acc + p.costo_paquete * p.cantidad, 0);
  if (!(total > 0)) return { estado: 'desconocido', ok: null, suma, total: 0, diferenciaPct: null };
  const diferenciaPct = Math.abs(suma - total) / total;
  const ok = diferenciaPct <= CHECKSUM_TOLERANCE;
  return { estado: ok ? 'ok' : 'diferencia', ok, suma, total, diferenciaPct };
}

/**
 * Flags items without a promo line when other items of the order have one (the usual layout shows a promo
 * for every item, so a missing one usually means it was not read). Keeps alerts already raised per item.
 */
export function flagPriceAlerts(productos) {
  const hasPromo = (p) => p.precio_promo_texto !== '';
  const anyPromo = productos.some(hasPromo);
  return productos.map((p) => ({ ...p, alerta_precio: p.alerta_precio || (anyPromo && !hasPromo(p)) }));
}

function buildUserContent(batch) {
  const content = [{ type: 'text', text: 'Extraé los datos del comprobante. Respondé solo JSON.' }];
  batch.forEach((page, i) => {
    if (page.type === 'image') {
      content.push({ type: 'image_url', image_url: { url: page.content } });
    } else {
      content.push({ type: 'text', text: `Texto de la página ${i + 1}:\n${page.content}` });
    }
  });
  return content;
}

function invalidData(message) {
  const error = new Error(message);
  error.code = 'PURCHASE_INVALID_DATA';
  return error;
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  return headers[name] ?? headers[name.toLowerCase()];
}

// Seconds to wait, from the retry-after header or a phrase like "try again in 1m5.2s" / "in 450ms"
function parseRetryAfterSeconds(error) {
  const header = Number(headerValue(error.headers, 'retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header);
  const m = /try again in (?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?/i.exec(String(error.message ?? ''));
  if (!m) return undefined;
  const seconds = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 1000;
  return seconds > 0 ? Math.ceil(seconds) : undefined;
}

function isRateLimited(error) {
  return error?.status === 429
    || error?.error?.error?.code === 'rate_limit_exceeded'
    || error?.error?.code === 'rate_limit_exceeded'
    || error?.code === 'rate_limit_exceeded';
}

// Logs only status, code and the parsed numbers: Groq error bodies carry the organization id
function logGroqError(error) {
  const text = String(error?.message ?? '');
  const num = (label) => new RegExp(label + ' (\\d+)', 'i').exec(text)?.[1];
  const parts = [`status=${error?.status ?? 'n/a'}`];
  if (isRateLimited(error)) {
    parts.push('code=rate_limit_exceeded');
    for (const label of ['Limit', 'Used', 'Requested']) {
      const value = num(label);
      if (value) parts.push(`${label.toLowerCase()}=${value}`);
    }
  } else {
    parts.push(`code=${error?.code ?? error?.name ?? 'unknown'}`);
  }
  console.error(`[purchase] Vision extraction error: ${parts.join(' ')}`);
}

function truncatedOutput() {
  const error = new Error('AI output truncated');
  error.code = 'AI_OUTPUT_TRUNCATED';
  return error;
}

// One Groq call. Returns the validated data or null when the model output is unusable.
async function extractBatch(batch, label) {
  const startedAt = Date.now();
  const response = await getClient().chat.completions.create({
    model: process.env.GROQ_VISION_MODEL || DEFAULT_VISION_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserContent(batch) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: maxTokens(),
  });
  const choice = response.choices?.[0];
  // Diagnostics only (no page content): time, why it stopped and how many tokens the model produced
  console.log(`[purchase] batch ${label} ${Date.now() - startedAt}ms finish_reason=${choice?.finish_reason ?? 'n/a'} completion_tokens=${response.usage?.completion_tokens ?? 'n/a'}`);
  // Cut by max_tokens: the JSON is incomplete, retrying the same request would cut it again
  if (choice?.finish_reason === 'length') throw truncatedOutput();
  const raw = choice?.message?.content;
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = purchaseImportSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

async function extractBatchWithRetry(batch, label) {
  try {
    const first = await extractBatch(batch, label);
    if (first) return first;
    // Retry once on invalid output (same policy as the voice flow)
    const second = await extractBatch(batch, label);
    if (second) return second;
  } catch (error) {
    if (error.code === 'AI_OUTPUT_TRUNCATED') throw error;
    logGroqError(error);
    if (isRateLimited(error)) {
      const limited = new Error('AI rate limited', { cause: error });
      limited.code = 'AI_RATE_LIMITED';
      limited.retryAfterSeconds = parseRetryAfterSeconds(error);
      throw limited;
    }
    const wrapped = new Error(`AI extraction failed: ${error.message}`, { cause: error });
    wrapped.code = 'AI_EXTRACTION_FAILED';
    throw wrapped;
  }
  throw invalidData('AI extraction produced invalid data');
}

// After the first batch, a 429 waits for the limit window (capped) and retries that batch once
async function extractBatchPaced(batch, isFirst, label) {
  try {
    return await extractBatchWithRetry(batch, label);
  } catch (error) {
    if (error.code !== 'AI_RATE_LIMITED' || isFirst) throw error;
    const seconds = Math.min(error.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_WAIT_SECONDS, MAX_RATE_LIMIT_WAIT_SECONDS);
    console.log(`[purchase] rate limited, waiting ${seconds}s before retrying the batch`);
    await sleep(seconds * 1000);
    return extractBatchWithRetry(batch, label);
  }
}

/**
 * Extracts a purchase order from receipt pages using a Groq vision model.
 * @param {Array<{type: 'text'|'image', content: string}>} pages
 * @returns {Promise<{pedido, productos, checksum}>}
 * @throws {Error} code AI_EXTRACTION_FAILED | AI_RATE_LIMITED (retryAfterSeconds) | AI_OUTPUT_TRUNCATED | PURCHASE_INVALID_DATA
 */
export async function extractPurchase(pages) {
  const batches = batchPages(pages);
  console.log(`[purchase] Extracting ${pages.length} page(s) in ${batches.length} batch(es)`);

  const pedido = { id: '', fecha: '', total: 0 };
  const productos = [];
  // Sequential on purpose: keeps order of products and avoids Groq rate-limit bursts
  let firstPage = 1; // 1-based index (in the pages sent) of the first page of the current batch
  for (const [i, batch] of batches.entries()) {
    const data = await extractBatchPaced(batch, i === 0, `${i + 1}/${batches.length}`);
    pedido.id = pedido.id || data.pedido.id;
    pedido.fecha = pedido.fecha || data.pedido.fecha;
    pedido.total = pedido.total || data.pedido.total;
    // `pagina` lets the client map each product back to the page/image it came from
    productos.push(...data.productos.map((p) => ({ ...p, pagina: firstPage })));
    firstPage += batch.length;
  }

  if (productos.length === 0) throw invalidData('No products found');
  if (productos.length > 50) throw invalidData('Too many products');

  const flagged = flagPriceAlerts(productos);
  return { pedido, productos: flagged, checksum: computeChecksum(flagged, pedido.total) };
}
