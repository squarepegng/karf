// Component properties, like Figma's: the literal props on a component usage
// (variant="primary", weight="duotone", size={20}) that a designer can change.
import { parseCode, walk } from './ast.mjs';

// Props Kerf may add to icons from known libraries, with the values they accept.
export const ICON_LIBS = {
  '@phosphor-icons/react': { weight: ['thin', 'light', 'regular', 'bold', 'fill', 'duotone'], size: 'number', mirrored: 'boolean' },
  'lucide-react': { size: 'number', strokeWidth: 'number', absoluteStrokeWidth: 'boolean' },
};

// Props that carry behavior, data or wiring: never offered for editing.
const DENY = /^(on[A-Z].*|key|ref|href|to|id|value|defaultValue|checked|defaultChecked|children|className|style|src|alt|type|name|htmlFor|form|action|method|target|rel|data-.*|aria-.*|role|tabIndex|disabled|required|placeholder|asChild|as|open|onOpenChange)$/;

function literalOf(attr) {
  const v = attr.value;
  if (v == null) return { value: true, kind: 'boolean' };
  if (v.type === 'StringLiteral') return { value: v.value, kind: 'string', node: v };
  if (v.type === 'JSXExpressionContainer') {
    const e = v.expression;
    if (e.type === 'NumericLiteral') return { value: e.value, kind: 'number', node: v };
    if (e.type === 'BooleanLiteral') return { value: e.value, kind: 'boolean', node: v };
    if (e.type === 'StringLiteral') return { value: e.value, kind: 'string', node: v };
  }
  return null;
}

function importSource(code, id) {
  let src = null;
  walk(parseCode(code).program, (n) => {
    if (n.type === 'ImportDeclaration' && n.specifiers.some((s) => s.local.name === id)) src = n.source.value;
  });
  return src;
}

export function propsInfo(code, el) {
  const open = el.openingElement, name = open.name;
  const id = name.type === 'JSXIdentifier' ? name.name : name.type === 'JSXMemberExpression' ? name.object.name : null;
  if (!id || !/^[A-Z]/.test(id)) return { component: false, props: [] };
  const lib = importSource(code, id);
  const known = ICON_LIBS[lib] || {};
  const props = [];
  for (const a of open.attributes) {
    if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier' || DENY.test(a.name.name)) continue;
    const lit = literalOf(a);
    const opt = known[a.name.name];
    if (lit) props.push({ name: a.name.name, value: lit.value, kind: Array.isArray(opt) ? 'option' : lit.kind, options: Array.isArray(opt) ? opt : undefined, editable: true });
    else props.push({ name: a.name.name, editable: false, reason: 'Set by code here' });
  }
  for (const [k, kind] of Object.entries(known)) {
    if (!props.some((p) => p.name === k)) props.push({ name: k, value: null, kind: Array.isArray(kind) ? 'option' : kind, options: Array.isArray(kind) ? kind : undefined, editable: true });
  }
  return { component: true, lib, props };
}

// Check a requested value against what the prop accepts; returns the clean value or throws.
export function checkProp(info, name, value) {
  const p = info.props.find((x) => x.name === name);
  if (!p) throw new Error(`${name} isn’t a property Kerf can change on this component.`);
  if (!p.editable) throw new Error(`${name} is set by code here, so Kerf won’t change it.`);
  if (p.kind === 'option') {
    if (!p.options.includes(String(value))) throw new Error(`${name} must be one of: ${p.options.join(', ')}.`);
    return String(value);
  }
  if (p.kind === 'number') {
    const n = Number(value);
    if (!isFinite(n)) throw new Error(`${name} must be a number.`);
    return n;
  }
  if (p.kind === 'boolean') {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new Error(`${name} must be true or false.`);
  }
  return String(value);
}

const format = (v) => (typeof v === 'number' || typeof v === 'boolean' ? `{${v}}` : JSON.stringify(v));

// Write prop changes into the element's opening tag with the smallest possible change.
export function applyProps(s, code, el, changes) {
  const info = propsInfo(code, el);
  if (!info.component) throw new Error('Only components have properties.');
  const open = el.openingElement;
  const done = [];
  for (const { name, value } of changes) {
    const v = checkProp(info, name, value);
    const attr = open.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === name);
    if (!attr) s.appendLeft(open.name.end, ` ${name}=${format(v)}`);
    else if (attr.value == null) s.appendLeft(attr.name.end, `=${format(v)}`);
    else s.overwrite(attr.value.start, attr.value.end, format(v));
    done.push({ name, from: info.props.find((p) => p.name === name)?.value ?? null, to: v });
  }
  return done;
}
