import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCamera } from './hooks/useCamera.js';
import {
  uploadMedia,
  createUploadSessions,
  uploadToSession,
  listMedia,
  filterByHashtag,
  MAX_FILES_PER_REQUEST,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
} from './services/driveStorage.js';
import CameraView from './components/CameraView.jsx';
import CaptureControls from './components/CaptureControls.jsx';
import HashtagFilter from './components/HashtagFilter.jsx';
import Gallery from './components/Gallery.jsx';
import Lightbox from './components/Lightbox.jsx';
import UploadPreviewModal from './components/UploadPreviewModal.jsx';
import { parseHashtags } from './utils/hashtags.js';
import { readGalleryCache, writeGalleryCache } from './utils/galleryCache.js';

// O Drive demora alguns segundos para gerar a miniatura de um arquivo
// recém-enviado. Uma segunda leitura da galeria pouco depois evita que
// a mídia fique como skeleton até o usuário recarregar a página.
const THUMB_DELAY_MS = 6000;

// A listagem pode falhar por motivo passageiro: o Apps Script responde
// 404 durante os segundos de uma republicação, e rede de celular oscila.
// Em vez de deixar o erro preso na tela, tenta de novo antes de desistir.
const LOAD_ATTEMPTS = 4;
const LOAD_RETRY_BASE_MS = 1200;

// Releitura periódica da galeria, para quem deixa o app aberto ver as
// mídias que os outros foram enviando.
//
// 30 min, e não 5: cada releitura é uma execução do Apps Script, e
// conta comum tem 90 min/dia no total. Medido com 200 convidados de
// app aberto, 5 min esgotariam a cota em ~2 h de festa; 30 min levam
// a autonomia para além de 8 h.
const AUTO_REFRESH_MS = 30 * 60 * 1000;

// Idade a partir da qual vale voltar ao servidor ao abrir o app. Abaixo
// disso, a listagem guardada no localStorage é boa o bastante — abrir
// o app várias vezes seguidas não deve custar uma execução por vez.
const CACHE_STALE_MS = 3 * 60 * 1000;

// Duração máxima de um vídeo. Não é só cortesia com o armazenamento:
// o arquivo fica em memória até o envio terminar, e celular modesto
// numa festa não é lugar para gravação longa.
const MAX_VIDEO_MS = 60 * 1000;

