// Map design values (Figma-style: 16px, Semibold, "surface-2") to the team's
// own Tailwind classes, and know which existing classes a new one replaces.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

function toPx(v) {
  if (Array.isArray(v)) v = v[0];
  v = String(v).trim();
  let m;
  if ((m = v.match(/^(-?[\d.]+)rem$/))) return Math.round(+m[1] * 16 * 100) / 100;
  if ((m = v.match(/^(-?[\d.]+)px$/))) return +m[1];
  if (v === '0') return 0;
  return null;
}

function pxMap(obj) {
  const m = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const p = toPx(v);
    if (p != null && !(p in m)) m[p] = k;
  }
  return m;
}

function flattenColors(obj, prefix = '', out = {}) {
  for (const k of Object.keys(obj || {})) {
    const v = obj[k];
    const name = k === 'DEFAULT' ? prefix : prefix ? `${prefix}-${k}` : k;
    if (v && typeof v === 'object') flattenColors(v, name, out);
    else if (typeof v === 'string') out[name] = v;
  }
  return out;
}

export function buildTheme(t) {
  const byValue = (obj, f) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [f(v), k]));
  return {
    spacing: pxMap(t.spacing),
    radius: pxMap(t.borderRadius),
    fontSize: pxMap(t.fontSize),
    lineHeight: pxMap(t.lineHeight),
    borderWidth: pxMap(t.borderWidth),
    fontWeight: byValue(t.fontWeight, (v) => String(v)),
    letterSpacing: byValue(t.letterSpacing, (v) => Math.round(parseFloat(v) * 1000) / 10), // em → % of em
    opacity: byValue(t.opacity, (v) => Math.round(parseFloat(v) * 100)),
    shadow: Object.keys(t.boxShadow || {}),
    colors: flattenColors(t.colors),
    byKey: {
      spacing: Object.fromEntries(Object.entries(t.spacing || {}).map(([k, v]) => [k, toPx(v)])),
      radius: Object.fromEntries(Object.entries(t.borderRadius || {}).map(([k, v]) => [k, toPx(v)])),
      fontSize: Object.fromEntries(Object.entries(t.fontSize || {}).map(([k, v]) => [k, toPx(v)])),
      lineHeight: Object.fromEntries(Object.entries(t.lineHeight || {}).map(([k, v]) => [k, toPx(v)])),
      fontWeight: Object.fromEntries(Object.entries(t.fontWeight || {}).map(([k, v]) => [k, Number(v)])),
      opacity: Object.fromEntries(Object.entries(t.opacity || {}).map(([k, v]) => [k, Math.round(parseFloat(v) * 100)])),
      borderWidth: Object.fromEntries(Object.entries(t.borderWidth || {}).map(([k, v]) => [k, toPx(v)])),
    },
    gradientPrefix: t.backgroundImage && !('gradient-to-r' in t.backgroundImage) ? 'bg-linear-to-' : 'bg-gradient-to-',
    keys: {
      fontSize: Object.keys(t.fontSize || {}),
      fontWeight: Object.keys(t.fontWeight || {}),
      borderWidth: Object.keys(t.borderWidth || {}),
      fontFamily: Object.keys(t.fontFamily || {}),
    },
  };
}

// Resolve the app's own tailwind.config with the app's own tailwindcss.
export async function loadTheme(webRoot) {
  const req = createRequire(path.join(webRoot, 'package.json'));
  const resolveConfig = req('tailwindcss/resolveConfig');
  const file = ['tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs']
    .map((f) => path.join(webRoot, f))
    .find((f) => fs.existsSync(f));
  if (!file) throw new Error(`No tailwind.config.js found in ${webRoot}`);
  const mod = await import(pathToFileURL(file).href);
  const warn = console.warn;
  console.warn = () => {}; // Tailwind warns about renamed default colors when they're read
  try {
    return buildTheme(resolveConfig(mod.default || mod).theme);
  } finally {
    console.warn = warn;
  }
}

