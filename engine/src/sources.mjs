// Where an element's classes really come from when they aren't one string on the element:
// style tables (STATUS_STYLES[status]), constants, if/else branches, class objects,
// and CSS classes built with @apply. Kerf edits the style where it lives, the way a developer would.
import fs from 'node:fs';
import path from 'node:path';
import { parseCode } from './ast.mjs';

const CLASS_FNS = new Set(['cn', 'clsx', 'cx', 'twMerge', 'twJoin', 'classNames', 'classnames']);
const split = (s) => String(s || '').split(/\s+/).filter(Boolean);
const WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression', 'TSTypeAssertion']);
const unwrap = (n) => { while (n && WRAPPERS.has(n.type)) n = n.expression; return n; };
const keyName = (p) => (p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : p.key.type === 'NumericLiteral' ? String(p.key.value) : null);

function lit(n) {
  n = unwrap(n);
  if (!n) return null;
  if (n.type === 'StringLiteral') return { start: n.start + 1, end: n.end - 1, value: n.value };
  if (n.type === 'TemplateLiteral' && !n.expressions.length) return { start: n.quasis[0].start, end: n.quasis[0].end, value: n.quasis[0].value.raw };
  return null;
}

// Files are parsed once per change on disk.
const cache = new Map();
function parsed(file) {
  const m = fs.statSync(file).mtimeMs;
  const c = cache.get(file);
  if (c && c.m === m) return c;
  const code = fs.readFileSync(file, 'utf8');
  const v = { m, code, ast: parseCode(code, { file }) };
  cache.set(file, v);
  return v;
}

const srcRoot = (webRoot) => (fs.existsSync(path.join(webRoot, 'src')) ? path.join(webRoot, 'src') : webRoot);
const inside = (f, webRoot) => f.startsWith(path.resolve(webRoot) + path.sep) && !/[\\/](node_modules|\.next|dist|build|out)[\\/]/.test(f.slice(path.resolve(webRoot).length));

function resolveImport(fromFile, spec, webRoot) {
  let base;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec.startsWith('@/') || spec.startsWith('~/')) base = path.join(srcRoot(webRoot), spec.slice(2));
  else return null;
  const tries = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs'].map((e) => base + e), ...['ts', 'tsx', 'js', 'jsx'].map((e) => path.join(base, `index.${e}`))];
  return tries.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}

// What a name is bound to: a top-level const or function in this file, or an import (followed).
export function binding(file, name, webRoot, depth = 0) {
  if (depth > 4 || !inside(file, webRoot)) return null;
  let ast;
  try { ({ ast } = parsed(file)); } catch { return null; }
  for (const st of ast.program.body) {
    const decl = st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration' ? st.declaration : st;
    if (decl?.type === 'VariableDeclaration') {
      for (const d of decl.declarations) if (d.id.type === 'Identifier' && d.id.name === name && d.init) return { file, name, init: unwrap(d.init) };
    }
    if (decl?.type === 'FunctionDeclaration' && decl.id?.name === name) return { file, name, init: decl };
    if (st.type === 'ImportDeclaration') {
      for (const sp of st.specifiers) {
        if (sp.local.name !== name || sp.type !== 'ImportSpecifier') continue;
        const target = resolveImport(file, st.source.value, webRoot);
        return target ? binding(target, sp.imported.name ?? sp.imported.value, webRoot, depth + 1) : null;
      }
    }
    // export { NAME } from './somewhere'
    if (st.type === 'ExportNamedDeclaration' && st.source) {
      for (const sp of st.specifiers) {
        if ((sp.exported.name ?? sp.exported.value) !== name) continue;
        const target = resolveImport(file, st.source.value, webRoot);
        return target ? binding(target, sp.local.name ?? sp.local.value, webRoot, depth + 1) : null;
      }
    }
  }
  return null;
}

