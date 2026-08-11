// ============================================================
//  Configuração da integração com o Google Drive
// ============================================================
//  Não há login individual de usuário: o CLIENT_ID abaixo apenas
//  libera, em segundo plano, o acesso à pasta compartilhada do
//  Drive (FOLDER_ID) onde tudo é salvo. Quem usa a câmera não
//  precisa entrar em nenhuma conta — só identifica-se, se quiser,
//  pelo campo de nome acima da câmera.
//
//  Como preencher:
//  1. Copie este arquivo para "config.js" (ignorado pelo git).
//  2. Google Cloud Console → ative a "Google Drive API".
//  3. Crie um OAuth Client ID do tipo "Aplicativo da Web".
//     Em "Origens JavaScript autorizadas" adicione:
//       http://localhost:5173   (dev)
//       e a URL de produção quando publicar.
//  4. FOLDER_ID: abra a pasta no Drive e copie o trecho da URL
//     depois de /folders/. Compartilhe essa pasta com a conta
//     que vai autorizar o acesso do app.
// ============================================================

export const CLIENT_ID = 'SEU_CLIENT_ID.apps.googleusercontent.com';
export const FOLDER_ID = 'ID_DA_PASTA_NO_DRIVE';

// drive.file = acesso só aos arquivos que este app criou (menos invasivo).
export const SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
export const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
