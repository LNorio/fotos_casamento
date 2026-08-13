// ============================================================
//  Codigo.gs · Backend do "Câmera · Galeria"
//  Publicado como Web App do Google Apps Script.
// ============================================================
//  O script roda com a conta do DONO ("Executar como: eu"), então
//  quem usa o app não precisa entrar em nenhuma conta Google.
//
//  Ele nunca recebe os bytes das mídias: para cada envio abre uma
//  sessão de upload resumível no Drive e devolve só a URL dessa
//  sessão. O navegador manda o arquivo direto para o Drive, o que
//  remove o teto de tamanho, preserva a barra de progresso e não
//  consome cota de execução proporcional ao tamanho do arquivo.
//
//  Conta comum tem 90 min/dia de execução. Duas decisões de projeto
//  existem só para caber nisso com centenas de convidados:
//    · a listagem fica em cache por 60 s (LIST_CACHE_TTL_S);
//    · as sessões de upload são abertas em lote e em paralelo.
// ============================================================

// ID da pasta do Drive onde tudo é salvo (o trecho da URL depois
// de /folders/). Rode configurarPasta() uma vez após preencher.
const FOLDER_ID = 'COLE_AQUI_O_ID_DA_PASTA';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

// Largura da miniatura da galeria e da foto aberta em tela cheia.
const THUMB_SIZE = 640;
const FULL_SIZE = 2048;

const LIST_FIELDS =
  'nextPageToken,files(id,name,mimeType,createdTime,appProperties)';

// Cache da listagem. 60 s é curto o bastante para a galeria parecer
// viva e longo o bastante para absorver o pico de releituras.
const LIST_CACHE_KEY = 'lista_v1';
const LIST_CACHE_TTL_S = 60;

// O CacheService aceita no máximo 100 KB por chave. Guardamos o JSON
// comprimido, o que cobre alguns milhares de mídias; acima disso o
// cache é ignorado e a listagem segue direto ao Drive, só mais lenta.
const CACHE_MAX_CHARS = 95000;

// Teto de arquivos por lote de sessões. Segura o tempo de uma única
// execução e o tamanho do POST.
const MAX_BATCH = 25;

// Teto por arquivo. O endpoint é público — está na URL do bundle —,
// então sem isto qualquer pessoa poderia encher o Drive.
//
// A checagem aqui barra o acidente e o abuso casual; quem forjar um
// tamanho menor não passa mesmo assim, porque o valor declarado vai
// para o Google em X-Upload-Content-Length e é ele quem recusa o
// upload que não bater com o combinado.
const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200 MB

// ============================================================
//  Execute UMA VEZ pelo editor, depois de preencher FOLDER_ID.
//  Libera a pasta para leitura por link: é isso que faz as
//  miniaturas carregarem direto do CDN do Google, sem passar
//  por aqui. Os arquivos enviados depois herdam a permissão.
// ============================================================
function configurarPasta() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  Logger.log('Pasta "%s" liberada para leitura por link.', folder.getName());
}

// ============================================================
//  Roteamento HTTP
// ============================================================
//  doGet/doPost nunca podem lançar: uma exceção faz o Apps Script
//  responder uma página HTML de erro, que no navegador chega como
//  falha opaca. Por isso todo erro vira { ok: false, error }.

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || 'list';

    if (action === 'list') {
      // fresh=1 ignora o cache. O app usa isso logo depois de um
      // envio, para a mídia recém-criada aparecer na hora em vez de
      // esperar o cache vencer.
      return jsonText_(listPayload_(params.fresh === '1'));
    }

    return json_({ ok: false, error: 'Ação desconhecida: ' + action });
  } catch (err) {
    return json_({ ok: false, error: errorMessage_(err) });
  }
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    const body = JSON.parse(raw);

    // Caminho principal: abre N sessões numa execução só.
    if (body.action === 'createUploadSessions') {
      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length) return json_({ ok: false, error: 'Nenhum arquivo informado.' });
      if (files.length > MAX_BATCH) {
        return json_({ ok: false, error: 'No máximo ' + MAX_BATCH + ' arquivos por vez.' });
      }
      return json_({ ok: true, sessions: createUploadSessions_(files, body.origin) });
    }

    // Mantido para não quebrar uma aba antiga que ainda esteja aberta
    // com a versão anterior do app carregada.
    if (body.action === 'createUploadSession') {
      const result = createUploadSessions_([body], body.origin)[0];
      if (result.error) return json_({ ok: false, error: result.error });
      return json_({ ok: true, sessionUri: result.sessionUri });
    }

    return json_({ ok: false, error: 'Ação desconhecida: ' + body.action });
  } catch (err) {
    return json_({ ok: false, error: errorMessage_(err) });
  }
}

