// Turns image files (screenshots, photos) into the same kind of "pages" the PDF flow produces.

export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_PAGES = 10
export const MAX_SIDE = 2000
export const TALL_RATIO = 2.5
const SEGMENT_RATIO = 1.6
const OVERLAP = 0.12
const TAIL_MERGE = 0.25
const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45]
const DOWNSCALES = [1, 0.75, 0.5]
// /api/purchase/extract accepts a 15 MB JSON body. The total across ALL pages stays under 14M chars and
// every page gets an equal share of the worst case (MAX_PAGES), so any selection of pages fits.
export const TOTAL_BUDGET_CHARS = 14_000_000
export const PAGE_BUDGET_CHARS = Math.floor(TOTAL_BUDGET_CHARS / MAX_PAGES)

export const UNSUPPORTED_MESSAGE = 'Formato no soportado. Exportá la imagen como JPG o PNG (en iPhone: Ajustes > Cámara > Formatos > Más compatible).'

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])

/** 'pdf' | 'image' | 'unsupported'. MIME first; the extension only when the MIME is missing/generic. */
export function detectFileKind(file) {
  const mime = String(file.type || '').toLowerCase()
  if (mime === 'application/pdf') return 'pdf'
  if (IMAGE_MIMES.has(mime)) return 'image'
  if (mime && mime !== 'application/octet-stream') return 'unsupported'
  const ext = String(file.name || '').toLowerCase().split('.').pop()
  if (ext === 'pdf') return 'pdf'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  return 'unsupported'
}

/** One PDF OR 1..10 images. Throws an Error with a user-facing Spanish message otherwise. */
export function classifyFiles(files) {
  if (files.length === 0) throw new Error('Elegí un archivo.')
  const kinds = files.map(detectFileKind)
  if (kinds.includes('unsupported')) throw new Error(UNSUPPORTED_MESSAGE)
  const pdfs = kinds.filter((k) => k === 'pdf').length
  if (pdfs > 0 && pdfs < files.length) throw new Error('Elegí un PDF o varias imágenes, no ambos.')
  if (pdfs > 1) throw new Error('Elegí un solo PDF.')
  if (pdfs === 1) return { kind: 'pdf', files }
  if (files.length > MAX_PAGES) throw new Error(`Máximo ${MAX_PAGES} imágenes por vez.`)
  return { kind: 'images', files }
}

/** Longest side <= max, same proportions, never upscales. */
export function scaleToFit(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * Vertical segments (in ORIGINAL pixels) for very tall screenshots: height/width <= 2.5 stays whole;
 * otherwise ~1.6:1 (tall:wide) segments overlapping >= 12%. The last one ends exactly at the bottom
 * (a tiny tail is merged into the previous segment).
 */
export function sliceTall(width, height) {
  if (height / width <= TALL_RATIO) return [{ y: 0, height }]
  const segHeight = Math.round(width * SEGMENT_RATIO)
  const step = Math.floor(segHeight * (1 - OVERLAP))
  const segments = []
  let y = 0
  while (y + segHeight < height) {
    segments.push({ y, height: segHeight })
    y += step
  }
  // What the last full segment leaves uncovered. If it is small (< 25% of a step), stretch that segment
  // to the bottom instead of adding a last part that would be almost entirely overlap.
  const previous = segments[segments.length - 1]
  const leftover = height - (previous.y + previous.height)
  if (leftover < step * TAIL_MERGE) {
    previous.height = height - previous.y
  } else {
    segments.push({ y: height - segHeight, height: segHeight })
  }
  return segments
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function encodeJpeg(canvas, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality }))
  }
  return canvas.toDataURL('image/jpeg', quality)
}

// Draws one segment scaled to `size` and encodes it, stepping quality (then size) down until it fits
async function encodeSegment(bitmap, segment, maxChars) {
  const base = scaleToFit(bitmap.width, segment.height)
  for (const factor of DOWNSCALES) {
    const width = Math.max(1, Math.round(base.width * factor))
    const height = Math.max(1, Math.round(base.height * factor))
    const canvas = makeCanvas(width, height)
    const ctx = canvas.getContext('2d')
    // JPEG has no alpha: a transparent PNG would turn black, so paint white first
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, segment.y, bitmap.width, segment.height, 0, 0, width, height)
    for (const quality of QUALITIES) {
      const dataUrl = await encodeJpeg(canvas, quality)
      if (dataUrl.length <= maxChars) return dataUrl
    }
  }
  throw new Error('No pude comprimir la imagen lo suficiente. Probá con una más chica.')
}

/**
 * Decodes (respecting EXIF rotation), slices tall screenshots, downsizes to <= 2000 px and
 * re-encodes as JPEG. Returns one entry per page: { content, parte, partes }.
 */
export async function normalizeImageFile(file, { maxChars = PAGE_BUDGET_CHARS, maxParts = MAX_PAGES } = {}) {
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('No pude leer la imagen.')
  }
  try {
    const segments = sliceTall(bitmap.width, bitmap.height)
    // Known before encoding anything: don't spend time/memory on an image that cannot fit
    if (segments.length > maxParts) {
      throw new Error(`La imagen se divide en ${segments.length} partes y se pasa del máximo de ${MAX_PAGES} páginas. Elegí menos imágenes.`)
    }
    const pages = []
    for (const [i, segment] of segments.entries()) {
      pages.push({ content: await encodeSegment(bitmap, segment, maxChars), parte: i + 1, partes: segments.length })
    }
    return pages
  } finally {
    bitmap.close?.()
  }
}
