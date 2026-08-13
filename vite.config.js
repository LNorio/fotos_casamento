import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// getUserMedia exige contexto seguro. localhost já conta como seguro,
// então `npm run dev` funciona pra testar a câmera sem HTTPS.
export default defineConfig({
  plugins: [react()],
  // No GitHub Pages o site fica em /nome-do-repo/, e o workflow define
  // VITE_BASE de acordo. Localmente e em domínio próprio fica na raiz.
  base: process.env.VITE_BASE || '/',
  server: {
    host: true, // expõe na rede local p/ testar no celular (use https p/ câmera fora do localhost)
    port: 5173,
  },
});
