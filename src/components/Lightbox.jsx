// Lightbox: abre a mídia em tela cheia. Baixa o arquivo real (blob URL)
// pra o vídeo ter seek confiável.
import { useEffect, useState } from 'react';

export default function Lightbox({ item, token, getUrl, onClose }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!item) return;
    let objUrl;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    getUrl(token, item.id)
      .then((u) => {
        if (cancelled) return URL.revokeObjectURL(u);
        objUrl = u;
        setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
      setUrl(null);
    };
  }, [item, token, getUrl]);

  if (!item) return null;

  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Fechar">
        ✕
      </button>
      <div className="lightbox-body" onClick={(e) => e.stopPropagation()}>
        {failed ? (
          <p className="lightbox-error mono">Não foi possível carregar a mídia.</p>
        ) : !url ? (
          <div className="lightbox-spinner" role="status" aria-label="Carregando" />
        ) : item.kind === 'video' ? (
          <video src={url} controls autoPlay playsInline />
        ) : (
          <img src={url} alt={item.name} />
        )}
        {item.author && <div className="lightbox-author mono">{item.author}</div>}
        {item.hashtags.length > 0 && (
          <div className="lightbox-tags mono">
            {item.hashtags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
