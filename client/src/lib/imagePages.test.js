import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  detectFileKind, classifyFiles, scaleToFit, sliceTall, normalizeImageFile,
  UNSUPPORTED_MESSAGE, TALL_RATIO, PAGE_BUDGET_CHARS, TOTAL_BUDGET_CHARS, MAX_PAGES,
} from './imagePages'

const f = (name, type = '') => new File(['x'], name, { type })

describe('detectFileKind', () => {
  it.each([
    ['a.pdf', 'application/pdf', 'pdf'],
    ['a.jpg', 'image/jpeg', 'image'],
    ['a.png', 'image/png', 'image'],
    ['a.webp', 'image/webp', 'image'],
    ['a.heic', 'image/heic', 'unsupported'],
    ['a.heif', 'image/heif', 'unsupported'],
    ['a.gif', 'image/gif', 'unsupported'],
    ['a.txt', 'text/plain', 'unsupported'],
  ])('%s (%s) -> %s', (name, type, kind) => {
    expect(detectFileKind(f(name, type))).toBe(kind)
  })

  it.each([
    ['FOTO.JPG', 'image'], ['x.jpeg', 'image'], ['x.png', 'image'], ['x.webp', 'image'], ['x.PDF', 'pdf'],
    ['x.heic', 'unsupported'], ['x.HEIF', 'unsupported'], ['x', 'unsupported'],
  ])('sin MIME cae a la extension: %s -> %s', (name, kind) => {
    expect(detectFileKind(f(name, ''))).toBe(kind)
    expect(detectFileKind(f(name, 'application/octet-stream'))).toBe(kind)
  })

  it('el MIME manda sobre la extension', () => {
    expect(detectFileKind(f('x.pdf', 'image/png'))).toBe('image')
  })
})

describe('classifyFiles', () => {
  it('un PDF', () => {
    expect(classifyFiles([f('a.pdf', 'application/pdf')]).kind).toBe('pdf')
  })
  it('varias imagenes', () => {
    const r = classifyFiles([f('a.png', 'image/png'), f('b.jpg', 'image/jpeg')])
    expect(r.kind).toBe('images')
    expect(r.files).toHaveLength(2)
  })
  it('HEIC => mensaje claro en español', () => {
    expect(() => classifyFiles([f('a.heic', 'image/heic')])).toThrow(UNSUPPORTED_MESSAGE)
    expect(UNSUPPORTED_MESSAGE).toBe('Formato no soportado. Exportá la imagen como JPG o PNG (en iPhone: Ajustes > Cámara > Formatos > Más compatible).')
  })
  it('una imagen soportada junto a una no soportada => error', () => {
    expect(() => classifyFiles([f('a.png', 'image/png'), f('b.heic', 'image/heic')])).toThrow(/Formato no soportado/)
  })
  it('PDF mas imagenes, o dos PDFs => error', () => {
    expect(() => classifyFiles([f('a.pdf', 'application/pdf'), f('b.png', 'image/png')])).toThrow(/no ambos/)
    expect(() => classifyFiles([f('a.pdf', 'application/pdf'), f('b.pdf', 'application/pdf')])).toThrow(/un solo PDF/)
  })
  it('mas de 10 imagenes => error', () => {
    expect(() => classifyFiles(Array.from({ length: 11 }, (_, i) => f(`${i}.png`, 'image/png')))).toThrow(/10/)
  })
  it('sin archivos => error', () => {
    expect(() => classifyFiles([])).toThrow()
  })
})

describe('scaleToFit', () => {
  it('reduce el lado mas largo a 2000 manteniendo proporcion', () => {
    expect(scaleToFit(4000, 3000)).toEqual({ width: 2000, height: 1500 })
    expect(scaleToFit(1500, 4000)).toEqual({ width: 750, height: 2000 })
  })
  it('nunca agranda', () => {
    expect(scaleToFit(800, 600)).toEqual({ width: 800, height: 600 })
    expect(scaleToFit(2000, 2000)).toEqual({ width: 2000, height: 2000 })
  })
  it('acepta otro maximo', () => {
    expect(scaleToFit(1000, 500, 500)).toEqual({ width: 500, height: 250 })
  })
})

