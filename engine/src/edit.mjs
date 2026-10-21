// Find the JSX element behind a clicked DOM node and change it the way a
// developer would: only the class string or text that needs to change.
import fs from 'node:fs';
import path from 'node:path';
import MagicString from 'magic-string';
import { parseCode, walk } from './ast.mjs';
import { applyOps, isOffScale, matcher } from './tailwind.mjs';
import { findCvas, cvaIn, cvaTargets } from './cva.mjs';
import { propsInfo, applyProps } from './props.mjs';
import { structureEdit } from './structure.mjs';
import { summaryLabels } from './labels.mjs';
import { classSources, activeLit, sourceLabel, describeSources } from './sources.mjs';

export class KerfError extends Error {}

const CLASS_FNS = new Set(['cn', 'clsx', 'cx', 'twMerge', 'twJoin', 'classNames', 'classnames']);

// "src/components/ui/card.tsx:6:4" → { file, line, col }
export function parseLoc(loc, webRoot) {
  const m = String(loc).match(/^(.+):(\d+):(\d+)$/);
  if (!m) throw new KerfError(`Bad location: ${loc}`);
  const file = path.resolve(webRoot, m[1]);
  const inside = file.startsWith(path.resolve(webRoot) + path.sep) && !/[\\/](node_modules|\.next|\.git|dist|build|out)[\\/]/.test(file.slice(path.resolve(webRoot).length));
  if (!inside || !/\.[jt]sx$/.test(file)) throw new KerfError('Tovi only edits your app’s own .jsx and .tsx files.');
  return { rel: m[1], file, line: +m[2], col: +m[3] };
}

export function findElement(code, line, col) {
  const ast = parseCode(code);
  let found = null;
  walk(ast.program, (n) => {
    if (n.type === 'JSXElement' && n.openingElement.loc.start.line === line && n.openingElement.loc.start.column === col) found = n;
  });
  return found;
}

// The JSX element directly around this one, if it is in the same file.
function parentElement(code, el) {
  let parent = null;
  walk(parseCode(code).program, (n) => {
    if (n.type === 'JSXElement' && n.children.some((c) => c.start === el.start && c.end === el.end)) parent = n;
  });
  return parent;
}
// Figma’s "Fill" along a flex parent’s direction means “take the remaining space”.
function fillFor(code, el, ops, cvas) {
  if (!ops.some((o) => (o.prop === 'w' || o.prop === 'h') && o.value === 'fill')) return ops;
  const p = parentElement(code, el);
  const pc = p ? classInfo(p, cvas).classes : [];
  const flex = pc.includes('flex') || pc.includes('inline-flex');
  const col = pc.includes('flex-col') || pc.includes('flex-col-reverse');
  return ops.map((o) => (o.value === 'fill' && flex && ((o.prop === 'w' && !col) || (o.prop === 'h' && col)) ? { ...o, value: 'grow' } : o));
}

function literal(n) {
  if (!n) return null;
  if (n.type === 'StringLiteral') return { start: n.start + 1, end: n.end - 1, value: n.value };
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) {
    const q = n.quasis[0];
    return { start: q.start, end: q.end, value: q.value.raw };
  }
  return null;
}

// Where this element's classes live, and whether Tovi can safely rewrite them.
export function classInfo(el, cvas) {
  const open = el.openingElement;
  const attr = open.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === 'className');
  if (!attr) return { kind: 'none', insertAt: open.name.end, classes: [] };
  const v = attr.value;
  const direct = literal(v) || (v.type === 'JSXExpressionContainer' && literal(v.expression));
  if (direct) return { kind: 'string', ...direct, classes: split(direct.value) };
  if (v.type === 'JSXExpressionContainer') {
    const e = v.expression;
    // Variant components: the styles live in a cva() call in this file.
    const cv = cvas && cvaIn(e, cvas);
    if (cv) {
      const classes = [cv.base?.value || '', ...Object.entries(cv.groups).map(([g, vals]) => vals[cv.defaults[g]]?.value || '')].join(' ');
      return { kind: 'cva', entry: cv, classes: split(classes) };
    }
    if (e.type === 'CallExpression' && e.callee.type === 'Identifier' && CLASS_FNS.has(e.callee.name)) {
      const s = e.arguments.map(literal).find(Boolean);
      if (s) return { kind: 'call', fn: e.callee.name, ...s, classes: split(s.value) };
      return { kind: 'call-empty', fn: e.callee.name, insertAt: e.arguments.length ? e.arguments[0].start : e.end - 1, hasArgs: e.arguments.length > 0, classes: [] };
    }
  }
  return { kind: 'dynamic', classes: [], reason: 'Its classes are computed by code, so Tovi can’t change them safely here.' };
}

