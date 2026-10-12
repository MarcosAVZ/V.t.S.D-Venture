import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export const MAX_PAGES = 10
// Below this many characters a page is treated as having no usable text layer (e.g. Chromium "print to PDF" images)
export const MIN_TEXT_CHARS = 100
const RENDER_SCALE = 2
const JPEG_QUALITY = 0.85
const THUMB_SCALE = 0.3
const THUMB_QUALITY = 0.6

async function renderPageToJpeg(page, scale, quality) {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  return canvas.toDataURL('image/jpeg', quality)
}

// Opens the PDF, runs `fn(doc)` and always releases the document. pdf.js is lazy-loaded (heavy, flow-only).
async function withDocument(file, fn) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  let doc
  try {
    doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  } catch {
    throw new Error('No pude leer el PDF. ¿Es un archivo válido?')
  }

  try {
    if (doc.numPages > MAX_PAGES) {
      throw new Error(`El PDF tiene más de ${MAX_PAGES} páginas. Subí uno más corto.`)
    }
    return await fn(doc)
  } finally {
    doc.destroy?.()
  }
}

/**
 * Small preview of every page (so the user can choose which ones leave the browser).
 * @returns {Promise<Array<{number: number, src: string}>>} page numbers start at 1
 */
export function pdfThumbnails(file) {
  return withDocument(file, async (doc) => {
    const thumbs = []
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n)
      thumbs.push({ number: n, src: await renderPageToJpeg(page, THUMB_SCALE, THUMB_QUALITY) })
      page.cleanup?.()
    }
    return thumbs
  })
}

/**
 * Reads the chosen pages of a PDF: its text when the page has a usable text layer,
 * otherwise a JPEG data URL of the page rendered at full scale. Pages not chosen are never rendered.
 * @param {File} file
 * @param {number[]} [pageNumbers] 1-based pages to read (default: all)
 * @returns {Promise<Array<{type: 'text'|'image', content: string}>>}
 */
export function pdfToPages(file, pageNumbers) {
  return withDocument(file, async (doc) => {
    const wanted = pageNumbers ?? Array.from({ length: doc.numPages }, (_, i) => i + 1)
    const numbers = [...new Set(wanted)].filter((n) => Number.isInteger(n) && n >= 1 && n <= doc.numPages).sort((a, b) => a - b)
    if (numbers.length === 0) throw new Error('Elegí al menos una página.')

    const pages = []
    for (const n of numbers) {
      const page = await doc.getPage(n)
      const { items } = await page.getTextContent()
      const text = items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim()
      pages.push(text.length >= MIN_TEXT_CHARS
        ? { type: 'text', content: text }
        : { type: 'image', content: await renderPageToJpeg(page, RENDER_SCALE, JPEG_QUALITY) })
      page.cleanup?.()
    }
    return pages
  })
}
