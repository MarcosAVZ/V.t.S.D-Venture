import { useState, useRef, useCallback, useEffect } from 'react'

const MAX_RECORDING_SECONDS = 60

function Recorder({ onStatusChange, onResult, onError }) {
  const [isRecording, setIsRecording] = useState(false)
  const [isSupported, setIsSupported] = useState(true)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const timerRef = useRef(null)

  useEffect(() => {
    if (!window.MediaRecorder) {
      setIsSupported(false)
      onError('Tu navegador no soporta grabación de audio')
    }
  }, [onError])

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
            ? 'audio/ogg;codecs=opus'
            : ''

      const options = mimeType ? { mimeType } : {}
      const mediaRecorder = new MediaRecorder(stream, options)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' })
        uploadAudio(audioBlob)
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.start()
      setIsRecording(true)
      onStatusChange('recording')

      timerRef.current = setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop()
        }
      }, MAX_RECORDING_SECONDS * 1000)
    } catch (err) {
      console.error('Error accessing microphone:', err)
      onError('No se pudo acceder al micrófono')
    }
  }, [onStatusChange, onError])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      clearTimeout(timerRef.current)
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }, [])

  const uploadAudio = useCallback(async (audioBlob) => {
    try {
      onStatusChange('uploading')
      const formData = new FormData()
      const ext = audioBlob.type.includes('ogg') ? 'ogg' : 'webm'
      formData.append('audio', audioBlob, `recording.${ext}`)

      const stages = [
        { status: 'processing', delay: 1500 },
      ]

      let cancelled = false
      const runStages = async () => {
        for (const stage of stages) {
          await new Promise(resolve => setTimeout(resolve, stage.delay))
          if (cancelled) return
          onStatusChange(stage.status)
        }
      }

      runStages()

      const response = await fetch('/api/voice/process', {
        method: 'POST',
        body: formData,
      })

      cancelled = true

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))

        if (response.status === 422 && errorData.operations) {
          onError(
            'Detecté varias operaciones en un solo audio. Por favor, grabá una por vez.',
            'multi_operation',
            { operations: errorData.operations }
          )
          return
        }

        throw new Error(errorData.error || `Error del servidor: ${response.status}`)
      }

      const result = await response.json()
      onResult(result)
    } catch (err) {
      console.error('Upload error:', err)
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        onError('No se pudo conectar al servidor. ¿Querés intentar de nuevo?', 'network')
      } else {
        onError(err.message)
      }
    }
  }, [onStatusChange, onResult, onError])

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current)
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
    }
  }, [])

  if (!isSupported) {
    return (
      <div className="recorder">
        <p className="recorder-error">Grabación no soportada en este navegador</p>
      </div>
    )
  }

  return (
    <div className="recorder">
      {!isRecording ? (
        <button className="record-button" onClick={startRecording}>
          🎙️ Comenzar grabación
        </button>
      ) : (
        <button className="record-button recording" onClick={stopRecording}>
          ⏹️ Detener grabación
        </button>
      )}
      {isRecording && (
        <div className="recording-indicator">
          <span className="pulse"></span>
          Grabando... (máximo {MAX_RECORDING_SECONDS}s)
        </div>
      )}
    </div>
  )
}

export default Recorder
