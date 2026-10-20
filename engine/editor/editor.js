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
    versions: { versions: [], draft: [], peeking: null }, open: {}, path: '/', hintSeen: false, layersOpen: innerWidth >= 1180,
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
  };
  const clamp = (p, v) => Math.max(PROPS[p].min ?? 0, Math.min(PROPS[p].max ?? 9999, v));
  const cs = (el) => el.ownerDocument.defaultView.getComputedStyle(el);
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
  const nameOf = (el) => el.getAttribute('data-kerf-n') || el.tagName.toLowerCase();
  const fileName = (loc) => (loc || '').split(':')[0].split('/').pop();
  const activeLoc = () => (S.sel ? (S.scope === 'here' ? S.sel.use || S.sel.def : S.sel.def || S.sel.use) : null);
  const info = () => (S.sel ? (activeLoc() === S.sel.def ? S.sel.defInfo : S.sel.useInfo) : null);
  const q = (loc) => `[data-kerf="${CSS.escape(loc)}"],[data-kerf-use="${CSS.escape(loc)}"]`;
  const sameLoc = (el) => (D ? D.querySelectorAll(defOf(el) ? `[data-kerf="${CSS.escape(defOf(el))}"]` : `[data-kerf-use="${CSS.escape(useOf(el))}"]`) : []);

  async function select(el) {
    if (!el) { S.sel = null; S.cpick = null; renderPanel(); renderLayers(); return; }
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
    const get = (loc) => (loc ? api('/inspect', { loc }).catch((e) => ({ error: e.message })) : null);
    const [d, u] = await Promise.all([get(s.def), get(s.use)]);
    if (S.sel !== s) return;
    s.defInfo = d;
    s.useInfo = u;
    renderPanel();
  }
  // After an edit the app re-renders and the element may be a new node: find it again.
  function refind() {
    const s = S.sel;
    if (!s || !D || s.el.isConnected) return;
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
      const r = await api('/edit', { loc, ...change });
      if (r.changed) {
        S.count = r.n;
        const sm = r.summary, parts = [];
        if (sm.removed.length || sm.added.length) parts.push(`${sm.removed.join(' ') || '—'} → ${sm.added.join(' ')}`);
        if (sm.text) parts.push(`“${sm.text.to}”`);
        (sm.props || []).forEach((p) => parts.push(`${p.name}: ${p.from ?? 'default'} → ${p.to}`));
        toast(`${fileName(r.file)} · ${parts.join(' · ')}`, sm.offScale.length ? `Off your scale: ${sm.offScale.join(', ')}` : '', false, true);
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
      if (r.undone) { S.count = r.n; toast(`Undone in ${fileName(r.file)}`); afterEdit(); renderChanges(); }
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
    reload: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v3h-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const ico = (n, s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16" aria-hidden="true">${IC[n]}</svg>`;
  const cornerIco = (deg) => `<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><g transform="rotate(${deg} 8 8)">${IC.rad}</g></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const tip = (label, key) => `<span class="tip">${label}${key ? `<span class="k">${key}</span>` : ''}</span>`;
  const hb = (act, icon, title, v = '', extra = '') => `<button class="ib sm" data-act="${act}" data-v="${v}" ${extra} title="${title}" aria-label="${title}">${ico(icon)}</button>`;

  /* ---------- top bar ---------- */
  const DEVICES = { desktop: null, tablet: 820, mobile: 390 };
  function renderTop() {
    const p = S.project || {};
    const n = S.versions.draft.length + S.versions.versions.reduce((a, v) => a + v.changes.length, 0);
    $('top').innerHTML = `<div class="tside">
        <button class="icon${S.layersOpen && S.mode === 'edit' ? ' on' : ''}" data-act="layersToggle" title="Show or hide layers" aria-label="Show or hide layers" ${S.mode === 'edit' ? '' : 'disabled'}>${ico('sidebar', 16)}</button>
        <span class="brand">${ico('kerf', 18)}<span>${esc(p.name || 'Kerf')}</span></span>
        ${p.branch ? `<span class="chip mono" title="Git branch">${ico('branch', 12)}${esc(p.branch)}</span>` : ''}
      </div>
      <form class="pathBox" data-form="path" title="Page"><span class="mono" style="color:var(--ink3)">${esc(location.host)}</span><input id="pathIn" value="${esc(S.path)}" spellcheck="false" aria-label="Page path"><button type="button" class="ib sm" data-act="reload" title="Reload page" aria-label="Reload page">${ico('reload')}</button></form>
      <div class="tside r">
        ${Object.keys(DEVICES).map((d) => `<button class="icon${S.device === d ? ' on' : ''}" data-act="device" data-v="${d}" title="${d[0].toUpperCase() + d.slice(1)}" aria-pressed="${S.device === d}">${ico(d, 16)}</button>`).join('')}
        <span class="div" style="height:20px;margin:0 4px"></span>
        <button class="icon${S.side === 'history' ? ' on' : ''}" data-act="history" title="Version history" aria-label="Version history">${ico('history', 16)}${S.versions.versions.length ? '<i class="badgeDot"></i>' : ''}</button>
        <button class="primary" data-act="pr" ${n ? '' : 'disabled'}>Create PR<span class="count">${n}</span></button>
      </div>`;
  }
  function applyDevice() {
    const w = DEVICES[S.device];
    $('frameBox').style.maxWidth = w ? w + 'px' : '';
  }

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
    h.hidden = S.hintSeen || S.mode !== 'preview' || S.askOpen || S.tool === 'annotate';
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
        const icon = useOf(el) && el.getAttribute('data-kerf-n') ? 'comp' : leafText ? 'text' : 'frame';
        rows.push(`<button class="layer${on ? ' on' : ''}" data-layer="${rows.length}" style="padding-left:${6 + depth * 14}px">
          <span class="tw" data-twist="${esc(k)}">${n.kids.length ? ico(open ? 'chev' : 'chevR', 10) : ''}</span>${ico(icon, 12)}<span class="nm">${esc(nameOf(el))}</span>${leafText ? `<span class="tx">${esc(leafText)}</span>` : ''}</button>`);
        layerEls.push(el);
        if (n.kids.length && open) add(n.kids, depth + 1);
      }
    };
    layerEls = [];
    add(layerTree(), 0);
    const tree = box.querySelector('.tree');
    const st = tree ? tree.scrollTop : 0;
    const changes = S.versions.draft;
    box.innerHTML = `<div class="lhead">Layers<span class="note" style="font-weight:400">${esc(S.path)}</span></div>
      <div class="tree">${rows.join('') || '<div class="empty">This page has no elements Kerf can edit yet.</div>'}</div>
      <div class="lchanges"><span class="secT">Changes since last version</span>${changes.length ? changes.slice(-8).reverse().map((c) => `<div class="row"><span class="dot"></span><span><span class="mono">${esc(fileName(c.file))}</span> ${esc(c.label)}</span></div>`).join('') : '<span class="note">None yet</span>'}</div>`;
    box.querySelector('.tree').scrollTop = st;
    const onRow = box.querySelector('.layer.on');
    if (onRow && layersScrollToSel) { onRow.scrollIntoView({ block: 'nearest' }); layersScrollToSel = false; }
  }
  let layerEls = [], layersScrollToSel = false;
  let layerTimer = null;
  const layersSoon = () => { clearTimeout(layerTimer); layerTimer = setTimeout(renderLayers, 250); };

  /* ---------- design panel ---------- */
  const val = (p) => read(p, S.sel?.el);
  const nf = (p, icon, title, unit) => `<label class="inp" title="${title}"><span class="ic" data-scrub="${p}">${icon.startsWith('<') ? icon : ico(icon, 12)}</span><input type="text" inputmode="decimal" data-prop="${p}" value="${esc(val(p))}" aria-label="${title}">${unit ? `<span class="u">${unit}</span>` : ''}</label>`;
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
      const ci = $('chatIn'); if (ci) { ci.value = draft; if (focusChat || hadFocus) ci.focus(); }
      return;
    }
    const s = S.sel;
    if (!s) {
      p.innerHTML = tabsHTML() + `<div class="empty"><b>Nothing selected</b><span>Click anything in your app, or pick a layer on the left. Double-click text to retype it. Every change here is written to your code.</span></div>`;
      return;
    }
    const el = s.el, inf = info();
    const name = (activeLoc() === s.use ? s.useInfo?.tag : s.defInfo?.tag) || nameOf(el);
    const loc = activeLoc();
    let h = `<div class="sec head"><div class="secH"><span class="nm">${ico(s.use ? 'comp' : 'frame')}${esc(name)}</span>${hb('parent', 'up', 'Select parent')}</div>
      <span class="path">${esc(loc.replace(/:(\d+):\d+$/, ':$1'))}</span>
      ${s.def && s.use ? `<div class="seg"><button data-act="scope" data-v="all" class="${S.scope === 'all' ? 'on' : ''}" title="Change the component itself, everywhere it's used">Everywhere</button><button data-act="scope" data-v="here" class="${S.scope === 'here' ? 'on' : ''}" title="Change only this use of the component">Only here</button></div>` : ''}
      ${s.repeat > 1 ? `<span class="note">Repeated ×${s.repeat} by the same code: edits apply to all of them.</span>` : ''}
      ${actionsHTML()}</div>`;
    if (!inf) h += `<div class="sec"><span class="note">Reading code…</span></div>`;
    else if (inf.error) h += `<div class="sec"><span class="note warn">${esc(inf.error)}</span></div>`;
    else if (!el.isConnected) h += `<div class="sec"><span class="note">This element isn’t on screen right now.</span></div>`;
    else {
      h += imageSection(el);
      h += propsSection(inf);
      if (inf.classKind === 'dynamic') h += `<div class="sec"><span class="note warn">${esc(inf.classReason)}</span></div>`;
      if (inf.text?.editable) h += sec('Content', `<label class="inp"><input type="text" data-text="1" value="${esc(inf.text.value)}" aria-label="Text"></label>`);
      else if (isText(el)) h += sec('Content', `<span class="note">${esc(inf.text?.reason || '')}</span>`);
      if (isText(el) || inf.text?.editable) {
        const fam = cs(el).fontFamily.split(',')[0].replace(/["']/g, '');
        const fw = val('fontWeight');
        h += sec('Typography', `<label class="inp lock"><input type="text" value="${esc(fam)}" disabled aria-label="Font"></label>
          <div class="r2"><label class="inp"><select data-sel="fontWeight" aria-label="Weight">${[[100, 'Thin'], [200, 'Extra light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']].map(([v, n]) => `<option value="${v}"${v === fw ? ' selected' : ''}>${n}</option>`).join('')}</select>${ico('chev', 12)}</label>${nf('fontSize', '<b class="tg">T</b>', 'Font size')}</div>
          <div class="r2">${nf('lineHeight', 'lh', 'Line height')}${nf('letterSpacing', 'ls', 'Letter spacing', '%')}</div>
          <div class="r2"><div class="ibs">${[['left', 'alL'], ['center', 'alC'], ['right', 'alR']].map(([v, i]) => `<button class="ib${val('align') === v ? ' on' : ''}" data-act="set" data-p="align" data-v="${v}" title="Align ${v}">${ico(i)}</button>`).join('')}</div><span></span></div>`);
        h += sec('Text color', colorRow('color', 'Text color'));
      }
      h += sec(isLayout(el) ? 'Auto layout' : 'Padding', `${isLayout(el) ? `<div class="r2">${nf('gap', 'gap', 'Gap')}<span></span></div>` : ''}<div class="r2">${nf('padX', 'padH', 'Horizontal padding')}${nf('padY', 'padV', 'Vertical padding')}</div>`);
      const indep = S.corners;
      h += sec('Appearance', `<div class="r2c">${nf('opacity', 'opa', 'Opacity', '%')}${nf('radius', 'rad', 'Corner radius')}<button class="ib${indep ? ' on' : ''}" data-act="corners" title="Independent corners">${ico('corners')}</button></div>
        ${indep ? `<div class="r4">${nf('rTL', cornerIco(0), 'Top left')}${nf('rTR', cornerIco(90), 'Top right')}${nf('rBR', cornerIco(180), 'Bottom right')}${nf('rBL', cornerIco(270), 'Bottom left')}</div>` : ''}`);
      const hasFill = val('bg') && val('bg') !== 'transparent';
      h += sec('Fill', hasFill ? colorRow('bg', 'Fill', 'rmFill') : '', hasFill ? '' : hb('addFill', 'plus', 'Add fill'));
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
  function historyHTML() {
    const { versions, draft, peeking } = S.versions;
    const v = versions.slice().reverse();
    return `<div class="ptabs"><button class="on">Version history</button><button class="x" data-act="history" aria-label="Close">${ico('x')}</button></div>
      <div class="scroll" style="padding:8px;display:flex;flex-direction:column;gap:4px">
      ${draft.length ? `<div class="ver"><div class="vh"><span>Current</span><span>${draft.length} unsaved change${draft.length === 1 ? '' : 's'}</span></div>${draft.slice(0, 4).map((c) => `<span class="ch">${esc(fileName(c.file))} · ${esc(c.label)}</span>`).join('')}<span class="note">Going back to Preview saves these as a version.</span></div>` : ''}
      ${v.map((x) => `<div class="ver${peeking === x.n ? ' on' : ''}"><div class="vh"><span>Version ${x.n}</span><span>${time(x.at)}</span></div>
        ${x.changes.slice(0, 5).map((c) => `<span class="ch">${c.source === 'ai' ? '<span class="src">AI</span> ' : ''}${esc(fileName(c.file))} · ${esc(c.label)}</span>`).join('')}${x.changes.length > 5 ? `<span class="note">and ${x.changes.length - 5} more</span>` : ''}
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
      ? list.slice().reverse().map((x) => `<div class="chg"><span class="mono">${esc(x.file)}</span><span>${esc([x.summary.removed.join(' '), x.summary.added.join(' ')].filter(Boolean).join(' → '))}${x.summary.text ? ` “${esc(x.summary.text.to)}”` : ''}${(x.summary.props || []).map((p) => ` ${esc(p.name)}: ${esc(p.to)}`).join('')}</span></div>`).join('')
      : '<span class="note">No changes yet.</span>');
  }
  let toastT;
  function toast(msg, sub, err, withUndo) {
    const t = $('toast');
    t.hidden = false;
    t.className = 'toast' + (err ? ' err' : '');
    t.innerHTML = `<div class="tx"><span class="mono">${esc(msg)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>${withUndo ? '<button class="outline" data-act="undo">Undo</button>' : ''}<button class="ib" data-act="toastClose" aria-label="Dismiss">${ico('x')}</button>`;
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
  const labelOf = (el) => `${nameOf(el)} · ${fileName(useOf(el) || defOf(el))}`;
  function pool(container, n, cls) {
    while (container.children.length < n) { const d = document.createElement('div'); d.className = 'box ' + cls; d.innerHTML = '<span class="tag"></span>'; container.appendChild(d); }
    return [...container.children];
  }
  function loop() {
    refind();
    const edit = S.mode === 'edit';
    place($('hov'), edit && S.tool !== 'annotate' && S.hover !== S.sel?.el ? S.hover : null, S.hover ? labelOf(S.hover) : '');
    place($('sel'), edit ? S.sel?.el : null, S.sel ? labelOf(S.sel.el) : '');
    const sib = edit && S.sel && S.sel.repeat > 1 ? [...sameLoc(S.sel.el)].filter((x) => x !== S.sel.el).slice(0, 60) : [];
    pool($('sibs'), sib.length, 'sib').forEach((b, i) => place(b, sib[i] || null, null));
    const aEls = D ? (S.amber || []).flatMap((loc) => [...D.querySelectorAll(q(loc))]).slice(0, 60) : [];
    pool($('amb'), aEls.length, 'amber').forEach((b, i) => place(b, aEls[i] || null, null));
    if (W) $('marksG').setAttribute('transform', `translate(${-W.scrollX} ${-W.scrollY})`);
    if (W && W.location.pathname + W.location.search !== S.path) {
      S.path = W.location.pathname + W.location.search;
      if (document.activeElement?.id !== 'pathIn') { const pi = $('pathIn'); if (pi) pi.value = S.path; }
      layersSoon();
    }
    requestAnimationFrame(loop);
  }

  /* ---------- app events ---------- */
  function bindApp() {
    try { W = frame.contentWindow; D = frame.contentDocument; } catch { W = D = null; }
    if (!W || !D) return;
    S.sel = null; S.hover = null;
    const block = (e) => {
      if (S.mode !== 'edit' && S.tool !== 'annotate') return;
      if (S.editing && S.editing.contains(e.target)) return;
      e.preventDefault(); e.stopPropagation();
    };
    ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'touchstart', 'submit', 'contextmenu', 'auxclick'].forEach((t) => W.addEventListener(t, block, true));
    let lastClick = null;
    W.addEventListener('click', (e) => {
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
      select(pick(e.target));
    }, true);
    W.addEventListener('dblclick', (e) => {
      if (S.mode !== 'edit') return;
      block(e);
      if (S.sel && S.sel.el.contains(e.target)) beginText();
    }, true);
    W.addEventListener('pointermove', (e) => { S.hover = S.mode === 'edit' ? pick(e.target) : null; }, true);
    W.addEventListener('pointerleave', () => { S.hover = null; });
    W.addEventListener('keydown', onKey, true);
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
      case 'parent': { const p = S.sel && pick(S.sel.el.parentElement); if (p) select(p); break; }
      case 'corners': S.corners = !S.corners; renderPanel(); break;
      case 'cpick': S.cpick = S.cpick === v ? null : v; renderPanel(); break;
      case 'token': case 'set': commit({ ops: [{ prop: a.dataset.p, value: v }] }); break;
      case 'addFill': commit({ ops: [{ prop: 'bg', value: tokens().find(([n]) => n === 'surface')?.[0] || 'white' }] }); break;
      case 'rmFill': S.cpick = null; commit({ ops: [{ prop: 'bg', value: 'transparent' }] }); break;
      case 'addStroke': commit({ ops: [{ prop: 'borderW', value: 1 }, { prop: 'borderC', value: tokens().find(([n]) => n === 'border')?.[0] || 'black' }] }); break;
      case 'rmStroke': S.cpick = null; commit({ ops: [{ prop: 'borderW', value: 0 }] }); break;
      case 'setProp': commit({ props: [{ name: a.dataset.p, value: v }] }); break;
      case 'tab': S.tab = v; renderPanel(v === 'chat'); renderBar(); break;
      case 'chatToggle': toggleAI(false); break;
      case 'ask': toggleAI(false); break;
      case 'layersToggle': S.layersOpen = !S.layersOpen; renderLayers(); renderTop(); break;
      case 'device': S.device = v; applyDevice(); renderTop(); break;
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
    if (e.key === 'Enter' && !e.shiftKey && t.id === 'chatIn') { e.preventDefault(); sendChat(); return; }
    if (e.key === 'Enter' && !e.shiftKey && t.id === 'noteIn') { e.preventDefault(); addNote(); return; }
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
    if (f === 'ask') runAI($('askIn').value, visibleTargets(), 'ask');
    if (f === 'chat') sendChat();
    if (f === 'reply') {
      const v = $('replyIn').value, where = e.target.dataset.where, prev = S.card;
      runAI(v, where === 'notes' && prev?.targets ? prev.targets : visibleTargets(), where, v, true);
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
    const title = all.length === 1 ? `Design: ${all[0].label}`.slice(0, 72) : `Design updates on ${S.path === '/' ? 'the home screen' : S.path}`;
    const body = `Changes made in Kerf, by hand and with Kerf's AI.\n\n${all.map((c) => `- ${c.file}: ${c.label}`).join('\n')}`;
    const m = $('modal');
    m.hidden = false;
    m.innerHTML = `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="prT">
      <div class="dh"><div style="display:flex;flex-direction:column;gap:4px"><h2 id="prT">Create pull request</h2><span class="note">Your developers review it on GitHub before anything goes live.</span></div><button class="ib" data-act="closeModal" aria-label="Close">${ico('x')}</button></div>
      <div class="db">
        ${!p.repo ? `<span class="note warn">This project isn’t connected to a GitHub repository, so Kerf can’t open a pull request for it.</span>` : ''}
        <label><span class="secT">Title</span><input class="fld" id="prTitle" value="${esc(title)}"></label>
        <label><span class="secT">Note for reviewers</span><textarea class="fld" id="prBody" rows="5">${esc(body)}</textarea></label>
        <div style="display:flex;align-items:center;gap:8px;color:var(--ink2)"><span class="chip mono" style="color:var(--ink)">${p.branch?.startsWith('kerf/') ? esc(p.branch) : 'kerf/…'}</span>→<span class="chip mono" style="color:var(--ink)">${esc(p.branch?.startsWith('kerf/') ? 'its pull request' : p.branch || 'main')}</span>${p.repo ? `<span class="note">${esc(p.repo)}</span>` : ''}</div>
        <div class="files"><div class="fh"><span>${all.length} change${all.length === 1 ? '' : 's'}</span><span class="note">${files.length} file${files.length === 1 ? '' : 's'}</span></div>${files.map((f) => `<div class="fr"><span class="dot" style="margin:0"></span><span class="mono">${esc(f)}</span></div>`).join('')}</div>
      </div>
      <div class="df"><button class="outline" data-act="closeModal">Cancel</button><button class="primary solo" data-act="createPR" ${p.repo && files.length ? '' : 'disabled'}>Create pull request</button></div></section>`;
  }
  async function createPR() {
    const btn = document.querySelector('[data-act="createPR"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="spin"></i>Sending to GitHub…';
    try {
      const r = await api('/pr', { title: $('prTitle').value, body: $('prBody').value });
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
  const PROP_NAMES = { bg: 'Fill', color: 'Text color', borderC: 'Stroke color', fontSize: 'Size', fontWeight: 'Weight', lineHeight: 'Line height', letterSpacing: 'Letter spacing', align: 'Align', radius: 'Radius', rTL: 'Top-left corner', rTR: 'Top-right corner', rBR: 'Bottom-right corner', rBL: 'Bottom-left corner', padX: 'Padding X', padY: 'Padding Y', gap: 'Gap', borderW: 'Stroke', opacity: 'Opacity', shadow: 'Shadow' };
  const UNIT = { fontSize: 'px', lineHeight: 'px', radius: 'px', rTL: 'px', rTR: 'px', rBR: 'px', rBL: 'px', padX: 'px', padY: 'px', gap: 'px', borderW: 'px', opacity: '%', letterSpacing: '%' };
  const opLabel = (o) => `${PROP_NAMES[o.prop] || o.prop} ${o.value}${UNIT[o.prop] || ''}`;
  const structLabel = (st) => ({ delete: 'Delete', duplicate: 'Duplicate', move: `Move ${st.dir || 'to ' + st.index}`, swap: `Swap → ${st.to}`, insert: `Add ${st.position}: ${(st.jsx || '').slice(0, 60)}`, image: [st.src && `Image → ${st.src}`, st.alt != null && `Alt “${st.alt}”`].filter(Boolean).join(' · ') })[st.type];
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
    return { loc, shared: !!(def && use), measured: measure(el), text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100), note, ...img };
  }
  function uniq(list) {
    const seen = new Set(), out = [];
    for (const t of list) if (t.loc && !seen.has(t.loc)) { seen.add(t.loc); out.push(t); }
    return out;
  }
  const tagged = (root) => (root || D ? [...(root || D).querySelectorAll('[data-kerf],[data-kerf-use]')] : []);
  const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < W.innerHeight && r.right > 0 && r.left < W.innerWidth; };
  const visibleTargets = () => (D ? uniq(tagged().filter(onScreen).flatMap((el) => targetsOf(el))).slice(0, 90) : []);
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
  async function runAI(text, targets, where, shown, followUp) {
    text = String(text || '').trim();
    if (!text || S.card?.busy) return;
    if (!targets.length) { toast('Nothing on screen to work with yet. Wait for the page to load, or select something.', '', true); return; }
    const history = historyFor();
    const ctx = followUp ? 'Follow-up' : where === 'chat' && S.sel ? ((S.sel.use ? S.sel.useInfo?.tag : S.sel.defInfo?.tag) || nameOf(S.sel.el)) : where === 'notes' ? `${S.notes.length} note${S.notes.length === 1 ? '' : 's'}` : 'Whole screen';
    S.chat.push({ role: 'user', text, shown: shown || text, ctx, where });
    const m = { role: 'kerf', busy: true, status: 'pending', where, targets };
    S.chat.push(m);
    S.card = m;
    renderAI();
    try {
      m.proposal = await api('/ai', { request: text, targets, history });
      S.amber = m.proposal.edits.map((e) => e.loc);
      if (!m.proposal.edits.length) m.status = 'info';
    } catch (e) { m.error = e.message; }
    m.busy = false;
    renderAI();
  }
  async function decide(m, v) {
    if (!m || m.status !== 'pending') return;
    S.amber = [];
    if (v === 'apply') {
      const r = await api('/ai/apply', { edits: m.proposal.edits }).catch((e) => ({ error: e.message }));
      if (r.error) { toast(r.error, '', true); renderAI(); return; }
      const ok = r.results.filter((x) => x.ok && x.changed).length, bad = r.results.filter((x) => !x.ok);
      S.count = r.n;
      m.status = ok ? 'applied' : 'failed';
      toast(`Applied ${ok} change${ok === 1 ? '' : 's'}`, bad.length ? `${bad.length} skipped: ${bad[0].error}` : '', !!bad.length && !ok, !!ok);
      if (m.where === 'notes' && ok) S.notes = [];
      afterEdit();
    } else m.status = 'discarded';
    renderAI();
  }
  const STATUS = { applied: 'Applied', discarded: 'Discarded', failed: 'Couldn’t apply', info: '' };
  function kerfHTML(m, i) {
    if (m.busy) return `<div class="prop"><div class="kerfSays"><i class="spin"></i><span class="note">Kerf is reading the code…</span></div></div>`;
    if (m.error) return `<div class="prop err"><span class="note warn">${esc(m.error)}</span></div>`;
    const p = m.proposal;
    const badge = { partial: 'Partly possible', not_yet: 'Not possible in Kerf yet', needs_developer: 'For developers' }[p.scope];
    return `<div class="prop"><div class="kerfSays"><i class="dotA"></i><span>${badge ? `<b class="badge">${badge}</b> ` : ''}${esc(p.message)}</span></div>
      ${p.edits.length ? `<div class="edits">${p.edits.map((e) => `<div class="ed"><b>${esc(e.tag)}</b><span>${esc(e.why)}</span><span class="mono">${esc(editLabel(e))}</span></div>`).join('')}</div>` : ''}
      ${m.status === 'pending' ? `<div class="acts"><button class="ghostBtn" data-act2="decide" data-i="${i}" data-v="discard">Discard</button><button class="amberBtn" data-act2="decide" data-i="${i}" data-v="apply">Apply ${p.edits.length} change${p.edits.length === 1 ? '' : 's'}</button></div>` : STATUS[m.status] ? `<span class="note">${STATUS[m.status]}</span>` : ''}</div>`;
  }
  const replyForm = (where) => `<form class="reply" data-form="reply" data-where="${where}"><input id="replyIn" placeholder="Reply to Kerf…" autocomplete="off" aria-label="Reply to Kerf"><button class="sendB" aria-label="Send">${ico('up', 14)}</button></form>`;
  function renderAsk() {
    const a = $('ask');
    a.hidden = !(S.askOpen && S.mode === 'preview');
    if (a.hidden) return;
    const m = S.card && S.card.where === 'ask' ? S.card : null;
    if (m) {
      a.innerHTML = `<div class="card"><div class="cardTop"><span class="note">Kerf</span>${hb('closeCard2', 'x', 'Close', '', 'data-act2="closeCard"')}</div>${kerfHTML(m, S.chat.indexOf(m))}${m.busy ? '' : replyForm('ask')}</div>`;
      if (!m.busy) setTimeout(() => $('replyIn')?.focus(), 0);
    } else {
      a.innerHTML = `<form class="askF" data-form="ask"><span class="spark">${ico('spark', 16)}</span><input id="askIn" placeholder="Ask Kerf to change something on this screen" autocomplete="off" aria-label="Ask Kerf"><button class="sendB" aria-label="Send">${ico('up', 14)}</button></form>
        <div class="askHints">${['Make this page feel more premium', 'Make the text easier to read', 'Tighten the spacing'].map((s) => `<button data-act2="askHint" data-v="${s}">${s}</button>`).join('')}</div>`;
      setTimeout(() => $('askIn')?.focus(), 0);
    }
  }
  function chatHTML() {
    const ctx = S.sel ? `${esc((S.sel.use ? S.sel.useInfo?.tag : S.sel.defInfo?.tag) || nameOf(S.sel.el))} · ${esc(fileName(activeLoc()))}` : 'Whole screen';
    const msgs = S.chat.map((m, i) => (m.role === 'user' ? `<div class="uMsg"><span class="ctx">${esc(m.ctx)}</span><div class="bub">${esc(m.shown || m.text)}</div></div>` : `<div class="kMsg">${kerfHTML(m, i)}</div>`)).join('');
    return `<div class="chatScroll" id="chatScroll">${msgs || `<div class="empty"><b>Talk to Kerf</b><span>Select an element and describe the change, like “make these icons lighter”. Kerf reads the code, proposes edits in amber, and you approve them. Ask, notes and chat share this one conversation, so you can follow up here.</span></div>`}</div>
      <form class="comp" data-form="chat"><span class="ctx">${ctx}</span><textarea id="chatIn" rows="2" placeholder="Describe a change, or follow up…" aria-label="Message Kerf"></textarea><button class="sendB" aria-label="Send">${ico('up', 14)}</button></form>`;
  }
  function sendChat() {
    const t = $('chatIn');
    if (!t) return;
    const v = t.value;
    t.value = '';
    runAI(v, S.sel ? selectionTargets() : visibleTargets(), 'chat');
  }

  /* annotations */
  function shapeSVG(n, i, draft) {
    const st = `stroke="#2B66D9" stroke-width="2" fill="${draft ? 'none' : 'rgba(43,102,217,.06)'}"`;
    let s = '';
    if (n.shape === 'box') s = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" ${st}/>`;
    else if (n.shape === 'circle') s = `<ellipse cx="${n.x + n.w / 2}" cy="${n.y + n.h / 2}" rx="${n.w / 2}" ry="${n.h / 2}" ${st}/>`;
    else if (n.shape === 'arrow') { const a = Math.atan2(n.y2 - n.y, n.x2 - n.x), L = 12; s = `<path d="M${n.x} ${n.y}L${n.x2} ${n.y2}M${n.x2} ${n.y2}L${n.x2 - L * Math.cos(a - 0.5)} ${n.y2 - L * Math.sin(a - 0.5)}M${n.x2} ${n.y2}L${n.x2 - L * Math.cos(a + 0.5)} ${n.y2 - L * Math.sin(a + 0.5)}" stroke="#2B66D9" stroke-width="2.5" fill="none" stroke-linecap="round"/>`; }
    const [bx, by] = n.shape === 'pin' || n.shape === 'arrow' ? [n.x, n.y] : [n.x + n.w, n.y];
    if (i != null) s += `<g transform="translate(${bx} ${by})"><path d="M0 0h12a12 12 0 0 1 0 24h-0a12 12 0 0 1-12-12z" transform="translate(-4 -20)" fill="#2B66D9"/><text x="8" y="-3" fill="#fff" font-size="11" font-weight="600" font-family="Geist,system-ui,sans-serif" text-anchor="middle">${i + 1}</text></g>`;
    else if (n.shape === 'pin') s += `<circle cx="${n.x}" cy="${n.y}" r="6" fill="#2B66D9"/>`;
    return s;
  }
  function renderMarks() {
    $('marksG').innerHTML = S.notes.map((n, i) => shapeSVG(n, i)).join('') + (S.noteDraft ? shapeSVG(S.noteDraft, null, true) : '');
    $('annoCap').hidden = S.tool !== 'annotate';
    const busy = S.card?.busy && S.card.where === 'notes';
    const chip = $('notesChip');
    chip.hidden = !S.notes.length || !!S.noteDraft;
    if (!chip.hidden) chip.innerHTML = `<span>${S.notes.length} note${S.notes.length === 1 ? '' : 's'}</span><button class="ghostBtn" data-act2="notesClear">Clear</button><button class="lightBtn" data-act2="notesApply" ${busy ? 'disabled' : ''}>${busy ? '<i class="spin dark"></i>Reading…' : `${ico('spark', 14)}Apply ${S.notes.length > 1 ? 'all ' + S.notes.length : 'note'}`}</button>`;
    const pop = $('notePop');
    pop.hidden = !S.noteDraft;
    if (S.noteDraft && W) {
      const n = S.noteDraft, ow = $('ov').clientWidth, oh = $('ov').clientHeight;
      const ax = (n.shape === 'arrow' ? n.x2 : n.x + (n.w || 0)) - W.scrollX + 12, ay = (n.shape === 'arrow' ? n.y2 : n.y) - W.scrollY;
      pop.style.transform = `translate(${Math.min(ow - 332, Math.max(12, ax))}px,${Math.min(oh - 180, Math.max(12, ay))}px)`;
      if (!pop.dataset.open) {
        pop.innerHTML = `<div class="secH"><span>Note ${S.notes.length + 1}</span>${hb('noteDiscard2', 'x', 'Discard', '', 'data-act2="noteDiscard"')}</div><textarea id="noteIn" rows="3" placeholder="What should change here?"></textarea><div class="acts"><span class="note">Kerf will read the code under this mark.</span><button class="lightBtn" data-act2="noteAdd">Add note</button></div>`;
        pop.dataset.open = '1';
        setTimeout(() => $('noteIn')?.focus(), 0);
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
    runAI(request, targets, 'notes', S.notes.map((n, i) => `${i + 1}. ${n.text}`).join('\n'));
  }
  let draw = null;
  const ovPoint = (e) => { const r = $('ov').getBoundingClientRect(); return { x: e.clientX - r.left + W.scrollX, y: e.clientY - r.top + W.scrollY }; };
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
    const v = ($('noteIn')?.value || '').trim();
    if (!v || !S.noteDraft) return;
    S.notes.push({ ...S.noteDraft, text: v });
    S.noteDraft = null;
    renderMarks();
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
      else if (act === 'decide') decide(S.chat[+a.dataset.i], v);
      else if (act === 'closeCard') { if (S.card?.status === 'pending') S.card.status = 'discarded'; S.card = null; S.amber = []; renderAI(); }
      else if (act === 'noteAdd') addNote();
      else if (act === 'noteDiscard') { S.noteDraft = null; renderMarks(); }
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
  async function structure(op, { keepSel } = {}) {
    const loc = structLoc();
    if (!loc) { toast('Select an element first.', '', true); return false; }
    const before = D?.querySelector('vite-error-overlay');
    try {
      const r = await api('/structure', { loc, op });
      if (!r.changed) return false;
      S.count = r.n;
      toast(`${fileName(r.file)} · ${r.summary.action}`, '', false, true);
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
      { k: 'heading', label: 'Heading', icon: 'text', jsx: `<h2 className="text-2xl font-semibold ${ink}">New heading</h2>` },
      { k: 'button', label: has('Button') ? 'Button (your component)' : 'Button', icon: 'frame', jsx: has('Button') ? '<Button>Button</Button>' : `<button className="rounded-md px-4 py-2 text-sm font-medium ${tokenClass('bg', ['primary'], 'bg-gray-900')} ${tokenClass('text', ['primary-fg', 'primary-foreground'], 'text-white')}">Button</button>` },
      { k: 'image', label: 'Image…', icon: 'image', image: true },
      { k: 'icon', label: 'Icon…', icon: 'spark', iconPick: true },
      { k: 'frame', label: 'Frame', icon: 'frame', jsx: `<div className="flex flex-col gap-3 rounded-lg ${tokenClass('border', ['border'], 'border-gray-200')} border p-4"><p className="text-sm ${muted}">New frame</p></div>` },
    ];
  }
  // Boxes that hold other elements take new ones inside; text, images and buttons get them after.
  const defaultPos = () => (S.sel && S.sel.el.children.length && !['p', 'span', 'button', 'a', 'label', 'svg'].includes(S.sel.el.tagName.toLowerCase()) ? 'inside' : 'after');
  async function openInsert() {
    if (!S.sel) { toast('Select where the new element should go, then add it.', '', true); return; }
    const list = await templates();
    const comps = (S.components || []).filter((c) => !['Button'].includes(c.name));
    const m = $('modal');
    m.hidden = false;
    m.innerHTML = `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="insT" style="width:440px">
      <div class="dh"><div style="display:flex;flex-direction:column;gap:4px"><h2 id="insT">Add an element</h2><span class="note">It goes ${S.insertPos === 'inside' ? 'inside' : S.insertPos === 'before' ? 'before' : 'after'} <b>${esc(nameOf(S.sel.el))}</b>.</span></div><button class="ib" data-act="closeModal" aria-label="Close">${ico('x')}</button></div>
      <div class="db">
        <div class="seg">${['before', 'after', 'inside'].map((p) => `<button data-act="insPos" data-v="${p}" class="${(S.insertPos || 'after') === p ? 'on' : ''}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>
        <div class="grid3">${list.map((t, i) => `<button class="tile" data-act="insTpl" data-v="${i}">${ico(t.icon, 18)}<span>${esc(t.label)}</span></button>`).join('')}</div>
        ${comps.length ? `<div class="secT">Your components</div><label class="inp"><input id="compQ" placeholder="Search components" autocomplete="off"></label><div class="clist" id="compList">${compRows(comps, '')}</div>` : ''}
      </div></section>`;
    S._tpls = list;
  }
  const compRows = (comps, q) => comps.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 60).map((c) => `<button class="crow" data-act="insComp" data-v="${esc(c.name)}">${ico('comp', 12)}<span>${esc(c.name)}</span><span class="note mono">${esc(c.file.replace(/^src\//, ''))}</span></button>`).join('');
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
    if (e.target.id === 'compQ') $('compList').innerHTML = compRows((S.components || []).filter((c) => c.name !== 'Button'), e.target.value);
  });
  document.addEventListener('change', (e) => {
    if (e.target.dataset.alt) structure({ type: 'image', alt: e.target.value }, { keepSel: true });
  });
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act, v = a.dataset.v;
    if (act === 'sDel') structure({ type: 'delete' });
    else if (act === 'sDup') structure({ type: 'duplicate' });
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
      if (a.dataset.mode === 'swap') { $('modal').hidden = true; structure({ type: 'swap', to: v }, { keepSel: true }); }
      else insertJsx(`<${v} className="h-5 w-5" />`);
    }
    else if (act === 'swapComp') { $('modal').hidden = true; structure({ type: 'swap', to: v }, { keepSel: true }); }
    else if (act === 'imgUpload') { const src = await upload(await pickFile()); if (src) structure({ type: 'image', src }, { keepSel: true }); }
    else if (act === 'imgLink') { const u = prompt('Image link (https://…)'); if (u && /^https?:\/\//.test(u)) structure({ type: 'image', src: u.trim() }, { keepSel: true }); }
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
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); structure({ type: 'delete' }); }
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

  /* ---------- start ---------- */
  api('/theme').then((t) => { S.theme = t; renderPanel(); }).catch(() => {});
  api('/project').then((p) => { S.project = p; renderTop(); }).catch(() => {});
  api('/changes').then((c) => { S.count = c.length; renderBar(); }).catch(() => {});
  refreshVersions();
  renderAll();
  if (frame.contentDocument?.readyState === 'complete') bindApp();
  requestAnimationFrame(loop);
})();
