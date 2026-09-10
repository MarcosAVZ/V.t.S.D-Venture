import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { transcribeAudio } from '../services/transcriptionService.js';
import { extractOperationData } from '../services/aiService.js';
import { validateOperation } from '../schemas/operationSchemas.js';
import { executeOperation } from '../services/sheetsService.js';

const router = Router();

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  console.log(`[voice] Upload MIME type: ${file.mimetype}`);
  const allowedMimes = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/webm;codecs=opus'];
  if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Only audio files are allowed.`));
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
    console.log(`[voice] File: ${req.file.originalname}, MIME: ${req.file.mimetype}, Size: ${stats.size} bytes, Path: ${filePath}`);

    // Step 1: Transcribe audio
    const transcription = await transcribeAudio(filePath);
    console.log(`[voice] Transcription: "${transcription.substring(0, 100)}..."`);

    // Step 2: Extract structured data
    let extractionResult = await extractOperationData(transcription);
    console.log('[voice] AI extraction result:', JSON.stringify(extractionResult, null, 2));

    // Step 3: Validate with Zod, retry once on failure
    let validationResult = validateOperation(extractionResult);
    console.log('[voice] Validation result:', validationResult.success ? 'SUCCESS' : 'FAILED');
    if (!validationResult.success) {
      console.log('[voice] Validation errors:', JSON.stringify(validationResult.errors, null, 2));
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
    console.error('[voice] Full error:', error);
    if (error.code === 'MULTIPLE_OPERATIONS') {
      return res.status(422).json({
        error: 'Se detectaron múltiples operaciones en una grabación. Grabá una operación por vez.',
        details: error.operations,
      });
    }
    if (error.message.includes('Transcription failed')) {
      return res.status(422).json({ error: 'Transcription failed', details: error.message });
    }
    if (error.message.includes('AI extraction failed')) {
      return res.status(500).json({ error: 'AI extraction failed', details: error.message });
    }
    res.status(500).json({ error: 'Internal server error', details: error.message });
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
      error: `Error al ejecutar operación: ${error.message}`,
    });
  }
});

/**
 * Generates a human-readable preview string for the confirmation screen.
 * @param {Object} data - Validated operation data
 * @returns {string} Preview text
 */
function generatePreview(data) {
  switch (data.operation) {
    case 'COMPRA':
      return `Compra a ${data.proveedor} — ${data.productos.length} producto(s) — ${data.metodo_pago}`;
    case 'VENTA':
      return `Venta a ${data.cliente} — ${data.productos.length} producto(s) — ${data.metodo_pago}`;
    case 'NUEVO_PRODUCTO':
      return `Nuevo producto: ${data.producto} — compra: $${data.precio}${data.precio_venta > 0 ? ` | venta: $${data.precio_venta}` : ''}${data.stock_inicial > 0 ? ` — stock inicial: ${data.stock_inicial}` : ''}`;
    case 'AJUSTE':
      return `Ajuste: ${data.producto} — ${data.cantidad} unidades — ${data.motivo}`;
    case 'CONSULTA':
      return `Consulta: ${data.producto}${data.color ? ` ${data.color}` : ''}${data.talle ? ` talle ${data.talle}` : ''}`;
    default:
      return `${data.operation}`;
  }
}

export default router;
