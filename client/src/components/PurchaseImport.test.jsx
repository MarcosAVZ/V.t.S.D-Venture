import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const m = vi.hoisted(() => ({ pdfToPages: vi.fn(), pdfThumbnails: vi.fn(), normalizeImageFile: vi.fn() }))
vi.mock('../lib/pdfPages', () => ({ pdfToPages: m.pdfToPages, pdfThumbnails: m.pdfThumbnails }))
vi.mock('../lib/imagePages', async (importOriginal) => ({ ...(await importOriginal()), normalizeImageFile: m.normalizeImageFile }))

import PurchaseImport from './PurchaseImport'

const producto = (nombre, cantidad, costo, unidades = 1) => ({
  nombre_sugerido: nombre, titulo_corto: `${nombre} titulo largo`, variante: '', cantidad, unidades_por_paquete: unidades, costo_paquete: costo,
})
const EXTRACTION = {
  pedido: { id: 'PO-77', fecha: '2026-06-10', total: 11000 },
  productos: [producto('Gorra gato', 1, 6762), producto('Neceser', 2, 2119)],
  checksum: { estado: 'ok', ok: true, suma: 11000, total: 11000, diferenciaPct: 0 },
}

const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body })
const IMG = [{ type: 'image', content: 'data:image/jpeg;base64,AAAA' }]

let handlers
beforeEach(() => {
  m.pdfThumbnails.mockReset().mockResolvedValue([
    { number: 1, src: 'data:image/jpeg;base64,T1' },
    { number: 2, src: 'data:image/jpeg;base64,T2' },
    { number: 3, src: 'data:image/jpeg;base64,T3' },
  ])
  m.pdfToPages.mockReset().mockResolvedValue(IMG)
  handlers = {
    extract: vi.fn(() => json(EXTRACTION)),
    match: vi.fn((body) => json({
      resultados: body.nombres.map((nombre) => (nombre.toLowerCase().startsWith('gorra')
        ? { nombre, existe: true, producto: { id: 'P1', nombre } }
        : { nombre, existe: false })),
    })),
    import: vi.fn(() => json({ results: [], summary: { ok: 0, failed: 0 } })),
  }
  vi.stubGlobal('fetch', vi.fn((url, init) => {
    const key = String(url).split('/').pop()
    return handlers[key](init?.body ? JSON.parse(init.body) : undefined)
  }))
})
afterEach(() => vi.unstubAllGlobals())

const pdfFile = () => new File(['%PDF'], 'pedido.pdf', { type: 'application/pdf' })
const analyzeBtn = () => screen.getByRole('button', { name: /analizar/i })

async function pickPages() {
  const user = userEvent.setup()
  render(<PurchaseImport matchDebounceMs={40} />)
  await user.upload(screen.getByLabelText(/PDF del comprobante/i), pdfFile())
  await screen.findByLabelText('Página 1')
  return user
}

async function loadReview() {
  const user = await pickPages()
  await user.click(analyzeBtn())
  await screen.findByLabelText('Nombre (fila 1)')
  return user
}

describe('selector de paginas', () => {
  it('muestra una miniatura con checkbox por pagina, todas marcadas, y la nota de privacidad', async () => {
    await pickPages()
    for (const n of [1, 2, 3]) expect(screen.getByLabelText(`Página ${n}`)).toBeChecked()
    expect(document.querySelectorAll('img')).toHaveLength(3)
    expect(screen.getByText(/página 1.*datos personales/i)).toBeInTheDocument()
    expect(screen.getByText(/pierde.*control del total|solo se pierde/i)).toBeInTheDocument()
    expect(handlers.extract).not.toHaveBeenCalled()
    expect(m.pdfToPages).not.toHaveBeenCalled()
  })

  it('PDF: no aparece la pista de imagenes por minuto con 3 paginas? si aparece (hay mas de 2)', async () => {
    await pickPages()
    expect(screen.getByText(/Groq gratuito procesa/)).toBeInTheDocument()
  })

  it('solo se renderizan/envian las paginas marcadas', async () => {
    const user = await pickPages()
    await user.click(screen.getByLabelText('Página 1'))
    await user.click(analyzeBtn())
    await screen.findByLabelText('Nombre (fila 1)')
    expect(m.pdfToPages).toHaveBeenCalledTimes(1)
    expect(m.pdfToPages.mock.calls[0][1]).toEqual([2, 3])
  })

  it('exige al menos una pagina marcada', async () => {
    const user = await pickPages()
    for (const n of [1, 2, 3]) await user.click(screen.getByLabelText(`Página ${n}`))
    expect(analyzeBtn()).toBeDisabled()
    expect(screen.getByText(/al menos una página/i)).toBeInTheDocument()
    await user.click(screen.getByLabelText('Página 2'))
    expect(analyzeBtn()).toBeEnabled()
  })

  it('error al generar las miniaturas muestra el mensaje', async () => {
    m.pdfThumbnails.mockRejectedValue(new Error('No pude leer el PDF'))
    const user = userEvent.setup()
    render(<PurchaseImport matchDebounceMs={40} />)
    await user.upload(screen.getByLabelText(/PDF del comprobante/i), pdfFile())
    expect(await screen.findByRole('alert')).toHaveTextContent('No pude leer el PDF')
  })

  it('cancelar vuelve a elegir archivo', async () => {
    const user = await pickPages()
    await user.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(screen.getByLabelText(/PDF del comprobante/i)).toBeInTheDocument()
  })
})

