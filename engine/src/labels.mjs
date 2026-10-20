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

// What a designer would call an element: "Title “Stratemark”", "Button “Enter”", "Key round icon".
const TAGS = { h1: 'Title', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading', p: 'Text', span: 'Text', strong: 'Text', em: 'Text', small: 'Text', b: 'Text', i: 'Text', label: 'Label', a: 'Link', button: 'Button', img: 'Image', picture: 'Image', svg: 'Icon', input: 'Input', textarea: 'Text box', select: 'Dropdown', form: 'Form', ul: 'List', ol: 'List', li: 'List item', nav: 'Navigation', header: 'Header', footer: 'Footer', aside: 'Sidebar', section: 'Section', main: 'Page', article: 'Card', hr: 'Divider', video: 'Video', table: 'Table', tr: 'Table row', td: 'Cell', th: 'Cell', code: 'Code', blockquote: 'Quote', dialog: 'Dialog', div: 'Frame' };
const words = (n) => n.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
export function designKind(tag, { icon = false } = {}) {
  if (!tag) return 'Layer';
  if (/^[A-Z]/.test(tag)) { const w = words(tag); return icon || /Icon$/.test(tag) ? `${w.replace(/ Icon$/, '')} icon` : w; }
  return TAGS[tag.toLowerCase()] || 'Frame';
}
const TEXTY = new Set(['Title', 'Heading', 'Text', 'Label', 'Link', 'Button', 'List item', 'Quote', 'Cell', 'Input']);
export function designName(tag, text, opts) {
  const kind = designKind(tag, opts);
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.startsWith('image:') || !(TEXTY.has(kind) || /^[A-Z]/.test(tag || ''))) return kind;
  return `${kind} “${t.length > 24 ? t.slice(0, 23) + '…' : t}”`;
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
  if (summary.size && out.length) out[out.length - 1] += ` (${summary.size.toLowerCase()})`;
  return out;
}
