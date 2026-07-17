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
//  1. Google Cloud Console → ative a "Google Drive API".
//  2. Crie um OAuth Client ID do tipo "Aplicativo da Web".
//     Em "Origens JavaScript autorizadas" adicione:
//       http://localhost:5173   (dev)
//       e a URL de produção quando publicar.
//  3. FOLDER_ID: abra a pasta no Drive e copie o trecho da URL
//     depois de /folders/. Compartilhe essa pasta com a conta
//     que vai autorizar o acesso do app.
// ============================================================

export const CLIENT_ID = '233099617111-3alsdktu68ijchhed6l1ip8g1cklp6kt.apps.googleusercontent.com';
export const FOLDER_ID = '1eaA65KiCXQTkmLqpTZfzTgteSIJKvTw6';

// drive.file = acesso só aos arquivos que este app criou (menos invasivo).
export const SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
export const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
