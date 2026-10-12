import { describe, it, expect, vi, beforeEach } from 'vitest'

const pdf = vi.hoisted(() => ({ pages: [], getDocument: vi.fn(), GlobalWorkerOptions: {} }))

vi.mock('pdfjs-dist', () => ({
  getDocument: pdf.getDocument,
  GlobalWorkerOptions: pdf.GlobalWorkerOptions,
}))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.js' }))

import { pdfToPages, pdfThumbnails, MIN_TEXT_CHARS } from './pdfPages'

const fakePage = ({ text = '', toDataUrl = 'data:image/jpeg;base64,IMG' } = {}) => ({
  getTextContent: vi.fn().mockResolvedValue({ items: text ? text.split(' ').map((str) => ({ str })) : [] }),
  getViewport: vi.fn(({ scale }) => ({ width: 100 * scale, height: 200 * scale })),
  render: vi.fn(() => ({ promise: Promise.resolve() })),
  cleanup: vi.fn(),
  _toDataUrl: toDataUrl,
})

const file = () => ({ arrayBuffer: async () => new ArrayBuffer(8) })

beforeEach(() => {
  pdf.getDocument.mockReset()
  const toDataURL = vi.fn(() => 'data:image/jpeg;base64,IMG')
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}))
  HTMLCanvasElement.prototype.toDataURL = toDataURL
})

const mockDoc = (pages) =>
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: pages.length, getPage: async (n) => pages[n - 1], destroy: vi.fn() }),
  })

describe('pdfToPages', () => {
  it('pagina con capa de texto suficiente => type text', async () => {
    const longText = Array.from({ length: 40 }, (_, i) => `palabra${i}`).join(' ')
    expect(longText.length).toBeGreaterThan(MIN_TEXT_CHARS)
    mockDoc([fakePage({ text: longText })])
    const pages = await pdfToPages(file())
    expect(pages).toEqual([{ type: 'text', content: longText }])
  })

  it('pagina sin texto (impresa por Chromium como imagen) => renderiza JPEG scale 2 q0.85', async () => {
    const page = fakePage()
    mockDoc([page])
    const pages = await pdfToPages(file())
    expect(pages).toEqual([{ type: 'image', content: 'data:image/jpeg;base64,IMG' }])
    expect(page.getViewport).toHaveBeenCalledWith({ scale: 2 })
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.85)
  })

  it('texto demasiado corto cuenta como sin capa de texto', async () => {
    mockDoc([fakePage({ text: 'p1' })])
    expect((await pdfToPages(file()))[0].type).toBe('image')
  })

  it('mezcla paginas y respeta el orden', async () => {
    const longText = 'x '.repeat(MIN_TEXT_CHARS)
    mockDoc([fakePage(), fakePage({ text: longText })])
    expect((await pdfToPages(file())).map((p) => p.type)).toEqual(['image', 'text'])
  })

  it('mas de 10 paginas => error claro', async () => {
    mockDoc(Array.from({ length: 11 }, () => fakePage()))
    await expect(pdfToPages(file())).rejects.toThrow(/10 páginas/)
  })

  it('PDF ilegible => error en español', async () => {
    pdf.getDocument.mockReturnValue({ promise: Promise.reject(new Error('Invalid PDF')) })
    await expect(pdfToPages(file())).rejects.toThrow(/No pude leer el PDF/)
  })

  it('configura el worker con la URL de Vite', async () => {
    mockDoc([fakePage()])
    await pdfToPages(file())
    expect(pdf.GlobalWorkerOptions.workerSrc).toBe('/assets/pdf.worker.js')
  })
})

describe('pdfToPages con paginas elegidas', () => {
  it('solo renderiza y devuelve las paginas pedidas (privacidad)', async () => {
    const p1 = fakePage()
    const p2 = fakePage()
    const p3 = fakePage()
    const getPage = vi.fn(async (n) => [p1, p2, p3][n - 1])
    pdf.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 3, getPage, destroy: vi.fn() }) })
    const pages = await pdfToPages(file(), [2, 3])
    expect(pages).toHaveLength(2)
    expect(getPage).not.toHaveBeenCalledWith(1)
    expect(p1.render).not.toHaveBeenCalled()
    expect(p2.render).toHaveBeenCalled()
  })

  it('ignora numeros fuera de rango y sin paginas => error', async () => {
    mockDoc([fakePage()])
    await expect(pdfToPages(file(), [5])).rejects.toThrow(/al menos una página/i)
  })
})

describe('pdfThumbnails', () => {
  it('renderiza miniaturas chicas (scale 0.3) numeradas desde 1', async () => {
    const pgs = [fakePage(), fakePage()]
    mockDoc(pgs)
    const thumbs = await pdfThumbnails(file())
    expect(thumbs).toEqual([
      { number: 1, src: 'data:image/jpeg;base64,IMG' },
      { number: 2, src: 'data:image/jpeg;base64,IMG' },
    ])
    expect(pgs[0].getViewport).toHaveBeenCalledWith({ scale: 0.3 })
    expect(pgs[0].getViewport).not.toHaveBeenCalledWith({ scale: 2 })
  })

  it('mas de 10 paginas => error claro', async () => {
    mockDoc(Array.from({ length: 11 }, () => fakePage()))
    await expect(pdfThumbnails(file())).rejects.toThrow(/10 páginas/)
  })
})
