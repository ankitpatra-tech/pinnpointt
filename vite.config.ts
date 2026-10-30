import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [
    {
      name: 'route-rewrite',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const url = req.url ?? '/';
          if (url === '/' || url === '/about') {
            req.url = '/about.html';
          } else if (url === '/app' || url.startsWith('/app?') || url === '/webapp' || url.startsWith('/webapp?')) {
            req.url = url.replace(/^\/(?:app|webapp)/, '/index.html');
          }
          next();
        });
      },
    },
  ],
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        about: resolve(__dirname, 'about.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
