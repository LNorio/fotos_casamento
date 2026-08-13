# Câmera · Galeria

Aplicação em React + Vite para capturar fotos e vídeos com a câmera do dispositivo, organizar mídias por hashtags e salvar tudo em uma pasta do Google Drive.

Quem usa o app **não faz login em nada**: um Web App do Google Apps Script, publicado na conta dona da pasta, é quem conversa com o Drive.

## Arquitetura

```
┌──────────────────┐         ┌───────────────────────┐
│  GitHub Pages    │ fetch   │  Apps Script Web App  │
│  cliente (React) │────────▶│  apps-script/Codigo.gs│
└────────┬─────────┘         └───────────┬───────────┘
         │                               │ OAuth do dono
         │  miniaturas e mídia           ▼
         │  direto do CDN         ┌──────────────┐
         └───────────────────────▶│ Google Drive │
                                  └──────────────┘
```

Três serviços gratuitos, nenhum servidor próprio:

- **Envio** — o script abre uma sessão de upload resumível no Drive e devolve só a URL da sessão. O navegador manda os bytes direto para o Drive, o que dispensa limite de tamanho e mantém a barra de progresso. Os arquivos não passam pelo Apps Script.
- **Listagem** — o script devolve os metadados da pasta (incluindo hashtags e autor) já com as URLs públicas de cada mídia.
- **Exibição** — as miniaturas e as fotos em tela cheia vêm do CDN do Google; os vídeos usam o player do próprio Drive. Nada disso consome cota do script.

## Linguagem utilizada

O projeto é escrito em **JavaScript moderno** com **React**. A base de execução é o **Vite**, que fornece o ambiente de desenvolvimento e o build final. O backend é um arquivo `.gs` (Apps Script, também JavaScript).

Além do JavaScript, o projeto usa:

- **HTML** em `index.html` para a estrutura base da aplicação.
- **CSS** em `src/index.css` para toda a interface visual.

## Resumo do projeto

O objetivo da aplicação é funcionar como uma câmera com galeria integrada. O usuário pode:

- abrir a câmera traseira ou frontal;
- tirar fotos;
- gravar vídeos;
- enviar fotos e vídeos já salvos no dispositivo;
- adicionar hashtags antes da captura;
- visualizar a galeria de mídias salvas no Google Drive;
- filtrar os itens por hashtag;
- abrir fotos e vídeos em tela cheia.

## Hierarquia de pastas e arquivos

```
captura-drive/
├── index.html
├── package.json
├── package-lock.json
├── README.md
├── vite.config.js
├── .env.example
├── .gitignore
├── .github/
│   └── workflows/
│       └── deploy.yml
├── .vscode/
│   └── extensions.json
├── apps-script/
│   ├── Codigo.gs
│   ├── appsscript.json
│   └── README.md
└── src/
    ├── App.jsx
    ├── config.js
    ├── index.css
    ├── main.jsx
    ├── components/
    │   ├── CameraView.jsx
    │   ├── CaptureControls.jsx
    │   ├── Gallery.jsx
    │   ├── HashtagFilter.jsx
    │   ├── Lightbox.jsx
    │   └── UploadPreviewModal.jsx
    ├── hooks/
    │   └── useCamera.js
    ├── services/
    │   └── driveStorage.js
    └── utils/
        └── hashtags.js
```

### Resumo dos arquivos

- `index.html`: ponto de entrada do app, carrega fontes e o bundle React.
- `package.json`: define nome do projeto, scripts e dependências.
- `vite.config.js`: configuração do Vite, incluindo porta, acesso na rede local e o caminho base usado no GitHub Pages.
- `.env.example`: modelo do `.env.local` com a URL do Web App.
- `.github/workflows/deploy.yml`: publica o cliente no GitHub Pages a cada push na `main`.
- `apps-script/Codigo.gs`: o backend — listagem da pasta e abertura das sessões de upload.
- `apps-script/appsscript.json`: manifesto do script (escopos e modo de publicação).
- `apps-script/README.md`: passo a passo da publicação do Web App.
- `src/main.jsx`: monta o React no elemento raiz da página.
- `src/App.jsx`: componente principal, coordena câmera, upload e galeria.
- `src/config.js`: lê a URL do Web App a partir da variável de ambiente.
- `src/index.css`: estilos globais e toda a aparência da interface.
- `src/components/CameraView.jsx`: mostra a pré-visualização da câmera e o HUD.
- `src/components/CaptureControls.jsx`: botões de flip, foto e vídeo.
- `src/components/Gallery.jsx`: exibe a galeria em formato masonry.
- `src/components/HashtagFilter.jsx`: cria os chips para filtrar a galeria por hashtag.
- `src/components/Lightbox.jsx`: abre foto ou vídeo em tela cheia.
- `src/components/UploadPreviewModal.jsx`: revisão das mídias escolhidas no dispositivo antes do envio.
- `src/hooks/useCamera.js`: controla a câmera, captura de foto e gravação de vídeo.
- `src/services/driveStorage.js`: conversa com o Web App (listagem e upload).
- `src/utils/hashtags.js`: normaliza o texto digitado em uma lista de hashtags.

## Configuração

1. Publique o backend seguindo o [apps-script/README.md](apps-script/README.md) e copie a URL terminada em `/exec`.
2. Copie `.env.example` para `.env.local` e preencha `VITE_WEB_APP_URL` com essa URL.

```bash
npm install
npm run dev
```

O app roda em `http://localhost:5173`. Como `getUserMedia` exige contexto seguro, o uso em localhost funciona normalmente no navegador.

## Publicação no GitHub Pages

1. Em **Settings → Pages**, defina *Source* como **GitHub Actions**.
2. Em **Settings → Secrets and variables → Actions**, crie o secret `WEB_APP_URL` com a URL do Web App.
3. Faça push na `main`. O workflow constrói e publica.

O GitHub Pages serve por HTTPS, o que é necessário para a câmera funcionar fora do `localhost`.

## Observações técnicas

- As hashtags e o nome de quem enviou ficam salvos em `appProperties`, sem banco de dados separado.
- Fotos e vídeos usam o mesmo caminho de upload resumível, o que melhora a estabilidade em conexões instáveis e remove o limite de tamanho.
- A pasta do Drive precisa estar como "qualquer pessoa com o link pode ver" para as miniaturas carregarem sem autenticação — a função `configurarPasta()` do script faz isso.
- Como consequência, as mídias são acessíveis por quem tiver a URL do arquivo. Não são indexadas por buscadores, mas não são privadas.
