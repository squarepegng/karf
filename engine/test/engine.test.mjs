import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTheme, applyOps } from '../src/tailwind.mjs';
import { editElement, describe, applyResponsive } from '../src/edit.mjs';
import { tagSource } from '../src/ast.mjs';

// A small theme shaped like a resolved Tailwind config.
const th = buildTheme({
  spacing: { 0: '0px', 1: '0.25rem', 2: '0.5rem', 3: '0.75rem', 4: '1rem', 5: '1.25rem', 6: '1.5rem' },
  borderRadius: { none: '0px', DEFAULT: '0.25rem', lg: '0.5rem', xl: '0.75rem', '2xl': '1rem', full: '9999px' },
  fontSize: { sm: ['0.875rem', { lineHeight: '1.25rem' }], base: ['1rem', {}], lg: ['1.125rem', {}] },
  fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700' },
  lineHeight: { none: '1', 5: '1.25rem', 6: '1.5rem' },
  letterSpacing: { tight: '-0.025em', normal: '0em', wide: '0.025em' },
  opacity: { 0: '0', 50: '0.5', 100: '1' },
  borderWidth: { DEFAULT: '1px', 0: '0px', 2: '2px' },
  boxShadow: { DEFAULT: 'x', card: 'var(--s-card)', none: 'none' },
  colors: { surface: 'rgb(var(--c-surface) / <alpha-value>)', 'surface-2': 'x', content: 'x', muted: 'x', border: 'x', primary: { DEFAULT: 'x', fg: 'x' } },
  fontFamily: { sans: [], display: [] },
  screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px' },
});

const ops = (list, o) => applyOps(list.split(' '), o, th).classes.join(' ');

test('colors swap only the matching color class, keeping size and variants', () => {
  assert.equal(ops('text-sm text-muted hover:text-content', [{ prop: 'color', value: 'content' }]), 'text-sm text-content hover:text-content');
  assert.equal(ops('bg-surface p-4', [{ prop: 'bg', value: 'surface-2' }]), 'bg-surface-2 p-4');
  assert.equal(ops('border border-border', [{ prop: 'borderC', value: 'primary' }]), 'border border-primary');
  assert.equal(ops('bg-surface', [{ prop: 'bg', value: '#B5651D' }]), 'bg-[#B5651D]');
});

test('font size and color are told apart', () => {
  assert.equal(ops('text-sm text-muted', [{ prop: 'fontSize', value: 18 }]), 'text-lg text-muted');
  assert.equal(ops('text-sm text-muted', [{ prop: 'fontSize', value: 15 }]), 'text-[15px] text-muted');
});

test('values snap to the scale, off-scale values become arbitrary classes', () => {
  assert.equal(ops('rounded-2xl border', [{ prop: 'radius', value: 8 }]), 'rounded-lg border');
  assert.equal(ops('rounded-2xl', [{ prop: 'radius', value: 4 }]), 'rounded');
  assert.equal(ops('rounded-2xl', [{ prop: 'radius', value: 20 }]), 'rounded-[20px]');
  assert.equal(ops('font-semibold', [{ prop: 'fontWeight', value: 700 }]), 'font-bold');
  assert.equal(ops('tracking-tight', [{ prop: 'letterSpacing', value: 2.5 }]), 'tracking-wide');
  assert.equal(ops('shadow-card', [{ prop: 'shadow', value: 'none' }]), 'shadow-none');
});

test('p-5 splits when only one axis changes', () => {
  assert.equal(ops('flex p-5', [{ prop: 'padX', value: 24 }]), 'flex py-5 px-6');
  assert.equal(ops('px-4 py-2', [{ prop: 'padY', value: 12 }]), 'px-4 py-3');
});

test('setting all corners clears single-corner classes', () => {
  assert.equal(ops('rounded-tl-lg rounded-br-xl', [{ prop: 'radius', value: 16 }]), 'rounded-2xl');
});