// Derivado da constante para o aviso na tela nunca desmentir o limite
// real, caso ele mude.
const LIMITE_VIDEO =
  MAX_VIDEO_MS % 60000 === 0
    ? `${MAX_VIDEO_MS / 60000} minuto${MAX_VIDEO_MS > 60000 ? 's' : ''}`
    : `${Math.round(MAX_VIDEO_MS / 1000)} segundos`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const cam = useCamera();

  const [nameInput, setNameInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [items, setItems] = useState([]);
  const [loadingGallery, setLoadingGallery] = useState(false);
  const [activeTag, setActiveTag] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const fileInputRef = useRef(null);
  const thumbTimerRef = useRef(null);
  const statusTimerRef = useRef(null);
  const recordLimitRef = useRef(null);
  const recordTickRef = useRef(null);
  const stoppingRef = useRef(false);
  const lastRefreshRef = useRef(0);
  const busyRef = useRef(false);

  // Espelha `busy` num ref para o timer do reload automático poder
  // consultá-lo sem virar dependência e reiniciar o intervalo.
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // Hashtags digitadas no campo -> array limpo.
  const currentTags = useMemo(() => parseHashtags(tagsInput), [tagsInput]);

  // Recarrega a galeria a partir da pasta compartilhada do Drive.
  const refresh = useCallback(async ({ silent = false, fresh = false } = {}) => {
    if (!silent) setLoadingGallery(true);
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const { items: fetched, generatedAt } = await listMedia({ fresh });
          setItems(fetched);
          writeGalleryCache(fetched, generatedAt);
          // generatedAt é o instante em que o servidor montou a lista —
          // pode ser até 60 s mais velho que agora, quando a resposta
          // veio do cache. É justamente esse o dado honesto a mostrar.
          setUpdatedAt(generatedAt ? new Date(generatedAt) : new Date());
          setError(null);
          lastRefreshRef.current = Date.now();
          return;
        } catch (e) {
          if (attempt === LOAD_ATTEMPTS - 1) throw e;
          await sleep(LOAD_RETRY_BASE_MS * 2 ** attempt + Math.random() * 400);
        }
      }
    } catch (e) {
      console.error(e);
      if (!silent) setError('Não foi possível carregar a galeria: ' + e.message);
    } finally {
      if (!silent) setLoadingGallery(false);
    }
  }, []);

  // Mensagem que some sozinha, para confirmar o envio sem virar
  // ruído permanente na tela.
  const flashStatus = useCallback((texto, duracao = 2500) => {
    setUploadStatus(texto);
    clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setUploadStatus(null), duracao);
  }, []);

  // Recarrega agora e mais uma vez adiante, quando as miniaturas do que
  // acabou de subir já estiverem prontas. Nos dois casos ignora o cache
  // do servidor: sem isso a mídia recém-enviada poderia não aparecer,
  // porque a listagem em cache foi montada antes dela existir.
  //
  // Silencioso nas duas: o envio já terminou, e trocar o grid inteiro
  // por "Carregando galeria…" nesse momento parece que algo quebrou.
  const refreshAfterUpload = useCallback(async () => {
    await refresh({ silent: true, fresh: true });
    clearTimeout(thumbTimerRef.current);
    thumbTimerRef.current = setTimeout(
      () => refresh({ silent: true, fresh: true }),
      THUMB_DELAY_MS
    );
  }, [refresh]);

  // Abertura do app: mostra na hora o que ficou guardado da última vez
  // e só volta ao servidor se aquilo já tiver idade. Sem cache, é o
  // caminho normal com indicador de carregamento.
  useEffect(() => {
    const cached = readGalleryCache();
    if (cached) {
      setItems(cached.items);
      setUpdatedAt(cached.generatedAt ? new Date(cached.generatedAt) : null);
      lastRefreshRef.current = cached.fetchedAt;
      if (Date.now() - cached.fetchedAt >= CACHE_STALE_MS) {
        refresh({ silent: true });
      }
    } else {
      refresh();
    }
    return () => {
      clearTimeout(thumbTimerRef.current);
      clearTimeout(statusTimerRef.current);
      clearTimeout(recordLimitRef.current);
      clearInterval(recordTickRef.current);
    };
  }, [refresh]);

  // Reload automático. Sempre silencioso: não mostra "Carregando
  // galeria…" nem substitui o que já está na tela por uma mensagem de
  // erro se a rede oscilar — quem está usando o app não pediu isso.
  useEffect(() => {
    const canRefresh = () =>
      document.visibilityState === 'visible' && !busyRef.current;

    // Com a aba em segundo plano não adianta atualizar: gasta cota do
    // Apps Script e ainda estoura o limite de taxa das miniaturas
    // quando o convidado volta e tudo carrega de uma vez.
    const timer = setInterval(() => {
      if (canRefresh()) refresh({ silent: true });
    }, AUTO_REFRESH_MS);

    // Ao voltar para a aba, atualiza na hora se já passou do intervalo,
    // em vez de esperar o próximo tique.
    const onVisibility = () => {
      if (!canRefresh()) return;
      if (Date.now() - lastRefreshRef.current < AUTO_REFRESH_MS) return;
      refresh({ silent: true });
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  // Todas as hashtags existentes (p/ os chips).
  const allTags = useMemo(
    () => [...new Set(items.flatMap((i) => i.hashtags))].sort(),
    [items]
  );

  const visible = useMemo(
    () => filterByHashtag(items, activeTag),
    [items, activeTag]
  );

  // --- Ações de captura ---
  const handlePhoto = useCallback(async () => {
    setBusy(true);
    setError(null);
    // Retorno imediato: abrir a sessão sozinha leva ~1,5 s, e sem nada
    // na tela nesse intervalo a impressão é de que o clique não pegou.
    setProgress(0);
    setUploadStatus('Enviando foto…');
    try {
      const blob = await cam.capturePhoto();
      if (blob) {
        await uploadMedia(
          blob,
          `foto_${Date.now()}.jpg`,
          currentTags,
          nameInput.trim(),
          setProgress
        );
        flashStatus('Foto enviada');
        // Sem await: a galeria se atualiza em segundo plano e o
        // obturador volta a funcionar assim que o envio termina.
        refreshAfterUpload();
      } else {
        setUploadStatus(null);
      }
    } catch (e) {
      console.error(e);
      setError('Falha ao enviar a foto: ' + e.message);
      setUploadStatus(null);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [cam, currentTags, nameInput, refreshAfterUpload, flashStatus]);

  // Encerra a gravação e envia. Chamado tanto pelo usuário quanto pelo
  // limite de duração — daí a trava: se o tempo estourar no mesmo
  // instante em que alguém aperta parar, uma segunda chamada ficaria
  // esperando um evento de parada que já aconteceu, e o botão nunca
  // mais destravaria.
  const stopVideoAndUpload = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    clearTimeout(recordLimitRef.current);
    clearInterval(recordTickRef.current);

    setBusy(true);
    setError(null);
    setProgress(0);
    setUploadStatus('Enviando vídeo…');
    try {
      const blob = await cam.stopRecording();
      if (blob) {
        await uploadMedia(
          blob,
          `video_${Date.now()}.webm`,
          currentTags,
          nameInput.trim(),
          setProgress
        );
        flashStatus('Vídeo enviado');
        refreshAfterUpload();
      } else {
        setUploadStatus(null);
      }
    } catch (e) {
      console.error(e);
      setError('Falha ao enviar o vídeo: ' + e.message);
      setUploadStatus(null);
    } finally {
      stoppingRef.current = false;
      setBusy(false);
      setProgress(null);
      setRecordSeconds(0);
    }
  }, [cam, currentTags, nameInput, refreshAfterUpload, flashStatus]);

  const handleToggleVideo = useCallback(() => {
    if (cam.recording) {
      stopVideoAndUpload();
      return;
    }
    cam.startRecording();
    setRecordSeconds(0);
    clearInterval(recordTickRef.current);
    recordTickRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    clearTimeout(recordLimitRef.current);
    recordLimitRef.current = setTimeout(stopVideoAndUpload, MAX_VIDEO_MS);
  }, [cam, stopVideoAndUpload]);

  // Escolha de arquivos do dispositivo (fotos e vídeos): não envia direto,
  // abre o preview pra revisar a mídia e ajustar as hashtags de cada uma.
  const handleFilesSelected = useCallback((e) => {
    const escolhidos = Array.from(e.target.files || []).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    e.target.value = '';
    if (!escolhidos.length) return;

    // Barra o que passa do teto antes de o convidado esperar um envio
    // que o servidor recusaria de qualquer forma.
    const files = escolhidos.filter((f) => f.size <= MAX_FILE_BYTES);
    const grandes = escolhidos.filter((f) => f.size > MAX_FILE_BYTES);
    if (grandes.length) {
      const maior = Math.round(Math.max(...grandes.map((f) => f.size)) / 1048576);
      flashStatus(
        grandes.length === 1
          ? `"${grandes[0].name}" tem ${maior} MB e o limite é ${MAX_FILE_MB} MB.`
          : `${grandes.length} arquivos passam de ${MAX_FILE_MB} MB e ficaram de fora.`,
        5000
      );
    }
    if (!files.length) return;

    // O teto vale para a fila inteira, não para cada seleção: senão
    // bastaria escolher 10, depois mais 10, e o limite não existiria.
    const vagas = MAX_FILES_PER_REQUEST - pendingFiles.length;
    if (vagas <= 0) {
      flashStatus(
        `A fila já está cheia com ${MAX_FILES_PER_REQUEST}. Envie essas e depois escolha as próximas.`,
        5000
      );
      return;
    }

    // Escolha maior que o teto: em vez de recusar tudo, leva as
    // primeiras e explica o que ficou de fora.
    const aceitos = files.slice(0, vagas);
    if (files.length > aceitos.length) {
      flashStatus(
        `Dá para enviar ${MAX_FILES_PER_REQUEST} por vez — adicionei ${aceitos.length}. ` +
          `Envie essas e escolha o restante depois.`,
        5000
      );
    }

    setPendingFiles((prev) => [
      ...prev,
      ...aceitos.map((file) => ({
        id: `${file.name}_${file.size}_${file.lastModified}_${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        tagsInput,
        nameInput,
      })),
    ]);
  }, [tagsInput, nameInput, pendingFiles.length, flashStatus]);

  const handlePendingTagsChange = useCallback((id, value) => {
    setPendingFiles((prev) =>
      prev.map((it) => (it.id === id ? { ...it, tagsInput: value } : it))
    );
  }, []);

  const handlePendingNameChange = useCallback((id, value) => {
    setPendingFiles((prev) =>
      prev.map((it) => (it.id === id ? { ...it, nameInput: value } : it))
    );
  }, []);

  const handleRemovePending = useCallback((id) => {
    setPendingFiles((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((it) => it.id !== id);
    });
  }, []);

  const handleCancelPending = useCallback(() => {
    setPendingFiles((prev) => {
      prev.forEach((it) => URL.revokeObjectURL(it.previewUrl));
      return [];
    });
  }, []);

  // Envia os arquivos revisados no preview, como estão — sem recompressão —
  // para preservar a qualidade original.
  const handleConfirmPending = useCallback(async () => {
    setBusy(true);
    setError(null);
    const total = pendingFiles.length;
    let enviados = 0;

    try {
      // Fatiado em lotes porque o servidor recusa pedidos grandes — sem
      // isso, selecionar muitas fotos fazia o envio inteiro falhar sem
      // subir nada. Fatiar também adianta o início: o primeiro arquivo
      // começa a subir depois de uma chamada, não depois de N.
      //
      // As sessões de cada lote vêm numa única execução do Apps Script;
      // os bytes seguem um de cada vez, para a barra de progresso fazer
      // sentido.
      for (let inicio = 0; inicio < total; inicio += MAX_FILES_PER_REQUEST) {
        const lote = pendingFiles.slice(inicio, inicio + MAX_FILES_PER_REQUEST);

        setUploadStatus(`Preparando ${inicio + 1}–${inicio + lote.length} de ${total}…`);
        const sessions = await createUploadSessions(
          lote.map(({ file, tagsInput: itemTags, nameInput: itemName }) => ({
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            tags: parseHashtags(itemTags),
            author: itemName.trim(),
          }))
        );

        for (let i = 0; i < lote.length; i++) {
          const { file } = lote[i];
          const session = sessions[i];
          if (!session || session.error) {
            throw new Error(session?.error || `Não foi possível preparar ${file.name}`);
          }
          setUploadStatus(`Enviando ${enviados + 1}/${total} — ${file.name}`);
          setProgress(0);
          await uploadToSession(session.sessionUri, file, setProgress);
          setProgress(null);
          enviados++;
        }
      }

      flashStatus(total > 1 ? `${total} mídias enviadas` : 'Mídia enviada');
      refreshAfterUpload();
      handleCancelPending();
    } catch (e) {
      console.error(e);
      setUploadStatus(null);
      setError(
        enviados > 0
          ? `Enviadas ${enviados} de ${total}. O restante falhou: ${e.message}`
          : 'Falha no envio: ' + e.message
      );
      // Falha no meio do caminho não pode custar o que já subiu: tira da
      // lista o que foi enviado e deixa só o que falta, pronto para
      // tentar de novo.
      if (enviados > 0) {
        setPendingFiles((prev) => {
          prev.slice(0, enviados).forEach((it) => URL.revokeObjectURL(it.previewUrl));
          return prev.slice(enviados);
        });
        refreshAfterUpload();
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [pendingFiles, refreshAfterUpload, handleCancelPending, flashStatus]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark mono">◎</span>
          <span className="brand-name">Câmera · Galeria</span>
        </div>
        <div className="topbar-actions">
          {updatedAt && !loadingGallery && (
            <span className="mono topbar-time">
              {updatedAt.toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
          <button
            className="mono connect-btn"
            onClick={() => refresh()}
            disabled={loadingGallery}
          >
            {loadingGallery ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </header>

      <div className="name-input-wrap">
        <input
          className="name-input"
          placeholder="Seu nome (opcional)"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
        />
      </div>

      <CameraView
        videoRef={cam.videoRef}
        ready={cam.ready}
        error={cam.error}
        recording={cam.recording}
        recordSeconds={recordSeconds}
        maxSeconds={MAX_VIDEO_MS / 1000}
        // Só no fluxo da câmera: no envio pelo dispositivo, quem mostra
        // o andamento é o próprio modal de revisão.
        uploading={busy && pendingFiles.length === 0}
        progress={progress}
        statusLabel={uploadStatus}
        facingMode={cam.facingMode}
        torchOn={cam.torchOn}
        torchSupported={cam.torchSupported}
        onToggleTorch={cam.toggleTorch}
      />

      <div className="tag-input-wrap">
        <input
          className="tag-input"
          placeholder="hashtags separadas por espaço"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
        />
      </div>

      <CaptureControls
        onPhoto={handlePhoto}
        onToggleVideo={handleToggleVideo}
        onFlip={cam.flipCamera}
        recording={cam.recording}
        busy={busy}
      />

      <p className="capture-hint">
        <span aria-hidden="true">🎬</span> Grave um <strong>short</strong> de até{' '}
        {LIMITE_VIDEO} — a gravação para sozinha no tempo
      </p>

      <div className="upload-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={handleFilesSelected}
          className="upload-input"
        />
        <button
          className="upload-box"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          <span className="upload-box-icon" aria-hidden="true">⇪</span>
          <span className="upload-box-text">
            <span className="upload-box-title">Enviar do dispositivo</span>
            <span className="upload-box-sub mono">
              até {MAX_FILES_PER_REQUEST} por vez · {MAX_FILE_MB} MB cada
            </span>
          </span>
        </button>
      </div>

      {error && <p className="upload-status mono">{error}</p>}

      {/* Enquanto envia, quem informa é o indicador sobre o visor. Aqui
          fica só a confirmação que aparece depois, já com o visor
          liberado. */}
      {!busy && pendingFiles.length === 0 && uploadStatus && (
        <p className="upload-status mono">{uploadStatus}</p>
      )}

      <section className="gallery-section">
        <HashtagFilter tags={allTags} active={activeTag} onSelect={setActiveTag} />
        <Gallery
          items={visible}
          onOpen={setSelected}
          loading={loadingGallery}
          resetKey={activeTag ?? ''}
        />
      </section>

      <Lightbox item={selected} onClose={() => setSelected(null)} />

      <UploadPreviewModal
        items={pendingFiles}
        busy={busy}
        status={uploadStatus}
        progress={progress}
        onTagsChange={handlePendingTagsChange}
        onNameChange={handlePendingNameChange}
        onRemove={handleRemovePending}
        onCancel={handleCancelPending}
        onConfirm={handleConfirmPending}
      />
    </div>
  );
}
