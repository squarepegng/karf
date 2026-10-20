// End-to-end check against a running app with Kerf attached:
// make real edits through the API, then the caller type-checks and diffs.
//   node scripts/live-check.mjs http://localhost:5173
const base = (process.argv[2] || 'http://localhost:5173') + '/__kerf';
const call = async (route, body) => {
  const r = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};
const cases = [
  ['Card everywhere: radius 8, fill surface-2', '/edit', { loc: 'src/components/ui/card.tsx:6:4', ops: [{ prop: 'radius', value: 8 }, { prop: 'bg', value: 'surface-2' }] }],
  ['CardTitle: bold, 20px', '/edit', { loc: 'src/components/ui/card.tsx:24:4', ops: [{ prop: 'fontWeight', value: 700 }, { prop: 'fontSize', value: 20 }] }],
  ['CardDescription: text color content', '/edit', { loc: 'src/components/ui/card.tsx:35:4', ops: [{ prop: 'color', value: 'content' }] }],
  ['CardContent: horizontal padding 24 (splits p-5)', '/edit', { loc: 'src/components/ui/card.tsx:42:4', ops: [{ prop: 'padX', value: 24 }] }],
  ['NotFound heading: retype text', '/edit', { loc: 'src/features/NotFoundPage.tsx:7:6', text: 'Nothing here yet' }],
  ['NotFound heading: off-scale size 30px', '/edit', { loc: 'src/features/NotFoundPage.tsx:7:6', ops: [{ prop: 'fontSize', value: 30 }] }],
  ['Inspect a component usage', '/inspect', { loc: 'src/features/deck/CardGrid.tsx:77:6' }],
];
let fail = 0;
for (const [name, route, body] of cases) {
  const r = await call(route, body);
  const ok = r.status === 200;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log('      ' + JSON.stringify(r.summary || r.error || { tag: r.tag, classKind: r.classKind, text: r.text }).slice(0, 220));
}
const undo = await call('/undo', {});
console.log(`${undo.undone ? 'PASS' : 'FAIL'}  Undo last edit (${undo.file})`);
process.exit(fail ? 1 : 0);
