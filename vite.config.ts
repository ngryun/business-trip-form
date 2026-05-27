import { defineConfig, normalizePath, type Plugin } from 'vite';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
const upstreamSrc = resolve(__dirname, 'src/upstream');
const rhwpCore = normalizePath(require.resolve('@rhwp/core/rhwp.js'));
const rhwpCoreDir = dirname(rhwpCore);
const fontAssetsDir = resolve(__dirname, 'assets/fonts');

/** /fonts/*.woff2 를 assets/fonts/ 에서 직접 서빙하고, 빌드 시 dist/fonts/ 로 복사한다. */
function fontAssets(): Plugin {
  return {
    name: 'font-assets',
    configureServer(server) {
      server.middlewares.use('/fonts', (req, res, next) => {
        const fontName = basename(decodePath(req.url?.split('?')[0] ?? ''));
        if (!fontName.endsWith('.woff2')) {
          next();
          return;
        }
        const fontPath = resolve(fontAssetsDir, fontName);
        if (!existsSync(fontPath)) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'font/woff2');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        createReadStream(fontPath).pipe(res);
      });
    },
    closeBundle() {
      const outDir = resolve(__dirname, 'dist/fonts');
      mkdirSync(outDir, { recursive: true });
      for (const fileName of readdirSync(fontAssetsDir)) {
        const source = resolve(fontAssetsDir, fileName);
        if (!fileName.endsWith('.woff2') || !statSync(source).isFile()) continue;
        copyFileSync(source, resolve(outDir, fileName));
      }
    },
  };
}

function decodePath(path: string): string {
  try { return decodeURIComponent(path); } catch { return ''; }
}

export default defineConfig({
  base: './',
  plugins: [fontAssets()],
  resolve: {
    alias: [
      { find: '@wasm/rhwp.js', replacement: rhwpCore },
      { find: '@upstream', replacement: upstreamSrc },
      { find: '@', replacement: upstreamSrc },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 7710,
    fs: {
      allow: [__dirname, rhwpCoreDir, fontAssetsDir],
    },
  },
});
