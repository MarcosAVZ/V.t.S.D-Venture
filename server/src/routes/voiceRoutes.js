import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { transcribeAudio } from '../services/transcriptionService.js';
import { extractPurchaseData } from '../services/aiService.js';
import { validatePurchase } from '../schemas/purchaseSchema.js';

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
  const allowedMimes = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/mp3'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only audio files are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// POST /api/voice/process
router.post('/process', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  const filePath = req.file.path;
  let transcription = null;
  let data = null;

  try {
    // Step 1: Transcribe audio
    transcription = await transcribeAudio(filePath);

    // Step 2: Extract structured data
    let extractionResult = await extractPurchaseData(transcription);

    // Step 3: Validate with Zod, retry once on failure
    let validationResult = validatePurchase(extractionResult);
    if (!validationResult.success) {
      // Retry extraction once
      extractionResult = await extractPurchaseData(transcription);
      validationResult = validatePurchase(extractionResult);
      if (!validationResult.success) {
        return res.status(422).json({
          error: 'AI extraction produced invalid data',
          details: validationResult.errors,
        });
      }
    }
    data = validationResult.data;

    // Step 4: Return success
    res.json({ transcription, data });
  } catch (error) {
    console.error('Processing error:', error);
    if (error.message.includes('Transcription failed')) {
      return res.status(422).json({ error: 'Transcription failed', details: error.message });
    }
    if (error.message.includes('AI extraction failed')) {
      return res.status(500).json({ error: 'AI extraction failed', details: error.message });
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

export default router;