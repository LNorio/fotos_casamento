import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// getUserMedia exige contexto seguro. localhost já conta como seguro,
// então `npm run dev` funciona pra testar a câmera sem HTTPS.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // expõe na rede local p/ testar no celular (use https p/ câmera fora do localhost)
    port: 5173,
  },
});
