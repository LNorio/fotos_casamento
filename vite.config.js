import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// getUserMedia exige contexto seguro. localhost conta como seguro, mas
// http://<ip-da-rede-local> não — e nesse caso navigator.mediaDevices
// nem existe. Para testar no celular pela rede local use
// `npm run dev:https`, que liga um certificado autoassinado; o navegador
// pede para confirmar o aviso de segurança uma vez.
//
// O modo do Vite, e não uma variável de ambiente, porque a sintaxe
// `VAR=1 comando` não funciona no shell do Windows. O .env.local
// continua sendo lido normalmente em qualquer modo.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
  // No GitHub Pages o site fica em /nome-do-repo/, e o workflow define
  // VITE_BASE de acordo. Localmente e em domínio próprio fica na raiz.
  base: process.env.VITE_BASE || '/',
  server: {
    host: true, // expõe na rede local p/ testar no celular
    port: 5173,
  },
}));