const split = (s) => s.split(/\s+/).filter(Boolean);

/* ---------- styles that live outside the element ---------- */
const SOURCED = new Set(['table', 'const', 'branch']);
// If this element's classes come (partly) from a table, a constant or an if/else, the sources; else null.
export function sourcedInfo(code, el, { file, webRoot, dom } = {}) {
  if (!file || !webRoot) return null;
  const attr = el.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === 'className');
  if (!attr || attr.value?.type !== 'JSXExpressionContainer') return null;
  const ci = classInfo(el, findCvas(code));
  if (ci.kind === 'string' || ci.kind === 'cva') return null;
  let src;
  try { src = classSources(file, attr.value.expression, { webRoot, dom }); } catch { return null; }
  if (!src.parts.some((p) => SOURCED.has(p.kind))) return null;
  return { ...src, expr: attr.value.expression };
}

// A target the AI or the panel can name: "element", "table:NAME:KEY" ("*" = every entry), "css:NAME", "const:NAME".
function parseTarget(t) {
  const m = String(t || '').match(/^(element|table|css|const)(?::([^:]+))?(?::(.+))?$/);
  return m ? { kind: m[1], name: m[2] || null, key: m[3] ?? null } : null;
}
export function sourceTargets(src) {
  const out = ['element'];
  for (const p of src.parts) {
    if (p.kind === 'table') out.push(`table:${p.name}:*`, ...p.entries.map((e) => `table:${p.name}:${e.key}`));
    if (p.kind === 'css' || p.kind === 'const') out.push(`${p.kind}:${p.name}`);
  }
  return [...new Set(out)];
}

