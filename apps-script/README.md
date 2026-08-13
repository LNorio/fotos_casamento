# Backend (Google Apps Script)

O "servidor" do app é um único arquivo publicado como **Web App** do Google Apps
Script. Ele roda com a sua conta, então nenhum convidado precisa fazer login.

## Publicação (primeira vez)

1. Acesse [script.google.com](https://script.google.com) → **Novo projeto**.
2. Cole o conteúdo de `Codigo.gs` no editor (substituindo o `myFunction` padrão).
3. No menu de engrenagem (**Configurações do projeto**), marque
   **"Mostrar o arquivo de manifesto appsscript.json"**. Abra o
   `appsscript.json` que aparece na lateral e cole o conteúdo do arquivo daqui.
4. Preencha o `FOLDER_ID` no topo do `Codigo.gs` com o ID da pasta do Drive
   (o trecho da URL depois de `/folders/`).
5. Selecione a função **`configurarPasta`** na barra superior e clique em
   **Executar**. O Google vai pedir autorização — é a única vez, e só para
   você. Na tela "O Google não verificou este app", use
   **Avançado → Acessar (não seguro)**: é o seu próprio script.
   Isso libera a pasta para leitura por link, o que faz as miniaturas
   carregarem direto do CDN do Google.
6. **Implantar → Nova implantação** → tipo **App da Web**:
   - *Executar como*: **Eu**
   - *Quem pode acessar*: **Qualquer pessoa**
7. Copie a **URL do app da Web** (termina em `/exec`) e coloque no `.env.local`
   do frontend, como `VITE_WEB_APP_URL`.

## Atualizações

> ⚠️ **Não use "Nova implantação" para atualizar** — isso gera uma URL nova e
> quebra o app publicado.

Use **Implantar → Gerenciar implantações** → ícone de lápis na implantação
existente → *Versão*: **Nova versão** → **Implantar**. A URL permanece a mesma.

Durante o desenvolvimento, a URL `/dev` sempre executa o código salvo mais
recente, sem precisar implantar. Ela funciona apenas para você (o dono).

## Teste rápido

```bash
curl -L "https://script.google.com/macros/s/SEU_ID/exec?action=list"
```

Deve responder `{"ok":true,"items":[...]}`.

## Cota de execução

Conta Google comum tem **90 min/dia** de execução de Apps Script — e planos
de armazenamento (Google One, AI Pro) **não aumentam esse limite**. Duas
decisões do código existem só para caber nisso com muitos convidados:

- **Cache de 60 s na listagem.** A maioria das leituras não chega ao Drive.
  O app passa `?fresh=1` logo após um envio, para a mídia nova aparecer sem
  esperar o cache vencer.
- **Sessões de upload em lote, com `fetchAll`.** Enviar 10 arquivos custa uma
  execução de ~2 s em vez de dez de ~1,5 s.

Do lado do app, a releitura automática da galeria é de 15 min e pausa com a
aba em segundo plano.

Estimativa para 200 convidados num evento de 6 h: **~57 min**, ou 63% da cota.

## Sobre os escopos

O manifesto pede o escopo `drive` completo, e não `drive.file`. O motivo é que
`drive.file` só enxerga arquivos criados pelo próprio app — ele não conseguiria
gravar numa pasta que já existe nem listar as mídias enviadas antes.

Isso não aciona verificação do Google: o processo de verificação vale para apps
que pedem consentimento de terceiros. Aqui só você autoriza, uma vez, o seu
próprio script.

## Versionamento com clasp (opcional)

```bash
npm i -g @google/clasp
clasp login
clasp clone SEU_SCRIPT_ID --rootDir apps-script
clasp push
```

Assim o `Codigo.gs` fica versionado no git junto com o frontend.
