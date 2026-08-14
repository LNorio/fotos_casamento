// Lightbox: abre a mídia em tela cheia.
//
//  - Foto: mostra na hora a miniatura que a galeria já carregou (ela
//    está no cache do navegador, então aparece instantaneamente) e
//    troca pela versão grande quando ela terminar de baixar em
//    segundo plano. Se a versão grande falhar, a miniatura fica —
//    imagem menos nítida é melhor que mensagem de erro.
//
//  - Vídeo: o player do próprio Drive, num iframe. É o caminho que faz
//    streaming e seek de forma confiável em qualquer tamanho de
//    arquivo, sem precisar baixar o vídeo inteiro antes de tocar.
import { useEffect, useState } from 'react';
import { acquireSlot, reportarFalha } from '../utils/loadQueue.js';

// Depois do envio, o Drive transcodifica o vídeo antes de conseguir
// reproduzi-lo, e até lá o player exibe "ainda está sendo processado".
// Não dá para trocar esse texto — ele vem de dentro do iframe —, mas dá
// para avisar antes que aquilo é esperado e passa.
const RECEM_ENVIADO_MS = 15 * 60 * 1000;

export default function Lightbox({ item, onClose }) {
  const [src, setSrc] = useState(null);
  // O player nativo é o caminho preferido; o do Drive entra se o
  // navegador não der conta do arquivo.
  const [usarPlayerDoDrive, setUsarPlayerDoDrive] = useState(false);
  const isVideo = item?.kind === 'video';
  const recemEnviado =
    isVideo &&
    item?.createdTime &&
    Date.now() - new Date(item.createdTime).getTime() < RECEM_ENVIADO_MS;

  // Pré-carrega a versão grande fora da árvore do React: assim a troca
  // do src acontece com a imagem já pronta, sem piscar.
  // Cada mídia recomeça do player nativo: a reserva vale para o arquivo
  // que falhou, não para os seguintes.
  useEffect(() => {
    setUsarPlayerDoDrive(false);
  }, [item]);

  useEffect(() => {
    if (!item || isVideo) return;

    setSrc(item.thumbUrl);
    let cancelado = false;
    let liberar = null;

    // priority: a foto aberta fura a fila do grid — o usuário está
    // olhando para ela agora, não para as miniaturas ainda pendentes.
    acquireSlot({ priority: true }).then((release) => {
      if (cancelado) return release();
      liberar = release;

      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        release();
        if (!cancelado) setSrc(item.fullUrl);
      };
      img.onerror = () => {
        release();
        reportarFalha();
        // Sem alarde: a miniatura já resolve a visualização.
      };
      img.src = item.fullUrl;
    });

    return () => {
      cancelado = true;
      if (liberar) liberar();
    };
  }, [item, isVideo]);

  if (!item) return null;

  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Fechar">
        ✕
      </button>
      <div className="lightbox-body" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          usarPlayerDoDrive || !item.downloadUrl ? (
            <iframe
              src={item.previewUrl}
              title={item.name}
              allow="autoplay; fullscreen"
              allowFullScreen
            />
          ) : (
            // playsInline evita que o iOS assuma a tela inteira sozinho.
            <video
              src={item.downloadUrl}
              controls
              autoPlay
              playsInline
              onError={() => setUsarPlayerDoDrive(true)}
            />
          )
        ) : src ? (
          <img src={src} alt={item.name} referrerPolicy="no-referrer" />
        ) : (
          <div className="lightbox-spinner" role="status" aria-label="Carregando" />
        )}
        {/* Só faz sentido com o player do Drive: ele depende da
            transcodificação, enquanto o nativo toca os bytes originais
            assim que o envio termina. */}
        {recemEnviado && usarPlayerDoDrive && (
          <p className="lightbox-nota mono">
            Vídeo recém-enviado — o Drive ainda pode estar preparando a
            reprodução. Se não tocar, tente daqui a alguns minutos.
          </p>
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