// Change styles where they live.
//   scope "key" (default): where the property is set now, e.g. the "verified" entry of a style table
//   scope "all": every entry of that table          scope "here": only this element
//   target (AI): an explicit place from sourceTargets().
export function editSourced({ file, code, src, ops, theme, scope = 'key', target = null, bp = null }) {
  const run = (list, op) => (bp && (bp.mode === 'all' || bp.mode === 'only') && theme.screens?.length ? applyResponsive(list, [op], theme, bp) : applyOps(list, [op], theme));
  const writes = new Map();
  const summary = { added: [], removed: [], changes: [], offScale: [], text: null, props: [], where: [] };
  const own = src.parts.filter((p) => p.kind === 'literal' && p.file === file && p.active);
  const t = parseTarget(target);
  const dest = (l, label) => {
    const id = l.new ? 'new' : `${l.file}:${l.start}`;
    if (!writes.has(id)) writes.set(id, { ...l, classes: l.new ? [] : split(l.value) });
    if (!summary.where.includes(label)) summary.where.push(label);
    return writes.get(id);
  };
  for (const op of ops) {
    const m = matcher(op.prop, theme);
    const owns = (v) => split(v).some((c) => !c.includes(':') && m(c));
    const owners = src.parts.map((p) => ({ p, l: activeLit(p) })).filter((x) => x.l && owns(x.l.value));
    const owner = owners[owners.length - 1] || null;
    const places = [];
    const table = (name) => src.parts.find((p) => p.kind === 'table' && p.name === name);
    if (t?.kind === 'table' || (!t && scope === 'all' && owner?.p.kind === 'table')) {
      const tp = table(t?.name || owner.p.name);
      if (!tp) throw new KerfError(`Tovi couldn’t find the style table ${t?.name}.`);
      const key = t ? t.key : '*';
      const keys = key === '*' ? tp.entries.map((e) => e.key) : [key];
      for (const k of keys) {
        const e = tp.entries.find((x) => x.key === k);
        if (!e) throw new KerfError(`${tp.name} has no “${k}” entry.`);
        places.push([{ ...e, file: tp.file }, sourceLabel(tp, key === '*' ? '*' : k)]);
      }
    } else if (t?.kind === 'css' || t?.kind === 'const') {
      const p = src.parts.find((x) => x.kind === t.kind && x.name === t.name);
      if (!p) throw new KerfError(`Tovi couldn’t find ${t.kind === 'css' ? '.' : ''}${t.name}.`);
      places.push([p, sourceLabel(p)]);
    } else if (owner && t?.kind !== 'element' && scope !== 'here') {
      places.push([owner.l, owner.p.kind === 'literal' || owner.p.kind === 'branch' ? 'this element' : sourceLabel(owner.p)]);
    } else {
      // Only this element: its own class string, placed after whatever sets the property now.
      if (owner && owner.p.kind !== 'literal' && owner.p.kind !== 'css' && !src.merge) {
        throw new KerfError(`This style comes from ${sourceLabel(owner.p)}, and this element’s classes aren’t merged with tailwind-merge, so Tovi can only change it there (for every element that uses it).`);
      }
      const after = owner && owner.p.kind !== 'css' ? owner.p.order : -Infinity;
      const mine = owner && owner.p.kind === 'literal' ? owner.l : [...own].reverse().find((p) => p.order > after);
      places.push([mine || { new: true, file }, 'this element']);
    }
    places.forEach(([l, label], i) => {
      const w = dest(l, label);
      const r = run(w.classes, op);
      w.classes = r.classes;
      summary.added.push(...r.added);
      summary.removed.push(...r.removed);
      if (i === 0) summary.changes.push(...r.changes);
    });
  }
  summary.offScale = summary.added.filter(isOffScale);
  // Write each file once.
  const files = new Map();
  const ms = (f) => {
    if (!files.has(f)) files.set(f, { s: new MagicString(f === file ? code : fs.readFileSync(f, 'utf8')) });
    return files.get(f).s;
  };
  for (const w of writes.values()) {
    const text = w.classes.join(' ');
    if (w.new) {
      if (!text) continue;
      const s = ms(file), e = src.expr;
      // Right after the last argument, so a trailing comma (cn(a, b,)) stays valid.
      if (src.call) {
        const args = src.call.arguments, last = args[args.length - 1];
        if (!last) s.appendLeft(src.call.end - 1, `'${text}'`);
        else {
          // Arguments on their own lines get the new one on its own line too, at the same indent.
          const lineStart = code.lastIndexOf('\n', last.start - 1) + 1, indent = code.slice(lineStart, last.start);
          const multiline = code.slice(src.call.start, last.start).includes('\n') && /^\s*$/.test(indent);
          s.appendLeft(last.end, multiline ? `,\n${indent}'${text}'` : `, '${text}'`);
        }
      }
      else if (e.type === 'TemplateLiteral') s.appendLeft(e.end - 1, ` ${text}`);
      else s.overwrite(e.start, e.end, `\`\${${code.slice(e.start, e.end)}} ${text}\``);
      continue;
    }
    const lead = w.value.match(/^\s*/)[0], trail = w.value.match(/\s*$/)[0];
    ms(w.file).overwrite(w.start, w.end, lead + text + trail);
  }
  const out = new Map();
  for (const [f, { s }] of files) {
    const next = s.toString();
    if (/\.[cm]?[jt]sx?$/.test(f)) {
      try { parseCode(next, { strict: true, file: f }); } catch (e) { throw new KerfError(`Tovi stopped: the change would break ${path.basename(f)} (${e.message}).`); }
    }
    out.set(f, next);
  }
  return { files: out, summary };
}

