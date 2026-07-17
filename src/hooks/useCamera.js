import { useCallback, useEffect, useRef, useState } from 'react';

// Escolhe um mimeType de vídeo suportado (iOS x Android divergem).
function pickVideoMime() {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

// Gerencia a câmera ao vivo e a captura.
// Retorna refs e ações prontas p/ os componentes de UI.
export function useCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment'); // traseira por padrão
  const [recording, setRecording] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    stop();
    const base = { video: { facingMode }, audio: true };
    try {
      // Tenta com áudio (p/ gravar vídeo com som).
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(base);
      } catch (audioErr) {
        // Se o microfone estiver bloqueado, o pedido combinado falha calado.
        // Refaz só com vídeo p/ pelo menos a imagem funcionar.
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
      }
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {}); // Android Chrome exige play() explícito
      }
      // Flash/lanterna: só existe em algumas câmeras traseiras (Android Chrome).
      const track = stream.getVideoTracks()[0];
      setTorchSupported(Boolean(track?.getCapabilities?.().torch));
      setReady(true);
    } catch (err) {
      const map = {
        NotAllowedError: 'Permissão de câmera negada. Libere o acesso e recarregue.',
        NotFoundError: 'Nenhuma câmera encontrada neste dispositivo.',
        NotReadableError: 'A câmera já está em uso por outro app.',
        OverconstrainedError: 'A câmera pedida não está disponível.',
      };
      setError(map[err.name] || 'Não foi possível abrir a câmera: ' + err.message);
    }
  }, [facingMode, stop]);

  // (Re)inicia sempre que a câmera (frontal/traseira) muda.
  useEffect(() => {
    start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  const flipCamera = useCallback(() => {
    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'));
  }, []);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch (err) {
      console.error('Falha ao alternar o flash:', err);
    }
  }, [torchOn, torchSupported]);

  // Captura um frame atual como Blob (foto).
  const capturePhoto = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return null;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    return new Promise((resolve) =>
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92)
    );
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickVideoMime();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  }, []);

  // Para a gravação e resolve com o Blob do vídeo.
  const stopRecording = useCallback(() => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder) return resolve(null);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'video/webm',
        });
        setRecording(false);
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  return {
    videoRef,
    ready,
    error,
    facingMode,
    recording,
    torchOn,
    torchSupported,
    flipCamera,
    toggleTorch,
    capturePhoto,
    startRecording,
    stopRecording,
    restart: start,
  };
}
