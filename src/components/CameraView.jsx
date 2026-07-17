// Visor de câmera ao vivo com moldura de foco e HUD.
export default function CameraView({
  videoRef,
  ready,
  error,
  recording,
  facingMode,
  torchOn,
  torchSupported,
  onToggleTorch,
}) {
  return (
    <div className="viewfinder">
      <video
        ref={videoRef}
        playsInline
        muted
        // espelha só a câmera frontal (selfie), como esperado
        style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
      />

      {torchSupported && (
        <button
          type="button"
          className={`torch-btn ${torchOn ? 'active' : ''}`}
          onClick={onToggleTorch}
          title={torchOn ? 'Desligar flash' : 'Ligar flash'}
          aria-label={torchOn ? 'Desligar flash' : 'Ligar flash'}
        >
          ⚡
        </button>
      )}

      {/* moldura de foco */}
      <div className="focus-frame" aria-hidden="true">
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
      </div>

      {/* HUD */}
      <div className="hud mono">
        <span>{facingMode === 'user' ? 'FRONTAL' : 'TRASEIRA'}</span>
        {recording && <span className="rec-dot">● REC</span>}
      </div>

      {!ready && !error && <div className="viewfinder-msg">Iniciando câmera…</div>}
      {error && <div className="viewfinder-msg error">{error}</div>}
    </div>
  );
}