describe('sliceTall', () => {
  it('imagen no alta (alto/ancho <= 2.5) => un solo segmento completo', () => {
    expect(sliceTall(1080, 1920)).toEqual([{ y: 0, height: 1920 }])
    expect(sliceTall(1000, 2500)).toEqual([{ y: 0, height: 2500 }])
    expect(TALL_RATIO).toBe(2.5)
  })

  it('captura alta 1080x6000 => 4 segmentos de ~1.6:1 con >= 12% de solape', () => {
    const segs = sliceTall(1080, 6000)
    const segH = Math.round(1080 * 1.6)
    expect(segs).toHaveLength(4)
    expect(segs[0].y).toBe(0)
    segs.forEach((s) => expect(s.height).toBeLessThanOrEqual(segH))
    for (let i = 1; i < segs.length; i += 1) {
      const overlap = segs[i - 1].y + segs[i - 1].height - segs[i].y
      expect(overlap).toBeGreaterThanOrEqual(segH * 0.12)
      expect(segs[i].y).toBeGreaterThan(segs[i - 1].y)
    }
  })

  it('el ultimo segmento llega exactamente al final y cubre todo', () => {
    for (const h of [3000, 4321, 6000, 10000, 12345]) {
      const segs = sliceTall(1000, h)
      const last = segs[segs.length - 1]
      expect(last.y + last.height).toBe(h)
      expect(segs[0].y).toBe(0)
      segs.forEach((s) => expect(s.y).toBeGreaterThanOrEqual(0))
    }
  })

  it('si lo que sobra al final es < 25% de un paso, se funde con el segmento anterior (sin ultima parte casi duplicada)', () => {
    // ancho 1000: segmento 1600, paso 1408. 3108 deja solo 100px nuevos al final
    const segs = sliceTall(1000, 3108)
    expect(segs).toHaveLength(2)
    const last = segs[segs.length - 1]
    expect(last.y + last.height).toBe(3108)
    expect(last.height).toBeLessThanOrEqual(1600 * 1.25)
  })

  it('si lo que sobra es >= 25% de un paso, queda como segmento propio', () => {
    const segs = sliceTall(1000, 3108 + 400)
    expect(segs).toHaveLength(3)
    expect(segs.at(-1).height).toBe(1600)
  })

  it('el solape minimo (12%) se mantiene aunque haya fusion', () => {
    for (const h of [3108, 3200, 4600, 6020]) {
      const segs = sliceTall(1000, h)
      for (let i = 1; i < segs.length; i += 1) {
        expect(segs[i - 1].y + segs[i - 1].height - segs[i].y).toBeGreaterThanOrEqual(1600 * 0.12)
      }
    }
  })

  it('la cantidad de segmentos crece con el alto', () => {
    expect(sliceTall(1000, 3000).length).toBeLessThan(sliceTall(1000, 9000).length)
  })
})

