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
async function pedirMidia(constraints, tentativas = 3) {
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
  const chunksRef = useRef([]);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [facingMode, setFacingMode] = useState('user'); // frontal por padrão
  const [recording, setRecording] = useState(false);
  // Se a câmera veio com faixa de áudio. Fica visível no visor: sem
  // isso, gravar mudo só é descoberto ao rever o vídeo — e não dá para
  // distinguir "o microfone não veio" de "o gravador não usou".
  const [audioAtivo, setAudioAtivo] = useState(false);
  // 'bloqueado' | 'ausente' | 'ocupado' | '' — permite dizer o que
  // fazer, em vez de só informar que não há som.
  const [audioMotivo, setAudioMotivo] = useState('');

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // Parar as faixas não basta: enquanto o <video> mantiver a
    // referência ao stream, boa parte dos aparelhos ainda considera a
    // câmera ocupada, e a abertura seguinte falha com NotReadableError.
    // É o que quebrava a troca entre traseira e frontal.
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
    setAudioAtivo(false);
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
      // Vídeo e áudio na MESMA chamada, de propósito.
      //
      // Cheguei a separá-los para tentar destravar a lanterna, e o
      // efeito colateral foi grave: o Chrome no Android não grava o
      // áudio quando as faixas vêm de chamadas diferentes e são
      // combinadas num MediaStream novo. No desktop grava, o que
      // escondeu o problema — os vídeos do computador tinham som e os
      // do celular não. Com a lanterna removida, separar não traz mais
      // benefício nenhum.
      //
      // Se o microfone for negado, refaz só com vídeo: melhor gravar
      // sem som do que não gravar.
      let stream;
      let motivo = '';
      try {
        stream = await pedirMidia({ video: { facingMode }, audio: true });
      } catch (semMicrofone) {
        // Guarda o porquê: uma negativa de permissão fica gravada no
        // navegador e se repete em toda abertura seguinte, então o
        // usuário precisa saber que a correção está nas permissões do
        // site — não em tentar de novo.
        motivo =
          {
            NotAllowedError: 'bloqueado',
            NotFoundError: 'ausente',
            NotReadableError: 'ocupado',
          }[semMicrofone?.name] || 'ausente';
        stream = await pedirMidia({ video: { facingMode } });
      }
      setAudioMotivo(motivo);

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
      setAudioAtivo(stream.getAudioTracks().length > 0);

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

    // Grava o stream da câmera como ele é. Ele já traz a faixa de áudio
    // quando o microfone foi concedido — e é justamente por vir da
    // mesma chamada que o Android a inclui na gravação.
    const semAudio = stream.getAudioTracks().length
      ? ''
      : 'Sem microfone disponível: o vídeo será gravado sem som.';

    const mimeType = pickVideoMime();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
    return { semAudio };
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
    audioAtivo,
    audioMotivo,
    flipCamera,
    capturePhoto,
    startRecording,
    stopRecording,
    restart: start,
  };
}
