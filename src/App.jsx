import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCamera } from './hooks/useCamera.js';
import { useDriveAuth } from './hooks/useDriveAuth.js';
import {
  uploadImage,
  uploadVideo,
  listMedia,
  filterByHashtag,
  fileToObjectURL,
} from './services/driveStorage.js';
import CameraView from './components/CameraView.jsx';
import CaptureControls from './components/CaptureControls.jsx';
import HashtagFilter from './components/HashtagFilter.jsx';
import Gallery from './components/Gallery.jsx';
import Lightbox from './components/Lightbox.jsx';
import WelcomeModal from './components/WelcomeModal.jsx';
import UploadPreviewModal from './components/UploadPreviewModal.jsx';
import { parseHashtags } from './utils/hashtags.js';

export default function App() {
  const cam = useCamera();
  const { token, ready, authorizing, ensureToken } = useDriveAuth();

  const [nameInput, setNameInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [items, setItems] = useState([]);
  const [loadingGallery, setLoadingGallery] = useState(false);
  const [activeTag, setActiveTag] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const fileInputRef = useRef(null);

  // Hashtags digitadas no campo -> array limpo.
  const currentTags = useMemo(() => parseHashtags(tagsInput), [tagsInput]);

  // Recarrega a galeria a partir da pasta compartilhada do Drive.
  const refresh = useCallback(async (tk) => {
    const t = tk || token;
    if (!t) return;
    setLoadingGallery(true);
    try {
      setItems(await listMedia(t));
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingGallery(false);
    }
  }, [token]);

  // Assim que o app conseguir acesso à pasta (em segundo plano), carrega a galeria.
  useEffect(() => {
    if (token) refresh(token);
  }, [token, refresh]);

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
    try {
      const t = await ensureToken();
      if (!t) return;
      const blob = await cam.capturePhoto();
      if (blob) {
        await uploadImage(t, blob, `foto_${Date.now()}.jpg`, currentTags, nameInput.trim());
        await refresh(t);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [ensureToken, cam, currentTags, nameInput, refresh]);

  const handleToggleVideo = useCallback(async () => {
    if (!cam.recording) {
      cam.startRecording();
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const t = await ensureToken();
      const blob = await cam.stopRecording();
      if (t && blob) {
        await uploadVideo(t, blob, `video_${Date.now()}.webm`, currentTags, setProgress, nameInput.trim());
        await refresh(t);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [ensureToken, cam, currentTags, nameInput, refresh]);

  // Escolha de arquivos do dispositivo (fotos e vídeos): não envia direto,
  // abre o preview pra revisar a mídia e ajustar as hashtags de cada uma.
  const handleFilesSelected = useCallback((e) => {
    const files = Array.from(e.target.files || []).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    e.target.value = '';
    if (!files.length) return;

    setPendingFiles((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: `${file.name}_${file.size}_${file.lastModified}_${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        tagsInput,
        nameInput,
      })),
    ]);
  }, [tagsInput, nameInput]);

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
    try {
      const t = await ensureToken();
      if (!t) return;
      for (let i = 0; i < pendingFiles.length; i++) {
        const { file, tagsInput: itemTagsInput, nameInput: itemNameInput } = pendingFiles[i];
        const tags = parseHashtags(itemTagsInput);
        setUploadStatus(`Enviando ${i + 1}/${pendingFiles.length} — ${file.name}`);
        if (file.type.startsWith('video/')) {
          setProgress(0);
          await uploadVideo(t, file, file.name, tags, setProgress, itemNameInput.trim());
          setProgress(null);
        } else {
          await uploadImage(t, file, file.name, tags, itemNameInput.trim());
        }
      }
      await refresh(t);
      handleCancelPending();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
      setUploadStatus(null);
      setProgress(null);
    }
  }, [ensureToken, pendingFiles, refresh, handleCancelPending]);

  return (
    <div className="app">
      <WelcomeModal open={!token} ready={ready} authorizing={authorizing} onAuthorize={ensureToken} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark mono">◎</span>
          <span className="brand-name">Câmera · Galeria</span>
        </div>
        {token ? (
          <span className="mono connected">Pasta conectada</span>
        ) : ready ? (
          <button className="mono connect-btn" onClick={ensureToken} disabled={authorizing}>
            {authorizing ? 'Autorizando…' : 'Autorizar Google Drive'}
          </button>
        ) : (
          <span className="mono connected">Conectando…</span>
        )}
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
            <span className="upload-box-sub mono">fotos ou vídeos já salvos</span>
          </span>
        </button>
      </div>

      {pendingFiles.length === 0 && uploadStatus && (
        <p className="upload-status mono">{uploadStatus}</p>
      )}

      {pendingFiles.length === 0 && progress !== null && (
        <div className="progress">
          <div className="progress-bar" style={{ width: progress + '%' }} />
          <span className="mono">{progress}%</span>
        </div>
      )}

      <section className="gallery-section">
        <HashtagFilter tags={allTags} active={activeTag} onSelect={setActiveTag} />
        <Gallery
          items={visible}
          token={token}
          onOpen={setSelected}
          getUrl={fileToObjectURL}
          loading={loadingGallery}
        />
      </section>

      <Lightbox
        item={selected}
        token={token}
        getUrl={fileToObjectURL}
        onClose={() => setSelected(null)}
      />

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