// Text Tovi may retype: one fixed string, not data or an expression.
export function textInfo(el) {
  const isComment = (c) => c.type === 'JSXExpressionContainer' && c.expression.type === 'JSXEmptyExpression';
  const kids = el.children.filter((c) => !(c.type === 'JSXText' && !c.value.trim()) && !isComment(c));
  // A label next to icons (<button><Icon/> Enter</button>) is still one fixed string.
  const texts = kids.filter((c) => c.type === 'JSXText');
  const dynamic = kids.some((c) => c.type === 'JSXExpressionContainer');
  if (kids.length > 1 && texts.length === 1 && !dynamic) return { editable: true, value: texts[0].value.trim(), node: texts[0], kind: 'text' };
  if (kids.length !== 1) return { editable: false, reason: kids.length ? 'This element contains other elements or several pieces of text.' : 'This element has no text.' };
  const k = kids[0];
  if (k.type === 'JSXText') return { editable: true, value: k.value.trim(), node: k, kind: 'text' };
  if (k.type === 'JSXExpressionContainer' && k.expression.type === 'StringLiteral') return { editable: true, value: k.expression.value, node: k, kind: 'expr' };
  return { editable: false, reason: 'This text comes from data or code, not a fixed string. Change it in the data, or ask a developer.' };
}

export function describe(code, line, col, ctx = {}) {
  const el = findElement(code, line, col);
  if (!el) throw new KerfError('Element not found. The file may have changed; reload and try again.');
  const ci = classInfo(el, findCvas(code));
  const ti = textInfo(el);
  const name = el.openingElement.name;
  const tag = name.type === 'JSXIdentifier' ? name.name : code.slice(name.start, name.end);
  return {
    tag,
    snippet: code.slice(el.openingElement.start, el.openingElement.end),
    classes: ci.classes,
    classKind: ci.kind,
    classReason: ci.reason,
    cva: ci.kind === 'cva' ? { name: ci.entry.name, groups: Object.fromEntries(Object.entries(ci.entry.groups).map(([g, v]) => [g, Object.keys(v)])), defaults: ci.entry.defaults } : undefined,
    text: ti.editable ? { editable: true, value: ti.value } : { editable: false, reason: ti.reason },
    ...propsInfo(code, el),
    sized: sizedProps(ci.classes, ctx.theme),
    ...sourcedDescribe(code, el, ctx),
  };
}
// Properties set differently per screen size (md:text-lg…), so the panel can mark them, like Framer's overrides.
const SIZED_PROPS = ['bg', 'color', 'borderC', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'align', 'radius', 'padX', 'padY', 'mX', 'mY', 'gap', 'borderW', 'opacity', 'shadow', 'w', 'h', 'layout', 'alignItems', 'justify'];
function sizedProps(classes, theme) {
  const screens = new Set((theme?.screens || []).map((x) => x.name));
  const rest = (classes || []).map((c) => c.match(/^([\w-]+):([^:]+)$/)).filter((m) => m && screens.has(m[1])).map((m) => m[2]);
  if (!rest.length) return [];
  return SIZED_PROPS.filter((p) => { try { const m = matcher(p, theme); return rest.some((c) => m(c)); } catch { return false; } });
}
function sourcedDescribe(code, el, ctx) {
  const src = sourcedInfo(code, el, ctx);
  if (!src) return {};
  const classes = [...new Set(src.parts.flatMap((p) => { const l = activeLit(p); return l ? split(l.value) : []; }))];
  return { classKind: 'sourced', classes, classReason: null, sources: describeSources(src, ctx.webRoot), targets: sourceTargets(src), merge: src.merge };
}

