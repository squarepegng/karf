// Changes described the way a designer would say them: "Size 24 → 36", not "text-2xl → text-4xl".
export const PROP_NAMES = {
  bg: 'Fill', color: 'Text color', borderC: 'Stroke color', fontSize: 'Size', fontWeight: 'Weight', lineHeight: 'Line height',
  letterSpacing: 'Letter spacing', align: 'Text align', radius: 'Corner radius', rTL: 'Top-left corner', rTR: 'Top-right corner',
  rBR: 'Bottom-right corner', rBL: 'Bottom-left corner', padX: 'Horizontal padding', padY: 'Vertical padding', mX: 'Horizontal margin',
  mY: 'Vertical margin', gap: 'Gap', borderW: 'Stroke', opacity: 'Opacity', shadow: 'Shadow', fit: 'Image fit', gradient: 'Gradient',
  clipText: 'Gradient text', w: 'Width', h: 'Height', layout: 'Layout', alignItems: 'Align', justify: 'Distribute', wrap: 'Wrap',
};
const PX = new Set(['fontSize', 'lineHeight', 'radius', 'rTL', 'rTR', 'rBR', 'rBL', 'padX', 'padY', 'mX', 'mY', 'gap', 'borderW', 'w', 'h']);
const PCT = new Set(['opacity', 'letterSpacing']);
const DIRS = { r: 'right', l: 'left', b: 'down', t: 'up', br: 'down-right', bl: 'down-left', tr: 'up-right', tl: 'up-left' };
const WEIGHTS = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };

function fmt(prop, v) {
  if (v == null || v === '') return null;
  if (prop === 'fontWeight') return WEIGHTS[v] || String(v);
  if (prop === 'gradient') { const [d, ...c] = String(v).split(/\s+/); return `${DIRS[d] || d}, ${c.join(' → ')}`; }
  if (prop === 'clipText') return v === 'on' || v === true ? 'on' : 'off';
  if (prop === 'layout') return { row: 'horizontal', col: 'vertical', column: 'vertical', none: 'off', grid: 'grid' }[v] || String(v);
  if (prop === 'w' || prop === 'h') { if (v === 'grow') return 'Fill';
    if (v === 'hug' || v === 'fill' || v === 'auto') return v[0].toUpperCase() + v.slice(1); }
  if (typeof v === 'number' || /^-?[\d.]+$/.test(String(v))) return `${v}${PX.has(prop) ? '' : PCT.has(prop) ? '%' : ''}`;
  return String(v);
}

export function changeLabel({ prop, from, to }) {
  const name = PROP_NAMES[prop] || prop;
  const a = fmt(prop, from), b = fmt(prop, to);
  if (b == null) return `${name} removed`;
  if (a == null || a === b) return `${name} ${b}`;
  return `${name} ${a} → ${b}`;
}

export function summaryLabels(summary) {
  const out = [];
  if (summary.action) out.push(summary.action);
  (summary.changes || []).forEach((c) => out.push(changeLabel(c)));
  if (summary.text) out.push(`Text “${summary.text.to}”`);
  (summary.props || []).forEach((p) => out.push(`${p.name} ${p.from ?? 'default'} → ${p.to}`));
  return out;
}
