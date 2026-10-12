import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler } from './server/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Handle backend API requests
app.use((req, res, next) => {
  if (req.url.startsWith('/api')) {
    return handler(req, res);
  }
  next();
});

const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.use((req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: false,
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Empire OS running on http://${HOST}:${PORT}`);
});
