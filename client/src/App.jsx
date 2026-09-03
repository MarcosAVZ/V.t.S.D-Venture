import { useState, useCallback } from 'react'
import Recorder from './components/Recorder'
import Transcription from './components/Transcription'
import StructuredData from './components/StructuredData'

const STATUS_TEXT = {
  idle: 'Listo para grabar',
  recording: 'Grabando...',
  uploading: 'Subiendo audio...',
  transcribing: 'Transcribiendo...',
  extracting: 'Analizando información...',
  validating: 'Validando datos...',
  completed: 'Completado',
  error: 'Error',
}

function App() {
  const [status, setStatus] = useState('idle')
  const [transcription, setTranscription] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const handleStatusChange = useCallback((newStatus) => {
    setStatus(newStatus)
    if (newStatus !== 'error') {
      setError('')
    }
  }, [])

  const handleResult = useCallback((result) => {
    setTranscription(result.transcription)
    setData(result.data)
    setStatus('completed')
  }, [])

  const handleError = useCallback((errorMessage) => {
    setError(errorMessage)
    setStatus('error')
  }, [])

  const statusText = status === 'error' ? `Error: ${error}` : STATUS_TEXT[status]

  return (
    <div className="app">
      <header className="app-header">
        <h1>V.t.S.D</h1>
        <p className="subtitle">Grabá tu voz y convertila en datos estructurados</p>
      </header>

      <main className="app-main">
        <section className="status-section">
          <div className={`status-indicator status-${status}`}>
            {statusText}
          </div>
        </section>

        <section className="recorder-section">
          <Recorder
            onStatusChange={handleStatusChange}
            onResult={handleResult}
            onError={handleError}
          />
        </section>

        <section className="transcription-section">
          <Transcription transcription={transcription} />
        </section>

        <section className="data-section">
          <StructuredData data={data} />
        </section>
      </main>

      <footer className="app-footer">
        <p>V.t.S.D — Voice to Structured Data</p>
      </footer>
    </div>
  )
}

export default App