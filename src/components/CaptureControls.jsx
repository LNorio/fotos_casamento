// Botões de captura: alternar câmera, tirar foto, gravar vídeo.
export default function CaptureControls({
  onPhoto,
  onToggleVideo,
  onFlip,
  recording,
  busy,
}) {
  return (
    <div className="controls">
      <button className="ctrl-side" onClick={onFlip} disabled={busy} title="Virar câmera">
        ⟲
      </button>

      {/* Durante a gravação o obturador vira "parar": é o botão maior e
          mais ao alcance do polegar, e tirar foto no meio de um vídeo
          interromperia a gravação de qualquer forma. */}
      <button
        className={`shutter ${recording ? 'recording' : ''}`}
        onClick={recording ? onToggleVideo : onPhoto}
        disabled={busy}
        title={recording ? 'Parar gravação' : 'Tirar foto'}
        aria-label={recording ? 'Parar gravação' : 'Tirar foto'}
      >
        <span className="shutter-inner" />
      </button>

      <button
        className={`ctrl-side ${recording ? 'active' : ''}`}
        onClick={onToggleVideo}
        disabled={busy}
        title={recording ? 'Parar gravação' : 'Gravar vídeo'}
      >
        {recording ? '■' : '⦿'}
      </button>
    </div>
  );
}
