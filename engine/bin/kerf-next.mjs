#!/usr/bin/env node
// Run a Next.js + Tailwind app's own dev server with Tovi attached.
// The app's repo and config are not modified: Tovi loads next.config itself and adds its loader.
//   node bin/kerf-next.mjs /path/to/app
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createKerf } from '../src/plugin.mjs';

const webRoot = path.resolve(process.argv[2] || '.');
process.chdir(webRoot);
process.env.NODE_ENV = 'development';
const req = createRequire(path.join(webRoot, 'package.json'));
const LOADER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/next-loader.cjs');

const freePort = (p) => new Promise((resolve) => {
  const s = net.createServer().once('error', () => resolve(freePort(p + 1))).once('listening', () => s.close(() => resolve(p))).listen(p, 'localhost');
});
const port = await freePort(Number(process.env.PORT) || 3000);

// Next reads next.config itself (and ignores config passed in code in dev), so wrap its config loader:
// every config it loads gets Tovi's loader added, and the app's own file stays untouched.
const Module = req('node:module');
const CONFIG = req.resolve('next/dist/server/config');
const addLoader = (cfg) => {
  if (!cfg || cfg.__kerf) return cfg;
  const userWebpack = cfg.webpack;
  return {
    ...cfg,
    __kerf: true,
    webpack(config, ctx) {
      const c = userWebpack ? userWebpack(config, ctx) : config;
      if (process.env.KERF_DEBUG) console.log('kerf webpack hook', ctx.isServer, ctx.nextRuntime);
      c.module.rules.unshift({ test: /\.[jt]sx$/, exclude: /node_modules/, enforce: 'pre', use: [{ loader: LOADER, options: { root: webRoot } }] });
      return c;
    },
  };
};
const load0 = Module._load;
let wrapped = null;
Module._load = function (request, parent, isMain) {
  const exp = load0.apply(this, arguments);
  if (!/config/.test(request)) return exp;
  let file;
  try { file = Module._resolveFilename(request, parent, isMain); } catch { return exp; }
  if (file !== CONFIG) return exp;
  if (!wrapped) {
    wrapped = Object.create(exp);
    const orig = exp.default;
    Object.defineProperty(wrapped, 'default', { enumerable: true, value: async (...args) => addLoader(await orig(...args)) });
  }
  return wrapped;
};
const next = req('next');
const kerf = await createKerf(webRoot);
let handle = null;
const server = http.createServer((rq, rs) => {
  if (rq.url === '/__kerf' || rq.url.startsWith('/__kerf/') || rq.url.startsWith('/__kerf?')) {
    rq.url = rq.url.slice('/__kerf'.length) || '/';
    if (!rq.url.startsWith('/')) rq.url = '/' + rq.url;
    return kerf.handle(rq, rs);
  }
  if (!handle) { rs.statusCode = 503; return rs.end('Starting…'); }
  handle(rq, rs);
});
const app = next({ dev: true, dir: webRoot, hostname: 'localhost', port, httpServer: server });
await new Promise((resolve) => server.listen(port, 'localhost', resolve));
await app.prepare();
handle = app.getRequestHandler();
// Hot reload websockets: newer Next versions hand these out; older ones attach to httpServer themselves.
if (typeof app.getUpgradeHandler === 'function') {
  const up = app.getUpgradeHandler();
  server.on('upgrade', (rq, socket, head) => { if (rq.url.startsWith('/_next/')) up(rq, socket, head); });
}
console.log(`  ➜  Local:   http://localhost:${port}/`);
console.log(`  Tovi editor: http://localhost:${port}/__kerf/`);
