import { validateRow, normName, derivedUnits, formatMoney } from '../lib/purchaseRows'

const BADGES = {
  existe: { text: 'Existe', className: 'match-existe' },
  nuevo: { text: 'Nuevo', className: 'match-nuevo' },
  pending: { text: 'Verificando…', className: 'match-pending' },
  error: { text: 'Sin verificar', className: 'match-error' },
}

function Field({ row, field, label, index, error, children }) {
  const inputId = `${row.id}-${field}`
  return (
    <div className="purchase-field">
      <label className="field-label" htmlFor={inputId}>{label}</label>
      {children({ id: inputId, 'aria-label': `${label} (fila ${index + 1})`, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? `${inputId}-error` : undefined })}
      {error && <span id={`${inputId}-error`} className="purchase-field-error">{error}</span>}
    </div>
  )
}

// Presentational: one editable row of the purchase review
function PurchaseItemRow({ row, index, match, serverError, onChange, onDelete, disabled }) {
  const errors = validateRow(row)
  const derived = derivedUnits(row)
  const status = match?.status ?? 'pending'
  const badge = BADGES[status] ?? BADGES.pending
  const isNew = status === 'nuevo'
  const set = (field) => (e) => onChange(row.id, field, e.target.value)

  return (
    <li className={`purchase-row ${serverError ? 'purchase-row-failed' : ''} ${row.alerta_precio || row.posible_duplicado ? 'purchase-row-alert' : ''}`} data-match={normName(row.nombre)}>
      <div className="purchase-row-header">
        <span className="product-index">#{index + 1}</span>
        <span className={`match-badge ${badge.className}`}>{badge.text}</span>
        <button
          type="button"
          className="remove-product-btn"
          aria-label={`Eliminar fila ${index + 1}`}
          onClick={() => onDelete(row.id)}
          disabled={disabled}
        >
          ✕
        </button>
      </div>

      {row.titulo_corto && <p className="purchase-original-title">{row.titulo_corto}</p>}

      <div className="purchase-row-fields">
        <Field row={row} field="nombre" label="Nombre" index={index} error={errors.nombre}>
          {(props) => <input {...props} className="field-input" type="text" value={row.nombre} onChange={set('nombre')} disabled={disabled} />}
        </Field>
        <Field row={row} field="variante" label="Variante" index={index}>
          {(props) => <input {...props} className="field-input" type="text" value={row.variante} onChange={set('variante')} disabled={disabled} />}
        </Field>
        <Field row={row} field="cantidad" label="Cantidad" index={index} error={errors.cantidad}>
          {(props) => <input {...props} className="field-input" type="text" inputMode="numeric" value={row.cantidad} onChange={set('cantidad')} disabled={disabled} />}
        </Field>
        <Field row={row} field="unidades_por_paquete" label="Unid./paquete" index={index} error={errors.unidades_por_paquete}>
          {(props) => <input {...props} className="field-input" type="text" inputMode="numeric" value={row.unidades_por_paquete} onChange={set('unidades_por_paquete')} disabled={disabled} />}
        </Field>
        <Field row={row} field="costo_paquete" label="Costo por paquete" index={index} error={errors.costo_paquete}>
          {(props) => <input {...props} className="field-input" type="text" inputMode="decimal" value={row.costo_paquete} onChange={set('costo_paquete')} disabled={disabled} />}
        </Field>
        {isNew && (
          <Field row={row} field="precio_venta" label="Precio de venta" index={index} error={errors.precio_venta}>
            {(props) => <input {...props} className="field-input" type="text" inputMode="decimal" placeholder="Opcional" value={row.precio_venta} onChange={set('precio_venta')} disabled={disabled} />}
          </Field>
        )}
      </div>

      {(row.precio_lista_texto || row.precio_promo_texto) && (
        <p className="purchase-read">lista: {row.precio_lista_texto || '—'} · promo: {row.precio_promo_texto || '—'}</p>
      )}
      {row.posible_duplicado && (
        <p className="purchase-price-alert">
          {row.duplicado_motivo === 'precio'
            ? 'Posible duplicado: mismo precio que un producto de la parte anterior de la captura (puede estar cortado). Revisalo.'
            : 'Posible duplicado (parte superpuesta de la captura): revisalo y borrá uno si corresponde.'}
        </p>
      )}
      {row.alerta_precio && <p className="purchase-price-alert">Revisá el precio: la lista y la promo no cierran o falta la promo.</p>}

      {derived && (
        <p className="purchase-derived" data-testid={`derivado-${row.id}`}>
          Se importan {derived.unidades} unidades a {formatMoney(derived.costoUnitario)} c/u
        </p>
      )}

      {serverError && <p className="purchase-row-error" role="alert">{serverError}</p>}
    </li>
  )
}

export default PurchaseItemRow