describe('PurchaseImport', () => {
  it('extrae y muestra una fila por producto con pedido y totales', async () => {
    await loadReview()
    expect(screen.getByLabelText('Nombre (fila 2)')).toHaveValue('Neceser')
    expect(screen.getByText(/PO-77/)).toBeInTheDocument()
    expect(screen.getByText(/2026-06-10/)).toBeInTheDocument()
    expect(handlers.extract).toHaveBeenCalledWith({ pages: IMG })
    expect(screen.getByTestId('total-calculado')).toHaveTextContent('11.000')
    expect(screen.getByTestId('total-pdf')).toHaveTextContent('11.000')
    expect(screen.queryByText(/no coincide/i)).not.toBeInTheDocument()
  })

  it('llama a /match y muestra Existe / Nuevo', async () => {
    await loadReview()
    await waitFor(() => expect(screen.getByText('Existe')).toBeInTheDocument())
    expect(screen.getByText('Nuevo')).toBeInTheDocument()
    expect(handlers.match).toHaveBeenCalledWith({ nombres: ['Gorra gato', 'Neceser'] })
  })

  it('re-consulta /match (debounced) al editar un nombre', async () => {
    const user = await loadReview()
    await waitFor(() => expect(screen.getByText('Nuevo')).toBeInTheDocument())
    handlers.match.mockClear()
    const input = screen.getByLabelText('Nombre (fila 2)')
    await user.clear(input)
    await user.type(input, 'Gorra azul')
    await waitFor(() => expect(handlers.match).toHaveBeenCalledTimes(1))
    expect(handlers.match).toHaveBeenCalledWith({ nombres: ['Gorra azul'] })
    await waitFor(() => expect(screen.getAllByText('Existe')).toHaveLength(2))
  })

  it('avisa si el total calculado no coincide con el del PDF', async () => {
    handlers.extract.mockImplementation(() => json({ ...EXTRACTION, pedido: { ...EXTRACTION.pedido, total: 50000 }, checksum: { estado: 'diferencia', ok: false, suma: 11000, total: 50000 } }))
    await loadReview()
    expect(screen.getByRole('status', { name: /advertencia/i })).toHaveTextContent(/no coincide/i)
  })

  it('total desconocido: nota neutra, NO la advertencia de diferencia', async () => {
    handlers.extract.mockImplementation(() => json({ ...EXTRACTION, pedido: { id: '', fecha: '', total: 0 }, checksum: { estado: 'desconocido', ok: null, suma: 11000, total: 0, diferenciaPct: null } }))
    await loadReview()
    expect(screen.getByRole('status', { name: /nota sobre el total/i })).toHaveTextContent('No se encontró el total del pedido; revisá los montos a mano')
    expect(screen.queryByRole('status', { name: /advertencia/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/no coincide/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('total-pdf')).toHaveTextContent('—')
  })

  it('el total calculado usa precio de paquete x cantidad', async () => {
    handlers.extract.mockImplementation(() => json({
      ...EXTRACTION,
      pedido: { ...EXTRACTION.pedido, total: 21595 },
      productos: [producto('Calcetines', 1, 21595, 10)],
    }))
    await loadReview()
    expect(screen.getByTestId('total-calculado')).toHaveTextContent('21.595')
    expect(screen.queryByRole('status', { name: /advertencia/i })).not.toBeInTheDocument()
  })

  it('borrar una fila actualiza el total y deshabilita confirmar con 0 filas', async () => {
    const user = await loadReview()
    await waitFor(() => expect(screen.getByText('Existe')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Eliminar fila 1' }))
    expect(screen.getByTestId('total-calculado')).toHaveTextContent('4.238')
    await user.click(screen.getByRole('button', { name: 'Eliminar fila 1' }))
    expect(screen.getByRole('button', { name: /confirmar compra/i })).toBeDisabled()
  })

  it('deshabilita confirmar mientras haya filas invalidas', async () => {
    const user = await loadReview()
    await waitFor(() => expect(screen.getByText('Existe')).toBeInTheDocument())
    const confirm = screen.getByRole('button', { name: /confirmar compra/i })
    expect(confirm).toBeEnabled()
    await user.clear(screen.getByLabelText('Cantidad (fila 1)'))
    await user.type(screen.getByLabelText('Cantidad (fila 1)'), '0')
    expect(confirm).toBeDisabled()
  })

  it('deshabilita confirmar mientras el match esta pendiente', async () => {
    let release
    handlers.match.mockImplementation((b) => new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => ({ resultados: b.nombres.map((nombre) => ({ nombre, existe: false })) }) }) }))
    await loadReview()
    expect(screen.getByRole('button', { name: /confirmar compra/i })).toBeDisabled()
    await waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: /confirmar compra/i })).toBeEnabled())
  })

  it('confirma: envia filas con existe y precio_venta solo para nuevos; todo ok => finalizado', async () => {
    const user = await loadReview()
    await waitFor(() => expect(screen.getByText('Nuevo')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Precio de venta (fila 2)'), '5000')
    handlers.import.mockImplementation(() => json({ results: [{ index: 0, ok: true }, { index: 1, ok: true }], summary: { ok: 2, failed: 0 } }))
    await user.click(screen.getByRole('button', { name: /confirmar compra/i }))
    await waitFor(() => expect(handlers.import).toHaveBeenCalled())
    expect(handlers.import).toHaveBeenCalledWith({
      pedido: { id: 'PO-77', fecha: '2026-06-10' },
      productos: [
        { nombre: 'Gorra gato', variante: '', cantidad: 1, costo_unitario: 6762, existe: true },
        { nombre: 'Neceser', variante: '', cantidad: 2, costo_unitario: 2119, existe: false, precio_venta: 5000 },
      ],
    })
    expect(await screen.findByText(/compra importada/i)).toBeInTheDocument()
  })

  it('importa UNIDADES: cantidad = paquetes x unidades y costo por unidad (3 casos reales)', async () => {
    handlers.extract.mockImplementation(() => json({
      ...EXTRACTION,
      productos: [
        producto('Calcetines 10', 1, 21595, 10),
        producto('Calcetines 4', 1, 4944, 4),
        producto('Calcetines 5', 1, 8673, 5),
        producto('Gorra neceser', 2, 2676, 1),
      ],
    }))
    handlers.match.mockImplementation((b) => json({ resultados: b.nombres.map((nombre) => ({ nombre, existe: true })) }))
    handlers.import.mockImplementation(() => json({ results: [0, 1, 2, 3].map((index) => ({ index, ok: true })), summary: { ok: 4, failed: 0 } }))
    const user = await loadReview()
    await waitFor(() => expect(screen.getByRole('button', { name: /confirmar compra/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /confirmar compra/i }))
    await waitFor(() => expect(handlers.import).toHaveBeenCalled())
    const { productos } = handlers.import.mock.calls[0][0]
    expect(productos.map((p) => [p.cantidad, p.costo_unitario])).toEqual([[10, 2159.5], [4, 1236], [5, 1734.6], [2, 2676]])
  })

  it('editar unidades por paquete actualiza lo que se importa', async () => {
    const user = await loadReview()
    await waitFor(() => expect(screen.getByText('Existe')).toBeInTheDocument())
    await user.clear(screen.getByLabelText('Unid./paquete (fila 2)'))
    await user.type(screen.getByLabelText('Unid./paquete (fila 2)'), '4')
    await waitFor(() => expect(screen.getByRole('button', { name: /confirmar compra/i })).toBeEnabled())
    handlers.import.mockImplementation(() => json({ results: [{ index: 0, ok: true }, { index: 1, ok: true }], summary: { ok: 2, failed: 0 } }))
    await user.click(screen.getByRole('button', { name: /confirmar compra/i }))
    await waitFor(() => expect(handlers.import).toHaveBeenCalled())
    const neceser = handlers.import.mock.calls[0][0].productos[1]
    expect(neceser).toMatchObject({ cantidad: 8, costo_unitario: 529.75 })
  })

  it('exito parcial: quita las filas ok, deja las fallidas con su error y permite reintentar solo esas', async () => {
    const user = await loadReview()
    await waitFor(() => expect(screen.getByText('Nuevo')).toBeInTheDocument())
    handlers.import.mockImplementationOnce(() => json({
      results: [{ index: 0, ok: true }, { index: 1, ok: false, error: 'Error al crear producto: Neceser' }],
      summary: { ok: 1, failed: 1 },
    }))
    await user.click(screen.getByRole('button', { name: /confirmar compra/i }))
    expect(await screen.findByText(/Error al crear producto: Neceser/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Nombre (fila 2)')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Nombre (fila 1)')).toHaveValue('Neceser')
    expect(screen.getByRole('status', { name: /resultado/i })).toHaveTextContent(/1 guardad/i)

    handlers.import.mockImplementationOnce(() => json({ results: [{ index: 0, ok: true }], summary: { ok: 1, failed: 0 } }))
    await user.click(screen.getByRole('button', { name: /reintentar/i }))
    await waitFor(() => expect(handlers.import).toHaveBeenCalledTimes(2))
    expect(handlers.import.mock.calls[1][0]).toEqual({
      pedido: { id: 'PO-77', fecha: '2026-06-10' },
      productos: [{ nombre: 'Neceser', variante: '', cantidad: 2, costo_unitario: 2119, existe: false }],
    })
    expect(await screen.findByText(/compra importada/i)).toBeInTheDocument()
  })

  it('error al extraer muestra mensaje y permite reintentar con las mismas paginas', async () => {
    handlers.extract.mockImplementation(() => json({ error: 'AI extraction failed' }, 500))
    const user = await pickPages()
    await user.click(analyzeBtn())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/No pude leer/i)
    expect(screen.getByLabelText('Página 1')).toBeChecked()
    expect(analyzeBtn()).toBeEnabled()
  })

  it('429 de Groq: muestra el mensaje y deja al usuario en el selector con su seleccion', async () => {
    handlers.extract.mockImplementation(() => json({ error: 'Se alcanzó el límite de uso de Groq. Esperá un minuto y volvé a intentar.', retryAfterSeconds: 13 }, 429))
    const user = await pickPages()
    await user.click(screen.getByLabelText('Página 1'))
    await user.click(analyzeBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent('Se alcanzó el límite de uso de Groq. Esperá un minuto y volvé a intentar.')
    expect(screen.getByLabelText('Página 1')).not.toBeChecked()
    expect(screen.getByLabelText('Página 2')).toBeChecked()
    expect(analyzeBtn()).toBeEnabled()
  })

  it('422 por salida truncada muestra el mensaje del servidor', async () => {
    handlers.extract.mockImplementation(() => json({ error: 'El comprobante tiene demasiados productos en una página.' }, 422))
    const user = await pickPages()
    await user.click(analyzeBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent(/demasiados productos/)
  })

  it('error al leer las paginas (pdfjs) muestra el mensaje', async () => {
    m.pdfToPages.mockRejectedValue(new Error('No pude leer el PDF'))
    const user = await pickPages()
    await user.click(analyzeBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent('No pude leer el PDF')
    expect(handlers.extract).not.toHaveBeenCalled()
  })

  it('rechaza formatos no soportados sin llamar al servidor', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<PurchaseImport matchDebounceMs={40} />)
    await user.upload(screen.getByLabelText(/PDF del comprobante/i), new File(['x'], 'a.txt', { type: 'text/plain' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Formato no soportado/)
    expect(m.pdfThumbnails).not.toHaveBeenCalled()
  })

  it('si /match falla, la fila queda sin verificar y no se puede confirmar', async () => {
    handlers.match.mockImplementation(() => json({ error: 'x' }, 500))
    await loadReview()
    await waitFor(() => expect(screen.getAllByText('Sin verificar')).toHaveLength(2))
    expect(screen.getByRole('button', { name: /confirmar compra/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /reintentar verificación/i })).toBeInTheDocument()
  })
})

const matchReply = (names, existe = false) => ({
  ok: true, status: 200, json: async () => ({ resultados: names.map((nombre) => ({ nombre, existe })) }),
})
const twoNew = (...names) => json({
  ...EXTRACTION,
  productos: names.map((n) => producto(n, 1, 1000)),
})

describe('match en vuelo mientras se edita', () => {
  it('editar la cantidad con /match pendiente igual termina verificando todas las filas', async () => {
    let release
    handlers.match.mockImplementation((b) => new Promise((resolve) => { release = () => resolve(matchReply(b.nombres)) }))
    const user = await loadReview()
    await waitFor(() => expect(handlers.match).toHaveBeenCalledTimes(1))
    await user.type(screen.getByLabelText('Cantidad (fila 1)'), '1')
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: /confirmar compra/i })).toBeEnabled())
    expect(screen.queryByText('Verificando…')).not.toBeInTheDocument()
    expect(handlers.match).toHaveBeenCalledTimes(1)
  })

  it('editar un nombre con /match en vuelo: el viejo se resuelve y el nuevo se consulta', async () => {
    let calls = 0
    const releases = []
    handlers.match.mockImplementation((b) => new Promise((resolve) => { calls += 1; releases.push(() => resolve(matchReply(b.nombres))) }))
    const user = await loadReview()
    await waitFor(() => expect(calls).toBe(1))
    const input = screen.getByLabelText('Nombre (fila 2)')
    await user.clear(input)
    await user.type(input, 'Otro')
    await waitFor(() => expect(calls).toBe(2))
    releases.forEach((r) => r())
    await waitFor(() => expect(screen.getByRole('button', { name: /confirmar compra/i })).toBeEnabled())
  })
})

