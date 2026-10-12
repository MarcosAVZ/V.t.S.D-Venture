import { Router } from 'express';
import { extractPurchase } from '../services/purchaseExtractionService.js';
import { todayAR } from '../utils/dateAr.js';
import { executeOperation, findProductByName } from '../services/sheetsService.js';
import {
  purchaseExtractRequestSchema,
  purchaseMatchSchema,
  purchaseConfirmSchema,
} from '../schemas/purchaseSchemas.js';

const router = Router();

const MATCH_CONCURRENCY = 5;
const normName = (s) => s.trim().toLowerCase();

// POST /api/purchase/extract — READ-ONLY: pages (text/image) -> vision model -> validated purchase.
// The 15mb body limit for this route is set in index.js (before the global 100kb parser).
router.post('/extract', async (req, res) => {
  const parsed = purchaseExtractRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: 'Páginas inválidas' });
  }

  try {
    const result = await extractPurchase(parsed.data.pages);
    res.json(result);
  } catch (error) {
    // Never log page content or model output, only the error code/message
    console.error('[purchase] Extract error:', error.code || error.message);
    if (error.code === 'PURCHASE_INVALID_DATA') {
      return res.status(422).json({ error: 'No pude leer los productos del comprobante' });
    }
    if (error.code === 'AI_RATE_LIMITED') {
      const body = { error: 'Se alcanzó el límite de uso de Groq. Esperá un minuto y volvé a intentar.' };
      if (error.retryAfterSeconds) {
        body.retryAfterSeconds = error.retryAfterSeconds;
        res.set('Retry-After', String(error.retryAfterSeconds));
      }
      return res.status(429).json(body);
    }
    if (error.code === 'AI_OUTPUT_TRUNCATED') {
      return res.status(422).json({ error: 'El comprobante tiene demasiados productos en una página. Probá con menos páginas a la vez.' });
    }
    if (error.code === 'AI_EXTRACTION_FAILED') {
      return res.status(500).json({ error: 'AI extraction failed' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/purchase/match — READ-ONLY: which names already exist in the inventory
router.post('/match', async (req, res) => {
  const parsed = purchaseMatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: 'Nombres inválidos' });
  }
  if (!process.env.GOOGLE_SHEETS_URL) {
    return res.status(500).json({ error: 'Google Sheets no configurado' });
  }

  const { nombres } = parsed.data;
  try {
    const resultados = [];
    for (let i = 0; i < nombres.length; i += MATCH_CONCURRENCY) {
      const chunk = nombres.slice(i, i + MATCH_CONCURRENCY);
      const found = await Promise.all(chunk.map((nombre) => findProductByName(nombre)));
      chunk.forEach((nombre, j) => {
        const r = found[j];
        if (r?.success && r.found && r.product) {
          const { id, nombre: nombreProducto, stock } = r.product;
          resultados.push({ nombre, existe: true, producto: { id, nombre: nombreProducto, ...(stock !== undefined && { stock }) } });
        } else {
          resultados.push({ nombre, existe: false });
        }
      });
    }
    res.json({ resultados });
  } catch (error) {
    // A lookup failure must NOT be reported as "Nuevo": it would lead to duplicates
    console.error('[purchase] Match error:', error.message);
    res.status(500).json({ error: 'Error al buscar productos' });
  }
});

// POST /api/purchase/import — MUTATION: row by row, per-row results (a failed row does not abort the batch)
router.post('/import', async (req, res) => {
  const parsed = purchaseConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: 'Datos de importación inválidos' });
  }
  if (!process.env.GOOGLE_SHEETS_URL) {
    return res.status(500).json({ success: false, error: 'Google Sheets no configurado' });
  }

  const { pedido, productos } = parsed.data;
  const fecha = pedido?.fecha || todayAR();
  const proveedor = pedido?.id ? `Importación pedido ${pedido.id}` : 'Importación PDF';

  const createdNames = new Set();
  const results = [];

  // The sheet is the source of truth: a "new" row may already exist (a previous attempt created it,
  // or the user retried after a partial failure). Throws when it cannot be verified.
  const existsInSheet = async (nombre) => {
    const lookup = await findProductByName(nombre);
    return Boolean(lookup?.success && lookup.found);
  };

  for (const [index, row] of productos.entries()) {
    const key = normName(row.nombre);

    try {
      // A name created earlier in this import, or already in the sheet, must not be created twice
      const asExisting = row.existe || createdNames.has(key) || await existsInSheet(row.nombre);

      const outcome = asExisting
        ? await executeOperation('COMPRA', {
            fecha,
            proveedor,
            productos: [{ nombre: row.nombre, cantidad: row.cantidad, precio_unitario: row.costo_unitario }],
          })
        : await executeOperation('NUEVO_PRODUCTO', {
            producto: row.nombre,
            precio: row.costo_unitario,
            precio_venta: row.precio_venta ?? 0,
            stock_inicial: row.cantidad,
            fecha,
          });

      if (outcome?.success) {
        if (!asExisting) createdNames.add(key);
        results.push({ index, ok: true });
      } else {
        // The product was created but its initial stock movement failed: it exists now,
        // so later rows (and the retry) must go through COMPRA, never create it again
        if (!asExisting && /^Producto creado pero/.test(outcome?.error || '')) createdNames.add(key);
        results.push({ index, ok: false, error: outcome?.error || 'Error al registrar' });
      }
    } catch (error) {
      console.error('[purchase] Import row error:', error.message);
      results.push({ index, ok: false, error: 'Error al registrar' });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  res.json({ results, summary: { ok, failed: results.length - ok } });
});

export default router;
