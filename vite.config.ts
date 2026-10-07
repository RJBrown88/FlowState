import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// No environment values reach the browser: the Gemini key lives on the server (server/config.ts).
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
