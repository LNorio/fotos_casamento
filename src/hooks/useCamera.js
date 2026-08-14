import { useCallback, useEffect, useRef, useState } from 'react';

// Escolhe um mimeType de vídeo suportado (iOS x Android divergem).
//
// Cada candidato declara o codec de áudio junto. Informar só o de vídeo
// — 'video/webm;codecs=vp9', como estava — faz várias implementações
// gravarem sem som: o mimeType descreve o conteúdo do arquivo, e um
// conteúdo sem trilha de áudio declarada leva o gravador a descartar a
// faixa. Era o motivo de os vídeos saírem mudos.
function pickVideoMime() {
  // mp4/h264 primeiro, por compatibilidade: é o formato que o Drive usa
  // como destino, então tende a exigir menos processamento antes de o
  // vídeo ficar reproduzível na galeria — e é o único que o iOS grava.
  // webm fica como alternativa para quem não suporta mp4.
  const candidates = [
    'video/mp4;codecs=h264,aac',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/mp4',
    'video/webm',
  ];
  return candidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

// Mesmo com o stream anterior encerrado, o aparelho leva um instante
// para liberar a câmera de fato — e nesse intervalo a abertura da outra
// lente falha com NotReadableError. Insistir algumas vezes, com espera
// crescente, resolve sem que o usuário veja erro nenhum.
async function pedirCamera(constraints, tentativas = 3) {
  for (let i = 0; ; i++) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (err.name !== 'NotReadableError' || i + 1 >= tentativas) throw err;
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
}

// Não há controle de lanterna aqui de propósito. O S22 Ultra com Chrome
// não expõe 'torch' em getCapabilities() para a lente que
// facingMode: 'environment' seleciona, e applyConstraits dentro de
// 'advanced' é aplicado em regime de melhor esforço: resolve sem erro e
// não acende nada. No iOS a API nem existe. Um botão que só funciona em
// parte dos aparelhos, e que mente nos demais, vale menos que a
// ausência dele.

// Gerencia a câmera ao vivo e a captura.
// Retorna refs e ações prontas p/ os componentes de UI.
export function useCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const audioStreamRef = useRef(null);
  const chunksRef = useRef([]);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [facingMode, setFacingMode] = useState('user'); // frontal por padrão
  const [recording, setRecording] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // Cobre o desmonte no meio de uma gravação; no fim normal quem
    // solta o microfone é o onstop do gravador.
    audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioStreamRef.current = null;
    // Parar as faixas não basta: enquanto o <video> mantiver a
    // referência ao stream, boa parte dos aparelhos ainda considera a
    // câmera ocupada, e a abertura seguinte falha com NotReadableError.
    // É o que quebrava a troca entre traseira e frontal.
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
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

    try {
      // Só vídeo. Pedir vídeo e áudio na mesma chamada faz o Chrome no
      // Android escolher um pipeline de câmera que recusa a lanterna —
      // o botão de flash aparecia e o applyConstraints era negado. O
      // microfone passa a ser pedido em startRecording, o que também
      // evita cobrar permissão de quem só quer tirar foto.
      const stream = await pedirCamera({ video: { facingMode } });

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
      const track = stream.getVideoTracks()[0];
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

  const startRecording = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream) return;

    // Microfone só agora, e num fluxo próprio. Se for negado, grava sem
    // som em vez de não gravar.
    let audioStream = null;
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.warn('Gravando sem áudio:', err?.name);
    }
    audioStreamRef.current = audioStream;

    const combinado = new MediaStream([
      ...stream.getVideoTracks(),
      ...(audioStream ? audioStream.getAudioTracks() : []),
    ]);

    const mimeType = pickVideoMime();
    const recorder = new MediaRecorder(combinado, mimeType ? { mimeType } : undefined);
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
        // Solta o microfone junto: manter a faixa viva deixa o
        // indicador de gravação aceso no sistema depois do fim.
        audioStreamRef.current?.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;

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
    flipCamera,
    capturePhoto,
    startRecording,
    stopRecording,
    restart: start,
  };
}
