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
    case 'padY': return (c) => /^(py|pt|pb)-/.test(c);
    case 'radius': return (c) => c === 'rounded' || c.startsWith('rounded-');
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
    case 'shadow': return v === 'none' ? 'shadow-none' : v === 'DEFAULT' ? 'shadow' : `shadow-${v}`;
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
  for (const { prop, value } of ops) {
    const m = matcher(prop, th);
    const base = (c) => !c.includes(':');
    // p-5 sets both axes: changing one axis splits it so the other is kept.
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
  }
  return { classes: out, removed, added };
}
