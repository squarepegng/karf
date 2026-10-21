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
import { createLibrary } from './library.mjs';
import { listTokens, tokenEdit } from './tokens.mjs';

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

// Kerf for one web app: tags JSX so elements map back to source, and serves the editor and its API.
// Used by the Vite plugin below and by the Next.js runner.
export async function createKerf(webRoot) {
  let theme = await loadTheme(webRoot);
  // A token change in tailwind.config changes the theme Kerf reads.
  const setToken = async ({ name, hex, which = 'both', source = 'hand' }) => {
    const files = tokenEdit(webRoot, theme, name, hex, which);
    const r = editor.applyFiles(files, `token:${name}`, { token: { name, hex, which }, source }, { action: `Colour “${name}”${which === 'both' || which === 'all' ? '' : ` (${which})`} → ${String(hex).toUpperCase()}` });
    if ([...files.keys()].some((f) => /tailwind\.config/.test(f))) theme = await loadTheme(webRoot);
    return r;
  };
  const library = createLibrary(webRoot);
  const editor = createEditor(webRoot, () => theme, library);
  const session = createSession(webRoot, editor);
  const skip = /[\\/](node_modules|\.next|dist|build|out)[\\/]/;
  return {
    tag(code, file) {
      if (!/\.[jt]sx$/.test(file) || !file.startsWith(webRoot + path.sep) || skip.test(file.slice(webRoot.length))) return null;
      return tagSource(code, file, webRoot);
    },
    // req.url is relative to /__kerf.
    async handle(req, res) {
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
        if (req.method === 'GET' && route === '/chat') return send(200, session.chat());
        if (req.method === 'GET' && route === '/icons') return send(200, library.searchIcons(new URL(req.url, 'http://x').searchParams.get('q'), 80, new URL(req.url, 'http://x').searchParams.get('lib') || undefined));
        if (req.method === 'GET' && route === '/components') return send(200, [...library.componentList().values()].map((c) => ({ name: c.name, file: c.rel })).sort((a, b) => a.name.localeCompare(b.name)));
        if (req.method === 'GET' && route === '/uploads') return send(200, library.uploads());
        if (req.method === 'GET' && route === '/tokens') return send(200, listTokens(webRoot, theme));
        if (req.method === 'GET' && route === '/theme') return send(200, theme);
        if (req.method === 'GET' && route === '/changes') return send(200, editor.history.map(({ rel, loc, change, summary, at }) => ({ file: rel, loc, change, summary, at })));
        if (req.method !== 'POST') return send(404, { error: 'Not found' });
        const body = await readBody(req);
        if (route === '/chat') { session.setChat(body); return send(200, { ok: true }); }
        // Every change is saved to .kerf/ so a restart keeps undo, versions and chat.
        const s0 = send;
        const send2 = (status, b) => { if (status === 200 && route !== '/inspect' && route !== '/ai') session.save(); return s0(status, b); };
        const writes = ['/edit', '/undo', '/ai/apply', '/structure'];
        if (writes.includes(route) && session.isPeeking()) return send(409, { error: 'You’re looking at an earlier version. Close it to keep editing.' });
        if (route === '/version') return send2(200, session.snapshot());
        if (route === '/restore') return send2(200, session.restore(Number(body.n)));
        if (route === '/peek') return send2(200, session.peekBefore(Number(body.n)));
        if (route === '/unpeek') return send2(200, session.unpeek());
        if (route === '/pr') return send2(200, session.pullRequest(body));
        if (route === '/inspect') return send(200, editor.describe(body.loc, body.dom));
        if (route === '/edit') return send2(200, editor.edit(body.loc, { ops: body.ops, text: body.text, props: body.props, cva: body.cva, bp: body.bp, dom: body.dom, scope: body.scope, target: body.target, name: body.name }));
        if (route === '/undo') return send2(200, editor.undo());
        if (route === '/token') return send2(200, await setToken(body));
        if (route === '/structure') return send2(200, editor.structure(body.loc, body.op, 'hand', body.name));
        if (route === '/upload') {
          try { return send(200, library.saveUpload(body.name, body.data)); } catch (e) { throw new KerfError(e.message); }
        }
        if (route === '/ai') {
          // Add what only the source knows: real tag, classes, whether text is editable.
          const targets = (body.targets || []).slice(0, 80).map((t) => {
            try {
              const d = editor.describe(t.loc, t.dom);
              return { ...t, tag: d.tag, file: d.file, snippet: d.snippet, classes: d.classes, classKind: d.classKind, classReason: d.classReason, sources: d.sources, sourceTargets: d.targets, merge: d.merge, textEditable: d.text.editable, text: d.text.editable ? d.text.value : t.text, props: d.props, lib: d.lib };
            } catch {
              return null;
            }
          }).filter(Boolean);
          let tokens = [];
          try { tokens = listTokens(webRoot, theme); } catch {}
          return send(200, await propose({ request: body.request, targets, history: body.history, images: body.images, tokens, webRoot, screen: body.screen, context: body.context }, theme, library));
        }
        if (route === '/ai/apply') {
          // Apply from the bottom of each file up, structure last per element, so positions stay valid.
          const lineOf = (e) => Number(String(e.loc).split(':').slice(-2)[0]) || 0;
          const rank = (e) => (!e.structure ? 0 : e.structure.type === 'delete' ? 2 : 1);
          // "Add the new one, delete the old one" on the same element is a replace: do it in one step.
          let edits = (body.edits || []).slice();
          for (const del of edits.filter((e) => e.structure?.type === 'delete')) {
            const ins = edits.find((e) => e.loc === del.loc && e.structure?.type === 'insert' && e.structure.position !== 'inside');
            if (ins) { ins.structure = { type: 'replace', jsx: ins.structure.jsx }; edits = edits.filter((e) => e !== del); }
          }
          // Code changes and colour tokens go last: they can touch files other edits point into.
          const late = edits.filter((e) => e.structure?.type === 'code' || e.structure?.type === 'token');
          edits = edits.filter((e) => !late.includes(e));
          // Style edits never move lines: do them top-down so parents get their layout before children.
          // Structural edits do move lines: do them bottom-up per file, deletes last.
          const file = (e) => String(e.loc).split(':')[0];
          const ordered = edits.sort((a, b) => (!!a.structure - !!b.structure) || (!a.structure ? file(a).localeCompare(file(b)) || lineOf(a) - lineOf(b) : file(a).localeCompare(file(b)) || lineOf(b) - lineOf(a) || rank(a) - rank(b)));
          // Groups run first so the new frames exist; elements they move are followed by later edits.
          const groups = ordered.filter((e) => e.structure?.type === 'group');
          const final = [...groups, ...ordered.filter((e) => e.structure?.type !== 'group')];
          const remap = new Map();
          const shifts = [];
          const results = final.map((e) => {
            let loc = remap.get(e.loc) || e.loc;
            if (!remap.has(e.loc)) for (const sh of shifts) {
              const m = loc.match(/^(.+):(\d+):(\d+)$/);
              if (m && m[1] === sh.file && +m[2] > sh.after) loc = `${m[1]}:${+m[2] + sh.delta}:${m[3]}`;
            }
            e = { ...e, loc };
            try {
              if (e.structure) {
                const r = editor.structure(e.loc, e.structure, 'ai', e.name);
                for (const [a, b] of r.moved || []) remap.set(a, b);
                if (r.shift) shifts.push(r.shift);
                return { loc: e.loc, ok: true, ...r };
              }
              return { loc: e.loc, ok: true, ...editor.edit(e.loc, { ops: e.ops, text: e.text || undefined, props: e.props, bp: e.bp, dom: e.dom, target: e.target, source: 'ai', name: e.name }) };
            } catch (err) {
              return { loc: e.loc, ok: false, error: err.message };
            }
          });
          for (const e of late) {
            try {
              const st = e.structure;
              const r = st.type === 'token' ? await setToken({ name: st.name, hex: st.hex, which: st.which, source: 'ai' }) : editor.code(st.file, st.find, st.replace, { source: 'ai', name: e.name, label: e.why ? `Code: ${e.why}` : null });
              results.push({ loc: e.loc, ok: true, ...r });
            } catch (err) {
              results.push({ loc: e.loc, ok: false, error: err.message });
            }
          }
          return send2(200, { results, n: editor.history.length });
        }
        return send(404, { error: 'Not found' });
      } catch (e) {
        send(e instanceof KerfError ? 422 : 500, { error: e.message });
      }
    },
  };
}

export default function kerf() {
  let k;
  return {
    name: 'kerf',
    apply: 'serve',
    enforce: 'pre',
    async configResolved(config) {
      k = await createKerf(config.root);
    },
    transform(code, id) {
      return k.tag(code, id.split('?')[0]);
    },
    configureServer(server) {
      server.middlewares.use('/__kerf', (req, res) => k.handle(req, res));
    },
  };
}
