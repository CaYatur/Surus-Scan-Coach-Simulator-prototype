import { defineConfig, type Plugin, type Connect } from 'vite';
import type { ServerResponse, IncomingMessage } from 'node:http';

const BASE = '/scan-coach/';
const BASE_NO_SLASH = '/scan-coach';
const DOUBLE = '/scan-coach/scan-coach';

/**
 * CaYaDev proxy often strips the /scan-coach prefix before forwarding to Vite.
 * With base set, Vite expects URLs under /scan-coach/. Re-prefix stripped paths
 * so Vite with base still matches. Also collapse accidental double-prefix from
 * the response rewriter (local opens of doubled URLs).
 */
function cayadevBasePrefix(): Plugin {
  return {
    name: 'cayadev-base-prefix',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const raw = req.url ?? '/';
        const pathOnly = raw.split('?', 1)[0] ?? '/';
        const q = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';

        // Local follow of doubled URLs → single base
        if (pathOnly.startsWith(`${DOUBLE}/`) || pathOnly === DOUBLE) {
          req.url = `${BASE_NO_SLASH}${pathOnly.slice(DOUBLE.length) || '/'}${q}`;
          next();
          return;
        }

        if (pathOnly.startsWith(BASE) || pathOnly.startsWith(BASE_NO_SLASH)) {
          next();
          return;
        }

        const needsPrefix =
          pathOnly === '/' ||
          pathOnly.startsWith('/src') ||
          pathOnly.startsWith('/@') ||
          pathOnly.startsWith('/node_modules') ||
          pathOnly.startsWith('/assets');

        if (needsPrefix) {
          const rest = pathOnly === '/' ? '/' : pathOnly;
          req.url = `${BASE_NO_SLASH}${rest}${q}`;
        }
        next();
      });
    },
  };
}

function isTransformableModule(urlPath: string): boolean {
  return (
    urlPath.includes('@vite/client') ||
    urlPath.includes('/@id/') ||
    urlPath.includes('/@fs/') ||
    urlPath.includes('/node_modules/') ||
    urlPath.includes('/.vite/deps/') ||
    /\.(m?[jt]sx?|vue|css)$/.test(urlPath)
  );
}

/**
 * CaYaDev response rewriter strips ONE literal "/scan-coach" prefix from absolute
 * URLs in JS/CSS bodies ("/scan-coach/src/hud.ts" → "/src/hud.ts" → browser 404).
 * Emit a doubled prefix so after the strip the browser still sees "/scan-coach/...".
 * Local requests to the doubled path are collapsed by cayadevBasePrefix.
 *
 * Vite 8 injects absolute base paths after transform hooks, so this is done by
 * wrapping the response in middleware registered before Vite internals.
 */
function doubleBaseAgainstProxyStrip(): Plugin {
  return {
    name: 'double-base-against-proxy-strip',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        const rawUrl = req.url ?? '/';
        const pathOnly = rawUrl.split('?', 1)[0] ?? '/';
        if (!isTransformableModule(pathOnly)) {
          next();
          return;
        }

        const originalEnd = res.end.bind(res);
        const originalWrite = res.write.bind(res);
        const chunks: Buffer[] = [];
        let ended = false;

        res.write = ((chunk: any, encoding?: any, cb?: any) => {
          if (chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
          }
          if (typeof encoding === 'function') encoding();
          else if (typeof cb === 'function') cb();
          return true;
        }) as typeof res.write;

        res.end = ((chunk?: any, encoding?: any, cb?: any) => {
          if (ended) return res;
          ended = true;
          if (chunk) {
            chunks.push(
              Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined),
            );
          }

          let body = Buffer.concat(chunks).toString('utf8');
          if (body.includes(`${BASE_NO_SLASH}/`) && !body.includes(`${DOUBLE}/`)) {
            // "/scan-coach/foo" → "/scan-coach/scan-coach/foo" (skip bare "/scan-coach/")
            body = body.replace(
              /(["'`])\/scan-coach\/(?!scan-coach\/)([^"'`]*)\1/g,
              (_m, q: string, rest: string) => {
                if (rest === '') return `${q}${BASE_NO_SLASH}/${q}`; // leave "/scan-coach/" alone
                return `${q}${DOUBLE}/${rest}${q}`;
              },
            );
          }

          const out = Buffer.from(body, 'utf8');
          try {
            res.removeHeader('Content-Length');
          } catch {
            /* ignore */
          }
          res.setHeader('Content-Length', out.length);
          res.write = originalWrite;
          res.end = originalEnd;
          const done = typeof encoding === 'function' ? encoding : cb;
          return originalEnd(out, done as any);
        }) as typeof res.end;

        next();
      });
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [cayadevBasePrefix(), doubleBaseAgainstProxyStrip()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    origin: 'https://app.cayadev.com',
    // CaYaDev tunnel does not proxy Vite HMR websockets; disable to avoid console noise.
    // Full page refresh still works on https://app.cayadev.com/scan-coach/
    hmr: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
});