// Edits per screen size, the mobile-first Tailwind way (md:, lg:…).
//   bp.mode "all":  one value everywhere: set the base class and drop size overrides of that property.
//   bp.mode "only": only between bp.start and bp.end (screen names; null = from 0 / no end). The old value
//                   is kept from bp.end up, so the change doesn't spill into bigger screens.
export function applyResponsive(list, ops, th, bp) {
  const order = (th.screens || []).map((x) => x.name);
  const rank = (n) => (n == null ? -1 : order.indexOf(n));
  const parse = (c) => { const m = c.match(/^([\w-]+):([^:]+)$/); return m && order.includes(m[1]) ? { bp: m[1], cls: m[2] } : null; };
  let classes = list.slice();
  const summary = { added: [], removed: [], changes: [] };
  const s = bp.mode === 'only' ? (order.includes(bp.start) ? bp.start : null) : null;
  const e = bp.mode === 'only' && order.includes(bp.end) ? bp.end : null;
  for (const op of ops) {
    const m = matcher(op.prop, th);
    const at = (lvl) => classes.filter((c) => (lvl == null ? !c.includes(':') : parse(c)?.bp === lvl)).map((c) => (lvl == null ? c : parse(c).cls));
    // What applies at the end screen today (largest level at or below it that sets this property).
    let oldAtEnd = [];
    if (e) for (const lvl of [null, ...order.slice(0, rank(e) + 1)]) { const hit = at(lvl).filter(m); if (hit.length) oldAtEnd = hit; }
    // Overrides that would fight the new value inside the range (or everywhere, for "all").
    const lo = bp.mode === 'all' ? -1 : rank(s), hi = bp.mode === 'all' ? Infinity : e ? rank(e) : Infinity;
    classes = classes.filter((c) => { const p = parse(c); if (p && rank(p.bp) > lo && rank(p.bp) < hi && m(p.cls)) { summary.removed.push(c); return false; } return true; });
    // Apply the op at the start level.
    const levelCls = at(s);
    const r = applyOps(levelCls, [op], th);
    const pre = (c) => (s == null ? c : `${s}:${c}`);
    const keep = new Set(r.classes);
    const gone = levelCls.filter((c) => !keep.has(c)).map(pre), fresh = r.classes.filter((c) => !levelCls.includes(c)).map(pre);
    classes = classes.filter((c) => !gone.includes(c));
    classes.push(...fresh);
    summary.removed.push(...gone);
    summary.added.push(...fresh);
    summary.changes.push(...r.changes);
    // Keep the old value from the end screen up.
    if (e && !at(e).some(m) && oldAtEnd.length && fresh.length) {
      const back = oldAtEnd.map((c) => `${e}:${c}`);
      classes.push(...back);
      summary.added.push(...back);
    }
  }
  return { classes, ...summary };
}

