// The Vite plugin: tags elements while the app runs in dev, and exposes a
// small local API the Kerf editor calls to read and change source files.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tagSource } from './ast.mjs';
import { loadTheme } from './tailwind.mjs';
import { createEditor, KerfError } from './edit.mjs';
import { propose } from './ai.mjs';
import { createSession } from './session.mjs';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const EDITOR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../editor');
const ASSETS = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/editor.js': ['editor.js', 'text/javascript'], '/editor.css': ['editor.css', 'text/css'] };

export default function kerf() {
  let webRoot;
  let srcDir;
  let theme;
  let editor;
  let session;

  return {
    name: 'kerf',
    apply: 'serve',
    enforce: 'pre',
    async configResolved(config) {
      webRoot = config.root;
      srcDir = path.join(webRoot, 'src') + path.sep;
      theme = await loadTheme(webRoot);
      editor = createEditor(webRoot, () => theme);
      session = createSession(webRoot, editor);
    },
    transform(code, id) {
      const file = id.split('?')[0];
      if (!/\.[jt]sx$/.test(file) || !file.startsWith(srcDir)) return null;
      return tagSource(code, file, webRoot);
    },
    configureServer(server) {
      server.middlewares.use('/__kerf', async (req, res) => {
        const send = (status, body) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        try {
          const route = req.url.split('?')[0];
          if (req.method === 'GET' && ASSETS[route]) {
            res.setHeader('Content-Type', ASSETS[route][1]);
            res.setHeader('Cache-Control', 'no-store');
            return res.end(fs.readFileSync(path.join(EDITOR, ASSETS[route][0]), 'utf8'));
          }
          if (req.method === 'GET' && route === '/project') {
            const pkg = JSON.parse(fs.readFileSync(path.join(webRoot, 'package.json'), 'utf8'));
            const g = session.repoInfo();
            return send(200, { name: g.repo || pkg.name || path.basename(webRoot), branch: g.git ? g.branch : null, repo: g.repo, gh: g.gh, files: g.files || [] });
          }
          if (req.method === 'GET' && route === '/versions') return send(200, session.list());
          if (req.method === 'GET' && route === '/theme') return send(200, theme);
          if (req.method === 'GET' && route === '/changes') return send(200, editor.history.map(({ rel, loc, change, summary, at }) => ({ file: rel, loc, change, summary, at })));
          if (req.method !== 'POST') return send(404, { error: 'Not found' });
          const body = await readBody(req);
          const writes = ['/edit', '/undo', '/ai/apply'];
          if (writes.includes(route) && session.isPeeking()) return send(409, { error: 'You’re looking at an earlier version. Close it to keep editing.' });
          if (route === '/version') return send(200, session.snapshot());
          if (route === '/restore') return send(200, session.restore(Number(body.n)));
          if (route === '/peek') return send(200, session.peekBefore(Number(body.n)));
          if (route === '/unpeek') return send(200, session.unpeek());
          if (route === '/pr') return send(200, session.pullRequest(body));
          if (route === '/inspect') return send(200, editor.describe(body.loc));
          if (route === '/edit') return send(200, editor.edit(body.loc, { ops: body.ops, text: body.text, props: body.props }));
          if (route === '/undo') return send(200, editor.undo());
          if (route === '/ai') {
            // Add what only the source knows: real tag, classes, whether text is editable.
            const targets = (body.targets || []).slice(0, 80).map((t) => {
              try {
                const d = editor.describe(t.loc);
                return { ...t, tag: d.tag, classes: d.classes, classKind: d.classKind, textEditable: d.text.editable, text: d.text.editable ? d.text.value : t.text, props: d.props, lib: d.lib };
              } catch {
                return null;
              }
            }).filter(Boolean);
            return send(200, await propose({ request: body.request, targets, history: body.history }, theme));
          }
          if (route === '/ai/apply') {
            const results = (body.edits || []).map((e) => {
              try {
                return { loc: e.loc, ok: true, ...editor.edit(e.loc, { ops: e.ops, text: e.text || undefined, props: e.props, source: 'ai' }) };
              } catch (err) {
                return { loc: e.loc, ok: false, error: err.message };
              }
            });
            return send(200, { results, n: editor.history.length });
          }
          return send(404, { error: 'Not found' });
        } catch (e) {
          send(e instanceof KerfError ? 422 : 500, { error: e.message });
        }
      });
    },
  };
}