describe('normalizeImageFile', () => {
  let encodeCalls
  let draws
  let ops
  let bitmap

  const setup = ({ width = 1000, height = 800, size = () => 100 } = {}) => {
    bitmap = { width, height, close: vi.fn() }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    draws = []
    encodeCalls = []
    ops = []
    HTMLCanvasElement.prototype.getContext = vi.fn(function getContext() {
      const ctx = {
        fillStyle: '',
        fillRect: (...args) => ops.push({ op: 'fillRect', args, fillStyle: ctx.fillStyle }),
        drawImage: (...args) => { ops.push({ op: 'drawImage' }); draws.push({ args, canvas: this }) },
      }
      return ctx
    })
    HTMLCanvasElement.prototype.toDataURL = vi.fn(function toDataURL(type, quality) {
      encodeCalls.push({ type, quality, width: this.width, height: this.height })
      return `data:image/jpeg;base64,${'A'.repeat(size(quality, this.width))}`
    })
  }
  beforeEach(() => setup())
  afterEach(() => vi.unstubAllGlobals())

  it('decodifica respetando la orientacion EXIF', async () => {
    const file = f('a.jpg', 'image/jpeg')
    await normalizeImageFile(file)
    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' })
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('reencodea a JPEG q0.85 y devuelve una pagina con parte 1/1', async () => {
    const r = await normalizeImageFile(f('a.png', 'image/png'))
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ parte: 1, partes: 1 })
    expect(r[0].content.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(encodeCalls[0]).toMatchObject({ type: 'image/jpeg', quality: 0.85 })
  })

  it('reduce a 2000px el lado mayor y no agranda', async () => {
    setup({ width: 4000, height: 3000 })
    await normalizeImageFile(f('big.png', 'image/png'))
    expect(encodeCalls[0]).toMatchObject({ width: 2000, height: 1500 })
    setup({ width: 800, height: 600 })
    await normalizeImageFile(f('small.png', 'image/png'))
    expect(encodeCalls[0]).toMatchObject({ width: 800, height: 600 })
  })

  it('captura alta: corta en el original (antes de reducir) y cada parte es una pagina', async () => {
    setup({ width: 1080, height: 6000 })
    const r = await normalizeImageFile(f('tall.png', 'image/png'))
    expect(r).toHaveLength(4)
    expect(r.map((p) => [p.parte, p.partes])).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]])
    // drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh): el recorte usa resolucion original
    expect(draws[0].args.slice(1, 5)).toEqual([0, 0, 1080, 1728])
    expect(draws[1].args[2]).toBeGreaterThan(0)
    expect(draws.at(-1).args[2] + draws.at(-1).args[4]).toBe(6000)
    // cada segmento (1080x1728) ya cabe en 2000px: no se reduce
    expect(encodeCalls[0]).toMatchObject({ width: 1080, height: 1728 })
  })

  it('baja la calidad si la pagina supera el presupuesto', async () => {
    setup({ size: (quality) => (quality > 0.8 ? 5000 : 100) })
    const r = await normalizeImageFile(f('a.jpg', 'image/jpeg'), { maxChars: 1000 })
    expect(encodeCalls.map((c) => c.quality)).toEqual([0.85, 0.75])
    expect(r[0].content.length).toBeLessThanOrEqual(1000 + 30)
  })

  it('si ni bajando calidad entra, reduce dimensiones; si no puede, error claro', async () => {
    setup({ size: (_q, width) => (width > 600 ? 5000 : 100) })
    const r = await normalizeImageFile(f('a.jpg', 'image/jpeg'), { maxChars: 1000 })
    expect(r[0].content.length).toBeLessThanOrEqual(1000 + 30)
    setup({ size: () => 5000 })
    await expect(normalizeImageFile(f('a.jpg', 'image/jpeg'), { maxChars: 1000 })).rejects.toThrow(/comprimir/i)
  })

  it('imagen ilegible => error en español', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('bad') }))
    await expect(normalizeImageFile(f('a.jpg', 'image/jpeg'))).rejects.toThrow(/No pude leer la imagen/)
  })
})

