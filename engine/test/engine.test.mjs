import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTheme, applyOps } from '../src/tailwind.mjs';
import { editElement, describe } from '../src/edit.mjs';
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
