// Preview dos arquivos escolhidos no upload por diretório, antes de
// enviar: mostra a mídia e permite ajustar as hashtags de cada item.
export default function UploadPreviewModal({
  items,
  busy,
  status,
  progress,
  onTagsChange,
  onNameChange,
  onRemove,
  onCancel,
  onConfirm,
}) {
  if (!items.length) return null;

  return (
    <div className="preview-overlay" onClick={busy ? undefined : onCancel}>
      <div className="preview-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="preview-title">
          Enviar {items.length} {items.length === 1 ? 'arquivo' : 'arquivos'}
        </h2>

        <div className="preview-list">
          {items.map((it) => (
            <div className="preview-item" key={it.id}>
              <div className="preview-thumb">
                {it.file.type.startsWith('video/') ? (
                  <video src={it.previewUrl} muted playsInline />
                ) : (
                  <img src={it.previewUrl} alt={it.file.name} />
                )}
                {!busy && (
                  <button
                    type="button"
                    className="preview-remove"
                    onClick={() => onRemove(it.id)}
                    aria-label="Remover arquivo"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="preview-fields">
                <span className="preview-name mono" title={it.file.name}>
                  {it.file.name}
                </span>
                <input
                  className="preview-author"
                  placeholder="Seu nome (opcional)"
                  value={it.nameInput}
                  onChange={(e) => onNameChange(it.id, e.target.value)}
                  disabled={busy}
                />
                <input
                  className="preview-tags"
                  placeholder="hashtags separadas por espaço"
                  value={it.tagsInput}
                  onChange={(e) => onTagsChange(it.id, e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>
          ))}
        </div>

        {status && <p className="upload-status mono">{status}</p>}
        {progress !== null && (
          <div className="progress">
            <div className="progress-bar" style={{ width: progress + '%' }} />
            <span className="mono">{progress}%</span>
          </div>
        )}

        <div className="preview-actions">
          <button className="preview-cancel mono" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button className="preview-confirm" onClick={onConfirm} disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}