describe('normalizeImageFile: fondo blanco, presupuesto y partes', () => {
  let ops
  let encodeCalls
  let toDataURLCalls

  const mockBitmap = (width, height) => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close: vi.fn() })))
  }
  const mockCanvas = ({ size = () => 100 } = {}) => {
    ops = []
    encodeCalls = []
    toDataURLCalls = 0
    HTMLCanvasElement.prototype.getContext = vi.fn(function getContext() {
      const ctx = {
        fillStyle: '',
        fillRect: (...args) => ops.push({ op: 'fillRect', args, fillStyle: ctx.fillStyle }),
        drawImage: () => ops.push({ op: 'drawImage' }),
      }
      return ctx
    })
    HTMLCanvasElement.prototype.toDataURL = vi.fn(function toDataURL(type, quality) {
      toDataURLCalls += 1
      encodeCalls.push({ type, quality, width: this.width })
      return `data:image/jpeg;base64,${'A'.repeat(size(quality, this.width))}`
    })
  }
  afterEach(() => vi.unstubAllGlobals())

  it('rellena de blanco ANTES de dibujar (un PNG transparente no queda negro al pasar a JPEG)', async () => {
    mockBitmap(400, 300)
    mockCanvas()
    await normalizeImageFile(f('transparente.png', 'image/png'))
    expect(ops.map((o) => o.op)).toEqual(['fillRect', 'drawImage'])
    expect(ops[0].fillStyle).toMatch(/^(#fff|#ffffff|white)$/i)
    expect(ops[0].args).toEqual([0, 0, 400, 300])
  })

  it('el presupuesto por pagina por defecto garantiza que 10 paginas no superan el limite de /extract (15mb)', () => {
    expect(MAX_PAGES).toBe(10)
    expect(PAGE_BUDGET_CHARS * MAX_PAGES).toBeLessThanOrEqual(TOTAL_BUDGET_CHARS)
    expect(TOTAL_BUDGET_CHARS).toBeLessThanOrEqual(14_000_000)
    expect(TOTAL_BUDGET_CHARS).toBeLessThan(15 * 1024 * 1024)
  })

  it('usa ese presupuesto por defecto: una pagina de 1.5M de chars baja la calidad', async () => {
    mockBitmap(1000, 800)
    mockCanvas({ size: (quality) => (quality > 0.8 ? 1_500_000 : 200_000) })
    const r = await normalizeImageFile(f('pesada.jpg', 'image/jpeg'))
    expect(encodeCalls.map((c) => c.quality)).toEqual([0.85, 0.75])
    expect(r[0].content.length).toBeLessThanOrEqual(PAGE_BUDGET_CHARS + 30)
  })

  it('maxParts: si los cortes no entran, falla ANTES de codificar nada', async () => {
    mockBitmap(1000, 12000)
    mockCanvas()
    await expect(normalizeImageFile(f('larguisima.png', 'image/png'), { maxParts: 3 })).rejects.toThrow(/10 páginas|demasiadas partes/i)
    expect(toDataURLCalls).toBe(0)
    expect(ops).toEqual([])
  })

  it('maxParts: si entran, procesa normalmente', async () => {
    mockBitmap(1000, 3000)
    mockCanvas()
    const r = await normalizeImageFile(f('ok.png', 'image/png'), { maxParts: 3 })
    expect(r.length).toBeLessThanOrEqual(3)
  })
})

describe('normalizeImageFile con OffscreenCanvas (camino de Chrome/Edge/Firefox)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('usa OffscreenCanvas + convertToBlob + FileReader y no el canvas del DOM', async () => {
    const created = []
    const converted = []
    const domToDataURL = vi.fn()
    HTMLCanvasElement.prototype.toDataURL = domToDataURL
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 3000, height: 1000, close: vi.fn() })))
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(width, height) {
        this.width = width
        this.height = height
        this.ops = []
        created.push(this)
      }
      getContext() {
        const ctx = {
          fillStyle: '',
          fillRect: (...args) => this.ops.push({ op: 'fillRect', args }),
          drawImage: () => this.ops.push({ op: 'drawImage' }),
        }
        return ctx
      }
      async convertToBlob(options) {
        converted.push(options)
        return new Blob(['hola'], { type: options.type })
      }
    })
    const r = await normalizeImageFile(f('ancha.png', 'image/png'))
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ width: 2000, height: 667 })
    expect(created[0].ops.map((o) => o.op)).toEqual(['fillRect', 'drawImage'])
    expect(converted).toEqual([{ type: 'image/jpeg', quality: 0.85 }])
    expect(r[0].content).toBe('data:image/jpeg;base64,aG9sYQ==')
    expect(domToDataURL).not.toHaveBeenCalled()
  })

  it('baja la calidad tambien por el camino de OffscreenCanvas', async () => {
    const qualities = []
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 400, height: 400, close: vi.fn() })))
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(width, height) { this.width = width; this.height = height }
      getContext() { return { fillStyle: '', fillRect() {}, drawImage() {} } }
      async convertToBlob({ type, quality }) {
        qualities.push(quality)
        return new Blob([quality > 0.8 ? 'x'.repeat(3000) : 'x'], { type })
      }
    })
    const r = await normalizeImageFile(f('a.png', 'image/png'), { maxChars: 1000 })
    expect(qualities).toEqual([0.85, 0.75])
    expect(r[0].content.length).toBeLessThanOrEqual(1000)
  })
})