describe('reintento tras importacion parcial no duplica productos', () => {
  const allNew = (b) => json({ resultados: b.nombres.map((nombre) => ({ nombre, existe: false })) })

  it('fallo "Producto creado pero..." => en el reintento esa fila va como existe', async () => {
    handlers.extract.mockImplementation(() => twoNew('Neceser', 'Zapato'))
    handlers.match.mockImplementation(allNew)
    const user = await loadReview()
    await waitFor(() => expect(screen.getAllByText('Nuevo')).toHaveLength(2))
    handlers.import.mockImplementationOnce(() => json({
      results: [{ index: 0, ok: true }, { index: 1, ok: false, error: 'Producto creado pero error al registrar stock inicial: Zapato' }],
      summary: { ok: 1, failed: 1 },
    }))
    await user.click(screen.getByRole('button', { name: /confirmar compra/i }))
    await screen.findByText(/Producto creado pero/)
    await waitFor(() => expect(screen.getByText('Existe')).toBeInTheDocument())
    handlers.import.mockImplementationOnce(() => json({ results: [{ index: 0, ok: true }], summary: { ok: 1, failed: 0 } }))
    await user.click(screen.getByRole('button', { name: /reintentar/i }))
    await waitFor(() => expect(handlers.import).toHaveBeenCalledTimes(2))
    expect(handlers.import.mock.calls[1][0].productos).toEqual([
      { nombre: 'Zapato', variante: '', cantidad: 1, costo_unitario: 1000, existe: true },
    ])
  })

  it('un nombre creado con exito marca como existe a otra fila fallida con el mismo nombre', async () => {
    handlers.extract.mockImplementation(() => twoNew('Zapato', 'Zapato'))
    handlers.match.mockImplementation(allNew)
    const user = await loadReview()
    await waitFor(() => expect(screen.getAllByText('Nuevo')).toHaveLength(2))
    handlers.import.mockImplementationOnce(() => json({
      results: [{ index: 0, ok: true }, { index: 1, ok: false, error: 'Error al registrar' }],
      summary: { ok: 1, failed: 1 },
    }))
    await user.click(screen.getByRole('button', { name: /confirmar compra/i }))
    await screen.findByText('Error al registrar')
    handlers.import.mockImplementationOnce(() => json({ results: [{ index: 0, ok: true }], summary: { ok: 1, failed: 0 } }))
    await user.click(screen.getByRole('button', { name: /reintentar/i }))
    await waitFor(() => expect(handlers.import).toHaveBeenCalledTimes(2))
    expect(handlers.import.mock.calls[1][0].productos[0].existe).toBe(true)
  })

  it('una fila que fallo sin crear el producto sigue como nuevo', async () => {
    handlers.extract.mockImplementation(() => twoNew('Neceser', 'Zapato'))
    handlers.match.mockImplementation(allNew)
    const user = await loadReview()
    await waitFor(() => expect(screen.getAllByText('Nuevo')).toHaveLength(2))
    handlers.import.mockImplementationOnce(() => json({
      results: [{ index: 0, ok: true }, { index: 1, ok: false, error: 'Error al crear producto: Zapato' }],
      summary: { ok: 1, failed: 1 },
    }))
    await user.click(screen.getByRole('button', { name: /confirmar compra/i }))
    await screen.findByText(/Error al crear producto/)
    handlers.import.mockImplementationOnce(() => json({ results: [{ index: 0, ok: true }], summary: { ok: 1, failed: 0 } }))
    await user.click(screen.getByRole('button', { name: /reintentar/i }))
    await waitFor(() => expect(handlers.import).toHaveBeenCalledTimes(2))
    expect(handlers.import.mock.calls[1][0].productos[0].existe).toBe(false)
  })
})

