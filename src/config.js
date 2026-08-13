// ============================================================
//  Configuração do app
// ============================================================
//  Só existe um valor a configurar: a URL do Web App do Apps
//  Script, que concentra o acesso ao Drive. Não há CLIENT_ID,
//  escopo OAuth nem ID de pasta aqui — tudo isso vive dentro do
//  script, fora do bundle que o navegador baixa.
//
//  Defina VITE_WEB_APP_URL em ".env.local" (veja .env.example).
//  A URL não é secreta: ela vai compilada no JS e qualquer
//  visitante consegue lê-la. Quem protege a pasta é a validação
//  do lado do servidor, não o sigilo da URL.
// ============================================================

export const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL || '';
