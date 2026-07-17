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

      <button
        className={`shutter ${recording ? 'recording' : ''}`}
        onClick={onPhoto}
        disabled={busy}
        title="Tirar foto"
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
