// ============================================================
//  driveStorage.js · Conversa com o Web App do Apps Script
// ============================================================
//  Não há token nem OAuth do lado do navegador: o script roda com
//  a conta do dono da pasta.
//
//  O envio acontece em duas etapas:
//    1. o script abre as sessões de upload resumível e devolve as URLs;
//    2. o navegador manda os bytes direto para o Drive, nessas URLs.
//  A etapa 2 dispensa autenticação — a session URI já é a credencial
//  daquele upload. Por isso não há limite de tamanho e a barra de
//  progresso continua funcionando.
//
//  A etapa 1 é feita em lote de propósito: N arquivos custam uma
//  execução do Apps Script em vez de N, o que importa porque conta
//  comum só tem 90 min de execução por dia.
// ============================================================
import { WEB_APP_URL } from '../config.js';

function endpoint() {
  if (!WEB_APP_URL) {
    throw new Error(
      'VITE_WEB_APP_URL não configurada. Copie .env.example para .env.local e preencha.'
    );
  }
  return WEB_APP_URL;
}

// O Apps Script não responde ao preflight OPTIONS, então a requisição
// precisa continuar "simples": nada de header Content-Type. Sem ele o
// navegador manda text/plain, que é aceito, e o script lê o corpo com
// e.postData.contents.
async function post(payload) {
  const res = await fetch(endpoint(), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return unwrap(res);
}

async function get(params) {
  const res = await fetch(`${endpoint()}?${new URLSearchParams(params)}`);
  return unwrap(res);
}

async function unwrap(res) {
  if (!res.ok) throw new Error('O servidor respondeu ' + res.status);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Falha no servidor');
  return data;
}

// ---- LISTAR MÍDIAS DA PASTA --------------------------------
// Já vem com as URLs públicas prontas (thumbUrl / fullUrl / previewUrl).
//
// O servidor guarda a listagem em cache por 60 s. Passe fresh logo
// depois de um envio, para a mídia nova aparecer sem esperar o cache.
//
// Devolve { items, generatedAt }. O generatedAt é o instante em que o
// servidor montou a listagem — repetido entre chamadas, indica que a
// resposta veio do cache.
export async function listMedia({ fresh = false } = {}) {
  const params = { action: 'list' };
  if (fresh) params.fresh = '1';
  const { items, generatedAt } = await get(params);
  return { items, generatedAt };
}

// ---- ABRIR AS SESSÕES DE UPLOAD ----------------------------
// files: [{ filename, mimeType, tags, author }]
// Devolve um array na mesma ordem, cada item { sessionUri } ou
// { error } — uma falha isolada não invalida o lote inteiro.
// Quantos arquivos vão por pedido. O servidor recusa lotes grandes
// (protege o tempo de uma execução e o tamanho do POST), então quem
// envia muitas mídias precisa fatiar — ver handleConfirmPending.
export const MAX_FILES_PER_REQUEST = 10;

// Espelha o teto do servidor. Aqui serve para avisar antes de o
// convidado esperar o envio; quem manda é a validação de lá.
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export const MAX_FILE_MB = Math.round(MAX_FILE_BYTES / 1048576);

// A origem vai junto porque o servidor precisa repassá-la ao Google ao
// abrir a sessão: é o que faz a resposta do PUT trazer os cabeçalhos
// de CORS. Sem isso o arquivo é criado, mas o navegador descarta a
// resposta e o envio parece ter falhado.
export async function createUploadSessions(files) {
  const { sessions } = await post({
    action: 'createUploadSessions',
    origin: window.location.origin,
    files,
  });
  return sessions;
}

// ---- ENVIAR OS BYTES ---------------------------------------
//  A sessão do Drive é resumível: se a conexão cair no meio, o que já
//  subiu continua lá. Numa festa com Wi-Fi disputado isso é a
//  diferença entre reenviar um vídeo inteiro e reenviar o pedaço que
//  faltou.
//
//  Verificado contra o endpoint real: o preflight libera Content-Range
//  e a resposta 308 expõe o cabeçalho Range, que é como o navegador
//  descobre até onde o Google recebeu.
const MAX_UPLOAD_RETRIES = 4;
const RETRY_BASE_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "bytes=0-262143" -> 262144, o primeiro byte ainda não recebido.
function proximoOffset(range) {
  const m = /bytes=0-(\d+)/.exec(range || '');
  return m ? Number(m[1]) + 1 : 0;
}

function corpoJson(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return {};
  }
}