test('tagger stamps HTML elements and component usages', () => {
  const out = tagSource('const A = () => <Card className="x"><div>hi</div></Card>;', '/app/src/A.tsx', '/app').code;
  assert.match(out, /<Card data-kerf-use="src\/A.tsx:1:16"/);
  assert.match(out, /<div data-kerf="src\/A.tsx:1:36"/);
});

const CARD = `import { cn } from '@/lib/cn';
export const Card = ({ className, ...props }) => (
  <div
    className={cn('rounded-2xl border border-border bg-surface shadow-card', className)}
    {...props}
  />
);
export const Title = () => <h3 className="text-lg font-semibold">Market map</h3>;
export const Name = ({ n }) => <p className="text-sm">{n.name}</p>;
export const Box = () => <section>Plain</section>;
export const Dyn = ({ c }) => <div className={c}>x</div>;
`;

test('edits the string inside cn() and nothing else', () => {
  const { code, summary } = editElement(CARD, 3, 2, { ops: [{ prop: 'radius', value: 8 }, { prop: 'bg', value: 'surface-2' }] }, th);
  assert.match(code, /cn\('rounded-lg border border-border bg-surface-2 shadow-card', className\)/);
  assert.deepEqual(summary.added, ['rounded-lg', 'bg-surface-2']);
  assert.equal(code.split('\n').length, CARD.split('\n').length);
});

test('retypes fixed text, refuses text from data', () => {
  const { code } = editElement(CARD, 8, 27, { text: 'Opportunity map' }, th);
  assert.match(code, />Opportunity map<\/h3>/);
  assert.throws(() => editElement(CARD, 9, 31, { text: 'x' }, th), /comes from data/);
  assert.equal(describe(CARD, 9, 31).text.editable, false);
});

test('adds className when there is none, refuses computed classes', () => {
  const { code } = editElement(CARD, 10, 25, { ops: [{ prop: 'padX', value: 16 }] }, th);
  assert.match(code, /<section className="px-4">Plain<\/section>/);
  assert.throws(() => editElement(CARD, 11, 30, { ops: [{ prop: 'padX', value: 16 }] }, th), /computed/);
});

