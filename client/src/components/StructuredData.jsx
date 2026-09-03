function StructuredData({ data }) {
  const renderJson = (obj) => {
    if (!obj) return null
    const jsonString = JSON.stringify(obj, null, 2)
    return jsonString
  }

  return (
    <div className="structured-data">
      <h2>Datos detectados</h2>
      {data ? (
        <div className="json-display">
          <pre>{renderJson(data)}</pre>
        </div>
      ) : (
        <div className="data-placeholder">
          Los datos estructurados aparecerán aquí
        </div>
      )}
    </div>
  )
}

export default StructuredData