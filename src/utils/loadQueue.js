// ============================================================
//  loadQueue.js · Controla o ritmo de carregamento das mídias
// ============================================================
//  O Google limita por IP o acesso direto a arquivos do Drive. Uma
//  galeria que dispara dezenas de <img> ao mesmo tempo toma 429 e
//  quase nada carrega. Num casamento o efeito é pior: todos os
//  convidados saem pelo mesmo IP do Wi-Fi do salão.
//
//  Medido contra drive.google.com/thumbnail, de um único IP:
//    ·  50 requisições simultâneas → 50x HTTP 200 em 1,4 s
//    · 150 requisições simultâneas → 150x HTTP 200 em 1,0 s (144 img/s)
//
//  Ou seja, esse endpoint aguenta bem mais do que a galeria precisa.
//  Os 429 que apareceram antes vinham do lh3.googleusercontent.com
//  (o thumbnailLink da API e a rota /d/{id}), que é limitado de forma
//  bem mais agressiva — e do qual já saímos.
//
//  A fila fica, mas folgada: serve para evitar rajada patológica com
//  centenas de mídias, não para contornar um limite que não existe
//  neste endpoint. O teto abaixo dá ~50 img/s por dispositivo, um
//  terço do que foi medido como suportado.
// ============================================================

const MAX_CONCURRENT = 6;
const MIN_INTERVAL_MS = 120;

// Ritmo adaptativo: qualquer número fixo aqui é um chute sobre um
// limite que o Google não documenta e que varia com a conta, o IP e o
// horário. Em vez de adivinhar, a fila desacelera quando leva 429 e
// volta a acelerar sozinha quando para de levar.
const MAX_INTERVAL_MS = 2000;
const DECAY_MS = 20000;

let intervalo = MIN_INTERVAL_MS;
let decaimento = null;

function agendarDecaimento() {
  clearTimeout(decaimento);
  decaimento = setTimeout(() => {
    intervalo = Math.max(MIN_INTERVAL_MS, Math.round(intervalo / 2));
    if (intervalo > MIN_INTERVAL_MS) agendarDecaimento();
  }, DECAY_MS);
}

// O evento de erro de um <img> não diz o motivo — e não dá para trocar
// por fetch, porque o endpoint de miniatura responde 302 sem cabeçalho
// de CORS e o navegador barraria a requisição no redirecionamento.
//
// Daí a inferência: falhas isoladas são normais (miniatura ainda sendo
// gerada, arquivo quebrado), mas várias em sequência, em imagens
// diferentes, são limite de taxa. Nesse caso a fila desacelera.
const FALHAS_PARA_DESACELERAR = 3;
const JANELA_FALHAS_MS = 5000;

let falhasRecentes = [];

export function reportarFalha() {
  const agora = Date.now();
  falhasRecentes = falhasRecentes.filter((t) => agora - t < JANELA_FALHAS_MS);
  falhasRecentes.push(agora);
  if (falhasRecentes.length < FALHAS_PARA_DESACELERAR) return;

  falhasRecentes = [];
  intervalo = Math.min(intervalo * 2, MAX_INTERVAL_MS);
  agendarDecaimento();
}

// Trava de segurança: se um <img> nunca disparar load nem error
// (aba em segundo plano, conexão pendurada), o slot volta sozinho
// em vez de travar a fila inteira.
const SLOT_TIMEOUT_MS = 20000;

let active = 0;
let lastStart = 0;
let pending = null;
const waiting = [];

function pump() {
  if (pending || !waiting.length || active >= MAX_CONCURRENT) return;

  const wait = lastStart + intervalo - Date.now();
  if (wait > 0) {
    pending = setTimeout(() => {
      pending = null;
      pump();
    }, wait);
    return;
  }

  lastStart = Date.now();
  active++;
  waiting.shift()();

  // Tenta o próximo: vai cair no agendamento acima por causa do
  // intervalo mínimo, mantendo o ritmo constante.
  pump();
}

// Resolve quando for a vez desta mídia, devolvendo a função que
// libera o slot. Chame-a quando ela terminar de carregar — ou falhar.
//
// priority: fura a fila do grid. Usado pela foto aberta em tela
// cheia, que o usuário está esperando ver agora — sem isso ela
// entraria atrás de todas as miniaturas ainda pendentes.
export function acquireSlot({ priority = false } = {}) {
  return new Promise((resolve) => {
    const task = () => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        clearTimeout(timer);
        active--;
        pump();
      };
      const timer = setTimeout(release, SLOT_TIMEOUT_MS);
      resolve(release);
    };

    if (priority) waiting.unshift(task);
    else waiting.push(task);
    pump();
  });
}
