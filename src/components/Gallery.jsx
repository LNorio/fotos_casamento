// Galeria masonry. Cada card baixa a mídia sob demanda (blob URL).
import { useCallback, useEffect, useRef, useState } from 'react';

const RETRY_DELAY = 15000;

function Thumb({ item, token, onOpen, getUrl }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Baixa o arquivo autenticado (o mesmo caminho usado ao abrir a mídia
  // no clique, que sempre funciona) — usado para vídeo/foto sem thumb e
  // como fallback quando o thumbnailLink falha.
  const loadViaDownload = useCallback(() => {
    getUrl(token, item.id)
      .then((u) => {
        if (!mountedRef.current) return URL.revokeObjectURL(u);
        setUrl(u);
      })
      .catch(() => {
        if (mountedRef.current) setFailed(true);
      });
  }, [token, item.id, getUrl]);

  useEffect(() => {
    setFailed(false);
    setUrl(null);

    // Fotos: tenta primeiro o thumbnailLink (mais leve).
    if (item.kind === 'image' && item.thumbnailLink) {
      setUrl(item.thumbnailLink);
      return;
    }

    loadViaDownload();
  }, [item, loadViaDownload, retryTick]);

  // Se a mídia não carregar em nenhum dos dois caminhos, não mostra o
  // ícone de imagem quebrada: mantém o skeleton de loading e tenta de
  // novo em 15s.
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => {
      setFailed(false);
      setRetryTick((n) => n + 1);
    }, RETRY_DELAY);
    return () => clearTimeout(timer);
  }, [failed]);

  const showMedia = url && !failed;

  return (
    <button className="tile" onClick={() => onOpen(item)}>
      {showMedia ? (
        item.kind === 'video' ? (
          <video src={url} muted playsInline />
        ) : (
          <img
            src={url}
            alt={item.name}
            loading="lazy"
            onError={() => {
              setUrl(null);
              // thumbnailLink falhou: cai direto pro download autenticado
              // em vez de repetir a mesma URL quebrada a cada 15s.
              loadViaDownload();
            }}
          />
        )
      ) : (
        <div className="tile-skeleton" />
      )}
      {item.kind === 'video' && <span className="play-badge">▶</span>}
    </button>
  );
}

export default function Gallery({ items, token, onOpen, getUrl, loading }) {
  if (loading) return <p className="empty">Carregando galeria…</p>;
  if (!items.length)
    return <p className="empty">Nada por aqui ainda. Capture a primeira mídia.</p>;

  return (
    <div className="masonry">
      {items.map((it) => (
        <Thumb key={it.id} item={it} token={token} onOpen={onOpen} getUrl={getUrl} />
      ))}
    </div>
  );
}
