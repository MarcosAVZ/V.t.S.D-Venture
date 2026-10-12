import PurchaseItemRow from './PurchaseItemRow'
import { normName } from '../lib/purchaseRows'

// Presentational: list of editable purchase rows
function PurchaseItemsTable({ rows, matches, rowErrors, onChange, onDelete, disabled }) {
  if (rows.length === 0) {
    return <p className="placeholder">No quedan productos para importar.</p>
  }
  return (
    <ul className="purchase-rows">
      {rows.map((row, index) => (
        <PurchaseItemRow
          key={row.id}
          row={row}
          index={index}
          match={matches[normName(row.nombre)]}
          serverError={rowErrors[row.id]}
          onChange={onChange}
          onDelete={onDelete}
          disabled={disabled}
        />
      ))}
    </ul>
  )
}

export default PurchaseItemsTable
