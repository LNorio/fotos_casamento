// Visor de câmera ao vivo com moldura de foco e HUD.
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function CameraView({
  videoRef,
  ready,
  error,
  recording,
  recordSeconds = 0,
  maxSeconds,
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
        {/* Com limite de duração, o tempo decorrido deixa de ser
            enfeite: sem ele a gravação simplesmente para sozinha. */}
        {recording && (
          <span className="rec-dot">
            ● REC {mmss(recordSeconds)}
            {maxSeconds ? ` / ${mmss(maxSeconds)}` : ''}
          </span>
        )}
      </div>

      {!ready && !error && <div className="viewfinder-msg">Iniciando câmera…</div>}
      {error && <div className="viewfinder-msg error">{error}</div>}
    </div>
  );
}
