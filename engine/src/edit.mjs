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

export class KerfError extends Error {}

const CLASS_FNS = new Set(['cn', 'clsx', 'cx', 'twMerge', 'twJoin', 'classNames', 'classnames']);

// "src/components/ui/card.tsx:6:4" → { file, line, col }
export function parseLoc(loc, webRoot) {
  const m = String(loc).match(/^(.+):(\d+):(\d+)$/);
  if (!m) throw new KerfError(`Bad location: ${loc}`);
  const file = path.resolve(webRoot, m[1]);
  const src = path.join(webRoot, 'src') + path.sep;
  if (!file.startsWith(src)) throw new KerfError('Kerf only edits files inside src/');
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

// Where this element's classes live, and whether Kerf can safely rewrite them.
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
  return { kind: 'dynamic', classes: [], reason: 'Its classes are computed by code, so Kerf can’t change them safely here.' };
}

const split = (s) => s.split(/\s+/).filter(Boolean);

// Text Kerf may retype: one fixed string, not data or an expression.
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

export function describe(code, line, col) {
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
  };
}

// Apply class ops and/or a text change to one element. Returns the new code and a summary.
export function editElement(code, line, col, { ops = [], text, props = [], cva } = {}, theme) {
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
    const r = ci.kind === 'cva' ? null : applyOps(ci.classes, ops, theme);
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
    throw new KerfError(`Kerf stopped: the change would break the file (${e.message}).`);
  }
  return { code: out, summary };
}

// File-level wrapper with an undo history, used by the dev server.
export function createEditor(webRoot, getTheme, library) {
  const history = [];
  const record = (file, rel, before, code, loc, change, summary) => {
    summary.labels = summaryLabels(summary);
    fs.writeFileSync(file, code);
    history.push({ file, rel, before, after: code, loc, change, summary, source: change.source || 'hand', at: Date.now() });
    return { file: rel, changed: true, summary, n: history.length };
  };
  return {
    history,
    // Delete, duplicate, move, swap, insert, image.
    structure(loc, op, source) {
      const { rel, file, line, col } = parseLoc(loc, webRoot);
      const before = fs.readFileSync(file, 'utf8');
      const { code, summary, moved, shift } = structureEdit(before, line, col, op, { file, library });
      if (code === before) return { file: rel, changed: false, summary };
      return { ...record(file, rel, before, code, loc, { structure: op, source }, summary), moved: (moved || []).map(([a, b]) => [`${rel}:${a}`, `${rel}:${b}`]), shift: shift ? { file: rel, ...shift } : null };
    },
    describe(loc) {
      const { rel, file, line, col } = parseLoc(loc, webRoot);
      return { file: rel, line, ...describe(fs.readFileSync(file, 'utf8'), line, col) };
    },
    edit(loc, change) {
      const { rel, file, line, col } = parseLoc(loc, webRoot);
      const before = fs.readFileSync(file, 'utf8');
      const { code, summary } = editElement(before, line, col, change, getTheme());
      if (code === before) return { file: rel, changed: false, summary };
      return record(file, rel, before, code, loc, change, summary);
    },
    undo() {
      const h = history.pop();
      if (!h) return { undone: false };
      if (fs.readFileSync(h.file, 'utf8') !== h.after) throw new KerfError(`${h.rel} changed outside Kerf since this edit, so Kerf won’t overwrite it.`);
      fs.writeFileSync(h.file, h.before);
      return { undone: true, file: h.rel, n: history.length };
    },
  };
}
