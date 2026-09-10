import OperationBadge from './OperationBadge'

const FIELD_LABELS = {
  fecha: 'Fecha',
  proveedor: 'Proveedor',
  cliente: 'Cliente',
  metodo_pago: 'Método de pago',
  producto: 'Producto',
  color: 'Color',
  talle: 'Talle',
  precio: 'Precio',
  stock_inicial: 'Stock inicial',
  cantidad: 'Cantidad',
  motivo: 'Motivo',
}

function StructuredData({ data, operation }) {
  if (!data) {
    return (
      <div className="structured-data">
        <h2>Datos detectados</h2>
        <p className="placeholder">Esperando datos...</p>
      </div>
    )
  }

  const renderFields = () => {
    const fields = []

    if (operation === 'COMPRA' || operation === 'VENTA') {
      fields.push(
        { key: 'fecha', value: data.fecha },
        { key: operation === 'COMPRA' ? 'proveedor' : 'cliente', value: data[operation === 'COMPRA' ? 'proveedor' : 'cliente'] },
        { key: 'metodo_pago', value: data.metodo_pago },
      )
    } else if (operation === 'NUEVO_PRODUCTO') {
      fields.push(
        { key: 'producto', value: data.producto },
        { key: 'color', value: data.color },
        { key: 'talle', value: data.talle },
        { key: 'precio', value: data.precio, format: 'currency' },
        { key: 'stock_inicial', value: data.stock_inicial },
      )
    } else if (operation === 'AJUSTE') {
      fields.push(
        { key: 'producto', value: data.producto },
        { key: 'color', value: data.color },
        { key: 'talle', value: data.talle },
        { key: 'cantidad', value: data.cantidad },
        { key: 'motivo', value: data.motivo },
      )
    } else if (operation === 'CONSULTA') {
      fields.push(
        { key: 'producto', value: data.producto },
        { key: 'color', value: data.color },
        { key: 'talle', value: data.talle },
      )
    } else {
      // Fallback: show all fields
      Object.entries(data).forEach(([key, value]) => {
        if (key !== 'productos' && key !== 'operation') {
          fields.push({ key, value })
        }
      })
    }

    return fields.filter((f) => f.value !== null && f.value !== undefined && f.value !== '')
  }

  const fields = renderFields()

  return (
    <div className="structured-data">
      <h2>Datos detectados</h2>

      {operation && (
        <div className="structured-operation">
          <OperationBadge operation={operation} />
        </div>
      )}

      <div className="data-card">
        {fields.map(({ key, value, format }) => (
          <div key={key} className="data-row">
            <span className="data-label">{FIELD_LABELS[key] || key}:</span>
            <span className="data-value">
              {format === 'currency'
                ? `$${Number(value).toLocaleString('es-AR')}`
                : value ?? '—'}
            </span>
          </div>
        ))}

        {data.productos && data.productos.length > 0 && (
          <div className="products-section">
            <h3>Productos ({data.productos.length})</h3>
            {data.productos.map((producto, index) => (
              <div key={index} className="product-card">
                <div className="product-header">
                  <span className="product-name">
                    {producto.nombre || producto.producto || `#${index + 1}`}
                  </span>
                  <span className="product-qty">x{producto.cantidad}</span>
                </div>
                <div className="product-details">
                  {producto.color && <span>Color: {producto.color}</span>}
                  {producto.talle && <span>Talle: {producto.talle}</span>}
                  {producto.precio_unitario != null && (
                    <span className="product-price">
                      ${producto.precio_unitario.toLocaleString('es-AR')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <details className="json-raw">
          <summary>Ver JSON completo</summary>
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </details>
      </div>
    </div>
  )
}

export default StructuredData