// How many of the app's files mention a name (a rough "used in N places").
const usageCache = new Map();
function codeFiles(webRoot) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || ['node_modules', 'dist', 'build', 'out', 'public'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.[jt]sx?$/.test(e.name) && !/\.(test|spec|stories)\./.test(e.name)) out.push(p);
    }
  };
  walk(srcRoot(webRoot));
  return out;
}
export function usage(name, webRoot, defFile) {
  const k = `${webRoot}|${name}`;
  const c = usageCache.get(k);
  if (c && Date.now() - c.at < 5000) return c.n;
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\b`);
  let n = 0;
  for (const f of codeFiles(webRoot)) {
    if (f === defFile) continue;
    try { if (re.test(fs.readFileSync(f, 'utf8'))) n++; } catch {}
  }
  usageCache.set(k, { n, at: Date.now() });
  return n;
}

// Does this class function resolve Tailwind conflicts (twMerge)? Then a later class wins.
function merges(file, fn, webRoot) {
  if (fn === 'twMerge') return true;
  const b = binding(file, fn, webRoot);
  if (!b) return false;
  try { return parsed(b.file).code.slice(b.init.start, b.init.end).includes('twMerge'); } catch { return false; }
}

// CSS classes made with @apply, e.g. `.chip { @apply rounded-full border … }`.
export function cssFiles(webRoot) {
  const out = [];
  const walk = (d, depth) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || ['node_modules', 'dist', 'build', 'out', 'public'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 6) walk(p, depth + 1);
      else if (/\.(css|pcss|postcss)$/.test(e.name)) out.push(p);
    }
  };
  walk(webRoot, 0);
  return out;
}
export function applyRules(webRoot) {
  const rules = new Map();
  for (const file of cssFiles(webRoot)) {
    const code = fs.readFileSync(file, 'utf8');
    const re = /(^|[\s,}])\.([A-Za-z_][\w-]*)\s*\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(code))) {
      const body = m[3], bodyStart = m.index + m[0].length - 1 - body.length;
      const a = body.match(/@apply\s+([^;]+);/);
      if (!a || rules.has(m[2])) continue;
      const start = bodyStart + a.index + a[0].indexOf(a[1]);
      rules.set(m[2], { kind: 'css', name: m[2], file, start, end: start + a[1].length, value: a[1] });
    }
  }
  return rules;
}

// All the places that feed this className, in the order they apply.
//   dom: the element's real classes in the page, used to tell which table entry or branch is active.
export function classSources(file, expr, { webRoot, dom = [] }) {
  const domSet = new Set(dom);
  const score = (v) => { const c = split(v).filter((x) => !x.includes(':')); return c.length && dom.length ? c.filter((x) => domSet.has(x)).length / c.length : null; };
  const parts = [];
  const unknown = [];
  let call = null;
  let merge = false;
  const code = parsed(file).code;
  const add = (p) => parts.push({ ...p, order: parts.length });
  const visit = (n, branch) => {
    n = unwrap(n);
    if (!n) return;
    const l = lit(n);
    if (l) { add({ kind: branch ? 'branch' : 'literal', file, ...l, active: branch ? (score(l.value) ?? 0) >= 0.5 : true }); return; }
    if (n.type === 'TemplateLiteral') {
      n.quasis.forEach((q) => { if (q.value.raw.trim()) add({ kind: 'literal', file, start: q.start, end: q.end, value: q.value.raw, active: true }); });
      n.expressions.forEach((e) => visit(e, branch));
      return;
    }
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && CLASS_FNS.has(n.callee.name)) {
      if (!call) call = n;
      if (merges(file, n.callee.name, webRoot)) merge = true;
      n.arguments.forEach((a) => visit(a, branch));
      return;
    }
    if (n.type === 'ConditionalExpression') { visit(n.consequent, true); visit(n.alternate, true); return; }
    if (n.type === 'LogicalExpression') { if (n.operator !== '&&') visit(n.left, branch); visit(n.right, true); return; }
    if (n.type === 'ArrayExpression') { n.elements.forEach((e) => visit(e, branch)); return; }
    if (n.type === 'ObjectExpression') {
      for (const p of n.properties) {
        if (p.type !== 'ObjectProperty' || p.key.type !== 'StringLiteral') continue;
        add({ kind: 'branch', file, start: p.key.start + 1, end: p.key.end - 1, value: p.key.value, active: (score(p.key.value) ?? 0) >= 0.5 });
      }
      return;
    }
    if (n.type === 'MemberExpression' && n.object.type === 'Identifier') {
      const b = binding(file, n.object.name, webRoot);
      const obj = b && unwrap(b.init);
      if (obj?.type === 'ObjectExpression') {
        const entries = obj.properties.filter((p) => p.type === 'ObjectProperty').map((p) => ({ key: keyName(p), ...lit(p.value) })).filter((e) => e.key != null && e.value != null);
        if (entries.length) {
          const fixed = !n.computed && n.property.type === 'Identifier' ? n.property.name : n.property.type === 'StringLiteral' ? n.property.value : null;
          let key = fixed;
          if (key == null && dom.length) {
            const best = entries.map((e) => [e, score(e.value) || 0]).sort((a, b) => b[1] - a[1])[0];
            if (best && best[1] >= 0.5) key = best[0].key;
          }
          add({ kind: 'table', file: b.file, name: n.object.name, entries, key, active: key != null, usedIn: usage(n.object.name, webRoot, b.file) });
          return;
        }
      }
      unknown.push(code.slice(n.start, n.end));
      return;
    }
    if (n.type === 'Identifier') {
      const b = binding(file, n.name, webRoot);
      const v = b && lit(b.init);
      if (v) { add({ kind: 'const', file: b.file, name: n.name, ...v, active: true, usedIn: usage(n.name, webRoot, b.file) }); return; }
    }
    unknown.push(code.slice(n.start, n.end));
  };
  visit(expr, false);

  // CSS classes used here that are built with @apply sit underneath everything (component layer).
  const rules = applyRules(webRoot);
  const words = new Set([...parts.flatMap((p) => (p.kind === 'table' ? split(p.entries.find((e) => e.key === p.key)?.value) : p.active ? split(p.value) : [])), ...dom]);
  const css = [...words].filter((w) => rules.has(w)).map((w) => ({ ...rules.get(w), active: true, usedIn: usage(w, webRoot) }));
  return { parts: [...css.map((c) => ({ ...c, order: -1 })), ...parts], merge, call, unknown };
}

// The class string a part contributes right now ({file,start,end,value}), or null.
export function activeLit(p) {
  if (p.kind === 'table') { const e = p.entries.find((x) => x.key === p.key); return e ? { ...e, file: p.file } : null; }
  return p.active ? p : null;
}

// Plain words for where a style lives.
export function sourceLabel(p, key) {
  const f = p.file ? p.file.split(path.sep).slice(-2).join('/') : '';
  if (p.kind === 'table') return `${p.name}${key === '*' ? ' (every entry)' : ` “${key ?? p.key}”`} in ${f}`;
  if (p.kind === 'const') return `${p.name} in ${f}`;
  if (p.kind === 'css') return `.${p.name} class in ${f}`;
  return 'this element';
}

// Short summary for the editor and the AI.
export function describeSources(src, webRoot) {
  const rel = (f) => path.relative(webRoot, f).split(path.sep).join('/');
  return src.parts.map((p) => {
    const base = { kind: p.kind, file: rel(p.file), usedIn: p.usedIn ?? 0 };
    if (p.kind === 'table') return { ...base, name: p.name, key: p.key, entries: p.entries.map((e) => ({ key: e.key, value: e.value })) };
    if (p.kind === 'css' || p.kind === 'const') return { ...base, name: p.name, value: p.value };
    return { ...base, value: p.value, active: p.active };
  });
}
