// Structural edits a designer makes in Figma, done to the code: delete,
// duplicate, move up/down, swap an icon or component, insert new elements,
// and change images. Every edit keeps imports correct and is re-parsed.
import MagicString from 'magic-string';
import { parseCode } from './ast.mjs';
import { KerfError } from './edit.mjs';

const SKIP = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments']);
function walkP(node, fn, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, parent);
  for (const k in node) {
    if (SKIP.has(k)) continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walkP(c, fn, node));
    else if (v && typeof v.type === 'string') walkP(v, fn, node);
  }
}

function locate(code, line, col) {
  const ast = parseCode(code);
  let el = null, parent = null;
  walkP(ast.program, (n, p) => {
    if (n.type === 'JSXElement' && n.openingElement.loc.start.line === line && n.openingElement.loc.start.column === col) { el = n; parent = p; }
  });
  if (!el) throw new KerfError('Element not found. The file may have changed; reload and try again.');
  return { ast, el, parent };
}

const tagName = (el, code) => code.slice(el.openingElement.name.start, el.openingElement.name.end);
const lineStart = (code, i) => code.lastIndexOf('\n', i - 1) + 1;
const indentAt = (code, i) => code.slice(lineStart(code, i), i).match(/^\s*/)[0];

// Only elements written directly inside other elements can be removed or moved:
// not a component's outer element, and not one shown by a condition or a list.
function inJSX(parent, what) {
  if (parent && (parent.type === 'JSXElement' || parent.type === 'JSXFragment')) return;
  const why = parent?.type === 'LogicalExpression' || parent?.type === 'ConditionalExpression'
    ? 'shown or hidden by code (a condition)'
    : parent?.type === 'ArrowFunctionExpression' || parent?.type === 'ReturnStatement' || parent?.type === 'ParenthesizedExpression'
      ? 'the outer box of its page or component, or repeated by code (a list)'
      : 'placed by code';
  throw new KerfError(`Kerf can’t ${what} this element because it’s ${why}. ${what.startsWith('insert') ? 'Add it inside instead, or select an element within it.' : 'Select the element around it, or one inside it.'}`);
}

/* ---------- imports ---------- */
function ensureImport(code, name, source) {
  const ast = parseCode(code);
  let has = false, target = null, lastImport = null;
  for (const n of ast.program.body) {
    if (n.type !== 'ImportDeclaration') continue;
    lastImport = n;
    if (n.specifiers.some((s) => s.local.name === name)) has = true;
    if (n.source.value === source && n.importKind !== 'type' && n.specifiers.some((s) => s.type === 'ImportSpecifier')) target = n;
  }
  if (has) return code;
  const s = new MagicString(code);
  if (target) {
    const last = target.specifiers[target.specifiers.length - 1];
    s.appendLeft(last.end, `, ${name}`);
  } else if (lastImport) s.appendLeft(lastImport.end, `\nimport { ${name} } from '${source}';`);
  else s.prepend(`import { ${name} } from '${source}';\n`);
  return s.toString();
}
// Drop named imports that nothing in the file uses any more.
function pruneImports(code, names) {
  if (!names.length) return code;
  const ast = parseCode(code);
  const used = new Set();
  walkP(ast.program, (n, p) => {
    if ((n.type === 'JSXIdentifier' || n.type === 'Identifier') && !(p && (p.type === 'ImportSpecifier' || p.type === 'ImportDefaultSpecifier'))) used.add(n.name);
  });
  const s = new MagicString(code);
  for (const decl of ast.program.body.filter((n) => n.type === 'ImportDeclaration')) {
    const drop = decl.specifiers.filter((sp) => names.includes(sp.local.name) && !used.has(sp.local.name));
    if (!drop.length) continue;
    if (drop.length === decl.specifiers.length) {
      const end = code[decl.end] === '\n' ? decl.end + 1 : decl.end;
      s.remove(decl.start, end);
    } else {
      for (const sp of drop) {
        const i = decl.specifiers.indexOf(sp);
        const next = decl.specifiers[i + 1], prev = decl.specifiers[i - 1];
        if (next) s.remove(sp.start, next.start);
        else s.remove(prev.end, sp.end);
      }
    }
  }
  return s.toString();
}
function componentNames(node) {
  const out = new Set();
  walkP(node, (n) => {
    if (n.type === 'JSXOpeningElement') {
      const nm = n.name.type === 'JSXIdentifier' ? n.name.name : n.name.type === 'JSXMemberExpression' ? n.name.object.name : null;
      if (nm && /^[A-Z]/.test(nm)) out.add(nm);
    }
  });
  return [...out];
}

