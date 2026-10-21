// Variant components (shadcn-style `cva(base, { variants: { variant: {...}, size: {...} } })`).
// Their styles live in the cva() call, so Tovi edits the base string or a variant's string there.
import { parseCode, walk } from './ast.mjs';

function lit(n) {
  if (!n) return null;
  if (n.type === 'StringLiteral') return { start: n.start + 1, end: n.end - 1, value: n.value };
  if (n.type === 'TemplateLiteral' && !n.expressions.length) return { start: n.quasis[0].start, end: n.quasis[0].end, value: n.quasis[0].value.raw };
  return null;
}
const keyName = (p) => (p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null);

export function findCvas(code) {
  const out = new Map();
  let ast;
  try { ast = parseCode(code); } catch { return out; }
  walk(ast.program, (n) => {
    if (n.type !== 'VariableDeclarator' || n.id.type !== 'Identifier' || n.init?.type !== 'CallExpression' || n.init.callee.type !== 'Identifier' || n.init.callee.name !== 'cva') return;
    const [baseArg, cfg] = n.init.arguments;
    const entry = { name: n.id.name, base: lit(baseArg), groups: {}, defaults: {}, order: [], compounds: [], cfg: cfg?.type === 'ObjectExpression' ? cfg : null, compoundArr: null };
    if (cfg?.type === 'ObjectExpression') {
      for (const p of cfg.properties) {
        const k = p.type === 'ObjectProperty' && keyName(p);
        if (k === 'variants' && p.value.type === 'ObjectExpression') {
          for (const g of p.value.properties) {
            const gname = g.type === 'ObjectProperty' && keyName(g);
            if (!gname || g.value.type !== 'ObjectExpression') continue;
            entry.groups[gname] = {};
            entry.order.push(gname);
            for (const v of g.value.properties) {
              const vk = v.type === 'ObjectProperty' && keyName(v);
              const l = vk && lit(v.value);
              if (l) entry.groups[gname][vk] = l;
            }
          }
        }
        if (k === 'compoundVariants' && p.value.type === 'ArrayExpression') {
          entry.compoundArr = p.value;
          for (const el of p.value.elements) {
            if (el?.type !== 'ObjectExpression') continue;
            const match = {};
            let l = null;
            for (const q of el.properties) {
              const qk = q.type === 'ObjectProperty' && keyName(q);
              if (qk === 'class' || qk === 'className') l = lit(q.value);
              else if (qk && q.value.type === 'StringLiteral') match[qk] = q.value.value;
            }
            if (l) entry.compounds.push({ match, lit: l });
          }
        }
        if (k === 'defaultVariants' && p.value.type === 'ObjectExpression') {
          for (const d of p.value.properties) {
            const dk = d.type === 'ObjectProperty' && keyName(d);
            if (dk && d.value.type === 'StringLiteral') entry.defaults[dk] = d.value.value;
          }
        }
      }
    }
    out.set(entry.name, entry);
  });
  return out;
}

// Does this className expression call a cva in this file? e.g. cn(buttonVariants({ variant, size, className }))
export function cvaIn(expr, cvas) {
  let hit = null;
  walk(expr, (n) => { if (!hit && n.type === 'CallExpression' && n.callee.type === 'Identifier' && cvas.has(n.callee.name)) hit = cvas.get(n.callee.name); });
  return hit;
}

const SIZE_PROPS = new Set(['padX', 'padY', 'fontSize', 'h', 'w', 'gap', 'lineHeight']);

// Which class strings an op should change.
//   mode "all":     the base string, plus any variant string that sets the same property
//   mode "variant": the active variant's string that sets the property (or the most fitting one)
export function cvaTargets(entry, prop, mode, active, matches) {
  const has = (l) => l && l.value.split(/\s+/).some((c) => !c.includes(':') && matches(c));
  const activeLits = Object.entries(entry.groups).map(([g, vals]) => [g, vals[active?.[g] ?? entry.defaults[g]]]).filter(([, l]) => l);
  if (mode === 'variant') {
    // "All ghost buttons": the variant group's own string, unless a later group (like size)
    // also sets this property and would win. Then a compound variant ({ variant: 'ghost', class })
    // is the cva way to override it for ghost only, because compound classes apply last.
    const vg = entry.order.includes('variant') ? 'variant' : entry.order.find((g) => g !== 'size') || entry.order[0];
    const key = active?.[vg] ?? entry.defaults[vg];
    const own = entry.groups[vg]?.[key];
    const later = entry.order.slice(entry.order.indexOf(vg) + 1).some((g) => has(entry.groups[g]?.[active?.[g] ?? entry.defaults[g]]));
    const existing = entry.compounds.find((c) => Object.keys(c.match).length === 1 && c.match[vg] === key);
    if (existing && (later || has(existing.lit))) return [existing.lit];
    if (later) return [{ compound: true, group: vg, key, entry }];
    return own ? [own] : entry.base ? [entry.base] : [];
  }
  const out = entry.base ? [entry.base] : [];
  for (const vals of Object.values(entry.groups)) for (const l of Object.values(vals)) if (has(l)) out.push(l);
  return out;
}
