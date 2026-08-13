// Galeria em grade de proporção fixa, preenchida por linha: as mídias
// mais recentes vêm primeiro (o servidor ordena por createdTime desc) e
// ocupam a primeira linha, lado a lado.
//
// Duas proteções contra o limite de taxa do Google (429):
//  1. paginação — só um punhado de cards existe por vez, então o
//     navegador nunca pede a galeria inteira de uma só vez;
//  2. fila de carregamento — dentro da página visível, no máximo
//     3 imagens em voo. Ver src/utils/loadQueue.js.
//
// O cache de repetição fica por conta do navegador: o Google devolve
// Cache-Control: private, max-age=86400 nas miniaturas, então voltar
// à galeria no mesmo dia não gera requisição nova.
import { useCallback, useEffect, useRef, useState } from 'react';
import { acquireSlot, reportarFalha } from '../utils/loadQueue.js';

const PAGE_SIZE = 12;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;

// Generoso de propósito. A causa mais comum de erro aqui é limite de
// taxa, que passa sozinho — e desistir cedo marcaria como quebrada uma
// foto que está perfeita. O teto existe só para o caso definitivo: um
// upload interrompido deixa um arquivo que nunca vai gerar miniatura, e
// aí insistir seria uma requisição a cada 30 s, por dispositivo, para
// sempre. Com o recuo exponencial, 10 tentativas levam ~4 minutos.
const MAX_TENTATIVAS = 10;

function Thumb({ item, onOpen }) {
  const [src, setSrc] = useState(null);
  const [tentativa, setTentativa] = useState(0);
  const [morto, setMorto] = useState(false);
  const releaseRef = useRef(null);
  const retryRef = useRef(null);

  // Uma mídia trocada no card zera o histórico de tentativas.
  useEffect(() => {
    setTentativa(0);
    setMorto(false);
  }, [item.thumbUrl]);

  const release = useCallback(() => {
    if (releaseRef.current) {
      releaseRef.current();
      releaseRef.current = null;
    }
  }, []);

  // Só define o src depois de conseguir vaga na fila. Note que não há
  // loading="lazy": com ele o navegador adia as imagens fora da tela,
  // o evento de load nunca chega e o slot ficaria preso.
  useEffect(() => {
    if (morto) return;
    let cancelado = false;
    setSrc(null);

    acquireSlot().then((releaseSlot) => {
      if (cancelado) return releaseSlot();
      releaseRef.current = releaseSlot;
      setSrc(item.thumbUrl);
    });

    return () => {
      cancelado = true;
      release();
    };
  }, [item.thumbUrl, tentativa, morto, release]);

  useEffect(() => () => clearTimeout(retryRef.current), []);

  const handleError = useCallback(() => {
    release();
    setSrc(null);
    // Alimenta a inferência de limite de taxa da fila.
    reportarFalha();

    if (tentativa + 1 >= MAX_TENTATIVAS) {
      setMorto(true);
      return;
    }
    // Jitter para os cards não voltarem todos no mesmo instante —
    // sincronizados, eles reproduziriam a rajada que causou a falha.
    const espera =
      Math.min(RETRY_BASE_MS * 2 ** tentativa, RETRY_MAX_MS) + Math.random() * 1000;
    clearTimeout(retryRef.current);
    retryRef.current = setTimeout(() => setTentativa((n) => n + 1), espera);
  }, [tentativa, release]);

  return (
    <button className="tile" onClick={() => onOpen(item)}>
      {src ? (
        <img
          src={src}
          alt={item.name}
          referrerPolicy="no-referrer"
          onLoad={release}
          onError={handleError}
        />
      ) : morto ? (
        <div className="tile-unavailable">
          <span aria-hidden="true">⊘</span>
          <span className="mono">indisponível</span>
        </div>
      ) : (
        <div className="tile-skeleton" />
      )}
      {item.kind === 'video' && !morto && <span className="play-badge">▶</span>}
    </button>
  );
}

export default function Gallery({ items, onOpen, loading, resetKey }) {
  const [shownCount, setShownCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);

  // Recomeça do topo quando o usuário troca de hashtag — e só nesse
  // caso. Reagir a `items` voltaria a galeria para a primeira página a
  // cada releitura automática, puxando o tapete de quem estivesse
  // rolando. Mídia nova entra no topo, então a posição continua válida.
  useEffect(() => {
    setShownCount(PAGE_SIZE);
  }, [resetKey]);

  const hasMore = shownCount < items.length;

  // Carrega a próxima página quando o rodapé se aproxima da tela. A
  // margem de 300px faz a busca começar um pouco antes de o usuário
  // chegar lá, sem pedir tudo de uma vez.
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setShownCount((n) => n + PAGE_SIZE);
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, shownCount]);

  if (loading) return <p className="empty">Carregando galeria…</p>;
  if (!items.length)
    return <p className="empty">Nada por aqui ainda. Capture a primeira mídia.</p>;

  return (
    <>
      <div className="masonry">
        {items.slice(0, shownCount).map((it) => (
          <Thumb key={it.id} item={it} onOpen={onOpen} />
        ))}
      </div>

      {hasMore && (
        <div className="gallery-more" ref={sentinelRef}>
          <button
            className="mono gallery-more-btn"
            onClick={() => setShownCount((n) => n + PAGE_SIZE)}
          >
            Carregar mais ({items.length - shownCount})
          </button>
        </div>
      )}
    </>
  );
}
