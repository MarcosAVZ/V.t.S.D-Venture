function StructuredData({ data }) {
  if (!data) {
    return (
      <div className="structured-data">
        <h2>Datos detectados</h2>
        <p className="placeholder">Esperando datos...</p>
      </div>
    )
  }

  return (
    <div className="structured-data">
      <h2>Datos detectados</h2>
      <div className="data-card">
        <div className="data-row">
          <span className="data-label">Fecha:</span>
          <span className="data-value">{data.fecha || '—'}</span>
        </div>
        <div className="data-row">
          <span className="data-label">Proveedor:</span>
          <span className="data-value">{data.proveedor || '—'}</span>
        </div>
        <div className="data-row">
          <span className="data-label">Método de pago:</span>
          <span className="data-value">{data.metodo_pago || '—'}</span>
        </div>

        {data.productos && data.productos.length > 0 && (
          <div className="products-section">
            <h3>Productos ({data.productos.length})</h3>
            {data.productos.map((producto, index) => (
              <div key={index} className="product-card">
                <div className="product-header">
                  <span className="product-name">{producto.producto}</span>
                  <span className="product-qty">x{producto.cantidad}</span>
                </div>
                <div className="product-details">
                  {producto.color && <span>Color: {producto.color}</span>}
                  {producto.talle && <span>Talle: {producto.talle}</span>}
                  <span className="product-price">
                    ${producto.precio_unitario?.toLocaleString('es-AR')}
                  </span>
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
