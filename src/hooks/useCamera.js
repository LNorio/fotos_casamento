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

  // Ordem da última abertura pedida. Duas chamadas concorrentes a
  // getUserMedia deixam um stream órfão ligado e podem falhar com
  // NotReadableError; o token faz a mais recente vencer e a anterior
  // devolver a câmera em vez de brigar por ela.
  const startTokenRef = useRef(0);

  const start = useCallback(async () => {
    const token = ++startTokenRef.current;
    setError(null);
    stop();

    // navigator.mediaDevices só existe em contexto seguro: HTTPS ou
    // localhost. Aberto por http://<ip> na rede local ele vem
    // undefined, e sem esta checagem o erro que aparece é
    // "Cannot read properties of undefined", que não ajuda ninguém.
    if (!navigator.mediaDevices?.getUserMedia) {
      const inseguro =
        window.location.protocol !== 'https:' &&
        !['localhost', '127.0.0.1'].includes(window.location.hostname);
      setError(
        inseguro
          ? 'A câmera exige HTTPS. Neste endereço (http://) o navegador bloqueia o acesso — use o site publicado ou rode com HTTPS.'
          : 'Este navegador não oferece acesso à câmera.'
      );
      return;
    }

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

      // Outra abertura começou enquanto esta esperava: descarta a
      // resposta e libera a câmera, senão fica um stream sem dono.
      if (token !== startTokenRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
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
      // O sistema pode encerrar a faixa por conta própria (outro app
      // tomou a câmera, tela bloqueada por muito tempo). Marcar como
      // não pronta faz o visor voltar ao estado de carregamento em vez
      // de exibir para sempre o último quadro congelado.
      if (track) track.onended = () => setReady(false);
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

  // Recuperação ao voltar do segundo plano.
  //
  // No celular, sair do navegador ou bloquear a tela suspende — e com
  // frequência encerra — as faixas de vídeo. Ao retornar, o <video>
  // continua exibindo o último quadro e a câmera parece travada, sem
  // nenhum erro no console.
  //
  // Faixa encerrada exige reabrir a câmera; faixa viva mas pausada só
  // precisa de um play(), que o iOS costuma exigir explicitamente.
  const recordingRef = useRef(false);
  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState !== 'visible') return;
      // Reabrir a câmera no meio de uma gravação a perderia.
      if (recordingRef.current) return;

      // Sem stream ainda: ou a primeira abertura está em curso, ou ela
      // falhou e já há mensagem na tela. Em nenhum dos dois casos cabe
      // abrir outra aqui — e isto importa porque pageshow dispara
      // também no carregamento inicial, junto com a abertura normal.
      const stream = streamRef.current;
      if (!stream) return;

      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState !== 'live') {
        start();
        return;
      }
      videoRef.current?.play().catch(() => {});
    };

    document.addEventListener('visibilitychange', aoVoltar);
    // pageshow cobre o retorno pelo cache de navegação (bfcache), em
    // que visibilitychange pode não disparar.
    window.addEventListener('pageshow', aoVoltar);
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('pageshow', aoVoltar);
    };
  }, [start]);

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
