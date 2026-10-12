import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { transcribeAudio } from '../services/transcriptionService.js';
import { extractOperationData } from '../services/aiService.js';
import { validateOperation } from '../schemas/operationSchemas.js';
import { executeOperation } from '../services/sheetsService.js';

const router = Router();

// Whitelist: mimetype (sin parametros) -> extension segura.
// La extension NUNCA se deriva del originalname (controlado por el usuario).
const MIME_EXTENSIONS = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/m4a': '.m4a',
  'audio/flac': '.flac',
};

const baseMime = (mimetype) => String(mimetype || '').split(';')[0].trim().toLowerCase();

// Temp uploads live in the OS temp dir (always writable, even as non-root user)
const uploadsDir = path.join(os.tmpdir(), 'vtsd-uploads');

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
      cb(null, uploadsDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + MIME_EXTENSIONS[baseMime(file.mimetype)]);
  },
});

const fileFilter = (req, file, cb) => {
  if (Object.hasOwn(MIME_EXTENSIONS, baseMime(file.mimetype))) {
    cb(null, true);
  } else {
    // Own code (not multer's LIMIT_UNEXPECTED_FILE, which means a wrong field name): handled in index.js as 400
    cb(Object.assign(new Error('Invalid file type'), { code: 'INVALID_FILE_TYPE' }), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// POST /api/voice/process — READ-ONLY: transcribe → classify → extract → validate → return JSON
// No Google Sheets writes happen here.
router.post('/process', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  const filePath = req.file.path;

  try {
    // Log file info for debugging
    const stats = fs.statSync(filePath);
    console.log(`[voice] File MIME: ${req.file.mimetype}, Size: ${stats.size} bytes`);

    // Step 1: Transcribe audio
    const transcription = await transcribeAudio(filePath);
    console.log(`[voice] Transcription: ${transcription.length} chars`);

    // Step 2: Extract structured data
    let extractionResult = await extractOperationData(transcription);
    console.log(`[voice] AI extraction: operation=${extractionResult?.operation}`);

    // Step 3: Validate with Zod, retry once on failure
    let validationResult = validateOperation(extractionResult);
    console.log('[voice] Validation result:', validationResult.success ? 'SUCCESS' : 'FAILED');
    if (!validationResult.success) {
      // Retry extraction once
      extractionResult = await extractOperationData(transcription);
      validationResult = validateOperation(extractionResult);
      if (!validationResult.success) {
        return res.status(422).json({
          error: 'AI extraction produced invalid data',
          details: validationResult.errors,
        });
      }
    }
    const data = validationResult.data;

    // Step 4: Generate preview (text summary for confirmation screen)
    const preview = generatePreview(data);

    // Step 5: Return structured data — NO Sheets write
    res.json({ transcription, operation: data.operation, data, preview });
  } catch (error) {
    console.error('[voice] Processing error:', error.message);
    if (error.code === 'MULTIPLE_OPERATIONS') {
      return res.status(422).json({
        error: 'Se detectaron múltiples operaciones en una grabación. Grabá una operación por vez.',
        details: error.operations,
      });
    }
    if (error.code === 'TRANSCRIPTION_FAILED') {
      return res.status(422).json({ error: 'Transcription failed' });
    }
    if (error.code === 'AI_EXTRACTION_FAILED') {
      return res.status(500).json({ error: 'AI extraction failed' });
    }
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    // Clean up temp file
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (cleanupError) {
      console.error('Failed to delete temp file:', cleanupError);
    }
  }
});

// POST /api/voice/execute — MUTATION: accepts { operation, data }, writes to Google Sheets
router.post('/execute', async (req, res) => {
  const { operation, data } = req.body;

  // Validate required fields
  if (!operation || !data) {
    return res.status(422).json({
      error: 'Campos requeridos: operation y data',
    });
  }

  // Validate operation + data against Zod schema
  const validationResult = validateOperation({ operation, ...data });
  if (!validationResult.success) {
    return res.status(422).json({
      error: 'Datos de operación inválidos',
      details: validationResult.errors,
    });
  }

  // Check Apps Script URL is configured
  if (!process.env.GOOGLE_SHEETS_URL) {
    return res.status(500).json({
      success: false,
      error: 'Google Sheets no configurado',
    });
  }

  try {
    const result = await executeOperation(operation, validationResult.data);

    if (result.success) {
      res.json(result);
    } else {
      // Determine appropriate status code from error type
      let statusCode = 500;
      if (result.error?.includes('no encontrado')) {
        statusCode = 404;
      } else if (result.error?.includes('Stock insuficiente')) {
        statusCode = 409;
      }
      res.status(statusCode).json(result);
    }
  } catch (error) {
    console.error('[voice] Execute error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error al ejecutar operación',
    });
  }
});

/**
 * Generates a human-readable preview string for the confirmation screen.
 * @param {Object} data - Validated operation data
 * @returns {string} Preview text
 */
export function generatePreview(data) {
  // Never print "undefined"/"null": fall back to a readable placeholder
  const val = (v, fallback = 'N/A') => (v === undefined || v === null || v === '' ? fallback : v);
  const count = Array.isArray(data.productos) ? data.productos.length : 0;
  const money = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  switch (data.operation) {
    case 'COMPRA':
      return `Compra a ${val(data.proveedor, 'proveedor sin especificar')} — ${count} producto(s) — ${val(data.metodo_pago, 'pago sin especificar')}`;
    case 'VENTA':
      return `Venta a ${val(data.cliente, 'cliente sin especificar')} — ${count} producto(s) — ${val(data.metodo_pago, 'pago sin especificar')}`;
    case 'NUEVO_PRODUCTO':
      return `Nuevo producto: ${val(data.producto)} — compra: $${money(data.precio)}${money(data.precio_venta) > 0 ? ` | venta: $${money(data.precio_venta)}` : ''}${money(data.stock_inicial) > 0 ? ` — stock inicial: ${money(data.stock_inicial)}` : ''}`;
    case 'AJUSTE':
      return `Ajuste: ${val(data.producto)} — ${val(data.cantidad, 0)} unidades — ${val(data.motivo, 'sin motivo')}`;
    case 'CONSULTA':
      return `Consulta: ${val(data.producto)}${data.color ? ` ${data.color}` : ''}${data.talle ? ` talle ${data.talle}` : ''}`;
    default:
      return `${val(data.operation, 'Operación desconocida')}`;
  }
}

export default router;
