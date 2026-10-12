import { useState, useEffect, useRef, useCallback } from 'react'
import PurchaseItemsTable from './PurchaseItemsTable'
import { pdfToPages, pdfThumbnails } from '../lib/pdfPages'
import { classifyFiles, normalizeImageFile, MAX_FILE_BYTES, MAX_PAGES, TOTAL_BUDGET_CHARS } from '../lib/imagePages'
import { flagDuplicates } from '../lib/purchaseDuplicates'
import { extractPurchase, matchNames, importPurchase } from '../lib/purchaseApi'
import { makeRow, isRowValid, computeTotal, isTotalOff, normName, toMoney, formatMoney, derivedUnits } from '../lib/purchaseRows'

// Container: owns the flow (pick PDF -> extract -> review -> import) and the server round-trips.
// phase: select | reading | pick | extracting | review | importing | done
function PurchaseImport({ matchDebounceMs = 400, onBusyChange }) {
  const [phase, setPhase] = useState('select')
  const [error, setError] = useState('')
  const [pedido, setPedido] = useState(null)
  const [pdfTotal, setPdfTotal] = useState(0)
  const [rows, setRows] = useState([])
  const [matches, setMatches] = useState({})
  const [rowErrors, setRowErrors] = useState({})
  const [importSummary, setImportSummary] = useState(null)
  const [importedCount, setImportedCount] = useState(0)
  const [retryTick, setRetryTick] = useState(0)
  const [thumbs, setThumbs] = useState([])
  const [selectedPages, setSelectedPages] = useState(new Set())
  const requested = useRef(new Set())
  const fileRef = useRef(null)
  // Image flow: the pages offered in the picker (content + where each one came from)
  const imagePagesRef = useRef([])
  const alive = useRef(true)
  // Bumped when the review is replaced (new extraction / reset): late /match answers are then ignored
  const generation = useRef(0)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  // Lets the parent block navigation while a file is being read/analyzed or the import is writing to the sheet
  useEffect(() => {
    onBusyChange?.(['reading', 'extracting', 'importing'].includes(phase))
  }, [phase, onBusyChange])
  useEffect(() => () => onBusyChange?.(false), [onBusyChange])

  // Look up names that have not been checked yet (debounced: runs again whenever a name is edited)
  useEffect(() => {
    if (phase !== 'review') return undefined
    const missing = new Map()
    rows.forEach((row) => {
      const name = row.nombre.trim()
      const key = normName(name)
      if (name && name.length <= 200 && !requested.current.has(key)) missing.set(key, name)
    })
    if (missing.size === 0) return undefined

    // The timer only debounces the request. Once it is sent the answer is ALWAYS applied (results are
    // keyed by name, so later edits to other fields or names cannot invalidate it); only a replaced
    // review (generation) or an unmounted component discards it.
    const timer = setTimeout(() => {
      const names = [...missing.values()]
      const keys = [...missing.keys()]
      const mine = generation.current
      keys.forEach((k) => requested.current.add(k))
      const apply = (update) => {
        if (!alive.current || mine !== generation.current) return
        setMatches((prev) => update({ ...prev }))
      }
      matchNames(names).then(
        ({ resultados }) => apply((next) => {
          resultados.forEach((r) => { next[normName(r.nombre)] = { status: r.existe ? 'existe' : 'nuevo' } })
          return next
        }),
        () => apply((next) => {
          keys.forEach((k) => { next[k] = { status: 'error' } })
          return next
        }),
      )
    }, matchDebounceMs)
    return () => clearTimeout(timer)
  }, [rows, phase, retryTick, matchDebounceMs])

  const handleFile = useCallback(async (event) => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (files.length === 0) return
    setError('')

    let selection
    try {
      selection = classifyFiles(files)
    } catch (err) {
      return setError(err.message)
    }
    if (selection.files.some((f) => f.size > MAX_FILE_BYTES)) return setError('El archivo es demasiado grande (máximo 20 MB).')

    try {
      setPhase('reading')
      let previews
      if (selection.kind === 'pdf') {
        previews = await pdfThumbnails(selection.files[0])
        fileRef.current = selection.files[0]
        imagePagesRef.current = []
      } else {
        const items = []
        for (const [index, file] of selection.files.entries()) {
          const parts = await normalizeImageFile(file, { maxParts: MAX_PAGES - items.length })
          parts.forEach((part) => {
            const number = items.length + 1
            const label = part.partes > 1 ? `Imagen ${index + 1} · parte ${part.parte}/${part.partes}` : `Imagen ${index + 1}`
            items.push({ number, src: part.content, label, content: part.content, origen: { pagina: number, imagen: index + 1, parte: part.parte, partes: part.partes } })
          })
          if (items.length > MAX_PAGES) throw new Error(`Con las capturas largas divididas en partes se pasa de ${MAX_PAGES} páginas. Elegí menos imágenes.`)
        }
        fileRef.current = null
        imagePagesRef.current = items
        previews = items
      }
      setThumbs(previews)
      setSelectedPages(new Set(previews.map((t) => t.number)))
      setPhase('pick')
    } catch (err) {
      setError(err.message || 'No pude leer el archivo.')
      setPhase('select')
    }
  }, [])

  const togglePage = useCallback((number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev)
      if (next.has(number)) next.delete(number)
      else next.add(number)
      return next
    })
  }, [])

  // Only the checked pages are rendered at full scale and leave the browser
  const handleAnalyze = useCallback(async () => {
    setError('')
    try {
      setPhase('reading')
      const numbers = [...selectedPages].sort((a, b) => a - b)
      let pages
      let sent // what each page sent maps to, to give every row its provenance
      if (fileRef.current) {
        pages = await pdfToPages(fileRef.current, numbers)
        sent = numbers.map((n) => ({ pagina: n }))
      } else {
        const chosen = imagePagesRef.current.filter((p) => selectedPages.has(p.number))
        pages = chosen.map((p) => ({ type: 'image', content: p.content }))
        if (chosen.reduce((sum, p) => sum + p.content.length, 0) > TOTAL_BUDGET_CHARS) {
          throw new Error('Las imágenes son demasiado pesadas; elegí menos páginas o capturas más chicas.')
        }
        sent = chosen.map((p) => p.origen)
      }
      setPhase('extracting')
      const result = await extractPurchase(pages)
      requested.current = new Set()
      generation.current += 1
      setPedido({ id: result.pedido.id, fecha: result.pedido.fecha })
      setPdfTotal(result.pedido.total)
      setRows(flagDuplicates(result.productos.map((p) => makeRow(p, sent[(p.pagina ?? 1) - 1] ?? { pagina: p.pagina }))))
      setMatches({})
      setRowErrors({})
      setImportSummary(null)
      setImportedCount(0)
      setPhase('review')
    } catch (err) {
      setError(err.message || 'No pude leer el comprobante.')
      setPhase('pick')
    }
  }, [selectedPages])

  const handleChange = useCallback((id, field, value) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
    setRowErrors((prev) => {
      if (!(id in prev)) return prev
      const { [id]: _removed, ...rest } = prev
      return rest
    })
  }, [])

  const handleDelete = useCallback((id) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const handleRetryMatch = useCallback(() => {
    const failed = Object.entries(matches).filter(([, m]) => m.status === 'error').map(([k]) => k)
    failed.forEach((k) => requested.current.delete(k))
    setMatches((prev) => Object.fromEntries(Object.entries(prev).filter(([, m]) => m.status !== 'error')))
    setRetryTick((t) => t + 1)
  }, [matches])

  const statusOf = (row) => matches[normName(row.nombre)]?.status
  const allVerified = rows.every((r) => ['existe', 'nuevo'].includes(statusOf(r)))
  const allValid = rows.every(isRowValid)
  const canConfirm = phase === 'review' && rows.length > 0 && allValid && allVerified
  const hasMatchError = rows.some((r) => statusOf(r) === 'error')

  const handleConfirm = useCallback(async () => {
    setPhase('importing')
    setError('')
    const payload = {
      pedido,
      productos: rows.map((row) => {
        const existe = statusOf(row) === 'existe'
        // The inventory works in UNITS: packs x units per pack, cost per unit
        const { unidades, costoUnitario } = derivedUnits(row)
        const item = {
          nombre: row.nombre.trim(),
          variante: row.variante.trim(),
          cantidad: unidades,
          costo_unitario: costoUnitario,
          existe,
        }
        if (!existe && row.precio_venta.trim() !== '') item.precio_venta = toMoney(row.precio_venta)
        return item
      }),
    }

    try {
      const { results } = await importPurchase(payload)
      const okIds = new Set()
      const failures = {}
      results.forEach((r) => {
        const row = rows[r.index]
        if (!row) return
        if (r.ok) okIds.add(row.id)
        else failures[row.id] = r.error || 'Error al registrar'
      })
      // Names that now exist in the sheet (created OK, or created but with the stock movement failed):
      // a retry must register stock on them, never create them again
      const createdKeys = new Set()
      results.forEach((r) => {
        const row = rows[r.index]
        if (!row) return
        const wasNew = statusOf(row) !== 'existe'
        if (wasNew && (r.ok || /^Producto creado pero/.test(r.error || ''))) createdKeys.add(normName(row.nombre))
      })
      if (createdKeys.size > 0) {
        setMatches((prev) => {
          const next = { ...prev }
          createdKeys.forEach((k) => { next[k] = { status: 'existe' } })
          return next
        })
      }
      const remaining = rows.filter((r) => !okIds.has(r.id))
      setRows(remaining)
      setRowErrors(failures)
      setImportedCount((c) => c + okIds.size)
      setImportSummary({ ok: okIds.size, failed: Object.keys(failures).length })
      setPhase(remaining.length === 0 ? 'done' : 'review')
    } catch (err) {
      setError(err.message || 'No se pudo guardar la compra.')
      setPhase('review')
    }
    // statusOf only reads `matches`, which is listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, pedido, matches])

  const reset = useCallback(() => {
    setPhase('select')
    setThumbs([])
    setSelectedPages(new Set())
    fileRef.current = null
    imagePagesRef.current = []
    setRows([])
    setMatches({})
    setRowErrors({})
    setImportSummary(null)
    setImportedCount(0)
    setError('')
    requested.current = new Set()
    generation.current += 1
  }, [])

  if (phase === 'reading' || phase === 'extracting') {
    return (
      <div className="purchase-import" role="status">
        <span className="loading-spinner"></span>
        <span>{phase === 'reading' ? 'Leyendo el archivo...' : 'Analizando el comprobante...'}</span>
      </div>
    )
  }

  if (phase === 'pick') {
    return (
      <div className="purchase-import">
        <h2>Elegí las páginas</h2>
        {thumbs.some((t) => t.content !== undefined) ? (
          <p className="purchase-warning">
            Si alguna captura muestra tus datos personales (nombre, dirección, teléfono), desmarcala.
          </p>
        ) : (
          <p className="purchase-warning">
            La página 1 de los comprobantes suele tener datos personales (nombre, teléfono, dirección).
            Si la desmarcás, solo se pierde el control del total del pedido.
          </p>
        )}
        {selectedPages.size > 2 && (
          <p className="purchase-note">Groq gratuito procesa ~2-3 imágenes por minuto; puede tardar.</p>
        )}
        {error && <p className="purchase-error" role="alert">{error}</p>}
        <fieldset className="purchase-pages">
          <legend>Páginas a analizar</legend>
          {thumbs.map((t) => (
            <label key={t.number} className="purchase-page">
              <input type="checkbox" checked={selectedPages.has(t.number)} onChange={() => togglePage(t.number)} />
              <span>{t.label ?? `Página ${t.number}`}</span>
              <img src={t.src} alt="" className="purchase-thumb" />
            </label>
          ))}
        </fieldset>
        {selectedPages.size === 0 && <p className="purchase-field-error">Elegí al menos una página.</p>}
        <div className="confirmation-actions">
          <button type="button" className="action-btn cancel-btn" onClick={reset}>Cancelar</button>
          <button type="button" className="action-btn confirm-btn" onClick={handleAnalyze} disabled={selectedPages.size === 0}>
            Analizar páginas seleccionadas
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="purchase-import">
        <div className="completed-message">
          <span className="completed-icon">✓</span>
          <span>Compra importada: {importedCount} producto(s)</span>
        </div>
        <button type="button" className="action-btn back-btn" onClick={reset}>← Importar otro PDF</button>
      </div>
    )
  }

  if (phase === 'select') {
    return (
      <div className="purchase-import">
        <h2>Importar compra (PDF o imágenes)</h2>
        <p className="idle-hint">Subí el comprobante de tu pedido (PDF, capturas de la app o fotos) y revisá los productos antes de guardar.</p>
        {error && <p className="purchase-error" role="alert">{error}</p>}
        <label className="purchase-file-label" htmlFor="purchase-pdf">Elegí el PDF del comprobante o una o más imágenes (capturas o fotos)</label>
        <input id="purchase-pdf" className="purchase-file-input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple onChange={handleFile} />
      </div>
    )
  }

  const computed = computeTotal(rows)
  const totalKnown = pdfTotal > 0
  const showTotalWarning = importedCount === 0 && totalKnown && isTotalOff(computed, pdfTotal)
  const showTotalNote = importedCount === 0 && !totalKnown
  const isImporting = phase === 'importing'

  return (
    <div className="purchase-import">
      <h2>Revisá la compra</h2>

      <div className="data-card purchase-summary">
        <div className="data-row"><span className="data-label">Pedido:</span><span className="data-value">{pedido?.id || '—'}</span></div>
        <div className="data-row"><span className="data-label">Fecha:</span><span className="data-value">{pedido?.fecha || '—'}</span></div>
        <div className="data-row"><span className="data-label">Total calculado:</span><span className="data-value" data-testid="total-calculado">{formatMoney(computed)}</span></div>
        <div className="data-row"><span className="data-label">Total del PDF:</span><span className="data-value" data-testid="total-pdf">{pdfTotal > 0 ? formatMoney(pdfTotal) : '—'}</span></div>
      </div>

      {showTotalWarning && (
        <div className="purchase-warning" role="status" aria-label="Advertencia de totales">
          El total calculado no coincide con el del PDF. Revisá cantidades y costos antes de confirmar.
        </div>
      )}

      {showTotalNote && (
        <div className="purchase-note" role="status" aria-label="Nota sobre el total">
          No se encontró el total del pedido; revisá los montos a mano.
        </div>
      )}

      {importSummary && (
        <div className="purchase-warning" role="status" aria-label="Resultado de la importación">
          {importSummary.ok} guardado(s) · {importSummary.failed} con error. Corregí las filas con error y reintentá.
        </div>
      )}

      {error && <p className="purchase-error" role="alert">{error}</p>}

      <PurchaseItemsTable
        rows={rows}
        matches={matches}
        rowErrors={rowErrors}
        onChange={handleChange}
        onDelete={handleDelete}
        disabled={isImporting}
      />

      {hasMatchError && (
        <div className="purchase-warning">
          No se pudo verificar si algunos productos ya existen.{' '}
          <button type="button" className="retry-btn" onClick={handleRetryMatch}>Reintentar verificación</button>
        </div>
      )}

      <div className="confirmation-actions">
        <button type="button" className="action-btn cancel-btn" onClick={reset} disabled={isImporting}>Cancelar</button>
        <button type="button" className="action-btn confirm-btn" onClick={handleConfirm} disabled={!canConfirm || isImporting}>
          {isImporting ? 'Guardando...' : importSummary ? 'Reintentar fallidas' : 'Confirmar compra'}
        </button>
      </div>
    </div>
  )
}

export default PurchaseImport