/* ---------- snippets: what may be inserted ---------- */
const SAFE_TAGS = new Set(['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'a', 'button', 'section', 'header', 'footer', 'nav', 'main', 'aside', 'article', 'ul', 'ol', 'li', 'strong', 'em', 'small', 'label', 'hr', 'br', 'figure', 'figcaption', 'blockquote', 'picture', 'svg', 'path']);
// New elements are purely visual: literal attributes only, no handlers, no code.
export function checkSnippet(jsx, isKnownComponent) {
  let ast;
  try { ast = parseCode(`const __kerf = (<>${jsx}</>);`, { strict: true }); }
  catch (e) { throw new KerfError(`The new element isn’t valid JSX (${e.message}).`); }
  const comps = [];
  walkP(ast.program.body[0], (n) => {
    if (n.type === 'JSXSpreadAttribute') throw new KerfError('New elements can’t spread properties.');
    if (n.type === 'JSXAttribute') {
      const nm = n.name.name;
      if (/^on[A-Z]/.test(nm) || nm === 'ref' || nm === 'dangerouslySetInnerHTML') throw new KerfError(`New elements can’t have ${nm}: Kerf adds visuals, not behavior.`);
    }
    if (n.type === 'JSXExpressionContainer' && !['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'JSXEmptyExpression'].includes(n.expression.type) && !(n.expression.type === 'TemplateLiteral' && !n.expression.expressions.length)) {
      throw new KerfError('New elements can only contain fixed text and values, not code.');
    }
    if (n.type === 'JSXOpeningElement') {
      const nm = n.name.type === 'JSXIdentifier' ? n.name.name : null;
      if (!nm) throw new KerfError('New elements must use plain tags or your components.');
      if (/^[a-z]/.test(nm)) { if (!SAFE_TAGS.has(nm)) throw new KerfError(`<${nm}> isn’t an element Kerf inserts.`); }
      else if (!isKnownComponent(nm)) throw new KerfError(`${nm} isn’t one of this project’s components or icons.`);
      else comps.push(nm);
    }
  });
  return [...new Set(comps)];
}

/* ---------- the operations ---------- */
// op: { type: 'delete' | 'duplicate' | 'move' | 'swap' | 'insert' | 'image', ... }
// ctx: { file, library } used to resolve imports.
export function structureEdit(code, line, col, op, ctx) {
  const { el, parent } = locate(code, line, col);
  const name = tagName(el, code);
  const s = new MagicString(code);
  let label, removedNames = [], imports = [];

  if (op.type === 'delete') {
    inJSX(parent, 'delete');
    let a = el.start, b = el.end;
    const ls = lineStart(code, a), le = code.indexOf('\n', b);
    if (!code.slice(ls, a).trim() && !code.slice(b, le === -1 ? code.length : le).trim()) { a = ls; b = le === -1 ? code.length : le + 1; }
    s.remove(a, b);
    removedNames = componentNames(el);
    label = `Deleted <${name}>`;
  } else if (op.type === 'duplicate') {
    inJSX(parent, 'duplicate');
    s.appendLeft(el.end, `\n${indentAt(code, el.start)}${code.slice(el.start, el.end)}`);
    label = `Duplicated <${name}>`;
  } else if (op.type === 'move') {
    inJSX(parent, 'move');
    const sibs = parent.children.filter((c) => c.type === 'JSXElement');
    const i = sibs.indexOf(el);
    const j = op.index != null ? Math.max(0, Math.min(sibs.length - 1, Number(op.index))) : op.dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= sibs.length) throw new KerfError(op.dir === 'up' ? 'It’s already first in its group.' : 'It’s already last in its group.');
    if (j === i) return { code, summary: { added: [], removed: [], offScale: [], text: null, props: [], action: null } };
    // Rotate the sibling texts so the element lands at position j and the others keep their order.
    const texts = sibs.map((c) => code.slice(c.start, c.end));
    const order = texts.slice();
    order.splice(j, 0, order.splice(i, 1)[0]);
    sibs.forEach((c, k) => { if (order[k] !== texts[k]) s.overwrite(c.start, c.end, order[k]); });
    label = `Moved <${name}> ${j < i ? 'up' : 'down'}`;
  } else if (op.type === 'swap') {
    const to = String(op.to || '').trim();
    if (!/^[A-Z][A-Za-z0-9]*$/.test(to)) throw new KerfError('Pick an icon or component to swap in.');
    // Stay in the icon library the current element comes from.
    const ast0 = parseCode(code);
    const cur = ast0.program.body.find((n) => n.type === 'ImportDeclaration' && n.specifiers.some((sp) => sp.local.name === name))?.source.value;
    const curIsIcon = cur && ctx.library.iconLibs?.()[cur];
    const lib = curIsIcon?.has(to) ? cur : !curIsIcon && ctx.library.componentList().has(to) ? null : ctx.library.findIcon(to);
    const comp = !lib && ctx.library.componentList().get(to);
    if (!lib && !comp) throw new KerfError(`${to} isn’t an icon or component in this project.`);
    if (!/^[A-Z]/.test(name)) throw new KerfError('Only icons and components can be swapped. To replace a plain element, delete it and insert a new one.');
    const n = el.openingElement.name;
    s.overwrite(n.start, n.end, to);
    if (el.closingElement) s.overwrite(el.closingElement.name.start, el.closingElement.name.end, to);
    imports.push([to, lib || ctx.library.importPath(ctx.file, comp.file)]);
    removedNames = [name];
    label = `Swapped ${name} → ${to}`;
  } else if (op.type === 'insert') {
    const comps = checkSnippet(op.jsx, (nm) => !!ctx.library.findIcon(nm) || ctx.library.componentList().has(nm));
    for (const c of comps) {
      // The project’s own components win over an icon with the same name (Badge, Card…).
      const comp = ctx.library.componentList().get(c);
      imports.push([c, comp ? ctx.library.importPath(ctx.file, comp.file) : ctx.library.findIcon(c)]);
    }
    let pos = op.position || 'after';
    const ind = indentAt(code, el.start);
    const canSibling = parent && (parent.type === 'JSXElement' || parent.type === 'JSXFragment');
    // Pick the nearest place that works: a page's outer box takes new elements inside it,
    // and an element that can't hold children gets the new one next to it.
    let note = '';
    let atStart = op.position === 'inside-start';
    if (pos === 'inside-start') pos = 'inside';
    if (pos !== 'inside' && !canSibling && el.closingElement) { atStart = pos === 'before'; pos = 'inside'; note = ` (it’s the outer box of this page or component, so it went inside, at the ${atStart ? 'top' : 'bottom'})`; }
    else if (pos === 'inside' && !el.closingElement && canSibling) { pos = 'after'; note = ` (<${name}> can’t hold elements, so it went after it)`; }
    if (pos === 'inside') {
      if (!el.closingElement) throw new KerfError(`<${name}> can’t hold other elements, and it has no neighbors Kerf can add to. Select the box around it.`);
      const cl = el.closingElement.start, cls = lineStart(code, cl);
      if (atStart) s.appendLeft(el.openingElement.end, `\n${ind}  ${op.jsx}`);
      else if (!code.slice(cls, cl).trim()) s.appendLeft(cls, `${ind}  ${op.jsx}\n`); // closing tag on its own line
      else s.appendLeft(cl, el.children.length ? op.jsx : `\n${ind}  ${op.jsx}\n${ind}`);
    } else {
      inJSX(parent, pos === 'before' ? 'insert before' : 'insert after');
      if (pos === 'before') s.appendRight(el.start, `${op.jsx}\n${ind}`);
      else s.appendLeft(el.end, `\n${ind}${op.jsx}`);
    }
    label = `Added ${comps.length ? comps.join(', ') : (op.jsx.match(/^<([a-z0-9]+)/i) || [])[1] || 'element'} ${pos} <${name}>${note}`;
  } else if (op.type === 'image') {
    if (name !== 'img') throw new KerfError('Select an image to change it.');
    const attr = (k) => el.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === k);
    const setLit = (k, v) => {
      const a = attr(k);
      if (!a) s.appendLeft(el.openingElement.name.end, ` ${k}=${JSON.stringify(v)}`);
      else if (a.value?.type === 'StringLiteral') s.overwrite(a.value.start, a.value.end, JSON.stringify(v));
      else throw new KerfError(`This image’s ${k} is set by code, so Kerf can’t change it here.`);
    };
    const parts = [];
    if (op.src) {
      const a = attr('src');
      if (a?.value?.type === 'JSXExpressionContainer' && a.value.expression.type === 'Identifier') {
        // src={logo} with `import logo from '…'`: point the import at the new file if nothing else uses it.
        const id = a.value.expression.name;
        const ast = parseCode(code);
        const decl = ast.program.body.find((n) => n.type === 'ImportDeclaration' && n.specifiers.some((sp) => sp.type === 'ImportDefaultSpecifier' && sp.local.name === id));
        let uses = 0;
        walkP(ast.program, (n, p) => { if (n.type === 'Identifier' && n.name === id && p?.type !== 'ImportDefaultSpecifier') uses++; });
        if (!decl || uses > 1) throw new KerfError('This image comes from code used elsewhere, so Kerf won’t change it here.');
        s.overwrite(a.value.start, a.value.end, JSON.stringify(op.src));
        removedNames.push(id);
      } else setLit('src', op.src);
      parts.push('image');
    }
    if (op.alt != null) { setLit('alt', String(op.alt)); parts.push('alt text'); }
    label = `Changed ${parts.join(' and ') || 'image'}`;
  } else throw new KerfError(`Unknown change: ${op.type}`);

  let out = s.toString();
  for (const [nm, src] of imports) out = ensureImport(out, nm, src);
  out = pruneImports(out, removedNames.filter((n) => !imports.some(([i]) => i === n)));
  try { parseCode(out, { strict: true }); }
  catch (e) { throw new KerfError(`Kerf stopped: the change would break the file (${e.message}).`); }
  return { code: out, summary: { added: [], removed: [], offScale: [], text: null, props: [], action: label } };
}