test('retypes a label that sits next to an icon', () => {
  const src = 'export const B = () => <button className="flex"><Icon /> Enter {/* note */}</button>;';
  const { code } = editElement(src, 1, 23, { text: 'Unlock' }, th);
  assert.match(code, /<Icon \/> Unlock \{/);
});

const ICONS = `import { Gear, House } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
export const A = () => <Gear weight="duotone" size={20} />;
export const B = () => <House size={collapsed ? 22 : 20} />;
export const C = () => <Button variant="ghost" onClick={go}>Go</Button>;
`;

test('component properties: read, change and add', () => {
  const d = describe(ICONS, 3, 23);
  assert.equal(d.lib, '@phosphor-icons/react');
  assert.deepEqual(d.props.find((p) => p.name === 'weight').options.includes('thin'), true);
  const { code } = editElement(ICONS, 3, 23, { props: [{ name: 'weight', value: 'light' }, { name: 'size', value: 18 }] }, th);
  assert.match(code, /<Gear weight="light" size=\{18\} \/>/);
  const added = editElement(ICONS, 3, 23, { props: [{ name: 'mirrored', value: true }] }, th).code;
  assert.match(added, /<Gear mirrored=\{true\} weight="duotone"/);
});

test('component properties: refuses bad values, computed props and behavior props', () => {
  assert.throws(() => editElement(ICONS, 3, 23, { props: [{ name: 'weight', value: 'heavy' }] }, th), /must be one of/);
  assert.throws(() => editElement(ICONS, 4, 23, { props: [{ name: 'size', value: 18 }] }, th), /set by code/);
  assert.throws(() => editElement(ICONS, 5, 23, { props: [{ name: 'onClick', value: 'x' }] }, th), /isn’t a property/);
  assert.match(editElement(ICONS, 5, 23, { props: [{ name: 'variant', value: 'outline' }] }, th).code, /variant="outline"/);
});

import { structureEdit } from '../src/structure.mjs';
const lib = {
  findIcon: (n) => (['Heart', 'Star', 'Bookmark'].includes(n) ? 'lucide-react' : null),
  componentList: () => new Map([['Badge', { name: 'Badge', file: '/app/src/components/ui/badge.tsx' }]]),
  importPath: () => '@/components/ui/badge',
};
const ctx = { file: '/app/src/Page.tsx', library: lib };
const PAGE = `import { Bookmark } from 'lucide-react';
import logo from '@/assets/logo.svg';
export const Page = ({ ok }) => (
  <div className="flex">
    <h1 className="text-xl">Title</h1>
    <p>Body</p>
    <Bookmark className="h-4 w-4" />
    <img src={logo} alt="Logo" />
    {ok && <span>Shown</span>}
  </div>
);
`;
const at = (n) => { const l = PAGE.split('\n')[n - 1]; return [n, l.search(/</)]; };

test('delete removes the element and its now-unused import', () => {
  const { code } = structureEdit(PAGE, ...at(7), { type: 'delete' }, ctx);
  assert.doesNotMatch(code, /Bookmark/);
  assert.match(code, /<p>Body<\/p>\n    <img/);
});
test('swap an icon updates the tag and the import', () => {
  const { code, summary } = structureEdit(PAGE, ...at(7), { type: 'swap', to: 'Heart' }, ctx);
  assert.match(code, /import \{ Heart \} from 'lucide-react';/);
  assert.match(code, /<Heart className="h-4 w-4" \/>/);
  assert.equal(summary.action, 'Swapped Bookmark → Heart');
  assert.throws(() => structureEdit(PAGE, ...at(7), { type: 'swap', to: 'Unicorn' }, ctx), /isn’t an icon/);
});
test('move and duplicate keep sibling order and indentation', () => {
  const moved = structureEdit(PAGE, ...at(6), { type: 'move', dir: 'up' }, ctx).code;
  assert.match(moved, /<p>Body<\/p>\n    <h1/);
  const dup = structureEdit(PAGE, ...at(5), { type: 'duplicate' }, ctx).code;
  assert.equal((dup.match(/<h1/g) || []).length, 2);
});
test('insert adds a component with its import, and refuses code', () => {
  const { code } = structureEdit(PAGE, ...at(5), { type: 'insert', position: 'after', jsx: '<Badge>New</Badge>' }, ctx);
  assert.match(code, /import \{ Badge \} from '@\/components\/ui\/badge';/);
  assert.match(code, /<\/h1>\n    <Badge>New<\/Badge>/);
  assert.throws(() => structureEdit(PAGE, ...at(5), { type: 'insert', jsx: '<button onClick={go}>x</button>' }, ctx), /behavior|code/);
  assert.match(structureEdit(PAGE, ...at(4), { type: 'insert', position: 'inside', jsx: '<p>End</p>' }, ctx).code, /<p>End<\/p>\n  <\/div>/);
});
test('image: new src replaces an imported image and drops the import; alt text', () => {
  const { code } = structureEdit(PAGE, ...at(8), { type: 'image', src: '/kerf/hero.png', alt: 'Hero' }, ctx);
  assert.match(code, /<img src="\/kerf\/hero.png" alt="Hero" \/>/);
  assert.doesNotMatch(code, /import logo/);
});
test('refuses to delete elements shown by code or a component root', () => {
  assert.throws(() => structureEdit(PAGE, 9, PAGE.split('\n')[8].indexOf('<span'), { type: 'delete' }, ctx), /condition/);
  assert.throws(() => structureEdit(PAGE, ...at(4), { type: "delete" }, ctx), /outer box/);
});

test('insert next to a page’s outer box goes inside it instead', () => {
  const { code, summary } = structureEdit(PAGE, ...at(4), { type: 'insert', position: 'before', jsx: '<img src="/kerf/a.png" alt="" />' }, ctx);
  assert.match(code, /<div className="flex">\n    <img src="\/kerf\/a.png" alt="" \/>/);
  assert.match(summary.action, /went inside/);
});

test('gradients replace solid fills, gradient text replaces the text color', () => {
  assert.equal(ops('bg-surface p-4', [{ prop: 'gradient', value: 'r primary surface-2' }]), 'p-4 bg-gradient-to-r from-primary to-surface-2');
  assert.equal(ops('bg-gradient-to-r from-primary to-surface p-4', [{ prop: 'bg', value: 'surface' }]), 'p-4 bg-surface');
  assert.equal(ops('font-bold text-primary', [{ prop: 'gradient', value: 'br primary content' }, { prop: 'clipText', value: 'on' }]), 'font-bold bg-gradient-to-br from-primary to-content bg-clip-text text-transparent');
  assert.equal(ops('bg-gradient-to-r from-primary to-content bg-clip-text text-transparent', [{ prop: 'gradient', value: 'none' }, { prop: 'clipText', value: 'off' }]), '');
});

test('replace swaps an element for new JSX in one step', () => {
  const { code, summary } = structureEdit(PAGE, ...at(5), { type: 'replace', jsx: '<h1 className="bg-gradient-to-r from-primary to-positive bg-clip-text text-transparent">Title</h1>' }, ctx);
  assert.match(code, /<h1 className="bg-gradient-to-r[^"]*">Title<\/h1>\n    <p>Body/);
  assert.equal(summary.action, 'Replaced <h1>');
  assert.match(structureEdit(PAGE, 9, PAGE.split('\n')[8].indexOf('<span'), { type: 'replace', jsx: '<strong>Shown</strong>' }, ctx).code, /\{ok && <strong>Shown<\/strong>\}/);
});

test('a transparent fill does not cancel a gradient', () => {
  assert.equal(ops('text-content', [{ prop: 'gradient', value: 'r primary positive' }, { prop: 'clipText', value: 'on' }, { prop: 'bg', value: 'transparent' }]), 'bg-gradient-to-r from-primary to-positive bg-clip-text text-transparent bg-transparent');
});

test('layout: margin, size, direction, alignment, wrap', () => {
  assert.equal(ops('m-4 text-sm', [{ prop: 'mY', value: 24 }]), 'mx-4 text-sm my-6');
  assert.equal(ops('block w-64', [{ prop: 'layout', value: 'row' }, { prop: 'w', value: 'fill' }]), 'flex flex-row w-full');
  assert.equal(ops('flex flex-col items-start', [{ prop: 'alignItems', value: 'center' }, { prop: 'justify', value: 'between' }, { prop: 'wrap', value: 'wrap' }]), 'flex flex-col items-center justify-between flex-wrap');
  assert.equal(ops('flex flex-row gap-2', [{ prop: 'layout', value: 'none' }]), 'gap-2');
  assert.equal(ops('h-10', [{ prop: 'h', value: 'hug' }]), 'h-fit');
  assert.equal(ops('w-full', [{ prop: 'w', value: 16 }]), 'w-4');
});

const BTN = `import { cva } from 'class-variance-authority';
const buttonVariants = cva('inline-flex rounded-full text-sm', {
  variants: {
    variant: { default: 'bg-ink text-ink-fg', ghost: 'border bg-surface text-content' },
    size: { default: 'px-5 py-2', sm: 'px-3.5 py-1.5 text-xs' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
const Button = ({ className, variant, size, ...props }) => (
  <button className={cn(buttonVariants({ variant, size, className }))} {...props} />
);
`;
test('variant components: edit one variant, or every button', () => {
  const d = describe(BTN, 10, 2);
  assert.equal(d.classKind, 'cva');
  assert.deepEqual(d.cva.groups.variant, ['default', 'ghost']);
  const ghost = editElement(BTN, 10, 2, { ops: [{ prop: 'bg', value: 'primary' }], cva: { mode: 'variant', active: { variant: 'ghost', size: 'default' } } }, th).code;
  assert.match(ghost, /ghost: 'border bg-primary text-content'/);
  assert.match(ghost, /default: 'bg-ink text-ink-fg'/);
  const all = editElement(BTN, 10, 2, { ops: [{ prop: 'radius', value: 8 }, { prop: 'padX', value: 24 }], cva: { mode: 'all' } }, th).code;
  assert.match(all, /cva\('inline-flex rounded-lg text-sm/);
  assert.match(all, /default: 'px-6 py-2', sm: 'px-6 py-1.5 text-xs'/);
  // Size owns padding, so a padding change for the default variant only becomes a compound variant.
  const small = editElement(BTN, 10, 2, { ops: [{ prop: 'padY', value: 8 }], cva: { mode: 'variant', active: { size: 'sm' } } }, th).code;
  assert.match(small, /compoundVariants: \[\{ variant: 'default', class: 'py-2' \}\]/);
});

test('variant-only overrides of a size-owned property use a compound variant', () => {
  const r = editElement(BTN, 10, 2, { ops: [{ prop: 'padX', value: 24 }], cva: { mode: 'variant', active: { variant: 'ghost', size: 'default' } } }, th).code;
  assert.match(r, /compoundVariants: \[\{ variant: 'ghost', class: 'px-6' \}\]/);
  const L = r.split('\n').findIndex((l) => l.includes('<button')) + 1;
  const r2 = editElement(r, L, 2, { ops: [{ prop: 'padY', value: 12 }], cva: { mode: 'variant', active: { variant: 'ghost', size: 'default' } } }, th).code;
  assert.match(r2, /class: 'px-6 py-3'/);
});

test('Fill inside a horizontal row takes the remaining space; elsewhere it fills the width', () => {
  const ROW = `export const A = () => (
  <div className="flex flex-row gap-2">
    <input className="input" />
    <button className="btn">Go</button>
  </div>
);
export const B = () => <div className="flex flex-col"><input className="input" /></div>;
`;
  assert.match(editElement(ROW, 3, 4, { ops: [{ prop: 'w', value: 'fill' }] }, th).code, /<input className="input flex-1" \/>/);
  assert.match(editElement(ROW, 7, ROW.split('\n')[6].indexOf('<input'), { ops: [{ prop: 'w', value: 'fill' }] }, th).code, /<input className="input w-full" \/>/);
});

test('group neighbors into a frame, and ungroup it again', () => {
  const FORM = `export const F = () => (
  <form className="flex flex-col gap-3">
    <label>Code</label>
    <input className="input" />
    <button className="btn">Enter</button>
  </form>
);
`;
  const g = structureEdit(FORM, 4, 4, { type: 'group', others: ['src/F.tsx:5:4'], className: 'flex flex-row items-center gap-2' }, ctx);
  assert.match(g.code, /<label>Code<\/label>\n    <div className="flex flex-row items-center gap-2">\n      <input className="input" \/>\n      <button className="btn">Enter<\/button>\n    <\/div>/);
  assert.equal(g.summary.action, 'Grouped 2 elements into a frame');
  assert.throws(() => structureEdit(FORM, 3, 4, { type: 'group', others: ['src/F.tsx:5:4'] }, ctx), /next to each other/);
  const u = structureEdit(g.code, 4, 4, { type: 'ungroup' }, ctx).code;
  assert.equal(u, FORM);
});

test('grouping reports where each element moved', () => {
  const FORM = `export const F = () => (
  <form className="flex flex-col gap-3">
    <input className="input" />
    <button className="btn">
      Enter
    </button>
    <p>Below</p>
  </form>
);
`;
  const g = structureEdit(FORM, 3, 4, { type: 'group', others: ['src/F.tsx:4:4'] }, ctx);
  assert.deepEqual(g.moved, [['3:4', '4:6'], ['4:4', '5:6']]);
  assert.deepEqual(g.shift, { after: 6, delta: 2 });
  assert.ok(editElement(g.code, 5, 6, { ops: [{ prop: 'w', value: 'hug' }] }, th).code.includes('<button className="btn w-fit">'));
  assert.ok(editElement(g.code, 9, 4, { ops: [{ prop: 'padX', value: 16 }] }, th).code.includes('<p className="px-4">Below</p>'));
});

const rsp = (list, o, bp) => applyResponsive(list.split(' '), o, th, bp).classes.join(' ');
test('only on mobile keeps the old value from tablet up', () => {
  assert.equal(rsp('text-lg px-4', [{ prop: 'fontSize', value: 14 }], { mode: 'only', start: null, end: 'md' }), 'px-4 text-sm md:text-lg');
});
test('only on tablet sets md: and keeps desktop as it was', () => {
  assert.equal(rsp('px-4', [{ prop: 'padX', value: 24 }], { mode: 'only', start: 'md', end: 'lg' }), 'px-4 md:px-6 lg:px-4');
});
test('only on desktop replaces lg: and drops bigger overrides', () => {
  assert.equal(rsp('px-4 lg:px-5 xl:px-6', [{ prop: 'padX', value: 8 }], { mode: 'only', start: 'lg', end: null }), 'px-4 lg:px-2');
});
test('all sizes sets the base value and removes size overrides', () => {
  assert.equal(rsp('text-sm md:text-lg font-bold', [{ prop: 'fontSize', value: 16 }], { mode: 'all' }), 'font-bold text-base');
});
test('an existing override at the end screen is left alone', () => {
  assert.equal(rsp('px-4 md:px-6', [{ prop: 'padX', value: 8 }], { mode: 'only', start: null, end: 'md' }), 'md:px-6 px-2');
});

// Styles that live outside the element: a status table in another file, like Stratemark's chips.
import fs0 from 'node:fs';
import os0 from 'node:os';
import path0 from 'node:path';
import { createEditor } from '../src/edit.mjs';
function chipProject() {
  const root = fs0.mkdtempSync(path0.join(os0.tmpdir(), 'kerf-src-'));
  fs0.mkdirSync(path0.join(root, 'src/lib'), { recursive: true });
  fs0.writeFileSync(path0.join(root, 'src/lib/cn.ts'), "import { twMerge } from 'tailwind-merge';\nexport function cn(...a: string[]) { return twMerge(a.join(' ')); }\n");
  fs0.writeFileSync(path0.join(root, 'src/lib/format.ts'), "export const STYLES: Record<string, string> = {\n  verified: 'border-surface bg-surface text-content',\n  estimated: 'border-muted bg-muted text-content',\n};\n");
  fs0.writeFileSync(path0.join(root, 'src/Badge.tsx'), "import { cn } from '@/lib/cn';\nimport { STYLES } from '@/lib/format';\nexport function Badge({ c }: { c: string }) {\n  return <span className={cn('chip', STYLES[c], 'cursor-help')}>x</span>;\n}\n");
  return root;
}
const editorFor = (root) => createEditor(root, () => th, { findIcon: () => null, componentList: () => new Map() });
const chipLoc = 'src/Badge.tsx:4:9';
const dom = ['chip', 'border-surface', 'bg-surface', 'text-content', 'cursor-help'];

test('a style from a status table is changed in the table, for that status', () => {
  const root = chipProject(), ed = editorFor(root);
  const d = ed.describe(chipLoc, dom);
  assert.equal(d.classKind, 'sourced');
  assert.equal(d.sources.find((s) => s.kind === 'table').key, 'verified');
  ed.edit(chipLoc, { ops: [{ prop: 'bg', value: 'primary' }], dom });
  const t = fs0.readFileSync(path0.join(root, 'src/lib/format.ts'), 'utf8');
  assert.match(t, /verified: 'border-surface bg-primary text-content'/);
  assert.match(t, /estimated: 'border-muted bg-muted text-content'/);
  ed.undo();
  assert.match(fs0.readFileSync(path0.join(root, 'src/lib/format.ts'), 'utf8'), /verified: 'border-surface bg-surface text-content'/);
});
test('a table target can change every status, or one other status', () => {
  const root = chipProject(), ed = editorFor(root);
  ed.edit(chipLoc, { ops: [{ prop: 'padX', value: 8 }], dom, target: 'table:STYLES:*' });
  const t = fs0.readFileSync(path0.join(root, 'src/lib/format.ts'), 'utf8');
  assert.equal((t.match(/px-2/g) || []).length, 2);
  ed.edit(chipLoc, { ops: [{ prop: 'color', value: 'muted' }], dom, target: 'table:STYLES:estimated' });
  assert.match(fs0.readFileSync(path0.join(root, 'src/lib/format.ts'), 'utf8'), /estimated: 'border-muted bg-muted text-muted px-2'/);
});
test('"only this one" adds an override after the table when cn merges classes', () => {
  const root = chipProject(), ed = editorFor(root);
  ed.edit(chipLoc, { ops: [{ prop: 'bg', value: 'primary' }], dom, scope: 'here' });
  assert.match(fs0.readFileSync(path0.join(root, 'src/Badge.tsx'), 'utf8'), /cn\('chip', STYLES\[c\], 'cursor-help bg-primary'\)/);
  assert.match(fs0.readFileSync(path0.join(root, 'src/lib/format.ts'), 'utf8'), /verified: 'border-surface bg-surface text-content'/);
});

import { valueToHex, hexToValue } from '../src/tokens.mjs';
test('colour tokens are read and written in the format the app uses', () => {
  assert.equal(valueToHex('15 118 110', 'rgb'), '#0F766E');
  assert.equal(hexToValue('#14B8A6', '45 200 182', 'rgb'), '20 184 166');
  assert.equal(hexToValue('#14B8A6', '45, 200, 182', 'rgb'), '20, 184, 166');
  assert.equal(valueToHex(hexToValue('#14B8A6', '173 58% 39%', 'hsl'), 'hsl'), '#14B8A6');
  assert.equal(hexToValue('#14b8a6', '#2DC8B6'), '#14B8A6');
});

test('a new class string is added after the last argument even with a trailing comma', () => {
  const root = fs0.mkdtempSync(path0.join(os0.tmpdir(), 'kerf-tc-'));
  fs0.mkdirSync(path0.join(root, 'src/lib'), { recursive: true });
  fs0.writeFileSync(path0.join(root, 'src/lib/cn.ts'), "import { twMerge } from 'tailwind-merge';\nexport function cn(...a: string[]) { return twMerge(a.join(' ')); }\n");
  fs0.writeFileSync(path0.join(root, 'src/Chip.tsx'), "import { cn } from '@/lib/cn';\nexport function Chip({ on }: { on: boolean }) {\n  return (\n    <button\n      className={cn(\n        'rounded-full px-2',\n        on ? 'bg-primary text-content' : 'bg-surface text-muted',\n      )}\n    >x</button>\n  );\n}\n");
  const ed = editorFor(root);
  ed.edit('src/Chip.tsx:4:4', { ops: [{ prop: 'bg', value: '#2A2350' }], dom: ['rounded-full', 'px-2', 'bg-surface', 'text-muted'], target: 'element' });
  const out = fs0.readFileSync(path0.join(root, 'src/Chip.tsx'), 'utf8');
  assert.match(out, /'bg-surface text-muted',\n        'bg-\[#2A2350\]',\n      \)\}/);
});
