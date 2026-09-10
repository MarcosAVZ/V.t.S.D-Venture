import { useState, useCallback } from 'react'
import Recorder from './components/Recorder'
import Transcription from './components/Transcription'
import StructuredData from './components/StructuredData'
import ConfirmationScreen from './components/ConfirmationScreen'
import QueryResult from './components/QueryResult'

const STATUS_TEXT = {
  idle: 'Listo para grabar',
  recording: 'Grabando...',
  uploading: 'Subiendo audio...',
  processing: 'Analizando...',
  confirming: 'Confirmá la operación',
  executing: 'Guardando...',
  queryResult: 'Resultado de consulta',
  completed: 'Completado',
  error: 'Error',
}

function App() {
  const [status, setStatus] = useState('idle')
  const [transcription, setTranscription] = useState('')
  const [operation, setOperation] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [errorType, setErrorType] = useState(null)
  const [errorDetails, setErrorDetails] = useState(null)
  const [queryResult, setQueryResult] = useState(null)
  const [lastOperation, setLastOperation] = useState(null)

  const isError = status === 'error'
  const isLoading = ['uploading', 'processing', 'executing'].includes(status)

  const handleStatusChange = useCallback((newStatus) => {
    setStatus(newStatus)
    if (newStatus !== 'error') {
      setError('')
      setErrorType(null)
      setErrorDetails(null)
    }
  }, [])

  const handleError = useCallback((errorMessage, type = 'generic', details = {}) => {
    setError(errorMessage)
    setErrorType(type)
    setErrorDetails(details)
    setStatus('error')
  }, [])

  const handleResult = useCallback((result) => {
    setTranscription(result.transcription)
    setOperation(result.operation)
    setData(result.data)
    setLastOperation(null)

    if (result.operation === 'CONSULTA') {
      setStatus('processing')
      executeQuery(result.data)
    } else {
      setStatus('confirming')
    }
  }, [])

  const executeQuery = useCallback(async (queryData) => {
    try {
      const params = new URLSearchParams()
      if (queryData.producto) params.append('producto', queryData.producto)
      if (queryData.color) params.append('color', queryData.color)
      if (queryData.talle) params.append('talle', queryData.talle)

      const response = await fetch(`/api/inventory/stock?${params.toString()}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Error del servidor: ${response.status}`)
      }

      const result = await response.json()
      setQueryResult(result)
      setStatus('queryResult')
    } catch (err) {
      console.error('Query error:', err)
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        handleError('No se pudo conectar al servidor. ¿Querés intentar de nuevo?', 'network', {
          retryAction: () => executeQuery(queryData),
        })
      } else {
        handleError(err.message)
      }
    }
  }, [handleError])

  const handleConfirm = useCallback(async ({ operation: op, data: execData }) => {
    setStatus('executing')
    setLastOperation({ operation: op, data: execData })

    try {
      const response = await fetch('/api/voice/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: op, data: execData }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))

        if (response.status === 409) {
          handleError(
            `Stock insuficiente. Solo tenés ${errorData.currentStock} unidades de "${errorData.producto || execData.producto}".`,
            'insufficient_stock',
            { currentStock: errorData.currentStock, producto: errorData.producto || execData.producto }
          )
          return
        }

        if (response.status === 404) {
          handleError(
            `No encontré "${errorData.producto || execData.producto}" en tu inventario.`,
            'product_not_found',
            { producto: errorData.producto || execData.producto }
          )
          return
        }

        throw new Error(errorData.error || `Error del servidor: ${response.status}`)
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Error al ejecutar la operación')
      }

      setStatus('completed')
    } catch (err) {
      console.error('Execute error:', err)
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        handleError(
          'No se pudo conectar al servidor. ¿Querés intentar de nuevo?',
          'network',
          { retryAction: () => handleConfirm({ operation: op, data: execData }) }
        )
      } else {
        handleError(err.message)
      }
    }
  }, [handleError])

  const handleRetry = useCallback(() => {
    if (errorDetails?.retryAction) {
      setError('')
      setErrorType(null)
      setErrorDetails(null)
      errorDetails.retryAction()
    } else {
      setStatus('idle')
      setTranscription('')
      setOperation(null)
      setData(null)
      setQueryResult(null)
      setError('')
      setErrorType(null)
      setErrorDetails(null)
      setLastOperation(null)
    }
  }, [errorDetails])

  const handleDismissError = useCallback(() => {
    setStatus('idle')
    setTranscription('')
    setOperation(null)
    setData(null)
    setQueryResult(null)
    setError('')
    setErrorType(null)
    setErrorDetails(null)
    setLastOperation(null)
  }, [])

  const handleCreateProduct = useCallback(() => {
    setOperation('NUEVO_PRODUCTO')
    setData({
      producto: errorDetails?.producto || '',
      color: null,
      talle: null,
      precio: 0,
      stock_inicial: 0,
    })
    setStatus('confirming')
    setError('')
    setErrorType(null)
    setErrorDetails(null)
  }, [errorDetails])

  return (
    <div className="app">
      <header className="app-header">
        <h1>V.t.S.D</h1>
        <p className="subtitle">Grabá tu voz y convertila en datos estructurados</p>
      </header>

      <main className="app-main">
        <section className="status-section">
          <div className={`status-indicator status-${status}`}>
            {STATUS_TEXT[status]}
            {isLoading && <span className="loading-dots">...</span>}
          </div>
        </section>

        {isError && error && (
          <section className={`error-banner error-${errorType || 'generic'}`}>
            <span className="error-icon">
              {errorType === 'network' && '🔌'}
              {errorType === 'insufficient_stock' && '📦'}
              {errorType === 'product_not_found' && '🔍'}
              {errorType === 'multi_operation' && '🎙️'}
              {!errorType && '⚠'}
            </span>
            <div className="error-content">
              <span className="error-message">{error}</span>
              {errorType === 'multi_operation' && errorDetails?.operations && (
                <div className="error-operations">
                  <span className="error-operations-label">Operaciones detectadas:</span>
                  <div className="error-operations-list">
                    {errorDetails.operations.map((op) => (
                      <span key={op} className="error-operation-tag">{op}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="error-actions">
              {errorType === 'product_not_found' && (
                <button className="create-product-btn" onClick={handleCreateProduct}>
                  Crear producto
                </button>
              )}
              {errorType === 'network' && errorDetails?.retryAction && (
                <button className="retry-btn" onClick={handleRetry}>
                  Reintentar
                </button>
              )}
              <button className="dismiss-btn" onClick={handleDismissError}>
                Entendido
              </button>
            </div>
          </section>
        )}

        {status === 'idle' && !isError && (
          <section className="hint-section">
            <p className="idle-hint">
              Grabá una compra, venta o consulta por voz
            </p>
          </section>
        )}

        {(status === 'idle' || status === 'recording' || status === 'uploading' || status === 'processing') && (
          <section className="recorder-section">
            <Recorder
              onStatusChange={handleStatusChange}
              onResult={handleResult}
              onError={handleError}
            />
          </section>
        )}

        {(status === 'uploading' || status === 'processing' || status === 'executing') && (
          <section className="loading-section">
            <div className="loading-indicator">
              <span className="loading-spinner"></span>
              <span className="loading-text">{STATUS_TEXT[status]}</span>
            </div>
          </section>
        )}

        {transcription && status !== 'uploading' && status !== 'processing' && (
          <section className="transcription-section">
            <Transcription transcription={transcription} />
          </section>
        )}

        {status !== 'confirming' && status !== 'executing' && data && status !== 'completed' && (
          <section className="data-section">
            <StructuredData data={data} operation={operation} />
          </section>
        )}

        {(status === 'confirming' || status === 'executing') && data && (
          <section className="confirmation-section">
            <ConfirmationScreen
              operation={operation}
              data={data}
              transcription={transcription}
              onConfirm={handleConfirm}
              onCancel={handleDismissError}
              isExecuting={status === 'executing'}
            />
          </section>
        )}

        {status === 'queryResult' && queryResult && (
          <section className="query-section">
            <QueryResult result={queryResult} />
            <button className="action-btn back-btn" onClick={handleDismissError}>
              ← Volver
            </button>
          </section>
        )}

        {status === 'completed' && (
          <section className="completed-section">
            <div className="completed-message">
              <span className="completed-icon">✓</span>
              <span>Operación ejecutada exitosamente</span>
            </div>
            <button className="action-btn back-btn" onClick={handleDismissError}>
              ← Nueva operación
            </button>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>V.t.S.D — Voice to Structured Data</p>
      </footer>
    </div>
  )
}

export default App