// Apply class ops and/or a text change to one element. Returns the new code and a summary.
export function editElement(code, line, col, { ops = [], text, props = [], cva, bp } = {}, theme) {
  const el = findElement(code, line, col);
  if (!el) throw new KerfError('Element not found. The file may have changed; reload and try again.');
  const s = new MagicString(code);
  const summary = { added: [], removed: [], offScale: [], text: null, props: [] };

  if (props.length) {
    try {
      summary.props = applyProps(s, code, el, props);
    } catch (e) {
      throw new KerfError(e.message);
    }
  }

  if (ops.length) {
    const ci = classInfo(el, findCvas(code));
    if (ci.kind === 'dynamic') throw new KerfError(ci.reason);
    ops = fillFor(code, el, ops, findCvas(code));
    if (ci.kind === 'cva') {
      // Edit the base string (every variant) or the active variant's string.
      const strings = new Map();
      const changes = [];
      for (const op of ops) {
        const targets = cvaTargets(ci.entry, op.prop, cva?.mode === 'variant' ? 'variant' : 'all', cva?.active, matcher(op.prop, theme));
        targets.forEach((l, i) => {
          const id = l.compound ? `compound:${l.group}:${l.key}` : l.start;
          const cur = strings.get(id) || { l, classes: l.compound ? [] : split(l.value) };
          const r = applyOps(cur.classes, [op], theme);
          cur.classes = r.classes;
          strings.set(id, cur);
          summary.added.push(...r.added);
          summary.removed.push(...r.removed);
          if (i === 0) changes.push(...r.changes);
        });
      }
      for (const { l, classes } of strings.values()) {
        if (!l.compound) { s.overwrite(l.start, l.end, classes.join(' ')); continue; }
        // Add a compound variant: { variant: 'ghost', class: '…' }.
        const item = `{ ${l.group}: '${l.key}', class: '${classes.join(' ')}' }`;
        const arr = l.entry.compoundArr, cfg = l.entry.cfg;
        if (arr) {
          const last = arr.elements[arr.elements.length - 1];
          if (last) s.appendLeft(last.end, `, ${item}`); else s.appendLeft(arr.start + 1, item);
        } else if (cfg) {
          const lastProp = cfg.properties[cfg.properties.length - 1];
          const ind = (code.slice(code.lastIndexOf('\n', lastProp.start) + 1, lastProp.start).match(/^\s*/) || [''])[0];
          // After the trailing comma if there is one, otherwise add the comma ourselves.
          const ci = code.indexOf(',', lastProp.end);
          const hasComma = ci > -1 && ci < cfg.end - 1 && !code.slice(lastProp.end, ci).trim();
          if (hasComma) s.appendLeft(ci + 1, `\n${ind}compoundVariants: [${item}],`);
          else s.appendLeft(lastProp.end, `,\n${ind}compoundVariants: [${item}]`);
        }
      }
      summary.changes = changes;
      summary.offScale = summary.added.filter(isOffScale);
      summary.scope = cva?.mode === 'variant' ? 'variant' : 'all';
    }
    const responsive = bp && (bp.mode === 'all' || bp.mode === 'only') && theme.screens?.length;
    const r = ci.kind === 'cva' ? null : responsive ? applyResponsive(ci.classes, ops, theme, bp) : applyOps(ci.classes, ops, theme);
    if (r && responsive && bp.label && (bp.mode === 'only' || r.removed.some((c) => c.includes(':')))) summary.size = bp.label;
    if (r) {
    const next = r.classes.join(' ');
    if (ci.kind === 'string' || ci.kind === 'call') {
      if (ci.start === ci.end) s.appendLeft(ci.start, next);
      else s.overwrite(ci.start, ci.end, next);
    } else if (ci.kind === 'none') s.appendLeft(ci.insertAt, ` className="${next}"`);
    else if (ci.kind === 'call-empty') s.appendLeft(ci.insertAt, ci.hasArgs ? `'${next}', ` : `'${next}'`);
    summary.added = r.added;
    summary.removed = r.removed;
    summary.changes = r.changes;
    summary.offScale = r.added.filter(isOffScale);
    }
  }

  if (text != null) {
    const ti = textInfo(el);
    if (!ti.editable) throw new KerfError(ti.reason);
    const value = String(text).trim();
    if (!value) throw new KerfError('Text can’t be empty.');
    if (ti.kind === 'text') {
      const lead = ti.node.value.match(/^\s*/)[0];
      const trail = ti.node.value.match(/\s*$/)[0];
      const safe = /[{}<>]/.test(value) ? `{${JSON.stringify(value)}}` : value;
      s.overwrite(ti.node.start, ti.node.end, lead + safe + trail);
    } else s.overwrite(ti.node.start, ti.node.end, `{${JSON.stringify(value)}}`);
    summary.text = { from: ti.value, to: value };
  }

  const out = s.toString();
  try {
    parseCode(out, { strict: true });
  } catch (e) {
    throw new KerfError(`Tovi stopped: the change would break the file (${e.message}).`);
  }
  return { code: out, summary };
}

