import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import voiceRoutes from './routes/voiceRoutes.js'
import inventoryRoutes from './routes/inventoryRoutes.js'
import purchaseRoutes from './routes/purchaseRoutes.js'

// Load .env from server/ directory (not cwd)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  console.log('[env] Loading .env from:', envPath)
  dotenv.config({ path: envPath })
} else {
  console.log('[env] No .env file found, using environment variables')
}
console.log('[env] GROQ_API_KEY loaded:', process.env.GROQ_API_KEY ? 'YES' : 'NO')
console.log('[env] GOOGLE_SHEETS_URL loaded:', process.env.GOOGLE_SHEETS_URL ? 'YES' : 'NO')

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || '127.0.0.1'
const IS_PRODUCTION = process.env.NODE_ENV === 'production'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const isLoopbackHost = (host) => LOOPBACK_HOSTS.has(String(host).toLowerCase())

// Extracts the lowercase hostname from a Host header ("localhost:3000" -> "localhost", "[::1]:3000" -> "[::1]")
function hostnameFromHeader(header = '') {
  const h = String(header).trim().toLowerCase()
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    return end === -1 ? h : h.slice(0, end + 1)
  }
  return h.split(':')[0]
}

/** Directory of the built client: STATIC_DIR, or Vite's output (client/dist). */
export function resolveStaticDir() {
  return process.env.STATIC_DIR
    ? path.resolve(process.env.STATIC_DIR)
    : path.resolve(__dirname, '..', '..', 'client', 'dist')
}

/** Startup warning when the API is bound to something other than loopback (it has no authentication). */
export function getHostWarning(host) {
  if (isLoopbackHost(host)) return null
  return `[server] WARNING: HOST=${host} exposes the API to the network and it has NO authentication. Anyone who can reach this port can read and write your inventory. Use HOST=127.0.0.1 unless you know what you are doing.`
}

/**
 * Builds the Express app. Options default to the environment; tests override them.
 * @param {{host?: string, port?: number|string, isProduction?: boolean, staticDir?: string}} [options]
 */
export function createApp({ host = HOST, port = PORT, isProduction = IS_PRODUCTION, staticDir } = {}) {
  const app = express()

  // Local-only hardening: when bound to loopback, reject foreign Host headers (DNS rebinding)
  if (isLoopbackHost(host)) {
    app.use((req, res, next) => {
      if (!isLoopbackHost(hostnameFromHeader(req.headers.host))) {
        return res.status(403).json({ error: 'Forbidden host' })
      }
      next()
    })
  }

  // Allowed browser origins: local only (Vite dev server and the locally served build), same list in
  // dev and production. There is no hosted deployment: the API has no authentication.
  const allowedOrigins = [
    'http://localhost:5173', 'http://127.0.0.1:5173',
    `http://localhost:${port}`, `http://127.0.0.1:${port}`,
  ]

  // Origin enforcement (CSRF): cors alone does not block "simple" cross-site requests
  // such as multipart POSTs, it only withholds headers. Requests WITHOUT Origin (curl,
  // same-origin GET) stay allowed.
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      return res.status(403).json({ error: 'Forbidden origin' })
    }
    next()
  })

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true)
      if (allowedOrigins.includes(origin)) return callback(null, true)
      callback(null, false)
    }
  }))

  // Receipt pages (JPEG base64) need a bigger body: raised for THIS route only, and it must be
  // registered BEFORE the global parser (body-parser skips requests already parsed)
  app.use('/api/purchase/extract', express.json({ limit: '15mb' }))

  app.use(express.json({ limit: '100kb' }))

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' })
  })

  // Voice routes
  app.use('/api/voice', voiceRoutes)

  // Inventory routes
  app.use('/api/inventory', inventoryRoutes)

  // Purchase import routes (PDF receipts)
  app.use('/api/purchase', purchaseRoutes)

  // Serve the built client when running locally in production mode (`npm start`)
  if (isProduction) {
    const publicDir = staticDir ? path.resolve(staticDir) : resolveStaticDir()
    if (fs.existsSync(publicDir)) {
      app.use(express.static(publicDir))
      // SPA fallback: index.html for every non-API GET (unknown /api routes stay 404)
      app.get('/{*splat}', (req, res, next) => {
        if (req.path.startsWith('/api/')) return next()
        res.sendFile(path.join(publicDir, 'index.html'))
      })
      console.log('[server] Serving static client from:', publicDir)
    } else {
      console.warn('[server] No static client found at', publicDir, '- run `npm start` (it builds the client first)')
    }
  }

  // Rejected by the upload fileFilter (not an audio mimetype)
  app.use((err, req, res, next) => {
    if (err?.code === 'INVALID_FILE_TYPE') {
      return res.status(400).json({ error: 'Invalid file type. Only audio files are allowed.' });
    }
    next(err);
  });

  // Multer error handler
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Unexpected file field. Send the audio in the "audio" field.' });
      }
      return res.status(400).json({ error: err.message });
    }
    next(err);
  });

  // Global error handler
  app.use((err, req, res, next) => {
    // Client errors raised by middleware (body-parser: 413 too large, 400 bad JSON, ...)
    const status = err.status ?? err.statusCode
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      const messages = { 400: 'Bad request', 413: 'Payload too large' }
      return res.status(status).json({ error: messages[status] || 'Bad request' })
    }
    console.error('Unhandled error:', err)
    res.status(500).json({ error: 'Internal server error' })
  })


  return app
}

const app = createApp()

export { app }
export default app

/** Starts listening (loopback by default: local desktop use only). */
export function start({ app: instance = app, host = HOST, port = PORT } = {}) {
  const warning = getHostWarning(host)
  if (warning) console.warn(warning)
  return instance.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port}`)
  })
}

// Listen only when run directly (node src/index.js), not when imported by tests.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isDirectRun) {
  start()
}