const SPECIAL_COLORS = ['inherit', 'current', 'transparent', 'black', 'white'];
function isColor(suffix, th) {
  const base = suffix.split('/')[0];
  return base in th.colors || SPECIAL_COLORS.includes(base) || /^\[(#|rgb|hsl|color:|var\()/.test(base);
}

// Which existing (non-variant) classes does setting `prop` replace?
export function matcher(prop, th) {
  const fs = new Set(th.keys.fontSize);
  const corner = (c) => (cls) => cls === `rounded-${c}` || cls.startsWith(`rounded-${c}-`);
  switch (prop) {
    case 'bg': return (c) => c.startsWith('bg-') && isColor(c.slice(3), th);
    case 'gradient': return (c) => /^bg-(gradient|linear)-to-/.test(c) || /^(from|via|to)-/.test(c);
    case 'clipText': return (c) => c === 'bg-clip-text' || c === 'text-transparent';
    case 'color': return (c) => c.startsWith('text-') && isColor(c.slice(5), th);
    case 'borderC': return (c) => c.startsWith('border-') && isColor(c.slice(7), th);
    case 'fontSize': return (c) => c.startsWith('text-') && (fs.has(c.slice(5)) || /^\[[\d.]+(px|rem|em)\]$/.test(c.slice(5)));
    case 'align': return (c) => /^text-(left|center|right|justify|start|end)$/.test(c);
    case 'fontWeight': return (c) => c.startsWith('font-') && (th.keys.fontWeight.includes(c.slice(5)) || /^\[\d+\]$/.test(c.slice(5)));
    case 'lineHeight': return (c) => c.startsWith('leading-');
    case 'letterSpacing': return (c) => c.startsWith('tracking-');
    case 'opacity': return (c) => c.startsWith('opacity-');
    case 'shadow': return (c) => c === 'shadow' || c === 'shadow-none' || (c.startsWith('shadow-') && (th.shadow.includes(c.slice(7)) || (/^\[/.test(c.slice(7)) && !isColor(c.slice(7), th))));
    case 'borderW': return (c) => c === 'border' || (c.startsWith('border-') && (th.keys.borderWidth.includes(c.slice(7)) || /^\[[\d.]+px\]$/.test(c.slice(7))));
    case 'gap': return (c) => c.startsWith('gap-');
    case 'padX': return (c) => /^(px|pl|pr|ps|pe)-/.test(c);
    case 'mX': return (c) => /^-?(mx|ml|mr|ms|me)-/.test(c);
    case 'mY': return (c) => /^-?(my|mt|mb)-/.test(c);
    case 'w': return (c) => /^w-/.test(c) || c === 'flex-1' || c === 'grow' || c === 'flex-auto';
    case 'h': return (c) => /^h-/.test(c) || c === 'flex-1';
    case 'layout': return (c) => ['flex', 'inline-flex', 'flex-row', 'flex-col', 'flex-row-reverse', 'flex-col-reverse', 'block', 'inline-block', 'grid', 'inline-grid'].includes(c);
    case 'alignItems': return (c) => /^items-(start|center|end|stretch|baseline)$/.test(c);
    case 'justify': return (c) => /^justify-(start|center|end|between|around|evenly|normal|stretch)$/.test(c);
    case 'wrap': return (c) => /^flex-(wrap|nowrap|wrap-reverse)$/.test(c);
    case 'padY': return (c) => /^(py|pt|pb)-/.test(c);
    case 'radius': return (c) => c === 'rounded' || c.startsWith('rounded-');
    case 'fit': return (c) => /^object-(cover|contain|fill|none|scale-down)$/.test(c);
    case 'rTL': return corner('tl');
    case 'rTR': return corner('tr');
    case 'rBR': return corner('br');
    case 'rBL': return corner('bl');
    default: throw new Error(`Unknown property: ${prop}`);
  }
}

function scale(prefix, map, px, unit = 'px') {
  const k = map[px];
  if (k != null) return k === 'DEFAULT' ? prefix : `${prefix}-${k}`;
  return `${prefix}-[${px}${unit}]`;
}

// The class a careful developer would write for this value, on the team's scale if possible.
export function classFor(prop, v, th) {
  switch (prop) {
    case 'padX': return scale('px', th.spacing, v);
    case 'mX': case 'mY': {
      const pre = prop === 'mX' ? 'mx' : 'my';
      if (v === 'auto') return `${pre}-auto`;
      const n = Number(v);
      return n < 0 ? '-' + scale(pre, th.spacing, -n) : scale(pre, th.spacing, n);
    }
    case 'w': case 'h': {
      if (v === 'hug') return `${prop}-fit`;
      if (v === 'fill') return prop === 'w' ? 'w-full' : 'h-full';
      if (v === 'grow') return 'flex-1'; // Fill along a flex parent’s direction: take the remaining space
      if (v === 'auto') return `${prop}-auto`;
      return scale(prop, th.spacing, Number(v));
    }
    case 'layout': return v === 'row' ? 'flex flex-row' : v === 'col' ? 'flex flex-col' : v === 'grid' ? 'grid' : 'block';
    case 'alignItems': return `items-${v}`;
    case 'justify': return `justify-${v}`;
    case 'wrap': return v === 'wrap' ? 'flex-wrap' : 'flex-nowrap';
    case 'padY': return scale('py', th.spacing, v);
    case 'gap': return scale('gap', th.spacing, v);
    case 'radius': return scale('rounded', th.radius, v);
    case 'rTL': return scale('rounded-tl', th.radius, v);
    case 'rTR': return scale('rounded-tr', th.radius, v);
    case 'rBR': return scale('rounded-br', th.radius, v);
    case 'rBL': return scale('rounded-bl', th.radius, v);
    case 'fontSize': return scale('text', th.fontSize, v);
    case 'lineHeight': return scale('leading', th.lineHeight, v);
    case 'borderW': return scale('border', th.borderWidth, v);
    case 'letterSpacing': { const k = th.letterSpacing[v]; return k ? `tracking-${k}` : `tracking-[${v / 100}em]`; }
    case 'fontWeight': { const k = th.fontWeight[String(v)]; return k ? `font-${k}` : `font-[${v}]`; }
    case 'opacity': { const k = th.opacity[v]; return k != null ? `opacity-${k}` : `opacity-[${v / 100}]`; }
    case 'align': return `text-${v}`;
    case 'fit': return `object-${v}`;
    case 'shadow': return v === 'none' ? 'shadow-none' : v === 'DEFAULT' ? 'shadow' : `shadow-${v}`;
    case 'gradient': {
      // "r primary positive" or "br primary via-color positive": direction, then from (via) to.
      const [dir, ...stops] = String(v).trim().split(/\s+/);
      const c = (x) => (x.startsWith('#') ? `[${x}]` : x);
      const out = [`${th.gradientPrefix || 'bg-gradient-to-'}${dir}`, `from-${c(stops[0])}`];
      if (stops.length > 2) out.push(`via-${c(stops[1])}`);
      out.push(`to-${c(stops[stops.length - 1])}`);
      return out.join(' ');
    }
    case 'clipText': return 'bg-clip-text text-transparent';
    case 'bg': case 'color': case 'borderC': {
      const pre = { bg: 'bg', color: 'text', borderC: 'border' }[prop];
      if (String(v).startsWith('#')) return `${pre}-[${v}]`;
      return `${pre}-${v}`;
    }
    default: throw new Error(`Unknown property: ${prop}`);
  }
}

export const isOffScale = (cls) => cls.includes('[');

// Apply property changes to a list of classes. A null value removes the property.
// Variant classes (hover:, md:, dark:) are left alone.
export function applyOps(list, ops, th) {
  let out = list.slice();
  const removed = [];
  const added = [];
  const changes = [];
  for (const op of ops) {
    const prop = op.prop;
    let value = op.value;
    const removedBefore = removed.length;
    const base0 = (c) => !c.includes(':');
    const also = prop === 'gradient' ? matcher('bg', th) : prop === 'bg' && value !== 'transparent' ? matcher('gradient', th) : prop === 'clipText' && value ? matcher('color', th) : null;
    if (also) out = out.filter((c) => !(base0(c) && also(c) && removed.push(c)));
    if (prop === 'color') out = out.filter((c) => !(base0(c) && c === 'text-transparent' && removed.push(c)));
    if ((prop === 'gradient' || prop === 'clipText') && (value === 'none' || value === 'off' || value === false)) value = null;
    const m = matcher(prop, th);
    const base = (c) => !c.includes(':');
    // p-5 sets both axes: changing one axis splits it so the other is kept.
    if ((prop === 'mX' || prop === 'mY')) {
      const i = out.findIndex((c) => base(c) && /^-?m-/.test(c));
      if (i > -1) {
        const neg = out[i].startsWith('-');
        const keep = (neg ? '-' : '') + (prop === 'mX' ? 'my-' : 'mx-') + out[i].replace(/^-?m-/, '');
        removed.push(out[i]);
        added.push(keep);
        out.splice(i, 1, keep);
      }
    }
    if (prop === 'layout' && value === 'none') value = null;
    if (prop === 'padX' || prop === 'padY') {
      const i = out.findIndex((c) => base(c) && /^p-/.test(c));
      if (i > -1) {
        const keep = (prop === 'padX' ? 'py-' : 'px-') + out[i].slice(2);
        removed.push(out[i]);
        added.push(keep);
        out.splice(i, 1, keep);
      }
    }
    let at = -1;
    out = out.filter((c, i) => {
      if (base(c) && m(c)) {
        if (at < 0) at = i;
        removed.push(c);
        return false;
      }
      return true;
    });
    if (value != null) {
      const cls = classFor(prop, value, th);
      if (at < 0 || at > out.length) out.push(cls);
      else out.splice(at, 0, cls);
      added.push(cls);
    }
    // Before/after in design terms, for labels like "Size 24 → 36".
    const mine = removed.slice(removedBefore).filter((c) => matcher(prop, th)(c.replace(/^-/, '')) || matcher(prop, th)(c));
    const pickFrom = prop === 'layout' ? mine.find((c) => /^flex-(row|col)/.test(c)) || mine[0] : mine[0];
    changes.push({ prop, from: pickFrom ? valueOfClass(prop, pickFrom, th) : null, to: value ?? null });
  }
  return { classes: out, removed, added, changes };
}

const PREFIX = { padX: ['px', 'p'], padY: ['py', 'p'], mX: ['mx', 'm'], mY: ['my', 'm'], gap: ['gap'], radius: ['rounded'], rTL: ['rounded-tl'], rTR: ['rounded-tr'], rBR: ['rounded-br'], rBL: ['rounded-bl'], fontSize: ['text'], lineHeight: ['leading'], borderW: ['border'], opacity: ['opacity'], w: ['w'], h: ['h'] };
const SCALE = { padX: 'spacing', padY: 'spacing', mX: 'spacing', mY: 'spacing', gap: 'spacing', w: 'spacing', h: 'spacing', radius: 'radius', rTL: 'radius', rTR: 'radius', rBR: 'radius', rBL: 'radius', fontSize: 'fontSize', lineHeight: 'lineHeight', borderW: 'borderWidth', opacity: 'opacity' };
export function valueOfClass(prop, cls, th) {
  if (!cls) return null;
  const neg = cls.startsWith('-');
  const c = neg ? cls.slice(1) : cls;
  if (prop === 'bg' || prop === 'color' || prop === 'borderC') return c.replace(/^(bg|text|border)-/, '').replace(/^\[|\]$/g, '');
  if (prop === 'fontWeight') { const k = c.replace(/^font-/, ''); return th.byKey?.fontWeight?.[k] ?? k.replace(/^\[|\]$/g, ''); }
  if (prop === 'shadow') return c === 'shadow' ? 'default' : c.replace(/^shadow-/, '');
  if (prop === 'align') return c.replace(/^text-/, '');
  if (prop === 'fit') return c.replace(/^object-/, '');
  if (prop === 'alignItems') return c.replace(/^items-/, '');
  if (prop === 'justify') return c.replace(/^justify-/, '');
  if (prop === 'wrap') return c === 'flex-wrap' ? 'wrap' : 'no wrap';
  if (prop === 'layout') return { 'flex-row': 'row', 'flex-col': 'column', flex: 'row', grid: 'grid', block: 'none' }[c] || c;
  if (prop === 'w' || prop === 'h') { const k = c.slice(2); if (k === 'fit') return 'hug'; if (k === 'full') return 'fill'; }
  if (prop === 'gradient') return c;
  for (const p of PREFIX[prop] || []) {
    if (c === p) return SCALE[prop] === 'borderWidth' ? th.byKey?.borderWidth?.DEFAULT : SCALE[prop] === 'radius' ? th.byKey?.radius?.DEFAULT : null;
    if (c.startsWith(p + '-')) {
      const k = c.slice(p.length + 1);
      const arb = k.match(/^\[(-?[\d.]+)(px|%|em)?\]$/);
      const v = arb ? Number(arb[1]) : th.byKey?.[SCALE[prop]]?.[k];
      return v == null ? k : neg ? -v : v;
    }
  }
  return null;
}
