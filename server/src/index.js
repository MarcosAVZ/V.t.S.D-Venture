import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import voiceRoutes from './routes/voiceRoutes.js'
import inventoryRoutes from './routes/inventoryRoutes.js'

// Load .env from server/ directory (not cwd)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  console.log('[env] Loading .env from:', envPath)
  dotenv.config({ path: envPath })
} else {
  console.log('[env] No .env file found, using environment variables')
}
console.log('[env] GROQ_API_KEY loaded:', process.env.GROQ_API_KEY ? 'YES (' + process.env.GROQ_API_KEY.substring(0, 8) + '...)' : 'NO')
console.log('[env] GOOGLE_SHEETS_URL loaded:', process.env.GOOGLE_SHEETS_URL ? 'YES' : 'NO')

const app = express()
const PORT = process.env.PORT || 3000
const isProduction = process.env.NODE_ENV === 'production'

// CORS — allow localhost in dev, Fly.io domain in production
const allowedOrigins = isProduction
  ? [`https://${process.env.FLY_APP_NAME || 'vtsd-venture'}.fly.dev`, 'https://vtsd-venture.fly.dev']
  : ['http://localhost:5173', 'http://localhost:3000']

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) return callback(null, true)
    callback(null, false)
  }
}))
app.use(express.json())

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

// Voice routes
app.use('/api/voice', voiceRoutes)

// Inventory routes
app.use('/api/inventory', inventoryRoutes)

// Serve static client in production
if (isProduction) {
  const publicDir = path.join(__dirname, '..', 'public')
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir))
    // SPA fallback — serve index.html for all non-API routes
    app.get('/{*splat}', (req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'))
    })
    console.log('[server] Serving static client from:', publicDir)
  } else {
    console.warn('[server] No public/ directory found — client not built')
  }
}

// Multer error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
