function Transcription({ transcription }) {
  return (
    <div className="transcription">
      <h2>Transcripción</h2>
      {transcription ? (
        <div className="transcription-content">
          {transcription}
        </div>
      ) : (
        <div className="transcription-placeholder">
          La transcripción aparecerá aquí después de grabar
        </div>
      )}
    </div>
  )
}

export default Transcription