// ============================================================
//  Listagem da galeria (com cache)
// ============================================================
//  Devolve o JSON já serializado: quando vem do cache, nem chega a
//  virar objeto de novo.
function listPayload_(skipCache) {
  const cache = CacheService.getScriptCache();

  if (!skipCache) {
    const hit = readCache_(cache);
    if (hit) return hit;
  }

  // generatedAt carimba QUANDO esta listagem foi montada, e vai junto
  // para o cache. Duas respostas com o mesmo carimbo vieram do cache;
  // carimbo novo significa que a execução foi até o Drive. É o que
  // torna o cache verificável de fora, sem abrir o painel de execuções
  // — e é o que o app usa para mostrar a hora da última atualização.
  const payload = JSON.stringify({
    ok: true,
    generatedAt: new Date().toISOString(),
    items: listMedia_(),
  });
  writeCache_(cache, payload);
  return payload;
}

function readCache_(cache) {
  const stored = cache.get(LIST_CACHE_KEY);
  if (!stored) return null;
  try {
    const gz = Utilities.newBlob(
      Utilities.base64Decode(stored),
      'application/x-gzip',
      'lista.gz'
    );
    return Utilities.ungzip(gz).getDataAsString();
  } catch (err) {
    return null; // cache ilegível: simplesmente recalcula
  }
}

// O cache é otimização, nunca requisito: qualquer falha aqui precisa
// ser silenciosa, senão derruba a listagem inteira.
function writeCache_(cache, text) {
  try {
    const gz = Utilities.gzip(Utilities.newBlob(text, 'application/json', 'lista.json'));
    const encoded = Utilities.base64Encode(gz.getBytes());
    if (encoded.length > CACHE_MAX_CHARS) return;
    cache.put(LIST_CACHE_KEY, encoded, LIST_CACHE_TTL_S);
  } catch (err) {
    Logger.log('Cache da listagem ignorado: %s', errorMessage_(err));
  }
}

function listMedia_() {
  const q = "'" + FOLDER_ID + "' in parents and trashed = false";
  const items = [];
  let pageToken = '';

  do {
    const url =
      DRIVE_FILES +
      '?q=' + encodeURIComponent(q) +
      '&fields=' + encodeURIComponent(LIST_FIELDS) +
      '&orderBy=' + encodeURIComponent('createdTime desc') +
      '&pageSize=1000' +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');

    const data = driveFetch_(url, { method: 'get' });
    (data.files || []).forEach(function (f) {
      items.push(toItem_(f));
    });
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return items;
}

// Converte o arquivo cru do Drive no formato que o front consome.
// As URLs devolvidas são públicas: o navegador busca a mídia direto
// do Google, sem token e sem passar por este script.
function toItem_(f) {
  const isVideo = String(f.mimeType || '').indexOf('video') === 0;
  const props = f.appProperties || {};

  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    createdTime: f.createdTime,
    kind: isVideo ? 'video' : 'image',
    hashtags: String(props.hashtags || '').split(' ').filter(Boolean),
    author: props.author || '',
    // Miniatura do grid e foto em tela cheia.
    //
    // Usamos /thumbnail em vez do thumbnailLink devolvido pela API:
    // aquele expira em algumas horas e some da listagem enquanto o
    // Drive ainda está gerando a miniatura de um arquivo recém-enviado.
    // Este é estável, é gerado sob demanda e aceita a largura desejada.
    // Ser estável também é o que permite a releitura periódica da
    // galeria sem rebaixar as imagens que já estão no cache.
    thumbUrl: thumbUrl_(f.id, THUMB_SIZE),
    fullUrl: isVideo ? null : thumbUrl_(f.id, FULL_SIZE),
    // Vídeo: o player do próprio Drive, que faz streaming e seek
    // corretamente em qualquer tamanho de arquivo.
    previewUrl: isVideo ? 'https://drive.google.com/file/d/' + f.id + '/preview' : null,
  };
}

// Ponto de entrada estável do Drive para miniaturas. Ele responde 302
// para https://lh3.googleusercontent.com/d/<id>=w<largura>, que é quem
// serve a imagem de fato.
//
// Apontar direto para o destino eliminaria esse salto — metade das
// requisições por miniatura e ~45% menos latência, medido. Fica
// registrado como otimização possível, mas o custo é depender da rota
// final em vez do ponto de entrada: se o Google mudar a
// infraestrutura, o /thumbnail acompanha e a URL fixa não.
function thumbUrl_(id, width) {
  return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w' + width;
}

