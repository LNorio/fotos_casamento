// Visor de câmera ao vivo com moldura de foco e HUD.
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function CameraView({
  videoRef,
  ready,
  error,
  recording,
  recordSeconds = 0,
  maxSeconds,
  audioAtivo = false,
  uploading = false,
  progress = null,
  statusLabel,
  facingMode,
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
        {/* Estado do microfone à vista: gravar sem som precisa ser
            percebido antes, não ao rever o vídeo. */}
        {ready && <span className="hud-audio">{audioAtivo ? '🎤' : '🔇 sem áudio'}</span>}
        {/* Com limite de duração, o tempo decorrido deixa de ser
            enfeite: sem ele a gravação simplesmente para sozinha. */}
        {recording && (
          <span className="rec-dot">
            ● REC {mmss(recordSeconds)}
            {maxSeconds ? ` / ${mmss(maxSeconds)}` : ''}
          </span>
        )}
      </div>

      {/* Envio em curso, sobre o visor. É onde o olho já está quando se
          aperta o obturador — um indicador abaixo dos controles passava
          despercebido e o botão apagado parecia falha. */}
      {uploading && (
        <div className="upload-overlay" role="status" aria-live="polite">
          <div className="upload-spinner" />
          <span className="upload-overlay-label">{statusLabel || 'Enviando…'}</span>
          <div className="upload-track">
            <div className="upload-track-bar" style={{ width: (progress ?? 0) + '%' }} />
          </div>
          <span className="upload-overlay-pct mono">
            {progress === null ? 'preparando' : `${progress}%`}
          </span>
        </div>
      )}

      {!ready && !error && !uploading && (
        <div className="viewfinder-msg">Iniciando câmera…</div>
      )}
      {error && <div className="viewfinder-msg error">{error}</div>}
    </div>
  );
}