// XHR e não fetch: só ele expõe progresso de upload.
function enviarFatia(sessionUri, blob, inicio, total, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUri, true);
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    // Só na retomada: no envio do zero, o PUT simples basta.
    if (inicio > 0) {
      xhr.setRequestHeader('Content-Range', `bytes ${inicio}-${total - 1}/${total}`);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round(((inicio + e.loaded) / total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ concluido: true, corpo: corpoJson(xhr.responseText) });
      } else if (xhr.status === 308) {
        // Recebido em parte: o Google diz até onde chegou.
        resolve({ concluido: false, offset: proximoOffset(xhr.getResponseHeader('Range')) });
      } else {
        reject(new Error('Falha no envio (' + xhr.status + ')'));
      }
    };
    xhr.onerror = () => reject(new Error('Erro de rede durante o envio'));
    xhr.send(inicio > 0 ? blob.slice(inicio) : blob);
  });
}

// Pergunta ao Google quanto ele já tem, sem mandar bytes.
function consultarProgresso(sessionUri, total) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUri, true);
    xhr.setRequestHeader('Content-Range', `bytes */${total}`);
    xhr.onload = () => {
      if (xhr.status === 308) {
        resolve(proximoOffset(xhr.getResponseHeader('Range')));
      } else if (xhr.status >= 200 && xhr.status < 300) {
        resolve(total); // já tinha concluído
      } else {
        reject(new Error('Não foi possível verificar o envio (' + xhr.status + ')'));
      }
    };
    xhr.onerror = () => reject(new Error('Erro de rede ao verificar o envio'));
    xhr.send(new Blob([]));
  });
}

export async function uploadToSession(sessionUri, blob, onProgress) {
  const total = blob.size;
  let inicio = 0;
  let falhas = 0;

  for (;;) {
    try {
      const res = await enviarFatia(sessionUri, blob, inicio, total, onProgress);
      if (res.concluido) return res.corpo;

      // 308 sem erro: o Google aceitou parte e espera o resto. Só conta
      // como progresso se de fato avançou — senão isto viraria laço.
      if (res.offset > inicio) {
        inicio = res.offset;
        falhas = 0;
        continue;
      }
      falhas++;
    } catch (err) {
      falhas++;
      if (falhas > MAX_UPLOAD_RETRIES) throw err;
    }

    if (falhas > MAX_UPLOAD_RETRIES) {
      throw new Error('Não foi possível concluir o envio após várias tentativas');
    }

    await sleep(RETRY_BASE_MS * 2 ** (falhas - 1) + Math.random() * 500);

    // Antes de reenviar, descobre o ponto real de parada: mandar do
    // lugar errado faria o Google recusar o arquivo inteiro.
    try {
      const posicao = await consultarProgresso(sessionUri, total);
      if (posicao >= total) return {};
      inicio = posicao;
    } catch {
      // Nem a consulta passou: tenta de novo do mesmo ponto.
    }
  }
}

// ---- UPLOAD DE UMA MÍDIA SÓ (câmera) -----------------------
export async function uploadMedia(blob, filename, tags = [], author = '', onProgress) {
  const mimeType = blob.type || 'application/octet-stream';
  const [session] = await createUploadSessions([
    { filename, mimeType, size: blob.size, tags, author },
  ]);
  if (!session || session.error) {
    throw new Error(session?.error || 'Não foi possível preparar o envio');
  }
  return uploadToSession(session.sessionUri, blob, onProgress);
}

// Filtro por hashtag no client (mantém a UX dos chips).
export function filterByHashtag(items, tag) {
  if (!tag) return items;
  return items.filter((it) => it.hashtags.includes(tag));
}