// ============================================================
//  Abertura das sessões de upload resumível
// ============================================================
//  Devolve apenas as session URIs. Cada uma já carrega o destino e os
//  metadados fixados aqui, e vale para um único arquivo — por isso
//  pode ir para o navegador sem expor credencial nenhuma.
//
//  fetchAll abre todas em paralelo: 10 arquivos custam ~1 execução de
//  2 s em vez de 10 execuções de 1,5 s. É o que mantém o custo de
//  escrita dentro da cota quando muita gente envia em lote.
//
//  O cabeçalho Origin não é decoração: o Google só devolve
//  Access-Control-Allow-Origin nas respostas do PUT quando a sessão
//  foi iniciada com uma origem associada. Sem ele o upload até
//  funciona — o arquivo é criado —, mas o navegador descarta a
//  resposta e o app enxerga um erro de rede em algo que deu certo.
function createUploadSessions_(files, rawOrigin) {
  const token = ScriptApp.getOAuthToken();
  const origin = sanitizeOrigin_(rawOrigin);

  // Arquivo recusado na validação nem chega a virar requisição, mas
  // guarda o lugar dele: o cliente casa as respostas pela posição.
  const resultados = new Array(files.length);
  const requests = [];
  const posicoes = [];

  files.forEach(function (f, i) {
    const recusa = validarArquivo_(f);
    if (recusa) {
      resultados[i] = { error: recusa };
      return;
    }
    requests.push(montarSessao_(f, token, origin));
    posicoes.push(i);
  });

  if (requests.length) {
    // Uma falha isolada vira erro só daquele arquivo: o resto do lote
    // continua válido.
    UrlFetchApp.fetchAll(requests).forEach(function (res, k) {
      const code = res.getResponseCode();
      if (code >= 300) {
        resultados[posicoes[k]] = {
          error: 'O Drive recusou a sessão de upload (' + code + ').',
        };
        return;
      }
      const location = headerValue_(res.getAllHeaders(), 'location');
      resultados[posicoes[k]] = location
        ? { sessionUri: location }
        : { error: 'O Drive não devolveu a URL da sessão de upload.' };
    });
  }

  return resultados;
}

// O cliente não é confiável: o filtro de tipo do app roda no navegador,
// que é justamente a parte que um abuso não usaria.
function validarArquivo_(f) {
  const mimeType = String(f.mimeType || '');
  if (!/^(image|video)\//.test(mimeType)) {
    return 'Só é possível enviar fotos e vídeos.';
  }

  const size = Number(f.size);
  if (!isFinite(size) || size <= 0) {
    return 'Tamanho do arquivo não informado. Recarregue a página e tente de novo.';
  }
  if (size > MAX_FILE_BYTES) {
    return (
      'Arquivo de ' + Math.round(size / 1048576) + ' MB: o limite é ' +
      Math.round(MAX_FILE_BYTES / 1048576) + ' MB.'
    );
  }
  return null;
}

function montarSessao_(f, token, origin) {
  const mimeType = String(f.mimeType);
  const headers = {
    Authorization: 'Bearer ' + token,
    'X-Upload-Content-Type': mimeType,
    // Declara o tamanho combinado: é o Google quem passa a recusar um
    // envio que não bata com ele.
    'X-Upload-Content-Length': String(Number(f.size)),
  };
  if (origin) headers.Origin = origin;

  return {
    url: DRIVE_UPLOAD + '?uploadType=resumable&fields=id',
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: headers,
    payload: JSON.stringify({
      name: sanitizeName_(f.filename),
      mimeType: mimeType,
      parents: [FOLDER_ID],
      appProperties: {
        hashtags: normalizeTags_(f.tags).join(' '),
        author: String(f.author || '').trim().slice(0, 120),
      },
    }),
    muteHttpExceptions: true,
  };
}

// ============================================================
//  Utilidades
// ============================================================
function driveFetch_(url, options) {
  const opts = options || {};
  opts.muteHttpExceptions = true;
  opts.headers = opts.headers || {};
  opts.headers.Authorization = 'Bearer ' + ScriptApp.getOAuthToken();

  const res = UrlFetchApp.fetch(url, opts);
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code >= 300) throw new Error('O Drive respondeu ' + code + ': ' + text);
  return text ? JSON.parse(text) : {};
}

// Os headers do UrlFetchApp não têm capitalização garantida e podem
// vir como array quando repetidos.
function headerValue_(headers, name) {
  const target = name.toLowerCase();
  for (const key in headers) {
    if (key.toLowerCase() === target) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return null;
}

// A origem vem do cliente e vira cabeçalho HTTP: só passa se tiver a
// forma de uma origem web, para não permitir injeção de cabeçalho.
function sanitizeOrigin_(raw) {
  const origin = String(raw || '').trim();
  return /^https?:\/\/[A-Za-z0-9._~:\-\[\]]+$/.test(origin) ? origin : '';
}

// O nome vem do cliente: tira separador de caminho e quebra de linha.
function sanitizeName_(raw) {
  const name = String(raw || '').replace(/[\/\\\r\n]/g, '_').trim();
  return name ? name.slice(0, 150) : 'midia_' + Date.now();
}

// Espelha parseHashtags() do front, mas aqui vale como validação:
// o cliente não é confiável.
function normalizeTags_(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(/[\s,]+/);
  const seen = {};
  const out = [];

  list.forEach(function (raw) {
    const tag = String(raw).replace(/^#/, '').trim().toLowerCase();
    if (tag && !seen[tag]) {
      seen[tag] = true;
      out.push(tag);
    }
  });

  return out.slice(0, 30);
}

function errorMessage_(err) {
  return String((err && err.message) || err);
}

function jsonText_(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

function json_(obj) {
  return jsonText_(JSON.stringify(obj));
}