// File-level wrapper with an undo history, used by the dev server.
export function createEditor(webRoot, getTheme, library) {
  const history = [];
  // more: other files changed by the same edit (e.g. a style table in lib/format.ts); one undo covers all.
  const record = (file, rel, before, code, loc, change, summary, more = []) => {
    summary.labels = summaryLabels(summary);
    fs.writeFileSync(file, code);
    for (const m of more) fs.writeFileSync(m.file, m.after);
    history.push({ file, rel, before, after: code, loc, change, summary, source: change.source || 'hand', at: Date.now(), ...(more.length ? { more } : {}) });
    return { file: rel, changed: true, summary, n: history.length, files: [rel, ...more.map((m) => path.relative(webRoot, m.file))] };
  };
  // Several files: the first changed one is the entry's main file.
  const recordFiles = (files, loc, change, summary) => {
    const list = [...files].map(([f, after]) => ({ file: f, before: fs.readFileSync(f, 'utf8'), after })).filter((x) => x.before !== x.after);
    if (!list.length) return null;
    const [main, ...more] = list;
    return record(main.file, path.relative(webRoot, main.file).split(path.sep).join('/'), main.before, main.after, loc, change, summary, more);
  };
  return {
    history,
    // Delete, duplicate, move, swap, insert, image.
    structure(loc, op, source, name) {
      const { rel, file, line, col } = parseLoc(loc, webRoot);
      const before = fs.readFileSync(file, 'utf8');
      const { code, summary, moved, shift } = structureEdit(before, line, col, op, { file, library });
      if (code === before) return { file: rel, changed: false, summary };
      return { ...record(file, rel, before, code, loc, { structure: op, source, name }, summary), moved: (moved || []).map(([a, b]) => [`${rel}:${a}`, `${rel}:${b}`]), shift: shift ? { file: rel, ...shift } : null };
    },
    describe(loc, dom) {
      const { rel, file, line, col } = parseLoc(loc, webRoot);
      return { file: rel, line, ...describe(fs.readFileSync(file, 'utf8'), line, col, { file, webRoot, dom, theme: getTheme() }) };
    },
    edit(loc, change) {
      const { rel, file, line, col } = parseLoc(loc, webRoot);
      const before = fs.readFileSync(file, 'utf8');
      // Styles that live in a table, constant, branch or CSS class are changed where they live.
      const el0 = change.ops?.length ? findElement(before, line, col) : null;
      const src = el0 && sourcedInfo(before, el0, { file, webRoot, dom: change.dom });
      if (src) {
        const { files, summary } = editSourced({ file, code: before, src, ops: change.ops, theme: getTheme(), scope: change.scope, target: change.target, bp: change.bp });
        if (change.text != null || change.props?.length) {
          const r = editElement(files.get(file) ?? before, line, col, { text: change.text, props: change.props }, getTheme());
          files.set(file, r.code);
          summary.text = r.summary.text;
          summary.props = r.summary.props;
        }
        if (!files.has(file)) files.set(file, before);
        return recordFiles(files, loc, change, summary) || { file: rel, changed: false, summary };
      }
      const { code, summary } = editElement(before, line, col, change, getTheme());
      if (code === before) return { file: rel, changed: false, summary };
      return record(file, rel, before, code, loc, change, summary);
    },
    // Several files at once (design tokens). summary.action names the change.
    applyFiles(files, loc, change, summary) {
      return recordFiles(files, loc, change, { added: [], removed: [], changes: [], offScale: [], text: null, props: [], ...summary }) || { changed: false, summary };
    },
    // A small code change Claude wrote, for styles no tool can reach. Exactly one match, and it must still parse.
    code(relFile, find, replace, change = {}) {
      const file = path.resolve(webRoot, String(relFile || ''));
      if (!file.startsWith(path.resolve(webRoot) + path.sep) || /[\\/](node_modules|\.next|\.git|dist|build)[\\/]/.test(file) || !/\.(m?[jt]sx?|css)$/.test(file) || !fs.existsSync(file)) throw new KerfError('Tovi only changes your app’s own code and CSS files.');
      const before = fs.readFileSync(file, 'utf8');
      const n = find ? before.split(find).length - 1 : 0;
      if (n !== 1) throw new KerfError(n ? 'That code appears more than once, so Tovi won’t guess which to change.' : 'The code to change wasn’t found. The file may have changed; try again.');
      const after = before.replace(find, () => replace);
      if (/\.m?[jt]sx?$/.test(file)) {
        try { parseCode(after, { strict: true, file }); } catch (e) { throw new KerfError(`Tovi stopped: the change would break ${path.basename(file)} (${e.message}).`); }
      }
      const rel = path.relative(webRoot, file).split(path.sep).join('/');
      return record(file, rel, before, after, `code:${rel}`, { ...change, code: { file: rel } }, { added: [], removed: [], changes: [], offScale: [], text: null, props: [], action: change.label || `Code change in ${rel}` });
    },
    undo() {
      const h = history.pop();
      if (!h) return { undone: false };
      for (const f of [h, ...(h.more || [])]) {
        if (fs.readFileSync(f.file, 'utf8') !== f.after) { history.push(h); throw new KerfError(`${path.relative(webRoot, f.file)} changed outside Tovi since this edit, so Tovi won’t overwrite it.`); }
      }
      fs.writeFileSync(h.file, h.before);
      for (const m of h.more || []) fs.writeFileSync(m.file, m.before);
      return { undone: true, file: h.rel, n: history.length, label: [h.change?.name, ...(h.summary?.labels || [])].filter(Boolean).join(' · ') };
    },
  };
}
