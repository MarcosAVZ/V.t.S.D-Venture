function QueryResult({ result, isLoading }) {
  if (isLoading) {
    return (
      <div className="query-result">
        <h2>Resultado de consulta</h2>
        <div className="query-loading">
          <span className="loading-spinner"></span>
          <span>Consultando stock...</span>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="query-result">
        <h2>Resultado de consulta</h2>
        <div className="query-empty">
          <span className="empty-icon">🔍</span>
          <span>No se encontraron productos</span>
        </div>
      </div>
    )
  }

  if (result.error) {
    return (
      <div className="query-result">
        <h2>Resultado de consulta</h2>
        <div className="query-error">
          <span className="error-icon">⚠</span>
          {result.error}
        </div>
      </div>
    )
  }

  if (!result.message && (!result.historial_movimientos || result.historial_movimientos.length === 0)) {
    return (
      <div className="query-result">
        <h2>Resultado de consulta</h2>
        <div className="query-empty">
          <span className="empty-icon">📦</span>
          <span>No se encontraron productos</span>
        </div>
      </div>
    )
  }

  return (
    <div className="query-result">
      <h2>Resultado de consulta</h2>
      <div className="query-content">
        {result.message && <div className="query-stock-text">{result.message}</div>}

        {result.historial_movimientos && result.historial_movimientos.length > 0 && (
          <div className="query-history">
            <h3>Últimos movimientos</h3>
            <ul>
              {result.historial_movimientos.slice(-5).reverse().map((mov, i) => (
                <li key={i} className={`movement-${mov.tipo?.toLowerCase()}`}>
                  <span className="mov-type">{mov.tipo}</span>
                  <span className="mov-qty">
                    {mov.tipo === 'VENTA' || mov.tipo === 'AJUSTE' ? '-' : '+'}
                    {mov.cantidad}
                  </span>
                  <span className="mov-date">{mov.fecha}</span>
                  {mov.motivo && <span className="mov-motivo">{mov.motivo}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

export default QueryResult
