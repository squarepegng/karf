// Parsing helpers shared by the tagger and the editor.
import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import path from 'node:path';

// Plain .ts files can't be read as JSX (`<T>value` means a type there), so they skip the jsx plugin.
export function parseCode(code, { strict = false, file = '' } = {}) {
  return parse(code, {
    sourceType: 'module',
    plugins: /\.[cm]?ts$/.test(file) ? ['typescript'] : ['jsx', 'typescript'],
    errorRecovery: !strict,
  });
}

const SKIP = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments']);

export function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const key in node) {
    if (SKIP.has(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') walk(c, fn);
    } else if (v && typeof v.type === 'string') walk(v, fn);
  }
}

// Stamp every JSX element with where it lives in the source:
//   data-kerf="src/file.tsx:line:col"     on HTML elements (div, span, …)
//   data-kerf-use="src/file.tsx:line:col" on component usages (<Card>, <Button>)
// Components that spread their props onto a DOM element pass data-kerf-use
// through, so one DOM node knows both where it is defined and where it is used.
export function tagSource(code, file, root) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  let ast;
  try {
    ast = parseCode(code);
  } catch {
    return null;
  }
  const s = new MagicString(code);
  let count = 0;
  walk(ast.program, (node) => {
    if (node.type !== 'JSXOpeningElement') return;
    const name = node.name;
    if (name.type === 'JSXIdentifier' && name.name === 'Fragment') return;
    if (name.type === 'JSXMemberExpression' && name.property.name === 'Fragment') return;
    const intrinsic = name.type === 'JSXIdentifier' && /^[a-z]/.test(name.name);
    const attr = intrinsic ? 'data-kerf' : 'data-kerf-use';
    if (node.attributes.some((a) => a.type === 'JSXAttribute' && a.name.name === attr)) return;
    // Component usages also carry their name, for the Layers panel.
    const label = intrinsic ? '' : ` data-kerf-n="${code.slice(name.start, name.end)}"`;
    s.appendLeft(name.end, ` ${attr}="${rel}:${node.loc.start.line}:${node.loc.start.column}"${label}`);
    count++;
  });
  if (!count) return null;
  return { code: s.toString(), map: s.generateMap({ hires: true, source: file }) };
}
