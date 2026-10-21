#!/usr/bin/env node
// Run a React + Tailwind app's own Vite dev server with Kerf attached.
// The app's repo and config are not modified.
//   node bin/kerf.mjs /path/to/app/web
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import kerf from '../src/plugin.mjs';

const webRoot = path.resolve(process.argv[2] || '.');
// Tools like Tailwind and PostCSS look for their config in the working directory.
process.chdir(webRoot);
const req = createRequire(path.join(webRoot, 'package.json'));
const viteDir = path.dirname(req.resolve('vite/package.json'));
const vite = await import(pathToFileURL(path.join(viteDir, 'dist/node/index.js')).href);
const configFile = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'].map((f) => path.join(webRoot, f)).find((f) => fs.existsSync(f));

// Load the app's config ourselves so Kerf's tagger runs before any other plugin
// (React's plugin rewrites the file, which would shift every line and column).
const loaded = configFile ? await vite.loadConfigFromFile({ command: 'serve', mode: 'development' }, configFile, webRoot) : null;
const userConfig = loaded ? loaded.config : {};
const server = await vite.createServer({
  ...userConfig,
  configFile: false,
  root: webRoot,
  plugins: [kerf(), ...(userConfig.plugins || [])],
});
await server.listen();
server.printUrls();
console.log(`  Kerf editor: ${server.resolvedUrls?.local?.[0] || "http://localhost:5173/"}__kerf/`);
