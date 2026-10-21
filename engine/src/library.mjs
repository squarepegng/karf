// What a designer can pick from: the project's own components, the icons in
// its icon libraries, and images uploaded through Kerf.
import fs from 'node:fs';
import path from 'node:path';

const ICON_SOURCES = {
  'lucide-react': (dir) => {
    const dts = path.join(dir, 'dist/lucide-react.d.ts');
    if (!fs.existsSync(dts)) return [];
    const names = [...fs.readFileSync(dts, 'utf8').matchAll(/declare const ([A-Z][A-Za-z0-9]*):/g)].map((m) => m[1]);
    return names.filter((n) => !n.endsWith('Icon') && !n.startsWith('Lucide'));
  },
  '@phosphor-icons/react': (dir) => {
    const dts = path.join(dir, 'dist/index.d.ts');
    if (!fs.existsSync(dts)) return [];
    return [...fs.readFileSync(dts, 'utf8').matchAll(/export \* from '\.\/csr\/([A-Z][A-Za-z0-9]*)'/g)].map((m) => m[1]);
  },
};

export function createLibrary(webRoot) {
  // Most apps keep code in src/; Next.js apps often keep app/ and components/ at the root.
  const srcDir = fs.existsSync(path.join(webRoot, 'src')) ? path.join(webRoot, 'src') : webRoot;
  let icons = null;
  let components = null;

  function iconLibs() {
    if (icons) return icons;
    const pkg = JSON.parse(fs.readFileSync(path.join(webRoot, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    icons = {};
    for (const lib of Object.keys(ICON_SOURCES)) {
      if (!deps[lib]) continue;
      // Packages may be hoisted to the repo root in monorepos.
      let dir = webRoot, found = null;
      while (dir && !found) {
        const c = path.join(dir, 'node_modules', lib);
        if (fs.existsSync(c)) found = c;
        const up = path.dirname(dir);
        dir = up === dir ? null : up;
      }
      if (found) icons[lib] = new Set(ICON_SOURCES[lib](found));
    }
    return icons;
  }

  // Does this project import with "@/…" (an alias for src/)?
  let usesAlias = null;
  function aliasStyle() {
    if (usesAlias != null) return usesAlias;
    usesAlias = false;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (usesAlias) return;
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!['node_modules', 'public', 'dist', 'build', 'out'].includes(e.name) && !e.name.startsWith('.')) walk(p); }
        else if (/\.[jt]sx?$/.test(e.name) && /from ['"]@\//.test(fs.readFileSync(p, 'utf8'))) usesAlias = true;
      }
    };
    walk(srcDir);
    return usesAlias;
  }

  // Components the project exports from src/components (and src/ui).
  function componentList() {
    if (components) return components;
    components = new Map();
    const roots = ['components', 'ui'].map((d) => path.join(srcDir, d)).filter((d) => fs.existsSync(d));
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.[jt]sx$/.test(e.name) && !/\.(test|stories|spec)\./.test(e.name)) {
          const code = fs.readFileSync(p, 'utf8');
          const names = new Set();
          for (const m of code.matchAll(/export\s+(?:default\s+)?(?:const|function)\s+([A-Z][A-Za-z0-9]*)/g)) names.add(m[1]);
          for (const m of code.matchAll(/export\s*\{([^}]+)\}/g)) m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter((x) => /^[A-Z]/.test(x)).forEach((x) => names.add(x));
          for (const n of names) if (!components.has(n)) components.set(n, { name: n, file: p, rel: path.relative(webRoot, p) });
        }
      }
    };
    roots.forEach(walk);
    return components;
  }

  // How a file should import a component: "@/components/ui/button" or a relative path.
  function importPath(fromFile, compFile) {
    const noExt = compFile.replace(/\.[jt]sx?$/, '').replace(/\/index$/, '');
    if (aliasStyle()) return '@/' + path.relative(srcDir, noExt).split(path.sep).join('/');
    let r = path.relative(path.dirname(fromFile), noExt).split(path.sep).join('/');
    return r.startsWith('.') ? r : './' + r;
  }

  function findIcon(name) {
    for (const [lib, set] of Object.entries(iconLibs())) if (set.has(name)) return lib;
    return null;
  }
  function searchIcons(q, limit = 80, only) {
    q = String(q || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const out = [];
    for (const [lib, set] of Object.entries(iconLibs())) {
      if (only && lib !== only) continue;
      for (const n of set) {
        const l = n.toLowerCase();
        if (!q || l.includes(q)) out.push({ name: n, lib, score: l === q ? 0 : l.startsWith(q) ? 1 : 2 });
      }
    }
    return out.sort((a, b) => a.score - b.score || a.name.length - b.name.length).slice(0, limit).map(({ name, lib }) => ({ name, lib }));
  }

  // Icons the app already imports, most used first, so a swap keeps the app's icon vocabulary.
  let usedCache = null;
  function usedIcons(only) {
    if (!usedCache || Date.now() - usedCache.at > 10000) {
      const counts = new Map();
      const libs = Object.keys(iconLibs());
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.name.startsWith('.') || ['node_modules', 'dist', 'build', 'out', 'public'].includes(e.name)) continue;
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.[jt]sx?$/.test(e.name)) {
            const code = fs.readFileSync(p, 'utf8');
            for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
              if (!libs.includes(m[2])) continue;
              for (const raw of m[1].split(',')) {
                const n = raw.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').replace(/Icon$/, '');
                if (/^[A-Z]/.test(n) && iconLibs()[m[2]].has(n)) counts.set(`${m[2]}|${n}`, (counts.get(`${m[2]}|${n}`) || 0) + 1);
              }
            }
          }
        }
      };
      try { walk(srcDir); } catch {}
      usedCache = { at: Date.now(), list: [...counts].sort((a, b) => b[1] - a[1]).map(([k]) => { const [lib, name] = k.split('|'); return { name, lib }; }) };
    }
    return usedCache.list.filter((i) => !only || i.lib === only);
  }
  // Icons related to this one: the words in its name, plus a few common synonyms.
  const RELATED = { tv: ['monitor', 'screen', 'laptop', 'cast'], monitor: ['tv', 'screen', 'laptop'], trash: ['delete', 'bin', 'eraser'], user: ['person', 'profile', 'contact', 'circleuser'], settings: ['cog', 'gear', 'sliders', 'wrench'], cog: ['settings', 'gear', 'sliders'], x: ['close', 'circlex', 'ban'], search: ['scan', 'filter', 'zoomin'], heart: ['star', 'thumbsup', 'bookmark'], star: ['heart', 'sparkle', 'award'], home: ['house', 'building'], mail: ['inbox', 'send', 'message'], bell: ['alarm', 'notification', 'megaphone'], lock: ['key', 'shield', 'unlock'], key: ['lock', 'shield'], shield: ['lock', 'badgecheck'], check: ['circlecheck', 'badgecheck', 'squarecheck'], chevron: ['arrow', 'caret'], arrow: ['chevron', 'move'], plus: ['circleplus', 'squareplus'], calendar: ['clock', 'alarm'], clock: ['timer', 'watch', 'calendar'], phone: ['smartphone', 'call'], camera: ['image', 'video', 'aperture'], image: ['camera', 'picture', 'gallery'], file: ['document', 'folder', 'clipboard'], folder: ['file', 'archive'], chart: ['graph', 'trendingup', 'activity'], globe: ['earth', 'map', 'languages'], sparkles: ['wand', 'star', 'zap'], zap: ['bolt', 'flash', 'sparkles'] };
  function similarIcons(name, only, limit = 36) {
    const wordsOf = (n) => String(n || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Za-z])([0-9])/g, '$1 $2').toLowerCase().split(/\s+/).filter(Boolean);
    // Shape and style words ("round", "square", "2") describe how an icon looks, not what it means.
    const STYLE = new Set(['round', 'square', 'circle', 'minimal', 'off', 'dashed', 'filled', 'simple', 'alt', 'line', 'small', 'big', 'up', 'down', 'left', 'right', '2', '3', '4']);
    const all = wordsOf(name).filter((w) => w.length > 1 || w === 'x');
    const own = all.filter((w) => !STYLE.has(w)).length ? all.filter((w) => !STYLE.has(w)) : all;
    const terms = [...new Set([...own, ...own.flatMap((w) => RELATED[w] || [])])];
    // Whole words only (so "tv" doesn't match "SplitVertical"); longer terms may match the start of a word.
    const hit = (n) => { const ws = wordsOf(n); let best = 99; terms.forEach((t, rank) => { if (ws.some((w) => w === t || (t.length >= 4 && w.startsWith(t)))) best = Math.min(best, rank); }); return best; };
    const out = [];
    for (const [lib, set] of Object.entries(iconLibs())) {
      if (only && lib !== only) continue;
      for (const n of set) { if (n === name) continue; const r = hit(n); if (r < 99) out.push({ name: n, lib, r }); }
    }
    return out.sort((a, b) => a.r - b.r || a.name.length - b.name.length).slice(0, limit).map(({ name, lib }) => ({ name, lib }));
  }

  /* uploads go to public/kerf/ so they're served as /kerf/<name> */
  const uploadDir = path.join(webRoot, 'public', 'kerf');
  function saveUpload(name, base64) {
    const ext = (String(name).match(/\.(png|jpe?g|gif|webp|svg|avif)$/i) || [])[1];
    if (!ext) throw new Error('Upload an image: PNG, JPG, GIF, WebP, SVG or AVIF.');
    const buf = Buffer.from(String(base64), 'base64');
    if (buf.length > 10 * 1024 * 1024) throw new Error('Images must be under 10 MB.');
    fs.mkdirSync(uploadDir, { recursive: true });
    const base = path.basename(name, path.extname(name)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
    let file = `${base}.${ext.toLowerCase()}`, i = 2;
    while (fs.existsSync(path.join(uploadDir, file))) file = `${base}-${i++}.${ext.toLowerCase()}`;
    fs.writeFileSync(path.join(uploadDir, file), buf);
    return { src: `/kerf/${file}`, file: path.relative(webRoot, path.join(uploadDir, file)) };
  }
  function uploads() {
    if (!fs.existsSync(uploadDir)) return [];
    return fs.readdirSync(uploadDir).filter((f) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(f)).map((f) => `/kerf/${f}`);
  }

  return { iconLibs, findIcon, searchIcons, usedIcons, similarIcons, componentList, importPath, saveUpload, uploads };
}
