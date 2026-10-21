// Design tokens: the app's own colour palette, edited where it's defined.
// Tailwind colours usually point at CSS variables (rgb(var(--c-surface) / <alpha-value>)) with a light
// value in :root and a dark one in .dark; some are plain hex values in tailwind.config.
import fs from 'node:fs';
import path from 'node:path';
import { cssFiles } from './sources.mjs';
import { KerfError } from './edit.mjs';

const PALETTE = new Set(['slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'black', 'white', 'transparent', 'current', 'inherit']);
const isDefault = (name) => PALETTE.has(name.split('-')[0]);
const TW_CONFIGS = ['tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs', 'tailwind.config.ts', 'tailwind.config.mts', 'tailwind.config.cts'];

// "rgb(var(--c-surface) / <alpha-value>)" → { v: '--c-surface', fn: 'rgb' }
function varOf(raw) {
  const m = String(raw).match(/var\((--[\w-]+)/);
  if (!m) return null;
  const fn = (String(raw).match(/^\s*(rgba?|hsla?|oklch)\s*\(/i) || [])[1];
  return { v: m[1], fn: fn ? fn.toLowerCase().replace(/a$/, '') : null };
}

// Every --name: value; in the app's CSS, with the selector it sits in.
function varDefs(webRoot) {
  const defs = new Map();
  for (const file of cssFiles(webRoot)) {
    const code = fs.readFileSync(file, 'utf8');
    const stack = [];
    let last = 0;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '/' && code[i + 1] === '*') { const j = code.indexOf('*/', i + 2); i = j < 0 ? code.length : j + 1; continue; }
      if (ch === '{') { stack.push(code.slice(last, i).replace(/\/\*[\s\S]*?\*\//g, '').trim()); last = i + 1; }
      else if (ch === '}') { stack.pop(); last = i + 1; }
      else if (ch === ';') {
        const stmt = code.slice(last, i);
        const lead = stmt.match(/^(\s*(\/\*[\s\S]*?\*\/\s*)*)/)[0];
        const m = stmt.slice(lead.length).match(/^(--[\w-]+)\s*:\s*/);
        if (m) {
          const start = last + lead.length + m[0].length;
          const value = code.slice(start, i).trim();
          const list = defs.get(m[1]) || [];
          list.push({ file, selector: stack.join(' '), start, end: start + code.slice(start, i).trimEnd().length, value });
          defs.set(m[1], list);
        }
        last = i + 1;
      }
    }
  }
  return defs;
}
const themeOf = (sel) => (/dark/i.test(sel) ? 'dark' : /(^|\s|,)(:root|html|body)\b|^$/.test(sel.replace(/@[^ ]+[^{]*/g, '').trim()) || /^@/.test(sel) ? 'light' : sel);

/* colour maths */
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const toHexRGB = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}
const nums = (s) => String(s).replace(/\/.*$/, '').match(/-?[\d.]+/g)?.map(Number) || [];
function parseHex(h) {
  let x = String(h).trim().replace(/^#/, '');
  if (x.length === 3) x = [...x].map((c) => c + c).join('');
  return /^[0-9a-f]{6}/i.test(x) ? [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) : null;
}
// A CSS value (in the format the variable is used with) → #RRGGBB, or null if Kerf can't read it.
export function valueToHex(value, fn) {
  const v = String(value).trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return toHexRGB(...parseHex(v));
  const direct = v.match(/^(rgba?|hsla?)\((.*)\)$/i);
  if (direct) { const n = nums(direct[2]); return /^rgb/i.test(direct[1]) ? toHexRGB(n[0], n[1], n[2]) : toHexRGB(...hslToRgb(n[0], n[1], n[2])); }
  const n = nums(v);
  if (n.length < 3) return null;
  if (fn === 'rgb') return toHexRGB(n[0], n[1], n[2]);
  if (fn === 'hsl') return toHexRGB(...hslToRgb(n[0], n[1], n[2]));
  return null;
}
// #RRGGBB → a value in the same format as the old one ("15 118 110", "174 77% 26%", "#0F766E"…).
export function hexToValue(hex, old, fn) {
  const rgb = parseHex(hex);
  if (!rgb) throw new KerfError(`“${hex}” isn’t a colour Kerf can read. Use #RRGGBB.`);
  const v = String(old).trim();
  const comma = v.includes(',');
  if (/^#/.test(v)) return toHexRGB(...rgb);
  if (/^rgba?\(/i.test(v)) return `rgb(${rgb.join(comma ? ', ' : ' ')})`;
  if (/^hsla?\(/i.test(v)) { const [h, s, l] = rgbToHsl(...rgb); return `hsl(${Math.round(h)}${comma ? ',' : ''} ${Math.round(s)}%${comma ? ',' : ''} ${Math.round(l)}%)`; }
  if (fn === 'rgb') return rgb.join(comma ? ', ' : ' ');
  if (fn === 'hsl') { const [h, s, l] = rgbToHsl(...rgb); const r1 = (x) => Math.round(x * 10) / 10; return `${r1(h)}${comma ? ',' : ''} ${r1(s)}%${comma ? ',' : ''} ${r1(l)}%`; }
  throw new KerfError('Kerf can’t write this colour format yet.');
}

function configFile(webRoot) {
  const f = TW_CONFIGS.find((x) => fs.existsSync(path.join(webRoot, x)));
  return f ? path.join(webRoot, f) : null;
}

// The palette: [{ name, values: [{ theme: 'light' | 'dark' | 'all' | selector, hex }], where }]
export function listTokens(webRoot, theme) {
  const defs = varDefs(webRoot);
  const cfg = configFile(webRoot);
  const cfgCode = cfg ? fs.readFileSync(cfg, 'utf8') : '';
  const out = [];
  for (const [name, raw] of Object.entries(theme.colors || {})) {
    if (isDefault(name)) continue;
    const vr = varOf(raw);
    if (vr) {
      const byTheme = new Map();
      for (const d of defs.get(vr.v) || []) { const hex = valueToHex(d.value, vr.fn); if (hex) byTheme.set(themeOf(d.selector), { theme: themeOf(d.selector), hex }); }
      if (byTheme.size) out.push({ name, var: vr.v, fn: vr.fn, values: [...byTheme.values()], where: path.relative(webRoot, (defs.get(vr.v) || [])[0].file) });
    } else if (/^#[0-9a-f]{3,8}$/i.test(raw) && cfgCode.toLowerCase().includes(String(raw).toLowerCase())) {
      out.push({ name, values: [{ theme: 'all', hex: valueToHex(raw) }], where: path.basename(cfg) });
    }
  }
  return out;
}

const hexOut = (h) => toHexRGB(...parseHex(h));

// The new contents of each file that defines this token: Map(file → code).
//   which: 'light' | 'dark' | 'both' (or a selector name for other themes)
export function tokenEdit(webRoot, theme, name, hex, which = 'both') {
  const raw = theme.colors?.[name];
  if (raw == null || isDefault(name)) throw new KerfError(`“${name}” isn’t one of this app’s colour tokens.`);
  const files = new Map();
  const code = (f) => (files.has(f) ? files.get(f) : fs.readFileSync(f, 'utf8'));
  const vr = varOf(raw);
  if (vr) {
    const defs = (varDefs(webRoot).get(vr.v) || []).filter((d) => which === 'both' || which === 'all' || themeOf(d.selector) === which);
    if (!defs.length) throw new KerfError(`Kerf couldn’t find where “${name}” is defined${which === 'both' ? '' : ` for the ${which} theme`}.`);
    // Edit from the end of each file so earlier positions stay valid.
    for (const d of defs.sort((a, b) => (a.file === b.file ? b.start - a.start : a.file.localeCompare(b.file)))) {
      const c = code(d.file);
      // A note like /* #2DC8B6 lifted teal */ on the same line gets the new hex too.
      const eol = c.indexOf('\n', d.end), rest = c.slice(d.end, eol < 0 ? c.length : eol);
      const old = valueToHex(d.value, vr.fn);
      const note = old ? rest.replace(new RegExp(old.replace('#', '#?'), 'i'), (m) => (m.startsWith('#') ? hexOut(hex) : hexOut(hex).slice(1))) : rest;
      files.set(d.file, c.slice(0, d.start) + hexToValue(hex, d.value, vr.fn) + note + c.slice(d.end + rest.length));
    }
    return files;
  }
  const cfg = configFile(webRoot);
  const c = cfg && fs.readFileSync(cfg, 'utf8');
  const re = new RegExp(`(['"])${String(raw).replace(/[#]/g, '\\#')}\\1`, 'gi');
  const hits = c ? [...c.matchAll(re)] : [];
  if (hits.length !== 1) throw new KerfError(`Kerf couldn’t safely find “${name}” in the Tailwind config.`);
  const h = hits[0];
  files.set(cfg, c.slice(0, h.index) + `${h[1]}${toHexRGB(...parseHex(hex))}${h[1]}` + c.slice(h.index + h[0].length));
  return files;
}
