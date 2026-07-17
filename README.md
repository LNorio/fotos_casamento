# Câmera · Galeria

Aplicação em React + Vite para capturar fotos e vídeos com a câmera do dispositivo, organizar mídias por hashtags e salvar tudo em uma pasta do Google Drive.

## Linguagem utilizada

O projeto é escrito em **JavaScript moderno** com **React**. A base de execução é o **Vite**, que fornece o ambiente de desenvolvimento e o build final.

Além do JavaScript, o projeto usa:

- **HTML** em `index.html` para a estrutura base da aplicação.
- **CSS** em `src/index.css` para toda a interface visual.

## Resumo do projeto

O objetivo da aplicação é funcionar como uma câmera com galeria integrada. O usuário pode:

- abrir a câmera traseira ou frontal;
- tirar fotos;
- gravar vídeos;
- adicionar hashtags antes da captura;
- visualizar a galeria de mídias salvas no Google Drive;
- filtrar os itens por hashtag;
- abrir fotos e vídeos em tela cheia.

A autenticação é feita com **Google Identity Services** e o armazenamento usa a **Google Drive API v3**. As mídias são enviadas diretamente para uma pasta específica do Drive e as hashtags são guardadas nos `appProperties` de cada arquivo.

## Hierarquia de pastas e arquivos

```
captura-drive/
├── index.html
├── package.json
├── package-lock.json
├── README.md
├── vite.config.js
├── .gitignore
├── .vscode/
│   └── extensions.json
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
    │   └── Lightbox.jsx
    ├── hooks/
    │   ├── useCamera.js
    │   └── useDriveAuth.js
    └── services/
        └── driveStorage.js
```

### Resumo dos arquivos

- `index.html`: ponto de entrada do app, carrega fontes, Google Identity Services e o bundle React.
- `package.json`: define nome do projeto, scripts e dependências.
- `package-lock.json`: trava as versões instaladas pelo npm para manter o ambiente consistente.
- `vite.config.js`: configuração do Vite, incluindo porta e acesso na rede local.
- `README.md`: documentação principal do projeto.
- `.gitignore`: arquivos e pastas que não devem ir para o repositório.
- `.vscode/extensions.json`: sugestões de extensões para o VS Code.
- `src/main.jsx`: monta o React no elemento raiz da página.
- `src/App.jsx`: componente principal, coordena câmera, login, upload e galeria.
- `src/config.js`: concentra `CLIENT_ID`, `FOLDER_ID`, escopo OAuth e URLs da API.
- `src/index.css`: estilos globais e toda a aparência da interface.
- `src/components/CameraView.jsx`: mostra a pré-visualização da câmera e o HUD.
- `src/components/CaptureControls.jsx`: botões de flip, foto e vídeo.
- `src/components/Gallery.jsx`: exibe a galeria em formato masonry e carrega as mídias sob demanda.
- `src/components/HashtagFilter.jsx`: cria os chips para filtrar a galeria por hashtag.
- `src/components/Lightbox.jsx`: abre foto ou vídeo em tela cheia.
- `src/hooks/useCamera.js`: controla a câmera, captura de foto e gravação de vídeo.
- `src/hooks/useDriveAuth.js`: faz a autenticação OAuth com o Google.
- `src/services/driveStorage.js`: concentra upload, listagem, filtro e download das mídias no Drive.

## Como executar

```bash
npm install
npm run dev
```

O app roda em `http://localhost:5173`. Como `getUserMedia` exige contexto seguro, o uso em localhost funciona normalmente no navegador.

## Configuração do Google Drive

Edite `src/config.js` e preencha:

1. `CLIENT_ID` com o OAuth Client ID do Google Cloud Console.
2. `FOLDER_ID` com o ID da pasta do Google Drive onde os arquivos serão salvos.

No Google Cloud Console, ative a **Google Drive API** e cadastre `http://localhost:5173` nas origens autorizadas durante o desenvolvimento.

## Observações técnicas

- As hashtags ficam salvas em `appProperties`, sem banco de dados separado.
- Vídeos usam upload resumível, o que melhora a estabilidade em conexões instáveis.
- A galeria baixa os arquivos como `blob:` local para garantir melhor compatibilidade na reprodução e no avanço do vídeo.
