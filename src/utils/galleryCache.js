// ============================================================
//  galleryCache.js · Guarda a última listagem no localStorage
// ============================================================
//  Duas razões, uma de UX e uma de cota:
//
//  · UX — ao abrir o app a galeria aparece na hora, com as imagens
//    vindo do cache HTTP do navegador, em vez de uma tela de
//    "Carregando galeria…" esperando o Apps Script responder.
//
//  · Cota — toda chamada à listagem é uma execução do Apps Script, e
//    conta comum tem 90 min/dia. Guardando o resultado entre
//    aberturas, abrir o app cinco vezes seguidas deixa de custar
//    cinco execuções.
//
//  O cache é sempre opcional: em modo privado, com o armazenamento
//  cheio ou com o conteúdo corrompido, tudo cai no caminho normal.
// ============================================================

const KEY = 'galeria_v1';

// Devolve { items, generatedAt, fetchedAt } ou null.
export function readGalleryCache() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.items) || !data.fetchedAt) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeGalleryCache(items, generatedAt) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ items, generatedAt, fetchedAt: Date.now() })
    );
  } catch {
    // Acervo grande demais para o localStorage, ou modo privado.
    // Seguir sem cache é correto — só custa uma execução a mais.
  }
}
