// ============================================================
//  driveStorage.js  ·  Chamadas à Drive API v3 (framework-agnostic)
//  Todas as funções recebem o `token` (access token) como 1º argumento.
//  O token vem do hook useDriveAuth.
// ============================================================
import { FOLDER_ID, UPLOAD_URL, FILES_URL } from '../config.js';

const auth = (token) => ({ Authorization: 'Bearer ' + token });

// ---- UPLOAD DE FOTO (multipart) ----------------------------
// blob: vindo de canvas.toBlob(...). tags: array de hashtags.
// author: nome opcional digitado no campo de identificação.
export async function uploadImage(token, blob, filename, tags = [], author = '') {
  const metadata = {
    name: filename,
    mimeType: blob.type || 'image/jpeg',
    parents: [FOLDER_ID],
    appProperties: { hashtags: tags.join(' '), author }, // "banco" nativo do Drive
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', blob);

  const res = await fetch(
    `${UPLOAD_URL}?uploadType=multipart&fields=id,name,mimeType,appProperties`,
    { method: 'POST', headers: auth(token), body: form }
  );
  if (!res.ok) throw new Error('Falha no upload da foto: ' + res.status);
  return res.json();
}

// ---- UPLOAD DE VÍDEO (resumível, com progresso) ------------
// Recomendado p/ vídeo: aguenta rede instável e reporta progresso.
export async function uploadVideo(token, blob, filename, tags = [], onProgress, author = '') {
  const metadata = {
    name: filename,
    mimeType: blob.type || 'video/webm',
    parents: [FOLDER_ID],
    appProperties: { hashtags: tags.join(' '), author },
  };

  // 1) Abre a sessão resumível e captura a Location (session URI).
  const start = await fetch(`${UPLOAD_URL}?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      ...auth(token),
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': metadata.mimeType,
    },
    body: JSON.stringify(metadata),
  });
  if (!start.ok) throw new Error('Falha ao iniciar upload resumível: ' + start.status);
  const sessionUri = start.headers.get('Location');

  // 2) Envia o binário via XHR (fetch não expõe progresso de upload).
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUri, true);
    xhr.setRequestHeader('Content-Type', metadata.mimeType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve(JSON.parse(xhr.responseText))
        : reject(new Error('Falha no upload do vídeo: ' + xhr.status));
    xhr.onerror = () => reject(new Error('Erro de rede no upload do vídeo'));
    xhr.send(blob);
  });
}

// ---- LISTAR MÍDIAS DA PASTA --------------------------------
export async function listMedia(token) {
  const q = encodeURIComponent(`'${FOLDER_ID}' in parents and trashed=false`);
  const fields = encodeURIComponent(
    'files(id,name,mimeType,createdTime,appProperties,thumbnailLink)'
  );
  const res = await fetch(
    `${FILES_URL}?q=${q}&fields=${fields}&orderBy=createdTime desc&pageSize=1000`,
    { headers: auth(token) }
  );
  if (!res.ok) throw new Error('Falha ao listar: ' + res.status);
  const { files } = await res.json();
  return files.map((f) => ({
    ...f,
    kind: (f.mimeType || '').startsWith('video') ? 'video' : 'image',
    hashtags: (f.appProperties?.hashtags || '').split(' ').filter(Boolean),
    author: f.appProperties?.author || '',
  }));
}

// Filtro por hashtag no client (mantém a UX dos chips).
export function filterByHashtag(items, tag) {
  if (!tag) return items;
  return items.filter((it) => it.hashtags.includes(tag));
}

// ---- BAIXAR MÍDIA -> object URL ----------------------------
// Baixa autenticado e devolve blob: local. Assim o <video> faz seek
// normalmente, contornando a limitação de range requests do Drive.
// Baixa o arquivo inteiro: ótimo p/ fotos e vídeos curtos.
export async function fileToObjectURL(token, fileId) {
  const res = await fetch(`${FILES_URL}/${fileId}?alt=media`, {
    headers: auth(token),
  });
  if (!res.ok) throw new Error('Falha ao baixar arquivo: ' + res.status);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