describe('onBusyChange', () => {
  it('avisa true mientras importa y false al terminar', async () => {
    const onBusyChange = vi.fn()
    let finish
    handlers.import.mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve({ ok: true, status: 200, json: async () => ({ results: [{ index: 0, ok: true }, { index: 1, ok: true }], summary: { ok: 2, failed: 0 } }) })
    }))
    const user = userEvent.setup()
    render(<PurchaseImport matchDebounceMs={40} onBusyChange={onBusyChange} />)
    await user.upload(screen.getByLabelText(/PDF del comprobante/i), pdfFile())
    await screen.findByLabelText('Página 1')
    await user.click(analyzeBtn())
    await screen.findByLabelText('Nombre (fila 1)')
    await waitFor(() => expect(screen.getByRole('button', { name: /confirmar compra/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /confirmar compra/i }))
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true))
    finish()
    await screen.findByText(/compra importada/i)
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })
})

describe('imagenes (capturas y fotos)', () => {
  const imgFile = (name, type = 'image/png') => new File(['x'], name, { type })
  const parts = (n, tag) => Array.from({ length: n }, (_, i) => ({ content: `data:image/jpeg;base64,${tag}${i + 1}`, parte: i + 1, partes: n }))

  beforeEach(() => {
    m.normalizeImageFile.mockReset().mockImplementation(async (file) => (file.name === 'larga.png' ? parts(2, 'L') : parts(1, 'U')))
  })

  const uploadImages = async (files, options) => {
    const user = userEvent.setup(options)
    render(<PurchaseImport matchDebounceMs={40} />)
    await user.upload(screen.getByLabelText(/PDF del comprobante/i), files)
    return user
  }

  it('el selector acepta PDF e imagenes y permite varios archivos', () => {
    render(<PurchaseImport matchDebounceMs={40} />)
    const input = screen.getByLabelText(/PDF del comprobante/i)
    expect(input).toHaveAttribute('multiple')
    expect(input.getAttribute('accept')).toBe('application/pdf,image/jpeg,image/png,image/webp')
  })

  it('2 imagenes: arma el selector con etiquetas Imagen N / parte i/n y no usa pdf.js', async () => {
    await uploadImages([imgFile('uno.png'), imgFile('larga.png')])
    expect(await screen.findByLabelText('Imagen 1')).toBeChecked()
    expect(screen.getByLabelText('Imagen 2 · parte 1/2')).toBeChecked()
    expect(screen.getByLabelText('Imagen 2 · parte 2/2')).toBeChecked()
    expect(m.pdfThumbnails).not.toHaveBeenCalled()
    expect(screen.getByText('Si alguna captura muestra tus datos personales (nombre, dirección, teléfono), desmarcala.')).toBeInTheDocument()
    expect(screen.queryByText(/página 1/i)).not.toBeInTheDocument()
    expect(document.querySelectorAll('img')).toHaveLength(3)
  })

  it('pista de limite de Groq gratuito con mas de 2 imagenes/partes seleccionadas', async () => {
    const user = await uploadImages([imgFile('uno.png'), imgFile('larga.png')])
    await screen.findByLabelText('Imagen 1')
    expect(screen.getByText('Groq gratuito procesa ~2-3 imágenes por minuto; puede tardar.')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Imagen 1'))
    expect(screen.queryByText(/Groq gratuito procesa/)).not.toBeInTheDocument()
  })

  it('caso real: parte 4 con nombre distinto y mismos precios => aviso suave', async () => {
    const withPrices = (nombre, pagina) => ({ ...producto(nombre, 1, 8673), precio_lista_texto: 'ARS12.136', precio_promo_texto: 'ARS8.673', pagina })
    handlers.extract.mockImplementation(() => json({ ...EXTRACTION, productos: [withPrices('calcetines gato kawaii', 1), withPrices('calcetines gato corazones', 2)] }))
    const user = await uploadImages([imgFile('larga.png')])
    await screen.findByLabelText('Imagen 1 · parte 1/2')
    await user.click(analyzeBtn())
    await screen.findByLabelText('Nombre (fila 2)')
    expect(screen.getAllByText(/Posible duplicado/)).toHaveLength(1)
    expect(screen.getByText(/mismo precio que un producto de la parte anterior/)).toBeInTheDocument()
  })

  it('analiza solo las marcadas, en orden, como paginas image', async () => {
    const user = await uploadImages([imgFile('uno.png'), imgFile('larga.png')])
    await screen.findByLabelText('Imagen 1')
    await user.click(screen.getByLabelText('Imagen 1'))
    await user.click(analyzeBtn())
    await screen.findByLabelText('Nombre (fila 1)')
    expect(m.pdfToPages).not.toHaveBeenCalled()
    expect(handlers.extract).toHaveBeenCalledWith({ pages: [
      { type: 'image', content: 'data:image/jpeg;base64,L1' },
      { type: 'image', content: 'data:image/jpeg;base64,L2' },
    ] })
  })

  it('flujo completo con 2 imagenes: extrae, verifica e importa', async () => {
    handlers.extract.mockImplementation(() => json({
      ...EXTRACTION,
      productos: [{ ...producto('Gorra gato', 1, 6762), pagina: 1 }, { ...producto('Neceser', 2, 2119), pagina: 2 }],
    }))
    handlers.import.mockImplementation(() => json({ results: [{ index: 0, ok: true }, { index: 1, ok: true }], summary: { ok: 2, failed: 0 } }))
    const user = await uploadImages([imgFile('uno.png'), imgFile('dos.jpg', 'image/jpeg')])
    await screen.findByLabelText('Imagen 2')
    await user.click(analyzeBtn())
    await screen.findByLabelText('Nombre (fila 1)')
    await waitFor(() => expect(screen.getByRole('button', { name: /confirmar compra/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /confirmar compra/i }))
    expect(await screen.findByText(/compra importada/i)).toBeInTheDocument()
    expect(handlers.extract.mock.calls[0][0].pages).toHaveLength(2)
  })

  it('marca posible duplicado entre partes adyacentes de la misma imagen (sin borrar filas)', async () => {
    const dup = (nombre, pagina) => ({ ...producto(nombre, 1, 1000), precio_lista_texto: 'ARS2.000', precio_promo_texto: 'ARS1.000', pagina })
    handlers.extract.mockImplementation(() => json({ ...EXTRACTION, productos: [dup('Calcetines magneticos', 1), dup('Calcetines magneticos', 2)] }))
    const user = await uploadImages([imgFile('larga.png')])
    await screen.findByLabelText('Imagen 1 · parte 1/2')
    await user.click(analyzeBtn())
    await screen.findByLabelText('Nombre (fila 2)')
    expect(screen.getAllByText(/Posible duplicado/)).toHaveLength(1)
    expect(screen.getByLabelText('Nombre (fila 1)')).toBeInTheDocument()
  })

  it('NO marca el mismo producto en imagenes separadas', async () => {
    const same = (pagina) => ({ ...producto('Calcetines magneticos', 1, 1000), precio_lista_texto: 'ARS2.000', precio_promo_texto: 'ARS1.000', pagina })
    handlers.extract.mockImplementation(() => json({ ...EXTRACTION, productos: [same(1), same(2)] }))
    const user = await uploadImages([imgFile('uno.png'), imgFile('dos.png')])
    await screen.findByLabelText('Imagen 2')
    await user.click(analyzeBtn())
    await screen.findByLabelText('Nombre (fila 2)')
    expect(screen.queryByText(/Posible duplicado/)).not.toBeInTheDocument()
  })

  it('HEIC => mensaje claro y no se normaliza nada', async () => {
    await uploadImages([imgFile('foto.heic', 'image/heic')], { applyAccept: false })
    expect(await screen.findByRole('alert')).toHaveTextContent('Formato no soportado. Exportá la imagen como JPG o PNG (en iPhone: Ajustes > Cámara > Formatos > Más compatible).')
    expect(m.normalizeImageFile).not.toHaveBeenCalled()
  })

  it('PDF mas imagenes => error', async () => {
    await uploadImages([pdfFile(), imgFile('uno.png')])
    expect(await screen.findByRole('alert')).toHaveTextContent(/no ambos/)
  })

  it('le pasa a normalizeImageFile cuantas partes quedan disponibles (para no codificar de mas)', async () => {
    m.normalizeImageFile.mockImplementation(async () => parts(6, 'X'))
    await uploadImages([imgFile('a.png'), imgFile('b.png')])
    await screen.findByRole('alert')
    expect(m.normalizeImageFile.mock.calls[0][1]).toMatchObject({ maxParts: 10 })
    expect(m.normalizeImageFile.mock.calls[1][1]).toMatchObject({ maxParts: 4 })
  })

  it('si el peso total de las paginas elegidas supera el presupuesto, avisa antes de enviar', async () => {
    m.normalizeImageFile.mockImplementation(async () => [{ content: `data:image/jpeg;base64,${'A'.repeat(8_000_000)}`, parte: 1, partes: 1 }])
    const user = await uploadImages([imgFile('a.png'), imgFile('b.png')])
    await screen.findByLabelText('Imagen 2')
    await user.click(analyzeBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent(/demasiado pesadas/i)
    expect(handlers.extract).not.toHaveBeenCalled()
    // desmarcando una entra
    await user.click(screen.getByLabelText('Imagen 2'))
    await user.click(analyzeBtn())
    await screen.findByLabelText('Nombre (fila 1)')
    expect(handlers.extract).toHaveBeenCalledTimes(1)
  })

  it('413 del servidor => mensaje claro de imagenes pesadas, y se queda en el selector', async () => {
    handlers.extract.mockImplementation(() => json({ error: 'Payload too large' }, 413))
    const user = await uploadImages([imgFile('uno.png')])
    await screen.findByLabelText('Imagen 1')
    await user.click(analyzeBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent('Las imágenes son demasiado pesadas; elegí menos páginas o capturas más chicas.')
    expect(screen.getByLabelText('Imagen 1')).toBeChecked()
    expect(analyzeBtn()).toBeEnabled()
  })

  it('mas de 10 paginas entre partes => error claro', async () => {
    m.normalizeImageFile.mockImplementation(async () => parts(6, 'X'))
    await uploadImages([imgFile('a.png'), imgFile('b.png')])
    expect(await screen.findByRole('alert')).toHaveTextContent(/10/)
  })

  it('error al normalizar una imagen se muestra', async () => {
    m.normalizeImageFile.mockRejectedValue(new Error('No pude leer la imagen.'))
    await uploadImages([imgFile('a.png')])
    expect(await screen.findByRole('alert')).toHaveTextContent('No pude leer la imagen.')
  })
})

describe('onBusyChange durante lectura y extraccion', () => {
  it('true mientras lee el PDF (miniaturas) y vuelve a false en el selector', async () => {
    const onBusyChange = vi.fn()
    let release
    m.pdfThumbnails.mockImplementation(() => new Promise((resolve) => { release = () => resolve([{ number: 1, src: 'data:image/jpeg;base64,T1' }]) }))
    const user = userEvent.setup()
    render(<PurchaseImport matchDebounceMs={40} onBusyChange={onBusyChange} />)
    await user.upload(screen.getByLabelText(/PDF del comprobante/i), pdfFile())
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true))
    release()
    await screen.findByLabelText('Página 1')
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })

  it('true mientras extrae y false al llegar a la revision', async () => {
    const onBusyChange = vi.fn()
    let finish
    handlers.extract.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ ok: true, status: 200, json: async () => EXTRACTION }) }))
    const user = userEvent.setup()
    render(<PurchaseImport matchDebounceMs={40} onBusyChange={onBusyChange} />)
    await user.upload(screen.getByLabelText(/PDF del comprobante/i), pdfFile())
    await screen.findByLabelText('Página 1')
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
    await user.click(analyzeBtn())
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true))
    finish()
    await screen.findByLabelText('Nombre (fila 1)')
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })

  it('un error de extraccion libera el bloqueo', async () => {
    const onBusyChange = vi.fn()
    handlers.extract.mockImplementation(() => json({ error: 'x' }, 500))
    const user = userEvent.setup()
    render(<PurchaseImport matchDebounceMs={40} onBusyChange={onBusyChange} />)
    await user.upload(screen.getByLabelText(/PDF del comprobante/i), pdfFile())
    await screen.findByLabelText('Página 1')
    await user.click(analyzeBtn())
    await screen.findByRole('alert')
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })
})
