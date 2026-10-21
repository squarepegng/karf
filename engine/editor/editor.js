// Kerf editor. The team's real app runs in the iframe; this window holds the
// editor around it (top bar, layers, design panel, toolbar). The iframe is
// same-origin, so the editor reads and outlines the app's DOM directly.
(() => {
  /* ---------- api ---------- */
  const api = (route, body) =>
    fetch('/__kerf' + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.statusText);
      return j;
    });

  /* ---------- state ---------- */
  const S = {
    mode: 'preview', tool: 'select', tab: 'design', side: 'design', device: 'desktop',
    sel: null, hover: null, theme: null, project: null, scope: 'all',
    count: 0, corners: false, cpick: null, editing: null, changesOpen: false,
    chat: [], card: null, askOpen: false, shape: 'box', notes: [], noteDraft: null, amber: [],
    versions: { versions: [], draft: [], peeking: null }, open: {}, multi: [], alt: false, handleDrag: null, path: '/', hintSeen: false, layersOpen: innerWidth >= 1180,
  };
  const $ = (id) => document.getElementById(id);
  const frame = $('frame');
  let W = null, D = null; // the app's window and document

  /* ---------- properties ---------- */
  const PX = (css) => (v) => ({ [css]: v + 'px' });
  const PROPS = {
    bg: { css: (v) => ({ background: v }) },
    color: { css: (v) => ({ color: v }) },
    borderC: { css: (v) => ({ 'border-color': v }) },
    fontSize: { min: 6, max: 200, css: PX('font-size') },
    fontWeight: { css: (v) => ({ 'font-weight': v }) },
    lineHeight: { min: 0, max: 200, css: PX('line-height') },
    letterSpacing: { min: -20, max: 50, css: (v) => ({ 'letter-spacing': v / 100 + 'em' }) },
    align: { css: (v) => ({ 'text-align': v }) },
    radius: { max: 999, css: PX('border-radius') },
    rTL: { max: 999, css: PX('border-top-left-radius') },
    rTR: { max: 999, css: PX('border-top-right-radius') },
    rBR: { max: 999, css: PX('border-bottom-right-radius') },
    rBL: { max: 999, css: PX('border-bottom-left-radius') },
    padX: { max: 400, css: (v) => ({ 'padding-left': v + 'px', 'padding-right': v + 'px' }) },
    padY: { max: 400, css: (v) => ({ 'padding-top': v + 'px', 'padding-bottom': v + 'px' }) },
    gap: { max: 400, css: PX('gap') },
    borderW: { max: 20, css: (v) => ({ 'border-width': v + 'px', 'border-style': 'solid' }) },
    opacity: { max: 100, css: (v) => ({ opacity: v / 100 }) },
    shadow: { css: () => ({}) },
    mX: { min: -400, max: 400, css: (v) => ({ 'margin-left': v + 'px', 'margin-right': v + 'px' }) },
    mY: { min: -400, max: 400, css: (v) => ({ 'margin-top': v + 'px', 'margin-bottom': v + 'px' }) },
    w: { max: 4000, css: PX('width') },
    h: { max: 4000, css: PX('height') },
  };
  const clamp = (p, v) => Math.max(PROPS[p].min ?? 0, Math.min(PROPS[p].max ?? 9999, v));
  // An element from a page that has since reloaded has no window: fall back to the current one.
  const cs = (el) => (el.ownerDocument?.defaultView || W || window).getComputedStyle(el);
  const rgbHex = (c) => {
    const m = String(c).match(/[\d.]+/g);
    if (!m) return '';
    if (m.length > 3 && +m[3] === 0) return 'transparent';
    return '#' + m.slice(0, 3).map((x) => ('0' + Math.round(+x).toString(16)).slice(-2)).join('').toUpperCase();
  };
  function read(p, el) {
    if (!el || !el.isConnected) return '';
    const c = cs(el), fs = parseFloat(c.fontSize);
    switch (p) {
      case 'bg': return rgbHex(c.backgroundColor);
      case 'color': return rgbHex(c.color);
      case 'borderC': return rgbHex(c.borderTopColor);
      case 'fontSize': return Math.round(fs);
      case 'fontWeight': return Number(c.fontWeight);
      case 'lineHeight': return c.lineHeight === 'normal' ? Math.round(fs * 1.2) : Math.round(parseFloat(c.lineHeight));
      case 'letterSpacing': return c.letterSpacing === 'normal' ? 0 : Math.round((parseFloat(c.letterSpacing) / fs) * 1000) / 10;
      case 'align': { const a = c.textAlign; return a === 'start' ? 'left' : a === 'end' ? 'right' : a; }
      case 'radius': case 'rTL': return Math.round(parseFloat(c.borderTopLeftRadius));
      case 'rTR': return Math.round(parseFloat(c.borderTopRightRadius));
      case 'rBR': return Math.round(parseFloat(c.borderBottomRightRadius));
      case 'rBL': return Math.round(parseFloat(c.borderBottomLeftRadius));
      case 'padX': return Math.round(parseFloat(c.paddingLeft));
      case 'padY': return Math.round(parseFloat(c.paddingTop));
      case 'gap': return Math.round(parseFloat(c.columnGap)) || 0;
      case 'borderW': return Math.round(parseFloat(c.borderTopWidth));
      case 'opacity': return Math.round(Number(c.opacity) * 100);
      case 'mX': return Math.round(parseFloat(c.marginLeft)) || 0;
      case 'mY': return Math.round(parseFloat(c.marginTop)) || 0;
      case 'w': return Math.round(el.getBoundingClientRect().width);
      case 'h': return Math.round(el.getBoundingClientRect().height);
    }
    return '';
  }

  /* ---------- theme helpers ---------- */
  const SHADES = /-(50|[1-9]00|950)$/;
  const tokens = () => Object.entries(S.theme?.colors || {}).filter(([k]) => !SHADES.test(k) && !['inherit', 'current'].includes(k));
  // Token colors are CSS variables defined by the app, so resolve them in the app's document.
  function swatch(v) {
    const css = String(v).replace('<alpha-value>', '1');
    if (!D || !css.includes('var(')) return css;
    const probe = D.createElement('span');
    probe.style.color = css;
    D.body.appendChild(probe);
    const out = cs(probe).color;
    probe.remove();
    return out;
  }
  function tokenOf(prop) {
    const pre = { bg: 'bg-', color: 'text-', borderC: 'border-' }[prop];
    const cls = (info()?.classes || []).filter((c) => !c.includes(':') && c.startsWith(pre)).map((c) => c.slice(pre.length).split('/')[0]);
    return cls.find((c) => S.theme && c in S.theme.colors) || (cls.find((c) => /^\[#/.test(c)) || '').replace(/[[\]]/g, '');
  }
  function shadowOf() {
    const c = (info()?.classes || []).find((x) => !x.includes(':') && (x === 'shadow' || x.startsWith('shadow-')));
    if (!c) return 'none';
    return c === 'shadow' ? 'DEFAULT' : c.slice(7);
  }

  /* ---------- selection ---------- */
  const pick = (t) => (t && t.closest ? t.closest('[data-kerf],[data-kerf-use]') : null);
  const defOf = (el) => el.getAttribute('data-kerf');
  const useOf = (el) => el.getAttribute('data-kerf-use');
  const layerIcon = (el) => { const k = kindOf(el); return / icon$|^Icon$/.test(k) ? 'spark' : k === 'Image' ? 'image' : useOf(el) && /^[A-Z]/.test(el.getAttribute('data-kerf-n') || '') ? 'comp' : TEXTY.has(k) && !el.childElementCount ? 'text' : k === 'Row' ? 'padH' : k === 'Stack' ? 'padV' : 'frame'; };
  const nameOf = (el) => el.getAttribute('data-kerf-n') || el.tagName.toLowerCase();
  const fileName = (loc) => (loc || '').split(':')[0].split('/').pop();
  /* names a designer would use: "Title “Stratemark”", "Button “Enter”", "Row", "Key round icon" */
  const TAGN = { h1: 'Title', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading', p: 'Text', span: 'Text', strong: 'Text', em: 'Text', small: 'Text', b: 'Text', i: 'Text', label: 'Label', a: 'Link', button: 'Button', img: 'Image', picture: 'Image', svg: 'Icon', input: 'Input', textarea: 'Text box', select: 'Dropdown', form: 'Form', ul: 'List', ol: 'List', li: 'List item', nav: 'Navigation', header: 'Header', footer: 'Footer', aside: 'Sidebar', section: 'Section', main: 'Page', article: 'Card', hr: 'Divider', video: 'Video', table: 'Table', tr: 'Table row', td: 'Cell', th: 'Cell', code: 'Code', blockquote: 'Quote', dialog: 'Dialog' };
  const TEXTY = new Set(['Title', 'Heading', 'Text', 'Label', 'Link', 'Button', 'List item', 'Quote', 'Cell']);
  const camelWords = (n) => n.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  const clip = (t, n = 24) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  function kindOf(el) {
    const tag = el.tagName.toLowerCase(), comp = el.getAttribute('data-kerf-n');
    if (comp && /^[A-Z]/.test(comp)) { const w = camelWords(comp); return tag === 'svg' || /Icon$/.test(comp) ? `${w.replace(/ Icon$/, '')} icon` : w; }
    if (TAGN[tag]) return TAGN[tag];
    if (!el.childElementCount && (el.textContent || '').trim()) return 'Text';
    const c = cs(el);
    if (c.display.includes('grid')) return 'Grid';
    if (c.display.includes('flex')) return c.flexDirection.startsWith('column') ? 'Stack' : 'Row';
    return 'Frame';
  }
  // The words shown next to an element: its text, placeholder or alt text.
  function wordsOf(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') return clip(el.getAttribute('alt'));
    if (tag === 'input' || tag === 'textarea') return clip(el.getAttribute('placeholder') || el.value);
    return clip(el.textContent);
  }
  function dName(el) {
    if (!el) return '';
    const k = kindOf(el), w = wordsOf(el);
    return w && (TEXTY.has(k) || el.getAttribute('data-kerf-n') || /^(input|textarea|img)$/i.test(el.tagName)) && !/ icon$/.test(k) ? `${k} “${w}”` : k;
  }
  const activeLoc = () => (S.sel ? (S.scope === 'here' ? S.sel.use || S.sel.def : S.sel.def || S.sel.use) : null);
  const cvaParam = () => (S.sel?.defInfo?.cva && activeLoc() === S.sel.def ? { mode: S.scope === 'variant' ? 'variant' : 'all', active: activeVariant() } : undefined);
  const info = () => (S.sel ? (activeLoc() === S.sel.def ? S.sel.defInfo : S.sel.useInfo) : null);
  const q = (loc) => `[data-kerf="${CSS.escape(loc)}"],[data-kerf-use="${CSS.escape(loc)}"]`;
  const sameLoc = (el) => (D ? D.querySelectorAll(defOf(el) ? `[data-kerf="${CSS.escape(defOf(el))}"]` : `[data-kerf-use="${CSS.escape(useOf(el))}"]`) : []);

  async function select(el) {
    S.srcScope = 'key';
    S.iconQ = null;
    closeIconPop?.();
    if (!el) { S.multi = []; S.sel = null; S.cpick = null; renderPanel(); renderLayers(); return; }
    const list = [...sameLoc(el)];
    S.sel = { el, def: defOf(el), use: useOf(el), idx: Math.max(0, list.indexOf(el)), repeat: list.length, defInfo: null, useInfo: null };
    if (!S.sel.def) S.scope = 'here';
    else if (!S.sel.use) S.scope = 'all';
    S.cpick = null;
    let p = el.parentElement;
    while (p) { const t = pick(p); if (!t) break; S.open[keyOf(t)] = true; p = t.parentElement; }
    renderPanel();
    renderLayers();
    await loadInfo();
  }
  async function loadInfo() {
    const s = S.sel;
    if (!s) return;
    const dom = [...s.el.classList];
    const get = (loc) => (loc ? api('/inspect', { loc, dom }).catch((e) => ({ error: e.message })) : null);
    const [d, u] = await Promise.all([get(s.def), get(s.use)]);
    if (S.sel !== s) return;
    s.defInfo = d;
    s.useInfo = u;
    renderPanel();
  }
  // After an edit the app re-renders and the element may be a new node: find it again.
  function refind() {
    const s = S.sel;
    if (!s || !D || (s.el.isConnected && s.el.ownerDocument === D)) return;
    const list = D.querySelectorAll(s.def ? `[data-kerf="${CSS.escape(s.def)}"]` : `[data-kerf-use="${CSS.escape(s.use)}"]`);
    if (list.length) { s.el = list[Math.min(s.idx, list.length - 1)]; s.repeat = list.length; }
  }

  /* ---------- editing ---------- */
  let previewed = null;
  function preview(el, prop, value) {
    const css = PROPS[prop].css(value);
    for (const k in css) el.style.setProperty(k, css[k], 'important');
    previewed = { el, keys: Object.keys(css) };
  }
  function clearPreview() {
    if (!previewed) return;
    previewed.keys.forEach((k) => previewed.el.style.removeProperty(k));
    previewed = null;
  }
  async function commit(change) {
    const loc = activeLoc();
    if (!loc) return;
    try {
      if (S.multi.length) {
        // Several selected: apply the same change to each one, in a safe order.
        const edits = [{ loc, ...change, cva: cvaParam(), name: dName(S.sel.el), dom: [...S.sel.el.classList] }, ...S.multi.map((m) => ({ loc: locOf(m), ...change, name: dName(m.el), dom: [...m.el.classList] }))];
        const r = await api('/ai/apply', { edits: edits.map((e) => ({ loc: e.loc, ops: e.ops || [], props: e.props || [], text: e.text, name: e.name, dom: e.dom, bp: bpParam() })) });
        S.count = r.n;
        const ok = r.results.filter((x) => x.ok && x.changed).length;
        toast(`${ok} element${ok === 1 ? '' : 's'} · ${(r.results.find((x) => x.summary)?.summary.labels || []).join(' · ')}`, r.results.some((x) => !x.ok) ? r.results.find((x) => !x.ok).error : '', false, true);
      } else {
        const r = await api('/edit', { loc, ...change, cva: cvaParam(), bp: bpParam(), dom: S.sel ? [...S.sel.el.classList] : [], scope: S.srcScope || 'key', name: S.sel ? dName(S.sel.el) : null });
        if (r.changed) {
          S.count = r.n;
          const sm = r.summary;
          const who = S.sel ? dName(S.sel.el) : '';
          const where = sm.scope === 'variant' ? ` (all “${activeVariant()?.variant}”)` : sm.scope === 'all' ? ' (every one)' : '';
          if (sm.size) sm.labels = (sm.labels || []).map((l) => l.replace(/ \((only on \w+|all sizes)\)$/, ''));
          toast(`${who}${where} · ${(sm.labels || []).join(' · ')}${sm.size ? ` · ${sm.size.toLowerCase()}` : ''}`, sm.offScale.length ? 'Some values are off your design scale' : '', false, true, `${fileName(r.file)}: ${[sm.removed.join(' ') || '—', sm.added.join(' ')].join(' → ')}`);
        }
      }
      afterEdit();
    } catch (e) {
      clearPreview();
      toast(e.message, '', true);
    }
  }
  function afterEdit() {
    // Give Vite and Tailwind a moment to reload, then show the real result.
    [250, 700, 1500].forEach((ms) => setTimeout(() => { clearPreview(); refind(); loadInfo(); renderLayers(); }, ms));
    refreshVersions();
    renderBar();
    renderTop();
  }
  const pending = {};
  function commitSoon(prop, value) {
    clearTimeout(pending[prop]);
    pending[prop] = setTimeout(() => commit({ ops: [{ prop, value }] }), 450);
  }
  async function undo() {
    try {
      const r = await api('/undo', {});
      if (r.undone) { S.count = r.n; toast(r.label ? `Undone: ${r.label}` : 'Undone'); afterEdit(); renderChanges(); }
      else toast('Nothing to undo');
    } catch (e) { toast(e.message, '', true); }
  }

  /* ---------- text editing on the canvas ---------- */
  function beginText() {
    const s = S.sel, ti = info()?.text;
    if (!s || !ti) return;
    if (!ti.editable) { toast(ti.reason, '', true); return; }
    const el = s.el, orig = el.textContent;
    S.editing = el;
    el.contentEditable = 'true';
    el.focus();
    const r = D.createRange();
    r.selectNodeContents(el);
    const sel = W.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    const done = (save) => {
      el.removeEventListener('keydown', kd, true);
      el.removeEventListener('blur', bl);
      el.contentEditable = 'false';
      S.editing = null;
      const v = el.textContent.trim();
      if (save && v && v !== orig.trim()) commit({ text: v });
      else el.textContent = orig;
    };
    const kd = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); el.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); el.removeEventListener('blur', bl); done(false); }
    };
    const bl = () => done(true);
    el.addEventListener('keydown', kd, true);
    el.addEventListener('blur', bl);
  }

  /* ---------- icons ---------- */
  const IC = {
    kerf: '<rect x="2" y="3" width="5.5" height="10" rx="1.5" fill="currentColor"/><rect x="8.5" y="3" width="5.5" height="10" rx="1.5" fill="currentColor" opacity=".45"/>',
    play: '<path d="M5 3.2v9.6l7.5-4.8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
    edit: '<rect x="2" y="2" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8.5 8.5l5.2 2-2.3.7-.7 2.3z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
    undo: '<path d="M4 6h6a3.5 3.5 0 0 1 0 7H6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M6.5 3.5L4 6l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
    list: '<path d="M5.5 4h8M5.5 8h8M5.5 12h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="2.8" cy="4" r=".9" fill="currentColor"/><circle cx="2.8" cy="8" r=".9" fill="currentColor"/><circle cx="2.8" cy="12" r=".9" fill="currentColor"/>',
    up: '<path d="M8 13V3M4 7l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
    x: '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    plus: '<path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    minus: '<path d="M3.5 8h9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    chev: '<path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
    chevR: '<path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
    alL: '<path d="M3 4h10M3 8h6M3 12h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    alC: '<path d="M3 4h10M5 8h6M4 12h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    alR: '<path d="M3 4h10M7 8h6M5 12h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    corners: '<path d="M3 6V4.5A1.5 1.5 0 0 1 4.5 3H6M10 3h1.5A1.5 1.5 0 0 1 13 4.5V6M13 10v1.5a1.5 1.5 0 0 1-1.5 1.5H10M6 13H4.5A1.5 1.5 0 0 1 3 11.5V10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
    rad: '<path d="M4 12V8a4 4 0 0 1 4-4h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    opa: '<circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 3a5 5 0 0 1 0 10z" fill="currentColor"/>',
    gap: '<path d="M3 3v10M13 3v10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6 8h4M7 6.5L5.5 8 7 9.5M9 6.5l1.5 1.5L9 9.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>',
    padH: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M5 6v4M11 6v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    padV: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M5.5 6h5M5.5 10h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    lh: '<path d="M3 3h10M3 13h10M8 5.5v5M6.5 7l1.5-1.5L9.5 7M6.5 9l1.5 1.5L9.5 9" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>',
    ls: '<path d="M3 3v10M13 3v10M5.5 8h5M7 6.5L5.5 8 7 9.5M9 6.5l1.5 1.5L9 9.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>',
    sw: '<path d="M3 4.5h10" stroke="currentColor" stroke-width="1"/><path d="M3 8h10" stroke="currentColor" stroke-width="1.8"/><path d="M3 11.5h10" stroke="currentColor" stroke-width="2.6"/>',
    comp: '<path d="M8 1.8l2.4 2.4L8 6.6 5.6 4.2zM4.2 5.6L6.6 8 4.2 10.4 1.8 8zM11.8 5.6L14.2 8l-2.4 2.4L9.4 8zM8 9.4l2.4 2.4L8 14.2l-2.4-2.4z" fill="none" stroke="currentColor" stroke-width="1.1"/>',
    frame: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    text: '<path d="M3.5 4h9M8 4v9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    spark: '<path d="M8 1.7l1.5 4.2 4.2 1.5-4.2 1.5L8 13.1 6.5 8.9 2.3 7.4l4.2-1.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
    pen: '<path d="M3.4 10.9c-1.7-2.9.6-8 5.1-8 3.4 0 5.1 2.3 4.9 4.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M6.9 13.7l.45-2 5-5a1.15 1.15 0 0 1 1.6 1.6l-5 5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
    pin: '<path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="6.5" r="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    box: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>',
    circle: '<ellipse cx="8" cy="8" rx="5.5" ry="5" fill="none" stroke="currentColor" stroke-width="1.3"/>',
    arrow: '<path d="M3 13L13 3M7 3h6v6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
    history: '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 5v3l2 1.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>',
    desktop: '<rect x="2" y="3" width="12" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M6 13.5h4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>',
    tablet: '<rect x="3.5" y="2" width="9" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.25"/>',
    mobile: '<rect x="5" y="2" width="6" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.25"/>',
    branch: '<circle cx="4.5" cy="3.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.1"/><circle cx="4.5" cy="12.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.1"/><circle cx="11.5" cy="6" r="1.6" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M4.5 5.1v5.8M11.5 7.6c0 2.6-7 1.4-7 3.3" fill="none" stroke="currentColor" stroke-width="1.1"/>',
    check: '<path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    sidebar: '<rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M6 3v10" stroke="currentColor" stroke-width="1.25"/>',
    trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>',
    dup: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M3 10.5V3.8c0-.4.4-.8.8-.8h6.7" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>',
    swap: '<path d="M3 5.5h9l-2.5-2.5M13 10.5H4l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
    image: '<rect x="2.5" y="3" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="6.5" r="1.2" fill="currentColor"/><path d="M3 12l3.5-3.5 2.5 2.5 2-2 2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
    code: '<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
    search: '<circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    heading: '<path d="M3.5 3v10M12.5 3v10M3.5 8h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    button: '<rect x="1.5" y="4.5" width="13" height="7" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5.5 8h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
    zin: '<path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    clip: '<path d="M10.5 4.5L5.6 9.4a1.4 1.4 0 0 0 2 2l5-5a2.8 2.8 0 0 0-4-4l-5 5a4.2 4.2 0 0 0 6 6l4.4-4.4" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>',
    mic: '<rect x="6" y="2" width="4" height="7.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M3.8 7.5a4.2 4.2 0 0 0 8.4 0M8 11.8V14" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>',
    reload: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v3h-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const ico = (n, s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16" aria-hidden="true">${IC[n]}</svg>`;
  const cornerIco = (deg) => `<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><g transform="rotate(${deg} 8 8)">${IC.rad}</g></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const tip = (label, key) => `<span class="tip">${label}${key ? `<span class="k">${key}</span>` : ''}</span>`;
  const hb = (act, icon, title, v = '', extra = '') => `<button class="ib sm" data-act="${act}" data-v="${v}" ${extra} title="${title}" aria-label="${title}">${ico(icon)}</button>`;

  /* ---------- top bar ---------- */
  const DEVICES = { desktop: 1280, tablet: 820, mobile: 390 };
  const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2];
  S.zoom = 'fit';
  S.z = 1;
  // Pages a designer would recognise: "/" is Home, "/deck/new" is "Deck / New".
  const pageName = (p) => {
    const parts = String(p || '/').split('?')[0].split('/').filter(Boolean);
    if (!parts.length) return 'Home';
    return parts.map((x) => (/^[0-9a-f-]{8,}$/i.test(x) || /^\d+$/.test(x) ? '…' : decodeURIComponent(x).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()))).join(' / ');
  };
  S.pages = [];
  const DEV_LABEL = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Phone' };
  function devRange(d) {
    const sc = S.theme?.screens || [];
    const find = (name, min) => sc.find((x) => x.name === name) || sc.find((x) => x.min >= min);
    const tab = find('md', 700)?.min || 768, desk = find('lg', 1000)?.min || 1024;
    return { desktop: `${desk}px and up`, tablet: `${tab}–${desk - 1}px`, mobile: `under ${tab}px` }[d];
  }
  function renderTop() {
    const p = S.project || {};
    const n = S.versions.draft.length + S.versions.versions.reduce((a, v) => a + v.changes.length, 0);
    $('top').innerHTML = `<div class="tside">
        <button class="icon${S.layersOpen && S.mode === 'edit' ? ' on' : ''}" data-act="layersToggle" title="Layers" aria-label="Show or hide layers" ${S.mode === 'edit' ? '' : 'disabled'}>${ico('sidebar', 16)}</button>
        <button class="logoBtn" data-act="kerfMenu" title="Kerf menu" aria-label="Kerf menu" aria-haspopup="menu">${ico('kerf', 16)}${ico('chev', 10)}</button>
        <span class="crumbs"><span class="proj" title="${esc(p.repo || p.name || '')}">${esc(String(p.name || 'Kerf').split('/').pop())}</span><span class="sep">/</span><button class="pageBtn" data-act="pagesMenu" title="Pages" aria-haspopup="menu">${esc(pageName(S.path))}${ico('chev', 10)}</button></span>
      </div>
      <div class="tmid"><div class="bps" role="radiogroup" aria-label="Screen size">${Object.keys(DEVICES).map((d) => `<button class="${S.device === d ? 'on' : ''}" data-act="device" data-v="${d}" role="radio" aria-checked="${S.device === d}" title="${DEV_LABEL[d]} · ${devRange(d)}">${ico(d, 14)}<span>${DEV_LABEL[d]}</span></button>`).join('')}</div></div>
      <div class="tside r">
        <button class="zpct" data-act="zoomMenu" title="Zoom" aria-haspopup="menu">${Math.round(S.z * 100)}%${ico('chev', 10)}</button>
        <button class="icon${S.side === 'history' ? ' on' : ''}" data-act="history" title="Version history" aria-label="Version history">${ico('history', 16)}${S.versions.versions.length ? '<i class="badgeDot"></i>' : ''}</button>
        <button class="primary" data-act="pr" ${n ? '' : 'disabled'} title="Send your changes to developers as one pull request">Hand off${n ? `<span class="count">${n}</span>` : ''}</button>
      </div>`;
  }

  /* menus: one popover for the Kerf menu, pages, zoom and right-click */
  function openMenu(items, at) {
    const m = $('menu');
    m.innerHTML = items.map((it, i) => it === '-' ? '<div class="msep"></div>' : it.input ? `<form class="minput" data-mi="${i}"><input placeholder="${esc(it.placeholder || '')}" value="${esc(it.value || '')}" spellcheck="false" aria-label="${esc(it.placeholder || '')}"></form>` : it.head ? `<div class="mhead">${esc(it.head)}</div>` : `<button class="mi${it.on ? ' on' : ''}${it.danger ? ' danger' : ''}" data-mi="${i}" ${it.disabled ? 'disabled' : ''} role="menuitem"><span class="mchk">${it.on ? ico('check', 12) : ''}</span><span class="ml">${esc(it.label)}</span>${it.kbd ? `<span class="mk">${esc(it.kbd)}</span>` : ''}</button>`).join('');
    m.hidden = false;
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(innerWidth - w - 8, at.x)) + 'px';
    m.style.top = Math.max(8, Math.min(innerHeight - h - 8, at.y)) + 'px';
    m._items = items;
    const inp = m.querySelector('input');
    if (inp) setTimeout(() => inp.focus(), 0);
  }
  const closeMenu = () => { $('menu').hidden = true; };
  const below = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.bottom + 6 }; };
  $('menu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mi]');
    if (!b) return;
    const it = $('menu')._items[+b.dataset.mi];
    closeMenu();
    it?.run?.();
  });
  $('menu').addEventListener('submit', (e) => {
    e.preventDefault();
    const it = $('menu')._items[+e.target.dataset.mi];
    const v = e.target.querySelector('input').value.trim();
    closeMenu();
    it?.run?.(v);
  });
  document.addEventListener('pointerdown', (e) => { if (!$('menu').hidden && !e.target.closest('#menu')) closeMenu(); }, true);
  addEventListener('blur', () => setTimeout(() => { if (document.activeElement === frame) return; closeMenu(); }, 0));
  addEventListener('resize', () => closeMenu());
  const goTo = (v) => { if (!v) return; if (!v.startsWith('/')) v = '/' + v; frame.src = v; };
  function kerfMenu(at) {
    const p = S.project || {};
    openMenu([
      { head: p.repo || p.name || 'This project' },
      ...(p.branch ? [{ label: `Branch: ${p.branch}`, disabled: true }] : []),
      { label: 'Open another project…', run: () => window.open('http://localhost:4100', '_blank') },
      '-',
      { label: S.minUI ? 'Show panels' : 'Hide panels', kbd: '⇧\\', run: () => toggleMinUI() },
      { label: 'Keyboard shortcuts', kbd: '?', run: () => shortcuts() },
    ], at);
  }
  function pagesMenu(at) {
    const seen = [...new Set([S.path, ...S.pages])].slice(0, 12);
    openMenu([
      { input: true, placeholder: 'Go to a page, e.g. /settings', run: goTo },
      { head: 'Pages you’ve visited' },
      ...seen.map((x) => ({ label: `${pageName(x)}  ·  ${x}`, on: x === S.path, run: () => goTo(x) })),
      '-',
      { label: 'Reload page', kbd: '⌘R', run: () => { try { W.location.reload(); } catch { frame.src = S.path; } } },
    ], at);
  }
  function zoomMenu(at) {
    openMenu([
      { label: 'Zoom in', kbd: '⌘+', run: () => setZoom('in') },
      { label: 'Zoom out', kbd: '⌘−', run: () => setZoom('out') },
      { label: 'Zoom to fit', kbd: '⇧1', on: S.zoom === 'fit', run: () => setZoom('fit') },
      '-',
      ...[0.5, 1, 2].map((z) => ({ label: `${z * 100}%`, kbd: z === 1 ? '⇧0' : '', on: S.zoom === z, run: () => setZoom(z) })),
    ], at);
  }
  // Right-click on the canvas: what a designer reaches for, on the element under the cursor.
  function contextMenu(at) {
    const s = S.sel, inf = info(), el = s?.el;
    if (!el) return;
    const act = (a, v) => () => { const b = document.querySelector(`[data-act="${a}"]${v ? `[data-v="${v}"]` : ''}`); if (b) b.click(); };
    const plain = /^(div|section|span)$/.test(el.tagName.toLowerCase()) && !el.getAttribute('data-kerf-n');
    openMenu([
      { head: dName(el) },
      ...(inf?.text?.editable ? [{ label: 'Edit text', kbd: '↵', run: () => beginText() }] : []),
      { label: 'Ask Kerf about this…', kbd: '⌘K', run: () => toggleAI(true) },
      { label: 'Select parent', kbd: '⇧↵', disabled: !pick(el.parentElement), run: () => { const p = pick(el.parentElement); if (p) select(p); } },
      '-',
      { label: 'Duplicate', kbd: '⌘D', run: () => structure({ type: 'duplicate' }, { keepSel: true }) },
      { label: 'Group into a frame', kbd: '⌥⌘G', run: () => groupSelected() },
      ...(plain ? [{ label: 'Ungroup', kbd: '⇧⌘G', run: () => structure({ type: 'ungroup' }) }] : []),
      { label: 'Move up', kbd: '⌥↑', run: () => structure({ type: 'move', dir: 'up' }, { keepSel: true }) },
      { label: 'Move down', kbd: '⌥↓', run: () => structure({ type: 'move', dir: 'down' }, { keepSel: true }) },
      ...(document.querySelector('[data-act="sSwap"]') ? [{ label: 'Swap with…', run: act('sSwap') }] : []),
      { label: 'Add next to it…', kbd: 'I', run: act('insertMenu') },
      '-',
      { label: 'Delete', kbd: '⌫', danger: true, run: () => deleteSelected() },
    ], at);
  }
  function shortcuts() {
    const rows = [['Edit / Preview', 'E · P'], ['Annotate', 'A'], ['Ask Kerf', '⌘K'], ['Undo', '⌘Z'], ['Select parent', '⇧↵'], ['Duplicate', '⌘D'], ['Delete', '⌫'], ['Move up / down', '⌥↑ ⌥↓'], ['Group / ungroup', '⌥⌘G · ⇧⌘G'], ['Add element', 'I'], ['Measure spacing', 'hold ⌥'], ['Select several', '⇧ click'], ['Zoom in / out', '⌘+ · ⌘−'], ['Fit / 100%', '⇧1 · ⇧0'], ['Hide panels', '⇧\\']];
    const m = $('modal');
    m.hidden = false;
    m.innerHTML = `<section class="dialog keys" role="dialog" aria-modal="true" aria-labelledby="kT"><div class="dh"><h2 id="kT">Keyboard shortcuts</h2><button class="ib" data-act="closeModal" aria-label="Close">${ico('x')}</button></div><div class="db"><div class="krows">${rows.map(([a, k]) => `<div class="kr"><span>${a}</span><span class="kk">${k}</span></div>`).join('')}</div></div></section>`;
  }
  S.minUI = false;
  function toggleMinUI() {
    S.minUI = !S.minUI;
    document.body.classList.toggle('minUI', S.minUI);
    setTimeout(applyDevice, 0);
  }

  // The app keeps its real width (so desktop stays desktop) and is scaled to fit, like a Figma frame.
  function applyDevice() {
    const c = $('canvas'), fb = $('frameBox');
    if (!c) return;
    // Room for the frame's name above it and a margin below, like an artboard.
    const aw = Math.max(80, c.clientWidth - 48), ah = Math.max(80, c.clientHeight - 64);
    let zFit, w, z, h, left, top = 44;
    if (S.mode === 'preview' && S.device === 'desktop' && S.zoom === 'fit') {
      // Preview on desktop: full screen, edge to edge, like presenting the real product.
      zFit = Math.max(0.5, Math.min(1, c.clientWidth / 1024));
      z = zFit;
      w = Math.round(c.clientWidth / z);
      h = c.clientHeight / z;
      left = 0;
      Object.assign(fb.style, { width: w + 'px', height: h + 'px', left: '0px', top: '0px', transform: `scale(${z})` });
      $('sizer').style.width = '1px';
      $('sizer').style.height = '1px';
    } else {
      // Desktop keeps a desktop width (1024+) by zooming out, but Fit never goes below 50%, so text stays readable.
      zFit = S.device === 'desktop' ? Math.max(0.5, Math.min(1, aw / 1024)) : Math.min(1, aw / DEVICES[S.device]);
      w = S.device === 'desktop' ? Math.round(aw / zFit) : DEVICES[S.device];
      z = S.zoom === 'fit' ? zFit : S.zoom;
      h = ah / z;
      left = Math.max(16, (c.clientWidth - w * z) / 2);
      // +2 for the frame's border, so the app inside is exactly w wide (1024 must count as desktop).
      Object.assign(fb.style, { width: w + 2 + 'px', height: h + 'px', left: left + 'px', top: top + 'px', transform: `scale(${z})` });
      $('sizer').style.width = (left + w * z + 16) + 'px';
      $('sizer').style.height = '1px';
      $('devLabel').style.left = left + 'px';
    }
    fb.style.setProperty('--iz', 1 / z);
    fb.classList.toggle('dev', S.device !== 'desktop');
    const full = S.mode === 'preview' && S.device === 'desktop' && S.zoom === 'fit';
    fb.classList.toggle('full', full);
    // Preview is a presentation: no artboard name, no dotted grid.
    c.classList.toggle('present', S.mode === 'preview');
    $('devLabel').hidden = S.mode === 'preview';
    $('devLabel').innerHTML = `<b>${DEV_LABEL[S.device]}</b><span>${w}</span>`;
    const changed = S.z !== z;
    S.z = z;
    if (changed) renderTop();
  }
  function setZoom(v) {
    const cur = S.z;
    if (v === 'fit') S.zoom = 'fit';
    else if (v === 'in') S.zoom = ZOOMS.find((x) => x > cur + 0.01) || 2;
    else if (v === 'out') S.zoom = [...ZOOMS].reverse().find((x) => x < cur - 0.01) || 0.25;
    else S.zoom = Math.min(2, Math.max(0.25, +v || 1));
    applyDevice();
    renderTop();
  }
  new ResizeObserver(() => applyDevice()).observe(document.getElementById('canvas'));
  // Pinch or ⌘-scroll zooms the canvas, inside the app too.
  const pinch = (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); setZoom(Math.min(2, Math.max(0.25, Math.round(S.z * Math.exp(-e.deltaY * 0.01) * 100) / 100))); };
  document.getElementById('canvas').addEventListener('wheel', pinch, { passive: false });

  /* ---------- toolbar ---------- */
  function renderBar() {
    $('bar').innerHTML = `<div class="modes">
        <button class="tb${S.mode === 'preview' ? ' on' : ''}" data-act="mode" data-v="preview" aria-label="Preview">${ico('play', 16)}${tip('Preview', 'P')}</button>
        <button class="tb${S.mode === 'edit' ? ' on' : ''}" data-act="mode" data-v="edit" aria-label="Edit">${ico('edit', 16)}${tip('Edit', 'E')}</button>
      </div>
      <span class="div"></span>
      ${S.mode === 'preview'
        ? `<button class="tb${S.askOpen ? ' on' : ''}" data-act="ask" aria-label="Ask Kerf">${ico('spark', 16)}${tip('Ask Kerf', '⌘K')}</button>`
        : `<button class="tb${S.tab === 'chat' ? ' on' : ''}" data-act="chatToggle" aria-label="Chat with Kerf">${ico('spark', 16)}${tip('Chat with Kerf', '⌘K')}</button>`}
      ${S.mode === 'edit' ? `<button class="tb" data-act="insertMenu" aria-label="Add element">${ico('plus', 16)}${tip('Add element', 'I')}</button>` : ''}
      <button class="tb${S.tool === 'annotate' ? ' on' : ''}" data-act="tool" data-v="annotate" aria-label="Annotate">${ico('pen', 16)}${tip('Annotate', 'A')}</button>
      ${S.tool === 'annotate' ? `<div class="shapes">${['pin', 'box', 'circle', 'arrow'].map((k, i) => `<button class="tb sm${S.shape === k ? ' on' : ''}" data-act="shape" data-v="${k}" aria-label="${k}">${ico(k, 14)}${tip(k[0].toUpperCase() + k.slice(1), String(i + 1))}</button>`).join('')}</div>` : ''}
      <span class="div"></span>
      <button class="tb" data-act="undo" ${S.count ? '' : 'disabled'} aria-label="Undo">${ico('undo', 16)}${tip('Undo', '⌘Z')}</button>
      <button class="tb" data-act="changes" aria-label="Changes">${ico('list', 16)}${S.count ? '<i class="badgeDot" style="box-shadow:0 0 0 2px var(--raised)"></i>' : ''}${tip('Changes this session')}</button>`;
    const h = $('hint');
    h.hidden = true;
    if (!h.hidden) h.innerHTML = `Use your app normally. Press <span class="kbd">E</span> to edit a screen, <span class="kbd">A</span> to annotate, or <span class="kbd">⌘K</span> to ask Kerf.`;
  }

  /* ---------- layers ---------- */
  const keyOf = (el) => `${defOf(el) || ''}|${useOf(el) || ''}|${[...sameLoc(el)].indexOf(el)}`;
  function layerTree() {
    if (!D?.body) return [];
    let count = 0;
    const walk = (node) => {
      const out = [];
      for (const c of node.children) {
        if (count > 600) break;
        if (c.matches('[data-kerf],[data-kerf-use]')) {
          count++;
          out.push({ el: c, kids: walk(c) });
        } else out.push(...walk(c));
      }
      return out;
    };
    return walk(D.body);
  }
  function renderLayers() {
    const box = $('layers');
    box.hidden = S.mode !== 'edit' || !S.layersOpen;
    if (box.hidden) return;
    const rows = [];
    const add = (nodes, depth) => {
      for (const n of nodes) {
        const el = n.el, k = keyOf(el), open = !!S.open[k] || depth < 2;
        const on = S.sel?.el === el;
        const leafText = !n.kids.length && el.childElementCount === 0 ? (el.textContent || '').trim().slice(0, 40) : '';
        const icon = layerIcon(el);
        const comp = useOf(el) && /^[A-Z]/.test(el.getAttribute('data-kerf-n') || '');
        rows.push(`<button class="layer${on ? ' on' : ''}${comp ? ' comp' : ''}" data-layer="${rows.length}" style="padding-left:6px"><span class="ind" style="width:${depth * 14}px"></span>
          <span class="tw" data-twist="${esc(k)}">${n.kids.length ? ico(open ? 'chev' : 'chevR', 10) : ''}</span>${ico(icon, 12)}<span class="nm">${esc(kindOf(el))}</span>${(() => { const w = / icon$/.test(kindOf(el)) ? '' : leafText || (/^(img|input|textarea)$/i.test(el.tagName) ? wordsOf(el) : ''); return w ? `<span class="tx">${esc(w)}</span>` : ''; })()}</button>`);
        layerEls.push(el);
        if (n.kids.length && open) add(n.kids, depth + 1);
      }
    };
    layerEls = [];
    add(layerTree(), 0);
    const tree = box.querySelector('.tree');
    const st = tree ? tree.scrollTop : 0;
    const changes = S.versions.draft;
    box.innerHTML = `<div class="lhead"><span>Layers</span><button class="lpage" data-act="pagesMenu" title="Pages">${esc(pageName(S.path))}${ico('chev', 10)}</button></div>
      <div class="tree">${rows.join('') || '<div class="empty">This page has no elements Kerf can edit yet.</div>'}</div>
      ${changes.length ? `<button class="lchanges" data-act="history" title="Open version history"><span class="dot"></span><span>${changes.length} unsaved change${changes.length === 1 ? '' : 's'}</span>${ico('chevR', 10)}</button>` : ''}`;
    box.querySelector('.tree').scrollTop = st;
    const onRow = box.querySelector('.layer.on');
    if (onRow && layersScrollToSel) { onRow.scrollIntoView({ block: 'nearest' }); layersScrollToSel = false; }
  }
  let layerEls = [], layersScrollToSel = false;
  let layerTimer = null;
  const layersSoon = () => { clearTimeout(layerTimer); layerTimer = setTimeout(renderLayers, 250); };

  /* ---------- design panel ---------- */
  const val = (p) => read(p, S.sel?.el);
  const nf = (p, icon, title, unit) => `<label class="inp${info()?.sized?.includes(p) ? ' sized' : ''}" title="${title}${info()?.sized?.includes(p) ? ' · different on other screen sizes' : ''}"><span class="ic" data-scrub="${p}">${icon.startsWith('<') ? icon : ico(icon, 12)}</span><input type="text" inputmode="decimal" data-prop="${p}" value="${esc(val(p))}" aria-label="${title}">${unit ? `<span class="u">${unit}</span>` : ''}</label>`;
  const sec = (title, body, act = '') => `<div class="sec"><div class="secH"><span>${title}</span>${act}</div>${body}</div>`;
  function colorRow(p, title, removeAct) {
    const hex = val(p), tok = tokenOf(p), none = hex === 'transparent';
    let h = `<div class="cr"><label class="inp" title="${title}"><button class="cchip${none ? ' none' : ''}" data-act="cpick" data-v="${p}" style="background:${none ? 'transparent' : hex}" aria-label="Choose ${title}"></button><input type="text" data-prop="${p}" data-color="1" value="${none ? '' : hex.replace('#', '')}" placeholder="None" spellcheck="false" aria-label="${title} hex"><span class="u">${esc(tok && !tok.startsWith('#') ? tok : '')}</span></label>${removeAct ? `<button class="ib" data-act="${removeAct}" title="Remove">${ico('minus')}</button>` : ''}</div>`;
    if (S.cpick === p) {
      h += `<div class="cpop"><div class="cpT">Project tokens</div><div class="toks">${tokens().map(([n, v]) => `<button data-act="token" data-p="${p}" data-v="${esc(n)}" title="${esc(n)}" class="${n === tok ? 'on' : ''}"><i style="background:${esc(swatch(v))}"></i><span>${esc(n)}</span></button>`).join('')}</div>
        <label class="cust"><input type="color" data-colorinput="${p}" value="${/^#[0-9A-F]{6}$/.test(hex) ? hex : '#FFFFFF'}"><span>Custom color</span><span class="u">off scale</span></label></div>`;
    }
    return h;
  }
  const isText = (el) => el && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const isLayout = (el) => el && el.isConnected && /flex|grid/.test(cs(el).display);
  /* fill: solid or gradient */
  const DIRS = [['r', '→ Right'], ['l', '← Left'], ['b', '↓ Down'], ['t', '↑ Up'], ['br', '↘ Down right'], ['bl', '↙ Down left'], ['tr', '↗ Up right'], ['tl', '↖ Up left']];
  const CSSDIR = { r: 'to right', l: 'to left', b: 'to bottom', t: 'to top', br: 'to bottom right', bl: 'to bottom left', tr: 'to top right', tl: 'to top left' };
  function gradOf() {
    const cls = (info()?.classes || []).filter((c) => !c.includes(':'));
    const dir = cls.map((c) => c.match(/^bg-(?:gradient|linear)-to-(\w+)$/)).find(Boolean);
    if (!dir) return null;
    const stop = (p) => (cls.find((c) => c.startsWith(p + '-')) || '').slice(p.length + 1).replace(/^\[|\]$/g, '') || null;
    return { dir: dir[1], from: stop('from'), via: stop('via'), to: stop('to'), clip: cls.includes('bg-clip-text') };
  }
  const gradValue = (g) => [g.dir, g.from, g.via, g.to].filter(Boolean).join(' ');
  const tokenSwatch = (n) => { const t = tokens().find(([k]) => k === n); return t ? swatch(t[1]) : n?.startsWith('#') ? n : 'transparent'; };
  const stopSel = (key, cur, allowNone) => `<label class="inp"><i class="sw1" style="background:${esc(tokenSwatch(cur))}"></i><select data-gstop="${key}" aria-label="Gradient ${key}">${allowNone ? `<option value=""${cur ? '' : ' selected'}>No middle color</option>` : ''}${tokens().filter(([n]) => n !== 'transparent').map(([n]) => `<option${n === cur ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>${ico('chev', 12)}</label>`;
  function fillBody(g, el) {
    const seg = `<div class="seg"><button data-act="fillType" data-v="solid" class="${g ? '' : 'on'}">Solid</button><button data-act="fillType" data-v="gradient" class="${g ? 'on' : ''}">Gradient</button></div>`;
    if (!g) return seg + colorRow('bg', 'Fill', 'rmFill');
    const prev = `linear-gradient(${CSSDIR[g.dir] || 'to right'}, ${[g.from, g.via, g.to].filter(Boolean).map(tokenSwatch).join(', ')})`;
    return seg + `<div class="gprev" style="background:${esc(prev)}"></div>
      <div class="cr"><label class="inp"><select data-gstop="dir" aria-label="Direction">${DIRS.map(([v, n]) => `<option value="${v}"${v === g.dir ? ' selected' : ''}>${n}</option>`).join('')}</select>${ico('chev', 12)}</label><button class="ib" data-act="rmFill" title="Remove fill">${ico('minus')}</button></div>
      <div class="kv"><span>From</span>${stopSel('from', g.from)}</div>
      <div class="kv"><span>Middle</span>${stopSel('via', g.via, true)}</div>
      <div class="kv"><span>To</span>${stopSel('to', g.to)}</div>
      ${isText(el) ? `<div class="kv"><span>On text</span><div class="seg"><button data-act="clipText" data-v="off" class="${g.clip ? '' : 'on'}">Off</button><button data-act="clipText" data-v="on" class="${g.clip ? 'on' : ''}">On</button></div></div>` : ''}`;
  }
  document.addEventListener('change', (e) => {
    const k = e.target.dataset?.gstop;
    if (!k || !S.sel) return;
    const g = gradOf() || { dir: 'r' };
    g[k] = e.target.value || null;
    commit({ ops: [{ prop: 'gradient', value: gradValue(g) }] });
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act="fillType"],[data-act="clipText"]');
    if (!a || !S.sel) return;
    if (a.dataset.act === 'clipText') return commit({ ops: [{ prop: 'clipText', value: a.dataset.v }] });
    const g = gradOf();
    const names = tokens().map(([n]) => n).filter((n) => !['transparent', 'black', 'white'].includes(n));
    if (a.dataset.v === 'gradient' && !g) {
      const from = tokenOf('bg') && !tokenOf('bg').startsWith('#') ? tokenOf('bg') : names.includes('primary') ? 'primary' : names[0];
      const to = names.find((n) => n !== from && /positive|accent|secondary|primary/.test(n)) || names.find((n) => n !== from);
      commit({ ops: [{ prop: 'gradient', value: `r ${from} ${to}` }] });
    } else if (a.dataset.v === 'solid' && g) commit({ ops: [{ prop: 'bg', value: g.from || 'transparent' }, { prop: 'clipText', value: 'off' }] });
  });

  function propsSection(inf) {
    if (!inf?.component || !inf.props?.length) return '';
    const rows = inf.props.map((p) => {
      let ctl;
      if (!p.editable) ctl = `<label class="inp lock" title="${esc(p.reason)}"><input value="set by code" disabled></label>`;
      else if (p.kind === 'option') ctl = `<label class="inp"><select data-propsel="${esc(p.name)}">${p.value == null ? '<option value="" selected>Default</option>' : ''}${p.options.map((o) => `<option${o === p.value ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>${ico('chev', 12)}</label>`;
      else if (p.kind === 'boolean') ctl = `<div class="seg"><button data-act="setProp" data-p="${esc(p.name)}" data-v="false" class="${p.value !== true ? 'on' : ''}">Off</button><button data-act="setProp" data-p="${esc(p.name)}" data-v="true" class="${p.value === true ? 'on' : ''}">On</button></div>`;
      else if (p.kind === 'number') ctl = `<label class="inp"><input type="text" inputmode="decimal" data-propnum="${esc(p.name)}" value="${p.value ?? ''}" placeholder="Default"></label>`;
      else ctl = `<label class="inp"><input type="text" data-proptext="${esc(p.name)}" value="${esc(p.value)}"></label>`;
      return `<div class="kv"><span>${esc(p.name)}</span>${ctl}</div>`;
    }).join('');
    return sec(`Properties${inf.lib ? ` <span class="note" style="font-weight:400">${esc(inf.lib.replace(/^@/, '').split('/')[0])}</span>` : ''}`, rows);
  }
  /* screen sizes: edit for all sizes, or only the size you're looking at */
  S.sizeOnly = { desktop: false, tablet: true, mobile: true };
  function sizeRange() {
    const sc = S.theme?.screens || [];
    if (!sc.length) return null;
    const find = (name, min) => (sc.find((x) => x.name === name) || sc.find((x) => x.min >= min))?.name || null;
    const tab = find('md', 700), desk = find('lg', 1000);
    return { desktop: [desk, null], tablet: [tab, desk], mobile: [null, tab] }[S.device];
  }
  function bpParam() {
    const r = sizeRange();
    if (!r) return null;
    const dev = S.device;
    return S.sizeOnly[dev] ? { mode: 'only', start: r[0], end: r[1], label: `Only on ${DEV_LABEL[dev].toLowerCase()}` } : { mode: 'all', label: 'All sizes' };
  }
  // Where this element's styles really live (a style table, a constant), and how far a change reaches.
  function sourceHTML(inf) {
    if (inf?.classKind !== 'sourced') return '';
    const tb = inf.sources.find((x) => x.kind === 'table'), src = tb || inf.sources.find((x) => x.kind === 'const');
    if (!src) return '';
    const what = tb ? `${tb.name} “${tb.key ?? '?'}”` : src.name;
    const used = src.usedIn ? ` · used in ${src.usedIn} file${src.usedIn === 1 ? '' : 's'}` : '';
    const opts = [['here', 'Only this one'], ['key', tb ? `All “${tb.key ?? '…'}”` : 'Everywhere'], ...(tb ? [['all', `All ${tb.entries.length}`]] : [])];
    const sc = S.srcScope || 'key';
    return `<div class="srcRow"><span class="note">Styles come from <b>${esc(what)}</b> in ${esc(src.file)}${used}</span><div class="seg">${opts.map(([v, n]) => `<button data-act="srcScope" data-v="${v}" class="${sc === v ? 'on' : ''}" title="${v === 'here' ? 'Change only this element' : v === 'key' ? `Change it in ${esc(src.name)}${tb ? ` for “${esc(tb.key)}”` : ''}, everywhere it’s used` : `Change every entry of ${esc(tb.name)}`}">${esc(n)}</button>`).join('')}</div></div>`;
  }
  // The app's colour tokens, like Figma's local styles: change one and every screen follows.
  S.tokens = null;
  const loadTokens = () => api('/tokens').then((t) => { S.tokens = t; if (S.mode === 'edit' && !S.sel) renderPanel(); }).catch(() => { S.tokens = []; });
  function paletteHTML() {
    if (S.tokens == null) { loadTokens(); return ''; }
    if (!S.tokens.length) return '';
    const themes = [...new Set(S.tokens.flatMap((t) => t.values.map((v) => v.theme)))].slice(0, 3);
    return `<div class="sec palette"><div class="secH"><span>Colours</span><span class="note">${themes.map((x) => esc(x[0].toUpperCase() + x.slice(1))).join(' · ')}</span></div><span class="note">Your design system. Changing one updates every screen that uses it.</span>
      ${S.tokens.map((t) => `<div class="tok"><span class="tn">${esc(t.name)}</span><span class="sw">${themes.map((th) => { const v = t.values.find((x) => x.theme === th) || (th !== 'all' && t.values.find((x) => x.theme === 'all')); return v ? `<label class="swatch" style="background:${esc(v.hex)}" title="${esc(t.name)} · ${esc(th)} · ${esc(v.hex)}"><input type="color" value="${esc(v.hex.slice(0, 7))}" data-token="${esc(t.name)}" data-theme="${esc(v.theme)}" aria-label="${esc(t.name)} ${esc(th)}"></label>` : '<span class="swatch none"></span>'; }).join('')}</span></div>`).join('')}</div>`;
  }
  document.addEventListener('change', async (e) => {
    const i = e.target.closest?.('[data-token]');
    if (!i) return;
    try {
      const r = await api('/token', { name: i.dataset.token, hex: i.value.toUpperCase(), which: i.dataset.theme === 'all' ? 'both' : i.dataset.theme });
      if (r.changed) { S.count = r.n; toast(r.summary.labels?.[0] || 'Colour changed', 'Every screen using it updates', false, true); }
      S.tokens = null;
      afterEdit();
      renderPanel();
    } catch (err) { toast(err.message, '', true); }
  });
  function sizeHTML(inf) {
    if (!sizeRange() || inf?.classKind === 'cva') return '';
    const dev = S.device, only = S.sizeOnly[dev];
    const differs = (inf?.classes || []).some((c) => /^(sm|md|lg|xl|2xl):[^:]+$/.test(c));
    return `<div class="sizeRow"><div class="seg">${[[false, 'All sizes'], [true, `${DEV_LABEL[dev]} only`]].map(([v, n]) => `<button data-act="sizeOnly" data-v="${v}" class="${only === v ? 'on' : ''}" title="${v ? `Change it only on ${DEV_LABEL[dev].toLowerCase()} (${devRange(dev)}); other screen sizes keep how they look now` : 'Make it the same on every screen size'}">${ico(v ? dev : 'corners', 12)}${n}</button>`).join('')}</div>${differs ? '<span class="note" title="This element is styled differently on other screen sizes">Differs by size</span>' : ''}</div>`;
  }
  function scopeHTML(s, name) {
    const c = s.defInfo?.cva;
    if (c) {
      const av = activeVariant(), vname = av?.variant;
      const opts = [...(s.use ? [['here', 'Only this one']] : []), ...(vname ? [['variant', `All “${vname}”`]] : []), ['all', `Every ${s.use ? (s.useInfo?.tag || name) : name}`]];
      if (!opts.some(([v]) => v === S.scope)) S.scope = vname ? 'variant' : 'all';
      return `<div class="seg">${opts.map(([v, n]) => `<button data-act="scope" data-v="${v}" class="${S.scope === v ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>`;
    }
    if (s.def && s.use) return `<div class="seg"><button data-act="scope" data-v="all" class="${S.scope === 'all' ? 'on' : ''}" title="Change the component itself, everywhere it's used">Everywhere</button><button data-act="scope" data-v="here" class="${S.scope === 'here' ? 'on' : ''}" title="Change only this use of the component">Only here</button></div>`;
    return '';
  }
  function tabsHTML() {
    return `<div class="ptabs"><button data-act="tab" data-v="design" class="${S.tab === 'design' ? 'on' : ''}">Design</button><button data-act="tab" data-v="chat" class="${S.tab === 'chat' ? 'on' : ''}">Chat <span class="kbd">⌘K</span></button></div>`;
  }
  function renderPanel(focusChat) {
    const p = $('panel');
    p.hidden = !(S.mode === 'edit' || S.side === 'history');
    if (p.hidden) return;
    if (S.side === 'history') { p.innerHTML = historyHTML(); return; }
    if (S.tab === 'chat') {
      const draft = $('chatIn')?.value || '';
      const hadFocus = document.activeElement?.id === 'chatIn';
      p.innerHTML = tabsHTML() + chatHTML();
      const sc = $('chatScroll'); if (sc) sc.scrollTop = sc.scrollHeight;
      const ci = $('chatIn'); if (ci) { ci.value = draft; syncKC('chatIn'); if (focusChat || hadFocus) ci.focus(); }
      return;
    }
    const s = S.sel;
    if (!s) {
      p.innerHTML = tabsHTML() + `<div class="scroll"><div class="empty"><b>Nothing selected</b><span>Click anything in your app, or pick a layer on the left. Double-click text to retype it. Every change here is written to your code.</span></div>${paletteHTML()}</div>`;
      return;
    }
    const el = s.el, inf = info();
    const name = (activeLoc() === s.use ? s.useInfo?.tag : s.defInfo?.tag) || nameOf(el);
    const loc = activeLoc();
    let h = `<div class="sec head"><div class="secH"><span class="nm">${ico(layerIcon(el))}${esc(dName(el))}</span><span class="hbs">${hb('copyLoc', 'code', `Code: ${loc.replace(/:(\d+):\d+$/, ':$1')} (click to copy)`)}${hb('parent', 'up', 'Select parent')}</span></div>
      ${scopeHTML(s, name)}
      ${sourceHTML(inf)}
      ${sizeHTML(inf)}
      ${S.multi.length ? `<span class="note">+${S.multi.length} more selected: changes apply to all ${S.multi.length + 1}.</span>` : ''}
      ${s.repeat > 1 ? `<span class="note">Repeated ×${s.repeat} by the same code: edits apply to all of them.</span>` : ''}
      ${actionsHTML()}</div>`;
    if (!inf) h += `<div class="sec"><span class="note">Reading code…</span></div>`;
    else if (inf.error) h += `<div class="sec"><span class="note warn">${esc(inf.error)}</span></div>`;
    else if (!el.isConnected) h += `<div class="sec"><span class="note">This element isn’t on screen right now.</span></div>`;
    else {
      h += imageSection(el);
      if (el.tagName.toLowerCase() === 'svg') h += iconSection(el);
      else h += propsSection(inf);
      if (inf.classKind === 'dynamic') h += `<div class="sec"><span class="note warn">${esc(inf.classReason)}</span></div>`;
      if (inf.text?.editable) h += sec('Content', `<label class="inp"><input type="text" data-text="1" value="${esc(inf.text.value)}" aria-label="Text"></label>`);
      else if (isText(el)) h += sec('Content', `<span class="note">${esc(inf.text?.reason || '')}</span>`);
      if (isText(el) || inf.text?.editable) {
        // next/font names fonts like "__geistSans_1e4310": show "Geist Sans".
        const fam = camelWords(cs(el).fontFamily.split(',')[0].replace(/["']/g, '').replace(/^_+/, '').replace(/_[0-9a-f]{4,}$/i, '').replace(/_Fallback.*$/, '')).replace(/^./, (c) => c.toUpperCase());
        const fw = val('fontWeight');
        h += sec('Typography', `<label class="inp lock"><input type="text" value="${esc(fam)}" disabled aria-label="Font"></label>
          <div class="r2"><label class="inp"><select data-sel="fontWeight" aria-label="Weight">${[[100, 'Thin'], [200, 'Extra light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']].map(([v, n]) => `<option value="${v}"${v === fw ? ' selected' : ''}>${n}</option>`).join('')}</select>${ico('chev', 12)}</label>${nf('fontSize', '<b class="tg">T</b>', 'Font size')}</div>
          <div class="r2">${nf('lineHeight', 'lh', 'Line height')}${nf('letterSpacing', 'ls', 'Letter spacing', '%')}</div>
          <div class="r2"><div class="ibs">${[['left', 'alL'], ['center', 'alC'], ['right', 'alR']].map(([v, i]) => `<button class="ib${val('align') === v ? ' on' : ''}" data-act="set" data-p="align" data-v="${v}" title="Align ${v}">${ico(i)}</button>`).join('')}</div><span></span></div>`);
        h += sec('Text color', colorRow('color', 'Text color'));
      }
      h += layoutSections(el);
      if (el.tagName.toLowerCase() === 'svg') {
        h += sec('Icon color', colorRow('color', 'Icon color'));
        h += sec('Appearance', `<div class="r2">${nf('opacity', 'opa', 'Opacity', '%')}<span></span></div>`);
        const st0 = p.querySelector('.scroll')?.scrollTop || 0;
        p.innerHTML = tabsHTML() + `<div class="scroll">${h}</div>`;
        p.querySelector('.scroll').scrollTop = st0;
        return;
      }
      const indep = S.corners;
      h += sec('Appearance', `<div class="r2c">${nf('opacity', 'opa', 'Opacity', '%')}${nf('radius', 'rad', 'Corner radius')}<button class="ib${indep ? ' on' : ''}" data-act="corners" title="Independent corners">${ico('corners')}</button></div>
        ${indep ? `<div class="r4">${nf('rTL', cornerIco(0), 'Top left')}${nf('rTR', cornerIco(90), 'Top right')}${nf('rBR', cornerIco(180), 'Bottom right')}${nf('rBL', cornerIco(270), 'Bottom left')}</div>` : ''}`);
      const g = gradOf();
      const hasFill = g || (val('bg') && val('bg') !== 'transparent');
      h += sec('Fill', hasFill ? fillBody(g, el) : '', hasFill ? '' : hb('addFill', 'plus', 'Add fill'));
      const hasStroke = val('borderW') > 0;
      h += sec('Stroke', hasStroke ? colorRow('borderC', 'Stroke color', 'rmStroke') + `<div class="r2">${nf('borderW', 'sw', 'Stroke width')}<span></span></div>` : '', hasStroke ? '' : hb('addStroke', 'plus', 'Add stroke'));
      const sh = shadowOf(), keys = (S.theme?.shadow || []).filter((k) => k !== 'none' && k !== 'inner');
      h += sec('Effects', sh !== 'none' ? `<div class="cr"><label class="inp"><select data-sel="shadow" aria-label="Shadow">${keys.map((k) => `<option value="${esc(k)}"${k === sh ? ' selected' : ''}>Shadow · ${k === 'DEFAULT' ? 'default' : esc(k)}</option>`).join('')}</select>${ico('chev', 12)}</label><button class="ib" data-act="set" data-p="shadow" data-v="none" title="Remove">${ico('minus')}</button></div>` : '', sh !== 'none' ? '' : hb('set', 'plus', 'Add shadow', 'sm', 'data-p="shadow"'));
    }
    const st = p.querySelector('.scroll')?.scrollTop || 0;
    p.innerHTML = tabsHTML() + `<div class="scroll">${h}</div>`;
    p.querySelector('.scroll').scrollTop = st;
  }

  /* ---------- history ---------- */
  async function refreshVersions() {
    try { S.versions = await api('/versions'); } catch {}
    renderTop();
    if (S.mode === 'edit') layersSoon();
    if (S.side === 'history') renderPanel();
    renderPeek();
  }
  const time = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const chLabel = (c) => `${c.name ? `<b>${esc(c.name)}</b> · ` : ''}${esc(c.label)}`;
  function historyHTML() {
    const { versions, draft, peeking } = S.versions;
    const v = versions.slice().reverse();
    return `<div class="ptabs"><button class="on">Version history</button><button class="x" data-act="history" aria-label="Close">${ico('x')}</button></div>
      <div class="scroll" style="padding:8px;display:flex;flex-direction:column;gap:4px">
      ${draft.length ? `<div class="ver"><div class="vh"><span>Current</span><span>${draft.length} unsaved change${draft.length === 1 ? '' : 's'}</span></div>${draft.slice(-4).reverse().map((c) => `<span class="ch">${chLabel(c)}</span>`).join('')}${draft.length > 4 ? `<span class="note">and ${draft.length - 4} more</span>` : ''}<div class="acts"><button class="outline" data-act="saveVersion">Save as a version</button><span class="note">Also saved when you go back to Preview.</span></div></div>` : ''}
      ${v.map((x) => `<div class="ver${peeking === x.n ? ' on' : ''}"><div class="vh"><span>Version ${x.n}</span><span>${time(x.at)}</span></div>
        ${x.changes.slice(0, 5).map((c) => `<span class="ch">${c.source === 'ai' ? '<span class="src">AI</span> ' : ''}${chLabel(c)}</span>`).join('')}${x.changes.length > 5 ? `<span class="note">and ${x.changes.length - 5} more</span>` : ''}
        <div class="acts"><button class="outline" data-act="peek" data-v="${x.n}">${peeking === x.n ? 'Back to now' : 'Show before'}</button><button class="ghostBtn" data-act="restore" data-v="${x.n - 1}" title="Undo this version and everything after it">Undo from here</button></div></div>`).join('')}
      ${!v.length && !draft.length ? `<div class="empty"><b>No versions yet</b><span>Each time you go from Edit back to Preview, Kerf saves your changes as a version. Here you can see the screen before a version or undo back to it.</span></div>` : ''}
      </div>`;
  }
  function renderPeek() {
    const b = $('peekBar'), n = S.versions.peeking;
    b.hidden = !n;
    if (n) b.innerHTML = `<span>Showing the screen before version ${n}</span><button class="amberBtn" data-act="peek" data-v="${n}">Back to now</button>`;
  }

  /* ---------- changes popover, toast ---------- */
  async function renderChanges() {
    const c = $('changes');
    c.hidden = !S.changesOpen;
    if (c.hidden) return;
    let list = [];
    try { list = await api('/changes'); } catch {}
    c.innerHTML = `<div class="secH"><span>Changes this session</span>${hb('changes', 'x', 'Close')}</div>` + (list.length
      ? list.slice().reverse().map((x) => `<div class="chg"><span>${esc((x.summary.labels || []).join(' · '))}</span><span class="mono">${esc(x.file)}${x.summary.added?.length || x.summary.removed?.length ? ` · ${esc([x.summary.removed.join(' ') || '—', x.summary.added.join(' ')].join(' → '))}` : ''}</span></div>`).join('')
      : '<span class="note">No changes yet.</span>');
  }
  let toastT;
  function toast(msg, sub, err, withUndo, code) {
    const t = $('toast');
    t.hidden = false;
    t.className = 'toast' + (err ? ' err' : '');
    t.innerHTML = `<div class="tx"><span>${esc(msg)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}${code ? `<details class="code"><summary>Code</summary><span class="mono">${esc(code)}</span></details>` : ''}</div>${withUndo ? '<button class="outline" data-act="undo">Undo</button>' : ''}<button class="ib" data-act="toastClose" aria-label="Dismiss">${ico('x')}</button>`;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), err ? 6000 : 4000);
  }

  /* ---------- modes ---------- */
  function setMode(m) {
    if (m === S.mode) return;
    S.mode = m;
    S.hintSeen = true;
    if (m === 'preview') {
      S.sel = null; S.hover = null; S.changesOpen = false; S.tab = 'design';
      if (S.editing) S.editing.blur();
      api('/version', {}).then((v) => { S.versions = v; renderTop(); }).catch(() => {});
      renderChanges();
    } else { S.askOpen = false; if (S.side === 'history') S.side = 'design'; }
    renderAll();
    // Panels open or close with the mode, so the presentation re-fits.
    setTimeout(applyDevice, 0);
  }
  function renderAll() {
    renderTop(); renderBar(); renderLayers(); renderPanel(); renderAsk(); renderMarks();
  }

  /* ---------- outlines follow the page ---------- */
  function place(box, el, label) {
    if (!el || !el.isConnected || !W) { box.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.style.transform = `translate(${r.left}px,${r.top}px)`;
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    const t = box.querySelector('.tag');
    if (label != null && t) { t.textContent = label; t.classList.toggle('in', r.top < 22); }
  }
  const labelOf = (el) => dName(el);
  function pool(container, n, cls) {
    while (container.children.length < n) { const d = document.createElement('div'); d.className = 'box ' + cls; d.innerHTML = '<span class="tag"></span>'; container.appendChild(d); }
    return [...container.children];
  }
  function loop() {
    try { frameStep(); } catch (e) { if (!loop.warned) { console.warn('Kerf: drawing step failed', e); loop.warned = true; } }
    requestAnimationFrame(loop);
  }
  function frameStep() {
    refind();
    const edit = S.mode === 'edit';
    place($('hov'), edit && S.tool !== 'annotate' && S.hover !== S.sel?.el ? S.hover : null, S.hover ? labelOf(S.hover) : '');
    place($('sel'), edit ? S.sel?.el : null, S.sel ? labelOf(S.sel.el) : '');
    if (edit && S.sel?.el?.isConnected) {
      const r = S.sel.el.getBoundingClientRect(), dim = $('sel').querySelector('.dim');
      const t = `${Math.round(r.width)} × ${Math.round(r.height)}`;
      if (dim.textContent !== t) dim.textContent = t;
      $('sel').classList.toggle('comp', !!(useOf(S.sel.el) && /^[A-Z]/.test(S.sel.el.getAttribute('data-kerf-n') || '')));
    }
    const sib = edit && S.sel && S.sel.repeat > 1 ? [...sameLoc(S.sel.el)].filter((x) => x !== S.sel.el).slice(0, 60) : [];
    pool($('sibs'), sib.length, 'sib').forEach((b, i) => place(b, sib[i] || null, null));
    const aEls = D ? (S.amber || []).flatMap((loc) => [...D.querySelectorAll(q(loc))]).slice(0, 60) : [];
    pool($('amb'), aEls.length, 'amber').forEach((b, i) => place(b, aEls[i] || null, null));
    if (W) $('marksG').setAttribute('transform', `translate(${-W.scrollX} ${-W.scrollY})`);
    placeHandles(); placeMulti(); measureLines();
    if (W && W.location.pathname + W.location.search !== S.path) {
      S.path = W.location.pathname + W.location.search;
      S.pages = [S.path, ...S.pages.filter((x) => x !== S.path)].slice(0, 20);
      if (document.activeElement?.id !== 'pathIn') { const pi = $('pathIn'); if (pi) pi.value = S.path; }
      layersSoon();
    }
  }

  /* ---------- app events ---------- */
  function bindApp() {
    try { W = frame.contentWindow; D = frame.contentDocument; } catch { W = D = null; }
    if (!W || !D) return;
    S.sel = null; S.hover = null;
    // An input the app focuses on load would swallow Kerf's shortcuts (E, A…): release it until the user clicks in the app.
    let touched = false;
    W.addEventListener('pointerdown', () => { touched = true; }, true);
    [0, 300, 1200].forEach((ms) => setTimeout(() => { const a = D.activeElement; if (!touched && a && a !== D.body && /^(input|textarea|select)$/i.test(a.tagName)) a.blur(); }, ms));
    const block = (e) => {
      if (S.mode !== 'edit' && S.tool !== 'annotate') return;
      if (S.editing && S.editing.contains(e.target)) return;
      e.preventDefault(); e.stopPropagation();
    };
    ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'touchstart', 'submit', 'contextmenu', 'auxclick'].forEach((t) => W.addEventListener(t, block, true));
    W.addEventListener('pointerdown', () => { closeMenu(); closeIconPop(); }, true);
    W.addEventListener('scroll', () => closeMenu(), true);
    W.addEventListener('contextmenu', (e) => {
      if (S.mode !== 'edit' || S.tool === 'annotate' || S.editing) return;
      const hit = pick(e.target);
      if (!hit) return;
      if (S.sel?.el !== hit) { S.multi = []; select(hit); }
      const fr = frame.getBoundingClientRect();
      setTimeout(() => contextMenu({ x: fr.left + e.clientX * S.z, y: fr.top + e.clientY * S.z }), 0);
    }, true);
    let lastClick = null;
    // Browsers send no click to a disabled button or input, only pointer events: select those on release.
    W.addEventListener('pointerup', (e) => { if (S.mode === 'edit' && e.button === 0 && e.target.closest?.(':disabled')) onCanvasClick(e); }, true);
    W.addEventListener('click', onCanvasClick, true);
    function onCanvasClick(e) {
      if (S.mode !== 'edit') { closeFloating(); return; }
      if (S.editing && S.editing.contains(e.target)) return;
      block(e);
      closeFloating();
      // A click on a <label> makes the browser click its input too: ignore that echo.
      const now = performance.now();
      if (lastClick && now - lastClick.t < 80 && lastClick.el !== e.target && !lastClick.el.contains(e.target)) return;
      lastClick = { el: e.target, t: now };
      if (S.editing) S.editing.blur();
      layersScrollToSel = true;
      const hit = pick(e.target);
      if (e.shiftKey && S.sel && hit && hit !== S.sel.el) {
        const i = S.multi.findIndex((m) => m.el === hit);
        if (i > -1) S.multi.splice(i, 1); else S.multi.push({ el: hit, def: defOf(hit), use: useOf(hit) });
        renderPanel();
        return;
      }
      S.multi = [];
      select(hit);
    }
    W.addEventListener('dblclick', (e) => {
      if (S.mode !== 'edit') return;
      block(e);
      if (S.sel && S.sel.el.contains(e.target)) beginText();
    }, true);
    W.addEventListener('pointermove', (e) => { S.hover = S.mode === 'edit' ? pick(e.target) : null; }, true);
    W.addEventListener('pointerleave', () => { S.hover = null; });
    W.addEventListener('keydown', onKey, true);
    W.addEventListener('wheel', pinch, { passive: false });
    // Re-read layers when the app's DOM changes (navigation, data loading, hot reload).
    new W.MutationObserver(() => layersSoon()).observe(D.body, { childList: true, subtree: true });
    renderAll();
  }
  frame.addEventListener('load', bindApp);
  addEventListener('resize', () => { if (innerWidth < 1000 && S.layersOpen) { S.layersOpen = false; renderLayers(); renderTop(); } });

  // Clicking outside a floating card closes it.
  function closeFloating() {
    let changed = false;
    if (S.askOpen && !S.card?.busy) { S.askOpen = false; changed = true; }
    if (S.card && !S.card.busy && S.card.where === 'notes') { S.card = null; changed = true; }
    if (S.changesOpen) { S.changesOpen = false; renderChanges(); }
    if (S.cpick) { S.cpick = null; renderPanel(); }
    if (changed) { S.amber = []; renderAsk(); renderMarks(); renderBar(); }
  }

  /* ---------- keyboard (editor and app) ---------- */
  function onKey(e) {
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); toggleAI(true); return; }
    if (!typing && !mod && e.key === '?') { e.preventDefault(); shortcuts(); return; }
    if (!typing && !mod && e.shiftKey && (e.key === '|' || e.code === 'Backslash')) { e.preventDefault(); toggleMinUI(); return; }
    if (e.key === 'Escape' && !$('menu').hidden) { closeMenu(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom('in'); return; }
    if (mod && (e.key === '-' || e.key === '_')) { e.preventDefault(); setZoom('out'); return; }
    if (e.shiftKey && !mod && !typing && (e.code === 'Digit1' || e.code === 'Digit0')) { e.preventDefault(); setZoom(e.code === 'Digit1' ? 'fit' : 1); return; }
    if (e.key === 'Escape') {
      if (S.editing) return;
      e.preventDefault();
      if (!$('modal').hidden) { $('modal').hidden = true; }
      else if (S.cpick) { S.cpick = null; renderPanel(); }
      else if (S.noteDraft) { S.noteDraft = null; renderMarks(); }
      else if (S.card && !S.card.busy && S.card.where !== 'chat') { S.card = null; S.amber = []; renderAll(); }
      else if (S.askOpen) { S.askOpen = false; S.amber = []; renderAsk(); renderBar(); }
      else if (S.changesOpen) { S.changesOpen = false; renderChanges(); }
      else if (S.tool === 'annotate') setTool('select');
      else if (S.mode === 'edit' && S.tab === 'chat') { S.tab = 'design'; renderPanel(); renderBar(); }
      else if (S.side === 'history') { S.side = 'design'; renderAll(); }
      else if (S.mode === 'edit' && S.multi.length) { S.multi = []; renderPanel(); }
      else if (S.mode === 'edit' && S.sel) select(null);
      else if (S.mode === 'edit') setMode('preview');
      return;
    }
    if (typing) return;
    if (mod && e.key.toLowerCase() === 'z' && S.mode === 'edit') { e.preventDefault(); undo(); return; }
    if (mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'e') setMode('edit');
    else if (k === 'p') setMode('preview');
    else if (k === 'a') setTool(S.tool === 'annotate' ? 'select' : 'annotate');
    else if (S.tool === 'annotate' && ['1', '2', '3', '4'].includes(k)) { S.shape = ['pin', 'box', 'circle', 'arrow'][+k - 1]; renderBar(); }
    else if (S.mode === 'edit' && k === 'enter' && S.sel) beginText();
    else return;
    e.preventDefault();
  }
  window.addEventListener('keydown', onKey, true);
  function toggleAI(fromKey) {
    if (S.mode === 'edit') { S.tab = fromKey ? 'chat' : S.tab === 'chat' ? 'design' : 'chat'; renderPanel(S.tab === 'chat'); }
    else { S.askOpen = fromKey ? true : !S.askOpen; if (!S.askOpen) S.amber = []; renderAsk(); }
    renderBar();
  }

  /* ---------- editor clicks ---------- */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    const lay = e.target.closest('[data-layer]');
    if (lay) {
      const tw = e.target.closest('[data-twist]');
      if (tw && tw.innerHTML) { const k = tw.dataset.twist; S.open[k] = !(S.open[k] || false); renderLayers(); return; }
      const el = layerEls[+lay.dataset.layer];
      if (el) { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); select(el); }
      return;
    }
    if (!a) {
      if (S.cpick && !e.target.closest('.cpop')) { S.cpick = null; renderPanel(); }
      if (!e.target.closest('#ask,#noteRes,#bar,#changes,#toast,#panel,#layers,#top,#modal')) closeFloating();
      return;
    }
    const act = a.dataset.act, v = a.dataset.v;
    switch (act) {
      case 'mode': setMode(v); break;
      case 'undo': undo(); break;
      case 'changes': S.changesOpen = !S.changesOpen; renderChanges(); break;
      case 'toastClose': $('toast').hidden = true; break;
      case 'scope': S.scope = v; S.cpick = null; renderPanel(); break;
      case 'srcScope': S.srcScope = v; renderPanel(); break;
      case 'sizeOnly': S.sizeOnly[S.device] = v === 'true'; renderPanel(); break;
      case 'reveal': S.reveal = { el: S.sel?.el, ...(S.reveal?.el === S.sel?.el ? S.reveal : {}), [v]: true }; renderPanel(); break;
      case 'saveVersion': api('/version', {}).then((v) => { S.versions = v; renderPanel(); renderTop(); toast(`Saved version ${v.versions.length}`); }).catch((e) => toast(e.message, '', true)); break;
      case 'copyLoc': navigator.clipboard?.writeText(activeLoc() || '').then(() => toast('Copied the code location', activeLoc() || '')).catch(() => {}); break;
      case 'parent': { const p = S.sel && pick(S.sel.el.parentElement); if (p) select(p); break; }
      case 'corners': S.corners = !S.corners; renderPanel(); break;
      case 'cpick': S.cpick = S.cpick === v ? null : v; renderPanel(); break;
      case 'token': case 'set': commit({ ops: [{ prop: a.dataset.p, value: v }] }); break;
      case 'addFill': commit({ ops: [{ prop: 'bg', value: tokens().find(([n]) => n === 'surface')?.[0] || 'white' }] }); break;
      case 'rmFill': S.cpick = null; commit({ ops: gradOf() ? [{ prop: 'gradient', value: 'none' }, { prop: 'clipText', value: 'off' }] : [{ prop: 'bg', value: 'transparent' }] }); break;
      case 'addStroke': commit({ ops: [{ prop: 'borderW', value: 1 }, { prop: 'borderC', value: tokens().find(([n]) => n === 'border')?.[0] || 'black' }] }); break;
      case 'rmStroke': S.cpick = null; commit({ ops: [{ prop: 'borderW', value: 0 }] }); break;
      case 'setProp': commit({ props: [{ name: a.dataset.p, value: v }] }); break;
      case 'tab': S.tab = v; renderPanel(v === 'chat'); renderBar(); break;
      case 'chatToggle': toggleAI(false); break;
      case 'ask': toggleAI(false); break;
      case 'layersToggle': S.layersOpen = !S.layersOpen; renderLayers(); renderTop(); break;
      case 'device': S.device = v; S.zoom = 'fit'; applyDevice(); renderTop(); renderPanel(); break;
      case 'zoom': setZoom(v); break;
      case 'kerfMenu': kerfMenu(below(a)); break;
      case 'pagesMenu': pagesMenu(below(a)); break;
      case 'zoomMenu': zoomMenu(below(a)); break;
      case 'shortcuts': shortcuts(); break;
      case 'reload': W?.location.reload(); break;
      case 'history': S.side = S.side === 'history' ? 'design' : 'history'; if (S.side === 'history') refreshVersions(); renderAll(); break;
      case 'peek': peek(+v); break;
      case 'restore': restore(+v); break;
      case 'pr': openPR(); break;
      case 'closeModal': $('modal').hidden = true; break;
      case 'createPR': createPR(); break;
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.propsel) return t.value && commit({ props: [{ name: t.dataset.propsel, value: t.value }] });
    if (t.dataset.propnum) { const n = parseFloat(t.value); return isFinite(n) && commit({ props: [{ name: t.dataset.propnum, value: n }] }); }
    if (t.dataset.proptext) return commit({ props: [{ name: t.dataset.proptext, value: t.value }] });
    if (t.dataset.sel) return commit({ ops: [{ prop: t.dataset.sel, value: /^\d+$/.test(t.value) ? +t.value : t.value }] });
    if (t.dataset.text) return t.value.trim() && commit({ text: t.value.trim() });
    if (t.dataset.colorinput) return commit({ ops: [{ prop: t.dataset.colorinput, value: t.value.toUpperCase() }] });
    const p = t.dataset.prop;
    if (!p) return;
    if (t.dataset.color) {
      const hx = t.value.trim().replace(/^#/, '');
      if (/^[0-9a-f]{6}$/i.test(hx)) commit({ ops: [{ prop: p, value: '#' + hx.toUpperCase() }] });
      else renderPanel();
      return;
    }
    const n = parseFloat(t.value);
    if (isNaN(n)) return renderPanel();
    commit({ ops: [{ prop: p, value: clamp(p, Math.round(n * 10) / 10) }] });
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.colorinput && S.sel) preview(S.sel.el, t.dataset.colorinput, t.value);
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target, p = t.dataset && t.dataset.prop;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && t.closest && t.closest('.kc')) { e.preventDefault(); t.form.requestSubmit(); return; }
    if (!p || t.dataset.color || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !S.sel) return;
    e.preventDefault();
    const n = clamp(p, (parseFloat(t.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
    t.value = n;
    preview(S.sel.el, p, n);
    commitSoon(p, n);
  });
  document.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.dataset.form;
    if (f === 'path') { let v = $('pathIn').value.trim() || '/'; if (!v.startsWith('/')) v = '/' + v; frame.src = v; $('pathIn').blur(); }
    if (f === 'ask') take('askIn', (v, atts) => runAI(v, visibleTargets(), 'ask', null, false, atts));
    if (f === 'chat') sendChat();
    if (f === 'note') addNote();
    if (f === 'reply') {
      const where = e.target.dataset.where, prev = S.card;
      take('replyIn', (v, atts) => runAI(v, where === 'notes' && prev?.targets ? prev.targets : visibleTargets(), where, v, true, atts));
    }
  });
  // Drag a field's icon to scrub its value, like Figma. Preview live, write once on release.
  let scrub = null;
  document.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-scrub]');
    if (!h || !S.sel) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    const p = h.dataset.scrub;
    scrub = { p, x: e.clientX, v: parseFloat(val(p)) || 0, input: h.parentElement.querySelector('input'), n: null };
    document.body.style.cursor = 'ew-resize';
  });
  document.addEventListener('pointermove', (e) => {
    if (!scrub) return;
    const n = clamp(scrub.p, Math.round(scrub.v + (e.clientX - scrub.x) / 2));
    scrub.n = n;
    scrub.input.value = n;
    preview(S.sel.el, scrub.p, n);
  });
  document.addEventListener('pointerup', () => {
    if (!scrub) return;
    const s = scrub;
    scrub = null;
    document.body.style.cursor = '';
    if (s.n != null && s.n !== s.v) commit({ ops: [{ prop: s.p, value: s.n }] });
  });

  /* ---------- history actions ---------- */
  async function peek(n) {
    try {
      S.versions = S.versions.peeking === n ? await api('/unpeek', {}) : await api('/peek', { n });
      toast(S.versions.peeking ? `Showing the screen before version ${n}` : 'Back to the current version');
    } catch (e) { toast(e.message, '', true); }
    afterEdit();
  }
  async function restore(n) {
    if (!confirm(n === 0 ? 'Undo every change from this session?' : `Undo everything after version ${n}?`)) return;
    try {
      S.versions = await api('/restore', { n });
      const c = await api('/changes');
      S.count = c.length;
      toast(n === 0 ? 'Back to how the screen started' : `Restored version ${n}`);
    } catch (e) { toast(e.message, '', true); }
    afterEdit();
  }

  /* ---------- pull request ---------- */
  async function openPR() {
    await api('/version', {}).then((v) => (S.versions = v)).catch(() => {});
    const p = await api('/project').catch(() => ({}));
    const all = [...S.versions.versions.flatMap((v) => v.changes), ...S.versions.draft];
    const files = [...new Set(all.map((c) => c.file))];
    const title = all.length === 1 ? `Design: ${all[0].name ? all[0].name + ' · ' : ''}${all[0].label}`.slice(0, 72) : `Design updates: ${all.length} changes${S.path === '/' ? '' : ` on ${S.path}`}`;
    S.prAll = all;
    const m = $('modal');
    m.hidden = false;
    m.innerHTML = `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="prT">
      <div class="dh"><div style="display:flex;flex-direction:column;gap:4px"><h2 id="prT">Hand off to developers</h2><span class="note">Kerf sends your changes as one pull request on GitHub. Developers review it before anything goes live.</span></div><button class="ib" data-act="closeModal" aria-label="Close">${ico('x')}</button></div>
      <div class="db">
        ${!p.repo ? `<span class="note warn">This project isn’t connected to a GitHub repository, so Kerf can’t open a pull request for it.</span>` : ''}
        <label><span class="secT">Title</span><input class="fld" id="prTitle" value="${esc(title)}"></label>
        <label><span class="secT">Note for your developers <span class="note" style="font-weight:400">(optional)</span></span><textarea class="fld" id="prBody" rows="3" placeholder="Anything they should know, e.g. why you made these changes"></textarea></label>
        <div style="display:flex;align-items:center;gap:8px;color:var(--ink2)"><span class="chip mono" style="color:var(--ink)">${p.branch?.startsWith('kerf/') ? esc(p.branch) : 'kerf/…'}</span>→<span class="chip mono" style="color:var(--ink)">${esc(p.branch?.startsWith('kerf/') ? 'its pull request' : p.branch || 'main')}</span>${p.repo ? `<span class="note">${esc(p.repo)}</span>` : ''}</div>
        <div class="files"><div class="fh"><span>What changed · ${all.length}</span><span class="note" title="${esc(files.join('\n'))}">${files.length} code file${files.length === 1 ? '' : 's'}</span></div><div class="frs">${all.map((c) => `<div class="fr"><span class="dot" style="margin:0"></span><span>${c.source === 'ai' ? '<span class="src">AI</span> ' : ''}${c.name ? `<b>${esc(c.name)}</b> · ` : ''}${esc(c.label)}</span></div>`).join('')}</div></div>
      </div>
      <div class="df"><button class="outline" data-act="closeModal">Cancel</button><button class="primary solo" data-act="createPR" ${p.repo && files.length ? '' : 'disabled'}>Create pull request</button></div></section>`;
  }
  async function createPR() {
    const btn = document.querySelector('[data-act="createPR"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="spin"></i>Sending to GitHub…';
    try {
      const all = S.prAll || [], note = $('prBody').value.trim();
      const body = `${note ? note + '\n\n' : ''}### What changed\n${all.map((c) => `- ${c.source === 'ai' ? '(AI) ' : ''}${c.name ? `**${c.name}**: ` : ''}${c.label}`).join('\n')}\n\n<details><summary>Code changes</summary>\n\n${all.map((c) => `- \`${c.file}\`: ${c.code || c.label}`).join('\n')}\n</details>\n\nMade with Kerf.`;
      const r = await api('/pr', { title: $('prTitle').value, body });
      $('modal').innerHTML = `<section class="dialog" role="dialog" aria-modal="true"><div class="db" style="padding:20px;gap:10px">
        <span style="display:grid;place-items:center;width:32px;height:32px;border-radius:8px;background:var(--raised)">${ico('check', 16)}</span>
        <h2 style="margin:0;font-size:18px">${r.updated ? 'Pull request updated' : r.needsGitHubStep ? 'Branch pushed' : 'Pull request ready'}</h2>
        <span class="note">${r.files.length} file${r.files.length === 1 ? '' : 's'} on <span class="mono">${esc(r.branch)}</span>.${r.needsGitHubStep ? ' Open the link to finish creating the pull request on GitHub.' : ''}</span>
        ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>` : ''}</div>
        <div class="df"><button class="primary solo" data-act="closeModal">Done</button></div></section>`;
      S.project = await api('/project').catch(() => S.project);
      renderTop();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Try again';
      toast(e.message, '', true);
    }
  }

  /* ---------- AI: Ask bar, chat, annotations ---------- */
  const PROP_NAMES = { gradient: 'Gradient', clipText: 'Gradient text', fit: 'Image fit', bg: 'Fill', color: 'Text color', borderC: 'Stroke color', fontSize: 'Size', fontWeight: 'Weight', lineHeight: 'Line height', letterSpacing: 'Letter spacing', align: 'Align', radius: 'Radius', rTL: 'Top-left corner', rTR: 'Top-right corner', rBR: 'Bottom-right corner', rBL: 'Bottom-left corner', padX: 'Padding X', padY: 'Padding Y', gap: 'Gap', borderW: 'Stroke', opacity: 'Opacity', shadow: 'Shadow', w: 'Width', h: 'Height', mX: 'Margin X', mY: 'Margin Y', layout: 'Layout', alignItems: 'Align', justify: 'Distribute', wrap: 'Wrap' };
  const UNIT = { w: 'px', h: 'px', mX: 'px', mY: 'px', fontSize: 'px', lineHeight: 'px', radius: 'px', rTL: 'px', rTR: 'px', rBR: 'px', rBL: 'px', padX: 'px', padY: 'px', gap: 'px', borderW: 'px', opacity: '%', letterSpacing: '%' };
  const WORDS = { fill: 'Fill', grow: 'Fill', hug: 'Hug', auto: 'Auto', row: 'Horizontal', col: 'Vertical', none: 'Off', true: 'On', false: 'Off' };
  const opLabel = (o) => { const v = String(o.value); if (o.prop === 'fontWeight') return `Weight ${({ 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold' })[v] || v}`; return `${PROP_NAMES[o.prop] || o.prop} ${WORDS[v] || v}${/^-?[\d.]+$/.test(v) ? UNIT[o.prop] || '' : ''}`; };
  const structLabel = (st) => ({ token: `Colour “${st.name}”${st.which && st.which !== 'both' ? ` (${st.which})` : ''} → ${st.hex}`, code: `Code change in ${String(st.file || '').split('/').pop()}`, group: `Group into a frame (${st.className || ''})`, ungroup: 'Ungroup', replace: `Replace with: ${(st.jsx || '').slice(0, 60)}`, delete: 'Delete', duplicate: 'Duplicate', move: `Move ${st.dir || 'to ' + st.index}`, swap: `Swap → ${st.to}`, insert: `Add ${st.position}: ${(st.jsx || '').slice(0, 60)}`, image: [st.src && `Image → ${st.src}`, st.alt != null && `Alt “${st.alt}”`].filter(Boolean).join(' · ') })[st.type];
  const editLabel = (e) => e.structure ? structLabel(e.structure) : [...e.ops.map(opLabel), ...(e.props || []).map((p) => `${p.name}: ${p.value}`), ...(e.text ? [`“${e.text}”`] : [])].join(' · ');
  function measure(el) {
    const c = cs(el);
    return { fontSize: c.fontSize, color: rgbHex(c.color), fill: rgbHex(c.backgroundColor), radius: c.borderTopLeftRadius, padding: c.padding, display: c.display };
  }
  function targetsOf(el, note) {
    const def = defOf(el), use = useOf(el);
    const base = targetOf(el, note);
    if (!(def && use && el.getAttribute('data-kerf-n'))) return [base];
    // A component instance: the use site (just this one) and the definition (every use).
    return [{ ...base, loc: use, instance: true, shared: false }, { ...base, loc: def, shared: true, instance: false }];
  }
  function targetOf(el, note) {
    const def = defOf(el), use = useOf(el);
    const loc = use && (!def || el.tagName.toLowerCase() === 'svg' || el.getAttribute('data-kerf-n')) ? use : def || use;
    const img = el.tagName.toLowerCase() === 'img' ? { imgSrc: el.getAttribute('src'), alt: el.getAttribute('alt') } : {};
    return { loc, shared: !!(def && use), measured: measure(el), text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100), note, dom: [...el.classList], name: dName(el), box: (() => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })(), ...img };
  }
  function uniq(list) {
    const seen = new Set(), out = [];
    for (const t of list) if (t.loc && !seen.has(t.loc)) { seen.add(t.loc); out.push(t); }
    return out;
  }
  const tagged = (root) => (root || D ? [...(root || D).querySelectorAll('[data-kerf],[data-kerf-use]')] : []);
  // If the frame reports no size (a hidden window), treat the whole page as visible.
  const onScreen = (el) => { const r = el.getBoundingClientRect(); const vw = W.innerWidth || 1e5, vh = W.innerHeight || 1e5; return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw; };
  // Fewer, more relevant elements make Claude faster: what's on screen, biggest first is not useful, document order is.
  const visibleTargets = () => (D ? uniq(tagged().filter(onScreen).flatMap((el) => targetsOf(el))).slice(0, 64) : []);
  function selectionTargets() {
    const el = S.sel.el, out = [...targetsOf(el)];
    if (activeLoc() !== out[0].loc) out.unshift({ ...out[0], loc: activeLoc() });
    let p = el.parentElement;
    for (let i = 0; p && i < 2; p = p.parentElement) { const t = pick(p); if (t) { out.push(targetOf(t)); p = t; i++; } }
    tagged(el).slice(0, 30).forEach((c) => out.push(...targetsOf(c)));
    return uniq(out);
  }
  function noteTargets(n, i) {
    const pts = n.shape === 'pin' ? [[n.x, n.y]] : n.shape === 'arrow' ? [[n.x2, n.y2]] : [[n.x + n.w / 2, n.y + n.h / 2]];
    const els = [];
    for (const [px, py] of pts) D.elementsFromPoint(px - W.scrollX, py - W.scrollY).map(pick).filter(Boolean).slice(0, 3).forEach((e) => els.push(e));
    if (n.shape === 'box' || n.shape === 'circle') {
      tagged().forEach((el) => {
        const r = el.getBoundingClientRect(), cx = r.left + r.width / 2 + W.scrollX, cy = r.top + r.height / 2 + W.scrollY;
        if (r.width && cx >= n.x && cx <= n.x + n.w && cy >= n.y && cy <= n.y + n.h) els.push(el);
      });
    }
    return uniq(els.flatMap((el) => targetsOf(el, i + 1))).slice(0, 24);
  }

  // One conversation shared by the Ask bar, notes and chat.
  function historyFor() {
    const h = [];
    for (const m of S.chat) {
      if (m.role === 'user') h.push({ role: 'user', text: m.text });
      else if (m.error) h.push({ role: 'assistant', text: `(error) ${m.error}` });
      else if (m.proposal) h.push({ role: 'assistant', text: `${m.proposal.message}\nProposed: ${m.proposal.edits.map((e) => `${e.tag} ${editLabel(e)}`).join('; ') || 'no edits'}\nStatus: ${m.status}` });
    }
    return h.filter((x, i) => !(i > 0 && h[i - 1].role === x.role));
  }
  let chatT;
  function saveChat() {
    clearTimeout(chatT);
    chatT = setTimeout(() => api('/chat', { messages: S.chat.filter((m) => !m.busy).map(({ targets, ...m }) => m), notes: S.notes }).catch(() => {}), 300);
  }
  // What the designer is looking at, so Claude can resolve "this" and "here" and judge the screen.
  function aiContext() {
    let theme = null;
    try {
      const bg = getComputedStyle(D.body).backgroundColor, n = (bg.match(/[\d.]+/g) || []).map(Number);
      if (n.length >= 3 && !(n.length === 4 && n[3] === 0)) theme = 0.299 * n[0] + 0.587 * n[1] + 0.114 * n[2] < 128 ? 'dark' : 'light';
    } catch {}
    return { page: pageName(S.path), path: S.path, device: DEV_LABEL[S.device], width: W?.innerWidth, size: bpParam()?.label?.toLowerCase(), theme, selected: S.sel ? dName(S.sel.el) : null };
  }
  // A screenshot of exactly what's on screen (viewport), small and quick; skipped if it takes too long.
  let h2i = null;
  async function captureScreen() {
    if (!D || !W) return null;
    try {
      h2i ||= new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://unpkg.com/html-to-image@1.11.11/dist/html-to-image.js'; sc.onload = () => res(window.htmlToImage); sc.onerror = rej; document.head.appendChild(sc); });
      const lib = await h2i;
      const w = W.innerWidth, h = W.innerHeight, k = Math.min(1, 1280 / w);
      const shot = lib.toJpeg(D.documentElement, { width: w, height: h, canvasWidth: Math.round(w * k), canvasHeight: Math.round(h * k), pixelRatio: 1, quality: 0.72, skipFonts: true, cacheBust: false, style: { transform: `translate(${-W.scrollX}px, ${-W.scrollY}px)`, transformOrigin: '0 0' } });
      const url = await Promise.race([shot, new Promise((r) => setTimeout(() => r(null), 2500))]);
      return url && url.startsWith('data:image/jpeg') ? { media_type: 'image/jpeg', data: url.split(',')[1] } : null;
    } catch { h2i = null; return null; }
  }
  async function runAI(text, targets, where, shown, followUp, atts = []) {
    text = String(text || '').trim() || (atts.length ? 'Use the attached image.' : '');
    if (!text || S.card?.busy) return;
    if (!targets.length) { toast('Nothing on screen to work with yet. Wait for the page to load, or select something.', '', true); return; }
    const history = historyFor();
    const ctx = followUp ? 'Follow-up' : where === 'chat' && S.sel ? dName(S.sel.el) : where === 'notes' ? `${S.notes.length} note${S.notes.length === 1 ? '' : 's'}` : 'Whole screen';
    S.chat.push({ role: 'user', text, shown: shown || text, ctx, where, atts: atts.map((a) => ({ name: a.name, thumb: a.thumb })) });
    const m = { role: 'kerf', busy: true, status: 'pending', where, targets, noteTexts: where === 'notes' && !followUp ? S.notes.map((n) => n.text) : null, skip: [], started: Date.now(), looked: uniq(targets).map((t) => t.name).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).slice(0, 40), lookedN: targets.length };
    S.chat.push(m);
    S.card = m;
    renderAI();
    try {
      const screen = await captureScreen();
      m.proposal = await api('/ai', { request: text, targets, history, screen, context: aiContext(), images: atts.map((a) => ({ name: a.name, media_type: a.type, data: a.data, orig: a.orig })) });
      S.amber = m.proposal.edits.map((e) => e.loc);
      if (!m.proposal.edits.length) m.status = 'info';
    } catch (e) { m.error = e.message; }
    m.busy = false;
    m.took = Math.max(1, Math.round((Date.now() - m.started) / 1000));
    renderAI();
    saveChat();
  }
  async function decide(m, v) {
    if (!m || m.status !== 'pending') return;
    S.amber = [];
    if (v === 'apply') {
      const hadError = !!D?.querySelector('vite-error-overlay');
      m.applying = true;
      renderAI();
      const r = await api('/ai/apply', { edits: chosen(m).map((e) => (e.structure ? e : { ...e, bp: bpParam() })) }).catch((e) => ({ error: e.message }));
      m.applying = false;
      if (!r.error && chosen(m).some((e) => e.structure?.type === 'code')) guard(hadError);
      if (r.error) { toast(r.error, '', true); renderAI(); return; }
      const ok = r.results.filter((x) => x.ok && x.changed).length, bad = r.results.filter((x) => !x.ok);
      m.failed = bad.map((x) => x.loc);
      m.appliedN = ok;
      S.count = r.n;
      m.status = ok ? 'applied' : 'failed';
      toast(`Applied ${ok} change${ok === 1 ? '' : 's'}`, bad.length ? `${bad.length} skipped: ${bad[0].error}` : '', !!bad.length && !ok, !!ok);
      if (m.where === 'notes' && ok) S.notes = [];
      afterEdit();
    } else m.status = 'discarded';
    renderAI();
    saveChat();
  }
  const STATUS = { applied: 'Applied', discarded: 'Discarded', failed: 'Couldn’t apply', info: 'No changes to your app' };
  // Status is shown by Kerf, not written into the reply: drop a leading "Nothing changed yet." if the model adds one.
  const cleanMsg = (t) => { const x = String(t || '').replace(/^\s*(nothing (has )?changed( yet)?|no changes( were)?( made)?( yet)?|i (haven[’']t|have not) changed anything( yet)?)\s*[.:;,—–-]*\s*/i, ''); return x ? x[0].toUpperCase() + x.slice(1) : String(t || ''); };
  const chosen = (m) => m.proposal.edits.filter((e) => !(m.skip || []).includes(e.note ?? 0));
  // Each proposed change shows where it stands: to do, applying, done, failed or left out.
  function rowState(m, e) {
    const inPlan = chosen(m).includes(e);
    if (m.applying) return inPlan ? 'run' : 'skip';
    if (m.status === 'applied') return !inPlan ? 'skip' : (m.failed || []).includes(e.loc) ? 'bad' : 'ok';
    if (m.status === 'failed') return 'bad';
    if (m.status === 'discarded') return 'skip';
    return 'todo';
  }
  const MARK = { todo: '<i class="mk todo"></i>', run: '<i class="mk run"></i>', ok: `<i class="mk ok">${'<svg width="10" height="10" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'}</i>`, bad: '<i class="mk bad">×</i>', skip: '<i class="mk skip"></i>' };
  const rowFor = (m) => (e) => editRow(e, m ? rowState(m, e) : 'todo');
  const editRow = (e, st = 'todo') => `<div class="ed ${st}">${MARK[st] || ''}<div class="edB"><div class="edT"><b>${esc(e.name || e.tag)}</b><span class="mono">${esc(editLabel(e))}</span></div>${e.where ? `<span class="reach">Changes ${esc(e.where)}</span>` : ''}${e.why ? `<span>${esc(e.why)}</span>` : ''}${e.structure?.type === 'code' ? `<details class="code"><summary>Code change in ${esc(e.structure.file)}</summary><pre class="diff"><span class="del">${esc(e.structure.find)}</span><span class="add">${esc(e.structure.replace)}</span></pre></details>` : ''}</div></div>`;
  const NSTAT = { done: ['Done', 'ok'], partial: ['Partly', 'part'], not_possible: ['Not here', 'no'] };
  // Notes answered one by one: the mark's number, what was asked, what Kerf did, and its edits.
  function notesHTML(m, i) {
    const p = m.proposal, texts = m.noteTexts || [];
    const count = Math.max(texts.length, ...p.notes.map((n) => n.note), ...p.edits.map((e) => e.note || 0));
    const groups = [];
    for (let n = 1; n <= count; n++) {
      const info = p.notes.find((x) => x.note === n), eds = p.edits.filter((e) => e.note === n);
      if (!info && !eds.length && !texts[n - 1]) continue;
      groups.push({ n, info, eds, text: texts[n - 1] });
    }
    const loose = p.edits.filter((e) => !e.note || e.note > count);
    if (loose.length) groups.push({ n: 0, info: null, eds: loose, text: null });
    const pending = m.status === 'pending';
    return groups.map((g) => {
      const st = NSTAT[g.info?.status] || (g.eds.length ? NSTAT.done : NSTAT.not_possible);
      const off = (m.skip || []).includes(g.n);
      return `<div class="ng${off ? ' off' : ''}" data-ng="${g.n}" data-i="${i}">
        <div class="ngH">${g.n ? `<span class="nNum">${g.n}</span>` : '<span class="nNum other">+</span>'}<span class="ngQ">${g.text ? `“${esc(g.text)}”` : g.n ? `Note ${g.n}` : 'Also changed'}</span>${g.info || g.n ? `<span class="nSt ${st[1]}">${st[0]}</span>` : ''}
        ${pending && g.eds.length ? `<button class="nTog${off ? '' : ' on'}" data-act2="noteSkip" data-i="${i}" data-n="${g.n}" role="switch" aria-checked="${!off}" title="${off ? 'Include these changes' : 'Leave these out'}"><i></i></button>` : ''}</div>
        ${g.info?.summary ? `<div class="ngS">${esc(g.info.summary)}</div>` : ''}
        ${g.eds.length ? `<div class="ngE">${g.eds.map(rowFor(m)).join('')}</div>` : ''}</div>`;
    }).join('');
  }
  function kerfHTML(m, i) {
    if (m.busy) return `<div class="prop">${stepsHTML(m, true)}<div class="kLive"><i class="kSpin"><b></b><b></b><b></b><b></b></i><span class="kT" data-since="${m.started || Date.now()}">${liveText(m.started)}</span></div></div>`;
    if (m.error) return `<div class="prop err">${stepsHTML(m)}<span class="note warn">${esc(m.error)}</span></div>`;
    const p = m.proposal;
    const badge = { partial: 'Partly possible', not_yet: 'Not possible in Kerf yet', needs_developer: 'For developers' }[p.scope];
    const byNote = p.notes?.length && p.edits.length + p.notes.length > 1;
    const n = chosen(m).length;
    const status = STATUS[m.status] ? `<span class="kStatus ${m.status}">${m.status === 'applied' ? ico('check', 12) : m.status === 'info' ? '<i class="kNo"></i>' : ''}${STATUS[m.status]}</span>` : '';
    const head = m.applying ? `Applying ${n} change${n === 1 ? '' : 's'}…` : m.status === 'applied' ? `Applied ${m.appliedN ?? n} of ${p.edits.length}` : `${p.edits.length} proposed change${p.edits.length === 1 ? '' : 's'}`;
    return `<div class="prop${byNote ? ' byNote' : ''}">${stepsHTML(m)}${badge ? `<span class="badge">${badge}</span>` : ''}<p class="kText">${esc(cleanMsg(p.message))}</p>
      ${byNote ? `<div class="ngs">${notesHTML(m, i)}</div>` : p.edits.length ? `<div class="edits"><div class="edH">${m.applying ? '<i class="spin"></i>' : ''}${head}</div>${p.edits.map(rowFor(m)).join('')}</div>` : ''}
      ${m.status === 'pending' && p.edits.length ? `<div class="acts"><button class="ghostBtn" data-act2="decide" data-i="${i}" data-v="discard">Discard</button><button class="amberBtn" data-act2="decide" data-i="${i}" data-v="apply" ${n ? '' : 'disabled'}>${n < p.edits.length ? `Apply ${n} of ${p.edits.length}` : `Apply ${n === 1 ? 'change' : `${n} changes`}`}</button></div>` : status}</div>`;
  }
  // "Looked at 14 elements · Thought for 9s", which opens to show what Kerf read.
  function stepsHTML(m, live) {
    const n = m.lookedN || m.looked?.length || 0;
    if (!n) return '';
    const list = (m.looked || []).map((x) => `<li>${esc(x)}</li>`).join('') + (n > (m.looked || []).length ? `<li class="more">and ${n - m.looked.length} more</li>` : '');
    const done = live ? '' : m.took ? ` · Thought for ${m.took}s` : '';
    return `<details class="kSteps"><summary>${ico('eye', 12)}<span>Looked at ${n} element${n === 1 ? '' : 's'}${done}</span>${ico('chevR', 10)}</summary><ul>${list}</ul></details>`;
  }
  const liveText = (since) => {
    const t = Math.max(0, Math.floor((Date.now() - (since || Date.now())) / 1000));
    return `${t < 60 ? `${t}s` : `${Math.floor(t / 60)}m ${t % 60}s`} · ${t < 2 ? 'Reading the screen' : 'Thinking'}`;
  };
  // Tick the live timers without re-drawing the conversation.
  setInterval(() => document.querySelectorAll('[data-since]').forEach((el) => { el.textContent = liveText(+el.dataset.since); }), 1000);
  const replyForm = (where) => composer('replyIn', { form: 'reply', where, placeholder: 'Reply to Kerf…' });
  function renderAsk() {
    const a = $('ask');
    a.hidden = !(S.askOpen && S.mode === 'preview');
    if (a.hidden) return;
    const m = S.card && S.card.where === 'ask' ? S.card : null;
    if (m) {
      a.innerHTML = `<div class="card"><div class="cardTop"><span class="note">Kerf</span>${hb('closeCard2', 'x', 'Close', '', 'data-act2="closeCard"')}</div>${kerfHTML(m, S.chat.indexOf(m))}${m.busy ? '' : replyForm('ask')}</div>`;
      if (!m.busy) setTimeout(() => { $('replyIn')?.focus(); syncKC('replyIn'); }, 0);
    } else {
      a.innerHTML = `${composer('askIn', { form: 'ask', big: true, lead: `<span class="spark">${ico('spark', 16)}</span>`, placeholder: 'Ask Kerf to change something on this screen' })}
        <div class="askHints">${['Make this page feel more premium', 'Make the text easier to read', 'Tighten the spacing'].map((s) => `<button data-act2="askHint" data-v="${s}">${s}</button>`).join('')}</div>`;
      setTimeout(() => { $('askIn')?.focus(); syncKC('askIn'); }, 0);
    }
  }
  function chatHTML() {
    const ctx = S.sel ? esc(dName(S.sel.el)) : 'Whole screen';
    const msgs = S.chat.map((m, i) => (m.role === 'user' ? `<div class="uMsg"><span class="uCtx">${esc(m.ctx)}</span>${m.atts?.length ? `<div class="uAtt">${m.atts.map((a) => `<img src="${a.thumb}" alt="${esc(a.name)}" title="${esc(a.name)}">`).join('')}</div>` : ''}<div class="bub">${esc(m.shown || m.text)}</div></div>` : `<div class="kMsg">${kerfHTML(m, i)}</div>`)).join('');
    return `<div class="chatScroll" id="chatScroll">${msgs || `<div class="chatEmpty"><span class="ceMark">${ico('spark', 20)}</span><b>What should change?</b><span>Select something, or ask about the whole screen. Kerf proposes the edit first, and you approve it.</span><div class="ceHints">${['Make this feel more premium', 'Improve the contrast', 'Tighten the spacing'].map((t) => `<button data-act2="chatHint" data-v="${t}">${t}</button>`).join('')}</div></div>`}</div>
      <div class="comp">${composer('chatIn', { form: 'chat', ctx, placeholder: 'Describe a change, or follow up…' })}</div>`;
  }
  function sendChat() {
    take('chatIn', (v, atts) => runAI(v, S.sel ? selectionTargets() : visibleTargets(), 'chat', null, false, atts));
  }

  /* composer: one message box for Ask, replies, chat and notes, with images and dictation */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  S.att = {}; S.drafts = {};
  const KC = {};
  let mic = null;
  function composer(id, o) {
    KC[id] = o;
    const atts = S.att[id] || [];
    const rec = mic?.id === id, has = (S.drafts[id] || '').trim() || atts.length;
    return `<form class="kc${o.big ? ' big' : ''}" data-form="${o.form}" data-where="${o.where || ''}" data-kc="${id}">
      ${atts.length ? `<div class="kcAtt">${atts.map((a, i) => `<span class="kcThumb" title="${esc(a.name)}"><img src="${a.thumb}" alt="${esc(a.name)}"><button type="button" data-act2="attX" data-id="${id}" data-i="${i}" aria-label="Remove ${esc(a.name)}">${ico('x', 10)}</button></span>`).join('')}</div>` : ''}
      <div class="kcRow">${o.lead || ''}<textarea id="${id}" rows="1" placeholder="${esc(o.placeholder)}" aria-label="${esc(o.placeholder)}">${esc(S.drafts[id] || '')}</textarea></div>
      <div class="kcBar">
        <button type="button" class="kcB" data-act2="attach" data-id="${id}" title="Attach images · or paste / drop them here" aria-label="Attach images">${ico('clip', 15)}</button>
        ${o.ctx ? `<span class="kcCtx" title="What Kerf will look at">${ico(S.sel ? 'frame' : 'desktop', 12)}${o.ctx}</span>` : ''}
        <span class="sp"></span>
        ${SR ? `<button type="button" class="kcB mic${rec ? ' rec' : ''}" data-act2="mic" data-id="${id}" title="${rec ? 'Stop dictation' : 'Dictate, in any language'}" aria-label="${rec ? 'Stop dictation' : 'Dictate'}">${ico('mic', 15)}</button>` : ''}
        ${o.send ? `<button class="lightBtn sm"${has ? '' : ' disabled'}>${o.send}</button>` : `<button class="sendB"${has ? '' : ' disabled'} aria-label="Send">${ico('up', 14)}</button>`}
      </div></form>`;
  }
  const grow = (t) => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 168) + 'px'; };
  function syncKC(id) {
    const t = $(id);
    if (!t) return;
    grow(t);
    const has = !!(t.value.trim() || (S.att[id] || []).length);
    t.form.querySelector('.sendB,.lightBtn')?.toggleAttribute('disabled', !has);
  }
  function reKC(id, focus = true) {
    const form = document.querySelector(`[data-kc="${id}"]`);
    if (!form || !KC[id]) return;
    form.outerHTML = composer(id, KC[id]);
    syncKC(id);
    const t = $(id);
    if (focus && t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  }
  // Read a composer, clear it, and hand its text and images on.
  function take(id, fn) {
    if (S.card?.busy) return;
    const t = $(id), v = (t?.value || '').trim(), atts = S.att[id] || [];
    if (!v && !atts.length) return;
    if (mic?.id === id) stopMic();
    S.drafts[id] = ''; S.att[id] = [];
    if (t) { t.value = ''; reKC(id, false); }
    fn(v, atts);
  }
  const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  function shrink(img, max, q) {
    const w = img.naturalWidth || max, h = img.naturalHeight || max, k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  }
  const b64 = (file) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(file); });
  async function addFiles(id, files) {
    const list = [...files].filter((x) => /^image\/(png|jpeg|gif|webp|svg\+xml|avif)$/.test(x.type));
    if (!list.length) { toast('Kerf can read images: PNG, JPG, GIF, WebP or SVG.', '', true); return; }
    const cur = (S.att[id] ||= []);
    for (const file of list) {
      if (cur.length >= 4) { toast('Up to 4 images per message.', '', true); break; }
      if (file.size > 10 * 1024 * 1024) { toast(`${file.name} is over 10 MB.`, '', true); continue; }
      const url = URL.createObjectURL(file);
      try {
        const img = await loadImg(url);
        const ext = { 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' }[file.type] || file.type.split('/')[1];
        const name = file.name && file.name !== 'image.png' ? file.name : `pasted-image.${ext}`;
        // Claude sees a resized copy; the original goes into the project only if Kerf places it in the design.
        cur.push({ name, type: 'image/jpeg', data: shrink(img, 1568, 0.85).split(',')[1], thumb: shrink(img, 160, 0.8), orig: await b64(file) });
      } catch { toast(`Couldn’t read ${file.name}.`, '', true); } finally { URL.revokeObjectURL(url); }
    }
    reKC(id);
  }
  function stopMic() { if (!mic) return; const r = mic.r; mic = null; try { r.stop(); } catch {} markMic(); }
  const markMic = () => document.querySelectorAll('[data-act2="mic"]').forEach((b) => { const on = mic?.id === b.dataset.id; b.classList.toggle('rec', on); b.title = on ? 'Stop dictation' : 'Dictate, in any language'; });
  function toggleMic(id) {
    const same = mic?.id === id;
    stopMic();
    if (same) return;
    const r = new SR();
    r.lang = navigator.language || 'en-US';
    r.continuous = true;
    r.interimResults = true;
    const t = $(id), base = t && t.value.trim() ? t.value.replace(/\s*$/, ' ') : '';
    mic = { id, r };
    r.onresult = (e) => {
      let said = '';
      for (const x of e.results) said += x[0].transcript;
      const el = $(id);
      if (el) { el.value = base + said.trimStart(); S.drafts[id] = el.value; syncKC(id); }
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('The microphone is blocked. Allow it for this site in your browser, then try again.', '', true);
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Dictation stopped', e.error, true);
    };
    r.onend = () => { if (mic?.r === r) { mic = null; markMic(); } };
    try { r.start(); } catch { mic = null; }
    markMic();
    t?.focus();
  }
  document.addEventListener('input', (e) => { const t = e.target; if (t.closest?.('.kc') && t.tagName === 'TEXTAREA') { S.drafts[t.id] = t.value; syncKC(t.id); } });
  document.addEventListener('paste', (e) => {
    const t = e.target.closest?.('.kc');
    const files = [...(e.clipboardData?.files || [])];
    if (!t || !files.length) return;
    e.preventDefault();
    addFiles(t.dataset.kc, files);
  });
  document.addEventListener('dragover', (e) => { const t = e.target.closest?.('.kc'); if (t && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); t.classList.add('drop'); } });
  document.addEventListener('dragleave', (e) => { const t = e.target.closest?.('.kc'); if (t && !t.contains(e.relatedTarget)) t.classList.remove('drop'); });
  document.addEventListener('drop', (e) => {
    const t = e.target.closest?.('.kc');
    if (!t || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    t.classList.remove('drop');
    addFiles(t.dataset.kc, e.dataTransfer.files);
  });

  /* annotations */
  function shapeSVG(n, i, draft, hl) {
    const st = `stroke="${hl ? '#E9B547' : '#2B66D9'}" stroke-width="${hl ? 3 : 2}" fill="${draft ? 'none' : 'rgba(43,102,217,.06)'}"`;
    let s = '';
    if (n.shape === 'box') s = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" ${st}/>`;
    else if (n.shape === 'circle') s = `<ellipse cx="${n.x + n.w / 2}" cy="${n.y + n.h / 2}" rx="${n.w / 2}" ry="${n.h / 2}" ${st}/>`;
    else if (n.shape === 'arrow') { const a = Math.atan2(n.y2 - n.y, n.x2 - n.x), L = 12; s = `<path d="M${n.x} ${n.y}L${n.x2} ${n.y2}M${n.x2} ${n.y2}L${n.x2 - L * Math.cos(a - 0.5)} ${n.y2 - L * Math.sin(a - 0.5)}M${n.x2} ${n.y2}L${n.x2 - L * Math.cos(a + 0.5)} ${n.y2 - L * Math.sin(a + 0.5)}" stroke="#2B66D9" stroke-width="2.5" fill="none" stroke-linecap="round"/>`; }
    const [bx, by] = n.shape === 'pin' || n.shape === 'arrow' ? [n.x, n.y] : [n.x + n.w, n.y];
    if (i != null) s += `<g transform="translate(${bx} ${by})"><path d="M0 0h12a12 12 0 0 1 0 24h-0a12 12 0 0 1-12-12z" transform="translate(-4 -20)" fill="#2B66D9"/><text x="8" y="-3" fill="#fff" font-size="11" font-weight="600" font-family="Geist,system-ui,sans-serif" text-anchor="middle">${i + 1}</text></g>`;
    else if (n.shape === 'pin') s += `<circle cx="${n.x}" cy="${n.y}" r="6" fill="#2B66D9"/>`;
    return s;
  }
  const drawMarks = () => { $('marksG').innerHTML = S.notes.map((n, i) => shapeSVG(n, i, false, S.hlNote === i + 1)).join('') + (S.noteDraft ? shapeSVG(S.noteDraft, null, true) : ''); };
  // Hovering a note's answer lights up its mark and the elements it changes.
  document.addEventListener('mouseover', (e) => {
    const row = e.target.closest?.('.ntRow');
    if (row || e.target.closest?.('#notesChip')) { const n = row ? +row.dataset.note : null; if (n !== S.hlNote) { S.hlNote = n; drawMarks(); } return; }
    const g = e.target.closest?.('.ng'), n = g ? +g.dataset.ng : null;
    if (n === (S.hlNote ?? null)) return;
    S.hlNote = n;
    const m = g ? S.chat[+g.dataset.i] : S.card;
    if (m?.proposal && m.status === 'pending') S.amber = (n != null ? m.proposal.edits.filter((x) => (n ? x.note === n : !x.note)) : chosen(m)).map((x) => x.loc);
    drawMarks();
  });
  function renderMarks() {
    drawMarks();
    $('annoCap').hidden = S.tool !== 'annotate';
    const busy = S.card?.busy && S.card.where === 'notes';
    const chip = $('notesChip');
    chip.hidden = !S.notes.length || !!S.noteDraft || !!(S.card && S.card.where === 'notes' && !S.card.busy);
    // A tray above the toolbar: every note with its number and text, then one clear action.
    if (!chip.hidden) {
      const n = S.notes.length;
      chip.innerHTML = `<div class="ntHead"><span class="ntTitle">${ico('pen', 13)}${n} note${n === 1 ? '' : 's'} for Kerf</span><button class="ghostBtn sm" data-act2="notesClear" title="Remove all notes">Clear all</button></div>
        <div class="ntList">${S.notes.map((x, i) => `<div class="ntRow" data-note="${i + 1}"><i class="nNum">${i + 1}</i><span class="ntText">${esc(x.text)}${x.atts?.length ? ` <em>· ${x.atts.length} image${x.atts.length === 1 ? '' : 's'}</em>` : ''}</span><button class="ntDel" data-act2="noteDel" data-i="${i}" title="Remove this note" aria-label="Remove note ${i + 1}">${ico('x', 12)}</button></div>`).join('')}</div>
        <button class="primary ntGo" data-act2="notesApply" ${busy ? 'disabled' : ''}>${busy ? '<i class="spin"></i>Kerf is reading your notes…' : `${ico('spark', 14)}Ask Kerf to fix ${n === 1 ? 'this' : `all ${n}`}`}</button>`;
    }
    const pop = $('notePop');
    pop.hidden = !S.noteDraft;
    if (S.noteDraft && W) {
      const n = S.noteDraft, ow = $('ov').clientWidth, oh = $('ov').clientHeight;
      const ax = (n.shape === 'arrow' ? n.x2 : n.x + (n.w || 0)) - W.scrollX + 12, ay = (n.shape === 'arrow' ? n.y2 : n.y) - W.scrollY;
      pop.style.transform = `translate(${Math.min(ow - 332 / S.z, Math.max(12, ax))}px,${Math.min(oh - 180 / S.z, Math.max(12, ay))}px) scale(${1 / S.z})`;
      if (!pop.dataset.open) {
        pop.innerHTML = `<div class="secH"><span>Note ${S.notes.length + 1}</span>${hb('noteDiscard2', 'x', 'Discard', '', 'data-act2="noteDiscard"')}</div>${composer('noteIn', { form: 'note', send: 'Add note', placeholder: 'What should change here?' })}<span class="note">Kerf reads the code under this mark.</span>`;
        pop.dataset.open = '1';
        setTimeout(() => { $('noteIn')?.focus(); syncKC('noteIn'); }, 0);
      }
    } else delete pop.dataset.open;
    const res = $('noteRes');
    const m = S.card && S.card.where === 'notes' && !S.card.busy ? S.card : null;
    res.hidden = !m;
    if (m) res.innerHTML = `<div class="card"><div class="cardTop"><span class="note">Kerf · notes</span>${hb('closeCard2', 'x', 'Close', '', 'data-act2="closeCard"')}</div>${kerfHTML(m, S.chat.indexOf(m))}${replyForm('notes')}</div>`;
  }
  function renderAI() {
    renderAsk();
    renderMarks();
    if (S.mode === 'edit' && S.tab === 'chat') renderPanel();
  }
  function applyNotes() {
    if (!S.notes.length) return;
    const targets = uniq(S.notes.flatMap((n, i) => noteTargets(n, i)));
    const request = S.notes.map((n, i) => `Note ${i + 1}: ${n.text}`).join('\n') + '\nEach element is tagged with the note it sits under.';
    const atts = [], tagged = [];
    S.notes.forEach((n, i) => (n.atts || []).forEach((a) => { if (atts.length < 4) { atts.push(a); tagged.push(`Attachment ${atts.length} belongs to note ${i + 1}.`); } }));
    runAI(request + (tagged.length ? '\n' + tagged.join(' ') : ''), targets, 'notes', S.notes.map((n, i) => `${i + 1}. ${n.text}`).join('\n'), false, atts);
  }
  let draw = null;
  const ovPoint = (e) => { const r = $('ov').getBoundingClientRect(); return { x: (e.clientX - r.left) / S.z + W.scrollX, y: (e.clientY - r.top) / S.z + W.scrollY }; };
  $('annoCap').addEventListener('pointerdown', (e) => {
    if (S.tool !== 'annotate' || !W) return;
    e.preventDefault();
    $('annoCap').setPointerCapture(e.pointerId);
    S.noteDraft = null;
    renderMarks();
    draw = ovPoint(e);
  });
  $('annoCap').addEventListener('pointermove', (e) => {
    if (!draw) return;
    const { x: x2, y: y2 } = ovPoint(e);
    S.noteDraft = S.shape === 'pin' ? { shape: 'pin', x: x2, y: y2 } : S.shape === 'arrow' ? { shape: 'arrow', x: draw.x, y: draw.y, x2, y2 } : { shape: S.shape, x: Math.min(draw.x, x2), y: Math.min(draw.y, y2), w: Math.abs(x2 - draw.x), h: Math.abs(y2 - draw.y) };
    renderMarks();
  });
  $('annoCap').addEventListener('pointerup', () => {
    if (!draw) return;
    const d = S.noteDraft;
    if (!d || (d.shape !== 'pin' && d.shape !== 'arrow' && d.w < 8 && d.h < 8) || (d.shape === 'arrow' && Math.hypot(d.x2 - d.x, d.y2 - d.y) < 8)) S.noteDraft = { shape: 'pin', x: draw.x, y: draw.y };
    draw = null;
    renderMarks();
  });
  // Scrolling the page while annotating keeps the marks in place.
  $('annoCap').addEventListener('wheel', (e) => { if (W) W.scrollBy(e.deltaX, e.deltaY); }, { passive: true });
  function addNote() {
    if (!S.noteDraft) return;
    take('noteIn', (v, atts) => {
      S.notes.push({ ...S.noteDraft, text: v || 'See the attached image.', atts });
      S.noteDraft = null;
      renderMarks();
    });
  }
  function setTool(t) {
    S.tool = t;
    S.noteDraft = null;
    S.hintSeen = true;
    if (t === 'annotate') { S.hover = null; S.askOpen = false; }
    renderBar(); renderMarks(); renderAsk();
  }
  // AI buttons use data-act2 so they never collide with the editor's own actions.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act2]');
    if (a) {
      const act = a.dataset.act2, v = a.dataset.v;
      if (act === 'askHint') runAI(v, visibleTargets(), 'ask');
      else if (act === 'chatHint') runAI(v, S.sel ? selectionTargets() : visibleTargets(), 'chat');
      else if (act === 'decide') decide(S.chat[+a.dataset.i], v);
      else if (act === 'closeCard') { if (S.card?.status === 'pending') S.card.status = 'discarded'; S.card = null; S.amber = []; renderAI(); }
      else if (act === 'noteSkip') {
        const m = S.chat[+a.dataset.i], n = +a.dataset.n;
        if (!m || m.status !== 'pending') return;
        m.skip = (m.skip || []).includes(n) ? m.skip.filter((x) => x !== n) : [...(m.skip || []), n];
        S.amber = chosen(m).map((e) => e.loc);
        renderAI();
      }
      else if (act === 'noteAdd') addNote();
      else if (act === 'attach') { const id = a.dataset.id; pickImages().then((fs) => fs.length && addFiles(id, fs)); }
      else if (act === 'attX') { (S.att[a.dataset.id] || []).splice(+a.dataset.i, 1); reKC(a.dataset.id); }
      else if (act === 'mic') toggleMic(a.dataset.id);
      else if (act === 'noteDiscard') { S.noteDraft = null; renderMarks(); }
      else if (act === 'noteDel') { S.notes.splice(+a.dataset.i, 1); S.hlNote = null; renderMarks(); }
      else if (act === 'notesClear') { S.notes = []; if (S.card?.where === 'notes') S.card = null; S.amber = []; renderMarks(); }
      else if (act === 'notesApply') applyNotes();
      return;
    }
    const t = e.target.closest('[data-act="tool"],[data-act="shape"]');
    if (t) { if (t.dataset.act === 'tool') setTool(S.tool === t.dataset.v ? 'select' : t.dataset.v); else { S.shape = t.dataset.v; renderBar(); } }
  });

  /* ---------- structure: delete, duplicate, move, swap, insert, images ---------- */
  const kebab = (n) => n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Za-z])([0-9])/g, '$1-$2').toLowerCase();
  const iconSrc = (i) => i.lib === 'lucide-react' ? `https://unpkg.com/lucide-static@0.468.0/icons/${kebab(i.name)}.svg` : `https://unpkg.com/@phosphor-icons/core@2.1.1/assets/regular/${kebab(i.name)}.svg`;
  // Structural edits go to where an element is used (the instance), unless it's a plain element.
  const structLoc = () => (S.sel ? (S.sel.use && (S.scope === 'here' || !S.sel.def || nameOf(S.sel.el) !== S.sel.el.tagName.toLowerCase()) ? S.sel.use : S.sel.def || S.sel.use) : null);
  // Wrap the selection (and Shift-selected neighbors) in a new auto-layout frame.
  async function groupSelected() {
    const others = S.multi.map((m) => locOf(m));
    const dir = S.multi.length && S.multi.every((m) => Math.abs(m.el.getBoundingClientRect().top - S.sel.el.getBoundingClientRect().top) < 8) ? 'flex-row items-center' : 'flex-col';
    const ok = await structure({ type: 'group', others, className: `flex ${dir} gap-2` });
    if (ok) S.multi = [];
  }
  async function deleteSelected() {
    if (!S.multi.length) return structure({ type: 'delete' });
    const edits = [{ loc: structLoc(), structure: { type: 'delete' } }, ...S.multi.map((m) => ({ loc: locOf(m), structure: { type: 'delete' } }))];
    const r = await api('/ai/apply', { edits }).catch((e) => ({ error: e.message }));
    if (r.error) return toast(r.error, '', true);
    S.count = r.n; S.multi = []; S.sel = null;
    const ok = r.results.filter((x) => x.ok && x.changed).length, bad = r.results.find((x) => !x.ok);
    toast(`Deleted ${ok} element${ok === 1 ? '' : 's'}`, bad ? bad.error : '', false, true);
    afterEdit(); renderPanel();
  }
  async function structure(op, { keepSel } = {}) {
    const loc = structLoc();
    if (!loc) { toast('Select an element first.', '', true); return false; }
    const before = D?.querySelector('vite-error-overlay');
    try {
      const r = await api('/structure', { loc, op, name: S.sel ? dName(S.sel.el) : null });
      if (!r.changed) return false;
      S.count = r.n;
      toast(`${S.sel ? dName(S.sel.el) + ' · ' : ''}${r.summary.action}`, '', false, true, fileName(r.file));
      if (!keepSel) { S.sel = null; renderPanel(); }
      afterEdit();
      guard(before);
      return true;
    } catch (e) { toast(e.message, '', true); return false; }
  }
  // If a change makes the page fail to build, undo it straight away.
  function guard(hadError) {
    if (hadError) return;
    setTimeout(async () => {
      if (!D?.querySelector('vite-error-overlay')) return;
      await api('/undo', {}).catch(() => {});
      toast('That change broke the page, so Kerf undid it.', '', true);
      afterEdit();
      setTimeout(() => D?.querySelector('vite-error-overlay')?.remove(), 1500);
    }, 1500);
  }
  function actionsHTML() {
    const isComp = S.sel && /^[A-Z]/.test(nameOf(S.sel.el)) || S.sel?.el.tagName.toLowerCase() === 'svg';
    return `<div class="acts2">
      <button class="ib" data-act="sMove" data-v="up" title="Move up · ⌥↑" aria-label="Move up">${ico('up')}</button>
      <button class="ib" data-act="sMove" data-v="down" title="Move down · ⌥↓" aria-label="Move down"><span style="display:inline-block;transform:rotate(180deg)">${ico('up')}</span></button>
      <button class="ib" data-act="sDup" title="Duplicate · ⌘D" aria-label="Duplicate">${ico('dup')}</button>
      <button class="ib" data-act="sGroup" title="Group into a frame · ⌘⌥G" aria-label="Group">${ico('frame')}</button>
      ${S.sel && /^(div|section|span)$/.test(S.sel.el.tagName.toLowerCase()) && !S.sel.el.getAttribute('data-kerf-n') ? `<button class="ib" data-act="sUngroup" title="Ungroup · ⇧⌘G" aria-label="Ungroup">${ico('corners')}</button>` : ''}
      ${isComp ? `<button class="ib" data-act="sSwap" title="Swap for another icon or component" aria-label="Swap">${ico('swap')}</button>` : ''}
      <button class="ib" data-act="insertMenu" title="Add an element here · I" aria-label="Add">${ico('plus')}</button>
      <button class="ib danger" data-act="sDel" title="Delete · ⌫" aria-label="Delete">${ico('trash')}</button>
    </div>`;
  }
  function imageSection(el) {
    if (!el || el.tagName.toLowerCase() !== 'img') return '';
    const src = el.getAttribute('src') || '', alt = el.getAttribute('alt') || '';
    const fit = cs(el).objectFit;
    return sec('Image', `<div class="thumb"><img src="${esc(el.currentSrc || src)}" alt=""></div>
      <div class="r2"><button class="outline" data-act="imgUpload">Replace…</button><button class="outline" data-act="imgLink">Use a link</button></div>
      <label class="inp" title="Alt text"><span class="u">Alt</span><input type="text" data-alt="1" value="${esc(alt)}" placeholder="Describe the image"></label>
      <div class="ibs txt">${['cover', 'contain', 'fill'].map((v) => `<button class="ib${fit === v ? ' on' : ''}" data-act="set" data-p="fit" data-v="${v}" title="${v === 'cover' ? 'Fill the box, crop the edges' : v === 'contain' ? 'Fit inside the box' : 'Stretch to the box'}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>`);
  }
  function pickImages() {
    return new Promise((resolve) => {
      const i = document.createElement('input');
      i.type = 'file';
      i.multiple = true;
      i.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif';
      i.onchange = () => resolve([...i.files]);
      i.click();
    });
  }
  function pickFile() {
    return new Promise((resolve) => {
      const i = document.createElement('input');
      i.type = 'file';
      i.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif';
      i.onchange = () => resolve(i.files[0] || null);
      i.click();
    });
  }
  async function upload(file) {
    if (!file) return null;
    if (file.size > 10 * 1024 * 1024) { toast('Images must be under 10 MB.', '', true); return null; }
    const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(file); });
    try { return (await api('/upload', { name: file.name, data })).src; } catch (e) { toast(e.message, '', true); return null; }
  }

  /* insert menu */
  function tokenClass(pre, wanted, fallback) {
    const t = tokens().map(([n]) => n);
    const hit = wanted.find((w) => t.includes(w));
    return hit ? `${pre}-${hit}` : fallback;
  }
  async function templates() {
    if (!S.components) S.components = await api('/components').catch(() => []);
    const has = (n) => S.components.some((c) => c.name === n);
    const ink = tokenClass('text', ['content', 'foreground', 'text'], 'text-gray-900');
    const muted = tokenClass('text', ['muted', 'muted-foreground', 'faint'], 'text-gray-500');
    return [
      { k: 'text', label: 'Text', icon: 'text', jsx: `<p className="text-sm ${muted}">New text</p>` },
      { k: 'heading', label: 'Heading', icon: 'heading', jsx: `<h2 className="text-2xl font-semibold ${ink}">New heading</h2>` },
      { k: 'button', label: 'Button', yours: has('Button'), icon: 'button', jsx: has('Button') ? '<Button>Button</Button>' : `<button className="rounded-md px-4 py-2 text-sm font-medium ${tokenClass('bg', ['primary'], 'bg-gray-900')} ${tokenClass('text', ['primary-fg', 'primary-foreground'], 'text-white')}">Button</button>` },
      { k: 'image', label: 'Image…', icon: 'image', image: true },
      { k: 'icon', label: 'Icon…', icon: 'spark', iconPick: true },
      { k: 'frame', label: 'Frame', icon: 'frame', jsx: `<div className="flex flex-col gap-3 rounded-lg ${tokenClass('border', ['border'], 'border-gray-200')} border p-4"><p className="text-sm ${muted}">New frame</p></div>` },
    ];
  }
  // Boxes that hold other elements take new ones inside; text, images and buttons get them after.
  const defaultPos = () => (S.sel && S.sel.el.children.length && !['p', 'span', 'button', 'a', 'label', 'svg'].includes(S.sel.el.tagName.toLowerCase()) ? 'inside' : 'after');
  async function openInsert() {
    if (!S.sel) { toast('Select where the new element should go, then add it.', '', true); return; }
    S._tpls = await templates();
    const pos = S.insertPos || 'after';
    const m = $('modal');
    m.hidden = false;
    m.innerHTML = `<section class="dialog ins" role="dialog" aria-modal="true" aria-labelledby="insT">
      <div class="insHead"><div class="insTitle"><h2 id="insT">Add</h2><span class="note">${pos === 'inside' ? 'inside' : pos} <b>${esc(dName(S.sel.el))}</b></span></div>
        <div class="seg insPos">${[['before', 'Before'], ['after', 'After'], ['inside', 'Inside']].map(([p, n]) => `<button data-act="insPos" data-v="${p}" class="${pos === p ? 'on' : ''}">${n}</button>`).join('')}</div>
        <button class="ib" data-act="closeModal" aria-label="Close">${ico('x')}</button></div>
      <label class="insSearch">${ico('search', 14)}<input id="compQ" placeholder="Search elements and components" autocomplete="off" spellcheck="false"></label>
      <div class="insBody" id="insBody">${insBody('')}</div></section>`;
    setTimeout(() => $('compQ')?.focus(), 0);
  }
  // Basics as small tiles, then the project's components grouped by folder, with names in plain words.
  function insBody(q) {
    const ql = q.trim().toLowerCase();
    const hit = (t) => !ql || t.toLowerCase().includes(ql);
    const tiles = (S._tpls || []).map((t, i) => ({ t, i })).filter(({ t }) => hit(t.label));
    const groups = new Map();
    for (const c of (S.components || []).filter((c) => c.name !== 'Button')) {
      const label = camelWords(c.name);
      if (!hit(label) && !hit(c.name)) continue;
      const dir = (c.file.split('/').slice(-2, -1)[0] || 'components').replace(/[-_]/g, ' ');
      const g = dir.length <= 3 ? dir.toUpperCase() : dir[0].toUpperCase() + dir.slice(1);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ c, label });
    }
    const sorted = [...groups.entries()].sort((a, b) => (a[0] === 'UI' ? -1 : b[0] === 'UI' ? 1 : a[0].localeCompare(b[0])));
    const out = [];
    if (tiles.length) out.push(`<div class="insSec"><div class="insT">Basics</div><div class="insTiles">${tiles.map(({ t, i }) => `<button class="itile" data-act="insTpl" data-v="${i}"><span class="ii">${ico(t.icon, 16)}</span><span>${esc(t.label.replace(/…$/, ''))}</span>${t.yours ? '<i class="yours">Yours</i>' : ''}</button>`).join('')}</div></div>`);
    for (const [g, items] of sorted) out.push(`<div class="insSec"><div class="insT">${esc(g)}<span>${items.length}</span></div><div class="insList">${items.sort((a, b) => a.label.localeCompare(b.label)).slice(0, 80).map(({ c, label }) => `<button class="crow" data-act="insComp" data-v="${esc(c.name)}" title="${esc(c.name)} · ${esc(c.file)}">${ico('comp', 13)}<span>${esc(label)}</span></button>`).join('')}</div></div>`);
    return out.join('') || `<div class="insNone">Nothing matches “${esc(q)}”.</div>`;
  }
  const CHILD_TEXT = /^(Button|Badge|Label|CardTitle|CardDescription|Tag|Chip|Link|Heading|Title|Text)$/;
  async function insertJsx(jsx) {
    $('modal').hidden = true;
    await structure({ type: 'insert', position: S.insertPos || 'after', jsx });
  }

  /* icon picker (swap or insert) */
  function openIcons(mode) {
    const m = $('modal');
    m.hidden = false;
    m.innerHTML = `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="icT" style="width:520px">
      <div class="dh"><div style="display:flex;flex-direction:column;gap:4px"><h2 id="icT">${mode === 'swap' ? 'Swap icon' : 'Add an icon'}</h2><span class="note">From your project’s icon library.</span></div><button class="ib" data-act="closeModal" aria-label="Close">${ico('x')}</button></div>
      <div class="db"><label class="inp"><input id="iconQ" placeholder="Search icons, e.g. heart" autocomplete="off" data-mode="${mode}"></label><div class="igrid" id="iconGrid"><span class="note">Type to search…</span></div></div></section>`;
    setTimeout(() => $('iconQ').focus(), 0);
    searchIcons('', mode);
  }
  let iconT;
  function searchIcons(q, mode) {
    clearTimeout(iconT);
    iconT = setTimeout(async () => {
      const only = mode === 'swap' ? (S.sel?.useInfo?.lib || '') : '';
      const list = await api('/icons?q=' + encodeURIComponent(q) + (only ? '&lib=' + encodeURIComponent(only) : '')).catch(() => []);
      const g = $('iconGrid');
      if (!g) return;
      g.innerHTML = list.length ? list.map((i) => `<button class="icell" data-act="pickIcon" data-v="${esc(i.name)}" data-mode="${mode}" title="${esc(i.name)} · ${esc(i.lib)}"><img src="${iconSrc(i)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span>${esc(i.name)}</span></button>`).join('') : '<span class="note">No icons match.</span>';
    }, 120);
  }
  document.addEventListener('input', (e) => {
    if (e.target.id === 'iconQ') searchIcons(e.target.value, e.target.dataset.mode);
    if (e.target.id === 'compQ') $('insBody').innerHTML = insBody(e.target.value);
  });
  document.addEventListener('keydown', (e) => { if (e.target.id === 'compQ' && e.key === 'Enter') { e.preventDefault(); $('insBody')?.querySelector('button')?.click(); } });
  document.addEventListener('change', (e) => {
    if (e.target.dataset.alt) structure({ type: 'image', alt: e.target.value }, { keepSel: true });
  });
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act, v = a.dataset.v;
    if (act === 'sDel') deleteSelected();
    else if (act === 'sDup') structure({ type: 'duplicate' });
    else if (act === 'sGroup') groupSelected();
    else if (act === 'sUngroup') structure({ type: 'ungroup' });
    else if (act === 'sMove') structure({ type: 'move', dir: v });
    else if (act === 'sSwap') {
      if (S.sel.el.tagName.toLowerCase() === 'svg') openIcons('swap');
      else { S.insertPos = 'after'; openSwapComponent(); }
    }
    else if (act === 'insertMenu') { S.insertPos = defaultPos(); openInsert(); }
    else if (act === 'insPos') { S.insertPos = v; openInsert(); }
    else if (act === 'insTpl') {
      const t = S._tpls[+v];
      if (t.iconPick) openIcons('insert');
      else if (t.image) { $('modal').hidden = true; const src = await upload(await pickFile()); if (src) insertJsx(`<img src="${src}" alt="" className="h-auto w-full rounded-lg object-cover" />`); }
      else insertJsx(t.jsx);
    }
    else if (act === 'insComp') insertJsx(CHILD_TEXT.test(v) ? `<${v}>${v}</${v}>` : `<${v} />`);
    else if (act === 'pickIcon') {
      if (a.dataset.mode === 'swap') { $('modal').hidden = true; closeIconPop(); structure({ type: 'swap', to: v }, { keepSel: true }); }
      else insertJsx(`<${v} className="h-5 w-5" />`);
    }
    else if (act === 'swapComp') { $('modal').hidden = true; structure({ type: 'swap', to: v }, { keepSel: true }); }
    else if (act === 'iconPick') openIconPop(a);
    else if (act === 'iconUpload') {
      closeIconPop();
      // Your own icon: an uploaded SVG takes this icon's place at the same size.
      const file = await pickFile();
      if (!file) return;
      if (!/svg|png|webp/i.test(file.type)) { toast('Pick an SVG (or a PNG) for the icon.', '', true); return; }
      const src = await upload(file);
      const cls = ((S.sel?.useInfo || S.sel?.defInfo)?.classes || []).filter((c) => /^(h|w|size|shrink|flex|m[trblxy]?|-?m[trblxy]?)-/.test(c)).join(' ') || 'h-4 w-4';
      if (src) structure({ type: 'replace', jsx: `<img src="${src}" alt="" className="${cls}" />` });
    }
    else if (act === 'imgUpload') { const src = await upload(await pickFile()); if (src) structure({ type: 'image', src }, { keepSel: true }); }
    else if (act === 'imgLink') { const u = prompt('Image link (https://…)'); if (u && /^https?:\/\//.test(u)) structure({ type: 'image', src: u.trim() }, { keepSel: true }); }
  });
  /* the icon panel: a compact row like Figma's instance swap, plain stroke controls, and a picker */
  const libName = (lib) => ({ 'lucide-react': 'Lucide', '@phosphor-icons/react': 'Phosphor', 'phosphor-react': 'Phosphor' })[lib] || lib || '';
  function iconSection(el) {
    const name = el.getAttribute('data-kerf-n') || '', lib = S.sel?.useInfo?.lib || '';
    const real = name && /^[A-Z]/.test(name);
    const props = (S.sel?.useInfo?.props || []).filter((p) => p.editable);
    const prop = (n) => props.find((p) => p.name === n);
    const sw = prop('strokeWidth'), abs = prop('absoluteStrokeWidth'), wt = prop('weight');
    const row = `<button class="icRow btnRow" data-act="iconPick" title="Swap icon" aria-haspopup="dialog">
        <span class="icNow">${real ? `<img src="${iconSrc({ name, lib: lib || 'lucide-react' })}" alt="" onerror="this.style.visibility='hidden'">` : ico('spark', 16)}</span>
        <span class="icMeta"><b>${esc(real ? camelWords(name) : 'Custom icon')}</b><span class="note">${esc(real ? libName(lib) || 'Icon' : 'Drawn in the code')}</span></span>
        <span class="icSwap">Swap${ico('chev', 10)}</span></button>`;
    const ctl = [
      sw ? `<div class="kv"><span>Stroke</span><label class="inp"><input type="text" inputmode="decimal" data-propnum="strokeWidth" value="${sw.value ?? ''}" placeholder="2" aria-label="Stroke width"></label></div>` : '',
      abs ? `<div class="kv"><span title="Keep the lines the same thickness when the icon is resized">Fixed stroke</span><div class="seg"><button data-act="setProp" data-p="absoluteStrokeWidth" data-v="false" class="${abs.value !== true ? 'on' : ''}">Off</button><button data-act="setProp" data-p="absoluteStrokeWidth" data-v="true" class="${abs.value === true ? 'on' : ''}">On</button></div></div>` : '',
      wt ? `<div class="kv"><span>Weight</span><label class="inp"><select data-propsel="weight" aria-label="Icon weight">${wt.value == null ? '<option value="" selected>Default</option>' : ''}${wt.options.map((o) => `<option${o === wt.value ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>${ico('chev', 12)}</label></div>` : '',
    ].join('');
    return sec('Icon', row + ctl);
  }
  // The picker: icons this app already uses, icons like this one, or a search, with names and the current one marked.
  S.iconSug = null;
  const iconCells = (list, cur) => list.map((i) => `<button class="icell${i.name === cur ? ' on' : ''}" data-act="pickIcon" data-v="${esc(i.name)}" data-mode="swap" title="${esc(camelWords(i.name))}"><img src="${iconSrc(i)}" alt="" decoding="async" onerror="this.style.visibility='hidden'"><span>${esc(camelWords(i.name))}</span></button>`).join('');
  function iconPopBody() {
    const name = S.sel?.el.getAttribute('data-kerf-n') || '', q = (S.iconQ || '').trim();
    if (q) return S.iconRes?.q === q ? (S.iconRes.list.length ? `<div class="ipT">Results</div><div class="igrid p">${iconCells(S.iconRes.list.slice(0, 60), name)}</div>` : '<div class="ipNone">No icons match.</div>') : '<div class="ipNone">Searching…</div>';
    if (!S.iconSug) return '<div class="ipNone">Loading…</div>';
    const used = S.iconSug.used.filter((i) => i.name !== name).slice(0, 18), sim = S.iconSug.similar.slice(0, 24);
    return `${sim.length ? `<div class="ipT">Like ${esc(camelWords(name) || 'this one')}</div><div class="igrid p">${iconCells(sim, name)}</div>` : ''}${used.length ? `<div class="ipT">Used in this app</div><div class="igrid p">${iconCells(used, name)}</div>` : ''}` || '<div class="ipNone">Search for an icon.</div>';
  }
  function openIconPop(anchor) {
    let pop = $('iconPop');
    if (!pop) { pop = document.createElement('div'); pop.id = 'iconPop'; pop.className = 'iconPop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Swap icon'); document.body.appendChild(pop); }
    const lib = S.sel?.useInfo?.lib || '', name = S.sel?.el.getAttribute('data-kerf-n') || '';
    S.iconQ = '';
    pop.innerHTML = `<label class="insSearch sm">${ico('search', 12)}<input id="iconQp" placeholder="Search ${esc(libName(lib) || 'icons')}" autocomplete="off" spellcheck="false" aria-label="Search icons"></label><div class="ipBody" id="ipBody">${iconPopBody()}</div><div class="ipFoot"><button class="ghostBtn" data-act="iconUpload">${ico('image', 12)} Use your own SVG…</button></div>`;
    pop.hidden = false;
    const r = anchor.getBoundingClientRect(), h = Math.min(460, innerHeight - 24);
    const below = innerHeight - r.bottom - 12 >= Math.min(h, 360);
    Object.assign(pop.style, { width: Math.max(260, r.width) + 'px', left: Math.max(8, Math.min(innerWidth - Math.max(260, r.width) - 8, r.left)) + 'px', top: (below ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px', maxHeight: h + 'px' });
    setTimeout(() => $('iconQp')?.focus(), 0);
    api('/icons/suggest?name=' + encodeURIComponent(name) + (lib ? '&lib=' + encodeURIComponent(lib) : '')).then((x) => { S.iconSug = x; if (!(S.iconQ || '').trim() && $('ipBody')) $('ipBody').innerHTML = iconPopBody(); }).catch(() => { S.iconSug = { used: [], similar: [] }; });
  }
  const closeIconPop = () => { const p = $('iconPop'); if (p) p.hidden = true; };
  document.addEventListener('pointerdown', (e) => { const p = $('iconPop'); if (p && !p.hidden && !e.target.closest('#iconPop,[data-act="iconPick"]')) closeIconPop(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeIconPop(); });
  let iconPT;
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'iconQp') return;
    S.iconQ = e.target.value;
    const q = e.target.value.trim(), lib = S.sel?.useInfo?.lib || '';
    if (!q) { $('ipBody').innerHTML = iconPopBody(); return; }
    clearTimeout(iconPT);
    iconPT = setTimeout(async () => {
      const list = await api('/icons?q=' + encodeURIComponent(q) + (lib ? '&lib=' + encodeURIComponent(lib) : '')).catch(() => []);
      S.iconRes = { q, list };
      if ((S.iconQ || '').trim() === q && $('ipBody')) $('ipBody').innerHTML = iconPopBody();
    }, 120);
  });
  async function openSwapComponent() {
    if (!S.components) S.components = await api('/components').catch(() => []);
    const m = $('modal');
    m.hidden = false;
    m.innerHTML = `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="swT" style="width:440px">
      <div class="dh"><div style="display:flex;flex-direction:column;gap:4px"><h2 id="swT">Swap ${esc(nameOf(S.sel.el))}</h2><span class="note">Replace it with another of your components. Its properties are kept.</span></div><button class="ib" data-act="closeModal" aria-label="Close">${ico('x')}</button></div>
      <div class="db"><div class="clist">${S.components.map((c) => `<button class="crow" data-act="swapComp" data-v="${esc(c.name)}">${ico('comp', 12)}<span>${esc(c.name)}</span><span class="note mono">${esc(c.file.replace(/^src\//, ''))}</span></button>`).join('')}</div></div></section>`;
  }
  // Keyboard: delete, duplicate, move, insert.
  window.addEventListener('keydown', structKeys, true);
  function structKeys(e) {
    const t = e.target;
    if (S.mode !== 'edit' || !S.sel || S.editing || (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)))) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); deleteSelected(); }
    else if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyG') { e.preventDefault(); e.stopImmediatePropagation(); groupSelected(); }
    else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyG') { e.preventDefault(); e.stopImmediatePropagation(); structure({ type: 'ungroup' }); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); e.stopImmediatePropagation(); structure({ type: 'duplicate' }); }
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); e.stopImmediatePropagation(); structure({ type: 'move', dir: e.key === 'ArrowUp' ? 'up' : 'down' }); }
    else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'i') { e.preventDefault(); e.stopImmediatePropagation(); S.insertPos = defaultPos(); openInsert(); }
  }

  /* drag to reorder on the canvas: drag the selected element over a sibling */
  let drag = null;
  function bindDrag() {
    if (!W) return;
    W.addEventListener('keydown', structKeys, true);
    W.addEventListener('pointerdown', (e) => {
      if (S.mode !== 'edit' || S.tool === 'annotate' || !S.sel || !S.sel.el.contains(e.target) || S.editing) return;
      const el = S.sel.el, parent = el.parentElement;
      if (!parent) return;
      const sibs = [...parent.children].filter((c) => c.matches('[data-kerf],[data-kerf-use]'));
      if (sibs.length < 2) return;
      drag = { el, sibs, x: e.clientX, y: e.clientY, on: false, idx: sibs.indexOf(el) };
    }, true);
    W.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.on = true;
      const flow = cs(drag.el.parentElement);
      const horiz = /row/.test(flow.flexDirection) && /flex/.test(flow.display) || /grid/.test(flow.display);
      let best = 0, bd = 1e9, after = false;
      drag.sibs.forEach((s, k) => {
        const r = s.getBoundingClientRect(), c = horiz ? r.left + r.width / 2 : r.top + r.height / 2;
        const d = Math.abs((horiz ? e.clientX : e.clientY) - c);
        if (d < bd) { bd = d; best = k; after = (horiz ? e.clientX : e.clientY) > c; }
      });
      let to = best + (after ? 1 : 0);
      if (to > drag.idx) to -= 1;
      drag.to = to;
      const r = drag.sibs[best].getBoundingClientRect(), line = $('dropLine');
      line.hidden = false;
      line.style.cssText = horiz ? `left:${(after ? r.right : r.left) - 1}px;top:${r.top}px;width:3px;height:${r.height}px` : `left:${r.left}px;top:${(after ? r.bottom : r.top) - 1}px;width:${r.width}px;height:3px`;
    }, true);
    W.addEventListener('pointerup', () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      $('dropLine').hidden = true;
      if (d.on && d.to != null && d.to !== d.idx) structure({ type: 'move', index: d.to });
    }, true);
  }
  frame.addEventListener('load', bindDrag);
  if (frame.contentDocument?.readyState === 'complete') setTimeout(bindDrag, 0);

  /* ---------- layout: auto layout, size, margin ---------- */
  function layoutVal(el) {
    const c = cs(el);
    const flex = /flex/.test(c.display);
    const dir = flex ? (/column/.test(c.flexDirection) ? 'col' : 'row') : 'none';
    const norm = (v) => ({ 'flex-start': 'start', start: 'start', normal: 'start', left: 'start', 'flex-end': 'end', end: 'end', right: 'end', center: 'center', 'space-between': 'between', stretch: 'stretch', baseline: 'baseline' }[v] || 'start');
    return { dir, items: norm(c.alignItems), justify: norm(c.justifyContent), wrap: c.flexWrap === 'wrap' };
  }
  function sizeMode(axis) {
    const cls = (info()?.classes || []).filter((x) => !x.includes(':') && x.startsWith(axis + '-'));
    if (cls.includes(axis + '-fit')) return 'hug';
    if (cls.includes(axis + '-full') || (axis === 'w' && (info()?.classes || []).includes('flex-1'))) return 'fill';
    if (cls.some((x) => /^[wh]-(\d|\[)/.test(x))) return 'fixed';
    return 'auto';
  }
  // Frames get auto layout; text, icons and images only get what they can use.
  const isMedia = (el) => /^(img|svg|video|picture|canvas)$/i.test(el.tagName);
  const isContainer = (el) => !isMedia(el) && (el.childElementCount > 0 || !isText(el)) && !/^(input|textarea|select|hr)$/i.test(el.tagName);
  function layoutSections(el) {
    const L = layoutVal(el);
    let h = '';
    const shown = (k) => S.reveal?.el === el && S.reveal[k];
    const hasPad = (+val('padX') || 0) > 0 || (+val('padY') || 0) > 0, hasMargin = (+val('mX') || 0) !== 0 || (+val('mY') || 0) !== 0;
    const marginSec = () => sec('Margin', hasMargin || shown('margin') ? `<div class="r2">${nf('mX', 'padH', 'Horizontal margin')}${nf('mY', 'padV', 'Vertical margin')}</div>` : '', hasMargin || shown('margin') ? '' : hb('reveal', 'plus', 'Add margin', 'sm', 'data-v="margin"'));
    const sizeSec = () => sec('Size', `<div class="r2">${modeSel('w')}${modeSel('h')}</div><div class="r2">${fixedField('w')}${fixedField('h')}</div>`);
    const modeSel = (axis) => `<label class="inp"><span class="u">${axis.toUpperCase()}</span><select data-size="${axis}" aria-label="${axis === 'w' ? 'Width' : 'Height'}">${[['auto', 'Auto'], ['hug', 'Hug'], ['fill', 'Fill'], ['fixed', 'Fixed']].map(([v, n]) => `<option value="${v}"${sizeMode(axis) === v ? ' selected' : ''}>${n}</option>`).join('')}</select>${ico('chev', 12)}</label>`;
    const fixedField = (axis) => sizeMode(axis) === 'fixed' ? nf(axis, `<b class="tg">${axis.toUpperCase()}</b>`, axis === 'w' ? 'Width' : 'Height') : `<label class="inp lock"><input disabled value="${Math.round(axis === 'w' ? el.getBoundingClientRect().width : el.getBoundingClientRect().height)}"></label>`;
    if (!isContainer(el)) {
      if (!isMedia(el)) h += sec('Padding', hasPad || shown('pad') ? `<div class="r2">${nf('padX', 'padH', 'Horizontal padding')}${nf('padY', 'padV', 'Vertical padding')}</div>` : '', hasPad || shown('pad') ? '' : hb('reveal', 'plus', 'Add padding', 'sm', 'data-v="pad"'));
      return h + sizeSec() + marginSec();
    }
    // Alignment matrix like Figma's: 3×3, mapped to justify/items by direction.
    const pos = ['start', 'center', 'end'];
    const cell = (r, c) => {
      const main = L.dir === 'col' ? pos[r] : pos[c], cross = L.dir === 'col' ? pos[c] : pos[r];
      const on = L.justify === main && (L.items === cross || (L.items === 'stretch' && cross === 'start'));
      return `<button class="mx${on ? ' on' : ''}" data-act="align9" data-j="${main}" data-i="${cross}" title="Align ${cross}, ${main}" aria-label="Align ${cross} ${main}"><i></i></button>`;
    };
    const auto = L.dir !== 'none';
    h += sec('Auto layout', `<div class="r2"><div class="ibs">${[['none', 'Off'], ['col', '↓'], ['row', '→']].map(([v, n]) => `<button class="ib${L.dir === v ? ' on' : ''}" data-act="set" data-p="layout" data-v="${v}" title="${v === 'none' ? 'No auto layout' : v === 'col' ? 'Vertical' : 'Horizontal'}">${n}</button>`).join('')}</div>${auto ? `<div class="ibs txt"><button class="ib${L.wrap ? ' on' : ''}" data-act="set" data-p="wrap" data-v="${L.wrap ? 'nowrap' : 'wrap'}" title="Wrap onto new lines">Wrap</button></div>` : '<span></span>'}</div>
      ${auto ? `<div class="r2c" style="grid-template-columns:76px minmax(0,1fr)"><div class="m9">${[0, 1, 2].map((r) => [0, 1, 2].map((c) => cell(r, c)).join('')).join('')}</div>
        <div style="display:flex;flex-direction:column;gap:8px">${nf('gap', 'gap', 'Gap')}<div class="ibs txt"><button class="ib${L.justify === 'between' ? ' on' : ''}" data-act="set" data-p="justify" data-v="${L.justify === 'between' ? 'start' : 'between'}" title="Space items out evenly">Space between</button></div></div></div>` : ''}
      <div class="r2">${nf('padX', 'padH', 'Horizontal padding')}${nf('padY', 'padV', 'Vertical padding')}</div>`);
    h += sizeSec() + marginSec();
    return h;
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act="align9"]');
    if (!a || !S.sel) return;
    const L = layoutVal(S.sel.el);
    commit({ ops: [...(L.dir === 'none' ? [{ prop: 'layout', value: 'col' }] : []), { prop: 'justify', value: a.dataset.j }, { prop: 'alignItems', value: a.dataset.i }] });
  });
  document.addEventListener('change', (e) => {
    const axis = e.target.dataset?.size;
    if (!axis || !S.sel) return;
    const v = e.target.value;
    const r = S.sel.el.getBoundingClientRect();
    commit({ ops: [{ prop: axis, value: v === 'fixed' ? Math.round(axis === 'w' ? r.width : r.height) : v === 'auto' ? null : v }] });
  });

  /* ---------- on-canvas handles: padding and size ---------- */
  function placeHandles() {
    const box = $('handles');
    const el = S.sel?.el;
    const show = S.mode === 'edit' && S.tool === 'select' && el && el.isConnected && !S.editing && !S.multi.length;
    box.hidden = !show;
    if (!show) return;
    const r = el.getBoundingClientRect(), c = cs(el);
    const pl = parseFloat(c.paddingLeft), pt = parseFloat(c.paddingTop);
    const set = (id, x, y) => { const h = $(id); h.style.transform = `translate(${x}px,${y}px) scale(${1 / S.z})`; };
    set('hPadL', r.left + Math.max(2, pl / 2) - 4, r.top + r.height / 2 - 8);
    set('hPadR', r.right - Math.max(2, pl / 2) - 4, r.top + r.height / 2 - 8);
    set('hPadT', r.left + r.width / 2 - 8, r.top + Math.max(2, pt / 2) - 4);
    set('hPadB', r.left + r.width / 2 - 8, r.bottom - Math.max(2, pt / 2) - 4);
    set('hW', r.right - 4, r.top + r.height / 2 - 4);
    set('hH', r.left + r.width / 2 - 4, r.bottom - 4);
    set('hWH', r.right - 4, r.bottom - 4);
    const pad = $('padShade');
    if (S.handleDrag?.kind === 'pad') {
      pad.hidden = false;
      pad.style.cssText = `transform:translate(${r.left}px,${r.top}px);width:${r.width}px;height:${r.height}px;border-style:solid;border-color:rgba(240,106,95,.28);border-width:${c.paddingTop} ${c.paddingRight} ${c.paddingBottom} ${c.paddingLeft}`;
    } else pad.hidden = true;
  }
  document.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-handle]');
    if (!h || !S.sel) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    const k = h.dataset.handle, el = S.sel.el, r = el.getBoundingClientRect(), c = cs(el);
    S.handleDrag = { k, kind: k.startsWith('pad') ? 'pad' : 'size', x: e.clientX, y: e.clientY, padX: parseFloat(c.paddingLeft), padY: parseFloat(c.paddingTop), w: r.width, h: r.height, val: null };
  });
  document.addEventListener('pointermove', (e) => {
    const d = S.handleDrag;
    if (!d) return;
    const dx = (e.clientX - d.x) / S.z, dy = (e.clientY - d.y) / S.z;
    const el = S.sel.el;
    let prop, v;
    if (d.k === 'padL') { prop = 'padX'; v = d.padX + dx; } else if (d.k === 'padR') { prop = 'padX'; v = d.padX - dx; }
    else if (d.k === 'padT') { prop = 'padY'; v = d.padY + dy; } else if (d.k === 'padB') { prop = 'padY'; v = d.padY - dy; }
    else if (d.k === 'w') { prop = 'w'; v = d.w + dx; } else if (d.k === 'h') { prop = 'h'; v = d.h + dy; }
    const snap = (x) => Math.max(0, Math.round(x / (e.shiftKey ? 1 : 4)) * (e.shiftKey ? 1 : 4)); // 4px grid, Shift for 1px
    if (d.k === 'wh') {
      d.both = [snap(d.w + dx), snap(d.h + dy)];
      preview(el, 'w', d.both[0]); preview(el, 'h', d.both[1]);
      showLabel(e.clientX, e.clientY, `${d.both[0]} × ${d.both[1]}`);
      return;
    }
    v = snap(v);
    d.prop = prop; d.val = v;
    preview(el, prop, v);
    showLabel(e.clientX, e.clientY, `${{ padX: 'Padding X', padY: 'Padding Y', w: 'W', h: 'H' }[prop]} ${v}`);
  });
  document.addEventListener('pointerup', () => {
    const d = S.handleDrag;
    if (!d) return;
    S.handleDrag = null;
    $('dragLabel').hidden = true;
    if (d.both) commit({ ops: [{ prop: 'w', value: d.both[0] }, { prop: 'h', value: d.both[1] }] });
    else if (d.val != null) commit({ ops: [{ prop: d.prop, value: d.val }] });
  });
  function showLabel(x, y, text) {
    const l = $('dragLabel'), o = $('ov').getBoundingClientRect();
    l.hidden = false;
    l.textContent = text;
    l.style.transform = `translate(${(x - o.left) / S.z + 12 / S.z}px,${(y - o.top) / S.z + 12 / S.z}px) scale(${1 / S.z})`;
  }

  /* ---------- spacing measurements (hold Alt/Option) ---------- */
  function measureLines() {
    const g = $('measG');
    const a = S.sel?.el, b = S.hover;
    if (!S.alt || S.mode !== 'edit' || !a || !b || a === b || !a.isConnected || !b.isConnected) { g.innerHTML = ''; return; }
    const A = a.getBoundingClientRect(), B = b.getBoundingClientRect();
    const lines = [];
    const line = (x1, y1, x2, y2) => { const d = Math.round(Math.hypot(x2 - x1, y2 - y1)); if (d > 0) lines.push({ x1, y1, x2, y2, d }); };
    if (B.left <= A.left && B.right >= A.right && B.top <= A.top && B.bottom >= A.bottom) {
      const cx = A.left + A.width / 2, cy = A.top + A.height / 2;
      line(cx, B.top, cx, A.top); line(cx, A.bottom, cx, B.bottom); line(B.left, cy, A.left, cy); line(A.right, cy, B.right, cy);
    } else {
      const cy = (Math.max(A.top, B.top) + Math.min(A.bottom, B.bottom)) / 2, cx = (Math.max(A.left, B.left) + Math.min(A.right, B.right)) / 2;
      const yMid = Math.max(A.top, B.top) < Math.min(A.bottom, B.bottom) ? cy : A.top + A.height / 2;
      const xMid = Math.max(A.left, B.left) < Math.min(A.right, B.right) ? cx : A.left + A.width / 2;
      if (B.left >= A.right) line(A.right, yMid, B.left, yMid); else if (B.right <= A.left) line(B.right, yMid, A.left, yMid);
      if (B.top >= A.bottom) line(xMid, A.bottom, xMid, B.top); else if (B.bottom <= A.top) line(xMid, B.bottom, xMid, A.top);
    }
    g.innerHTML = lines.map((l) => `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="#F06A5F" stroke-width="1"/><rect x="${(l.x1 + l.x2) / 2 - 14}" y="${(l.y1 + l.y2) / 2 - 9}" width="28" height="16" rx="3" fill="#F06A5F"/><text x="${(l.x1 + l.x2) / 2}" y="${(l.y1 + l.y2) / 2 + 3}" fill="#fff" font-size="10" font-weight="600" text-anchor="middle" font-family="Geist,system-ui,sans-serif">${l.d}</text>`).join('');
  }
  const altKey = (e) => { if (e.key === 'Alt') { S.alt = e.type === 'keydown'; } };
  ['keydown', 'keyup'].forEach((t) => window.addEventListener(t, altKey, true));
  window.addEventListener('blur', () => (S.alt = false));

  /* ---------- multi-select (Shift-click) ---------- */
  function placeMulti() {
    const els = S.mode === 'edit' ? S.multi.map((m) => m.el).filter((x) => x.isConnected) : [];
    pool($('multi'), els.length, 'sel').forEach((b, i) => place(b, els[i] || null, els[i] ? labelOf(els[i]) : null));
  }
  const locOf = (m) => (m.use && (!m.def || m.el.getAttribute('data-kerf-n')) ? m.use : m.def || m.use);

  /* ---------- variant components ---------- */
  function activeVariant() {
    const c = S.sel?.defInfo?.cva;
    if (!c) return null;
    const out = {};
    for (const g of Object.keys(c.groups)) {
      const p = (S.sel.useInfo?.props || []).find((x) => x.name === g && x.value != null);
      out[g] = p ? p.value : c.defaults[g];
    }
    return out;
  }

  /* ---------- start ---------- */
  api('/theme').then((t) => { S.theme = t; renderPanel(); }).catch(() => {});
  api('/project').then((p) => { S.project = p; renderTop(); }).catch(() => {});
  api('/changes').then((c) => { S.count = c.length; renderBar(); }).catch(() => {});
  api('/chat').then((c) => { S.chat = (c.messages || []).map((m) => (m.role === 'kerf' && m.status === 'pending' ? { ...m, status: 'discarded' } : m)); S.notes = c.notes || []; renderAI(); }).catch(() => {});
  refreshVersions();
  renderAll();
  if (frame.contentDocument?.readyState === 'complete') bindApp();
  requestAnimationFrame(loop);
})();
