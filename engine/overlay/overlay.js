// Kerf editor overlay. Injected into the app's page in dev. Everything lives in
// a shadow root so the app's styles and Kerf's never touch each other.
(() => {
  if (window.__kerfOverlay) return;
  window.__kerfOverlay = true;

  /* ---------- api ---------- */
  const api = (route, body) =>
    fetch('/__kerf' + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      return j;
    });

  /* ---------- state ---------- */
  const S = {
    mode: 'preview', sel: null, hover: null, theme: null, scope: 'all',
    count: 0, corners: false, cpick: null, editing: null, changesOpen: false, changes: [],
  };

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

  const rgbHex = (c) => {
    const m = String(c).match(/[\d.]+/g);
    if (!m) return '';
    if (m.length > 3 && +m[3] === 0) return 'transparent';
    return '#' + m.slice(0, 3).map((x) => ('0' + Math.round(+x).toString(16)).slice(-2)).join('').toUpperCase();
  };
  function read(p, el) {
    if (!el) return '';
    const cs = getComputedStyle(el), fs = parseFloat(cs.fontSize);
    switch (p) {
      case 'bg': return rgbHex(cs.backgroundColor);
      case 'color': return rgbHex(cs.color);
      case 'borderC': return rgbHex(cs.borderTopColor);
      case 'fontSize': return Math.round(fs);
      case 'fontWeight': return Number(cs.fontWeight);
      case 'lineHeight': return cs.lineHeight === 'normal' ? Math.round(fs * 1.2) : Math.round(parseFloat(cs.lineHeight));
      case 'letterSpacing': return cs.letterSpacing === 'normal' ? 0 : Math.round((parseFloat(cs.letterSpacing) / fs) * 1000) / 10;
      case 'align': { const a = cs.textAlign; return a === 'start' ? 'left' : a === 'end' ? 'right' : a; }
      case 'radius': case 'rTL': return Math.round(parseFloat(cs.borderTopLeftRadius));
      case 'rTR': return Math.round(parseFloat(cs.borderTopRightRadius));
      case 'rBR': return Math.round(parseFloat(cs.borderBottomRightRadius));
      case 'rBL': return Math.round(parseFloat(cs.borderBottomLeftRadius));
      case 'padX': return Math.round(parseFloat(cs.paddingLeft));
      case 'padY': return Math.round(parseFloat(cs.paddingTop));
      case 'gap': return Math.round(parseFloat(cs.columnGap)) || 0;
      case 'borderW': return Math.round(parseFloat(cs.borderTopWidth));
      case 'opacity': return Math.round(Number(cs.opacity) * 100);
    }
    return '';
  }

  /* ---------- theme helpers ---------- */
  const SHADES = /-(50|[1-9]00|950)$/;
  const tokens = () => Object.entries(S.theme?.colors || {}).filter(([k]) => !SHADES.test(k) && !['inherit', 'current'].includes(k));
  const swatchCss = (v) => String(v).replace('<alpha-value>', '1');
  // Token name currently used for a color property, read from the element's classes.
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
  const pick = (t) => t && t.closest && t.closest('[data-kerf],[data-kerf-use]');
  const defOf = (el) => el.getAttribute('data-kerf');
  const useOf = (el) => el.getAttribute('data-kerf-use');
  const fileName = (loc) => (loc || '').split(':')[0].split('/').pop();
  const activeLoc = () => (S.sel ? (S.scope === 'here' ? S.sel.use || S.sel.def : S.sel.def || S.sel.use) : null);
  const info = () => (S.sel ? (activeLoc() === S.sel.def ? S.sel.defInfo : S.sel.useInfo) : null);
  const sameLoc = (el) => {
    const d = defOf(el);
    return d ? document.querySelectorAll(`[data-kerf="${CSS.escape(d)}"]`) : document.querySelectorAll(`[data-kerf-use="${CSS.escape(useOf(el))}"]`);
  };

  async function select(el) {
    if (!el) { S.sel = null; S.cpick = null; renderPanel(); return; }
    const list = [...sameLoc(el)];
    S.sel = { el, def: defOf(el), use: useOf(el), idx: Math.max(0, list.indexOf(el)), repeat: list.length, defInfo: null, useInfo: null };
    if (!S.sel.def) S.scope = 'here';
    else if (!S.sel.use) S.scope = 'all';
    S.cpick = null;
    renderPanel();
    await loadInfo();
  }
  async function loadInfo() {
    const s = S.sel;
    if (!s) return;
    const [d, u] = await Promise.all([s.def ? api('/inspect', { loc: s.def }).catch((e) => ({ error: e.message })) : null, s.use ? api('/inspect', { loc: s.use }).catch((e) => ({ error: e.message })) : null]);
    if (S.sel !== s) return;
    s.defInfo = d;
    s.useInfo = u;
    renderPanel();
  }
  // After an edit the app re-renders and the element may be a new node: find it again.
  function refind() {
    const s = S.sel;
    if (!s || s.el.isConnected) return;
    const q = s.def ? `[data-kerf="${CSS.escape(s.def)}"]` : `[data-kerf-use="${CSS.escape(s.use)}"]`;
    const list = document.querySelectorAll(q);
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
        const sm = r.summary;
        const parts = [];
        if (sm.removed.length || sm.added.length) parts.push(`${sm.removed.join(' ') || '—'} → ${sm.added.join(' ')}`);
        if (sm.text) parts.push(`“${sm.text.to}”`);
        (sm.props || []).forEach((p) => parts.push(`${p.name}: ${p.from ?? 'default'} → ${p.to}`));
        toast(`${fileName(r.file)} · ${parts.join(' · ')}`, sm.offScale.length ? `Off your scale: ${sm.offScale.join(', ')}` : '');
      }
      afterEdit();
    } catch (e) {
      clearPreview();
      toast(e.message, '', true);
    }
    renderBar();
  }
  function afterEdit() {
    // Give Vite and Tailwind a moment to reload, then show the real result.
    [250, 700, 1500].forEach((ms) => setTimeout(() => { clearPreview(); refind(); loadInfo(); }, ms));
  }
  const pending = {};
  function commitSoon(prop, value) {
    clearTimeout(pending[prop]);
    pending[prop] = setTimeout(() => commit({ ops: [{ prop, value }] }), 450);
  }

  /* ---------- text editing on the canvas ---------- */
  function beginText() {
    const s = S.sel;
    const ti = info()?.text;
    if (!s || !ti) return;
    if (!ti.editable) { toast(ti.reason, '', true); return; }
    const el = s.el, orig = el.textContent;
    S.editing = el;
    el.contentEditable = 'true';
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
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

  /* ---------- ui ---------- */
  const host = document.createElement('kerf-ui');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS_TEXT()}</style>
    <div class="box hov" id="hov"><span class="tag"></span></div>
    <div id="sibs"></div>
    <div class="box sel" id="sel"><span class="tag"></span></div>
    <div id="amb"></div>
    <svg class="marks" id="marks" width="100%" height="100%"><g id="marksG"></g></svg>
    <div class="annoCap" id="annoCap" hidden></div>
    <div class="ask" id="ask" hidden></div>
    <div class="notePop" id="notePop" hidden></div>
    <div class="notesChip" id="notesChip" hidden></div>
    <div class="noteRes" id="noteRes" hidden></div>
    <aside class="panel" id="panel" hidden></aside>
    <div class="bar" id="bar"></div>
    <div class="pop" id="changes" hidden></div>
    <div class="toast" id="toast" hidden></div>
    <span class="probe" id="probe"></span>`;
  const $ = (id) => root.getElementById(id);
  (document.body || document.documentElement).appendChild(host);

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
    spark: '<path d="M8 1.7l1.5 4.2 4.2 1.5-4.2 1.5L8 13.1 6.5 8.9 2.3 7.4l4.2-1.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
    pen: '<path d="M3.4 10.9c-1.7-2.9.6-8 5.1-8 3.4 0 5.1 2.3 4.9 4.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M6.9 13.7l.45-2 5-5a1.15 1.15 0 0 1 1.6 1.6l-5 5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
    pin: '<path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="6.5" r="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    box: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>',
    circle: '<ellipse cx="8" cy="8" rx="5.5" ry="5" fill="none" stroke="currentColor" stroke-width="1.3"/>',
    arrow: '<path d="M3 13L13 3M7 3h6v6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const ico = (n, s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16" aria-hidden="true">${IC[n]}</svg>`;
  const cornerIco = (deg) => `<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><g transform="rotate(${deg} 8 8)">${IC.rad}</g></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function renderBar() {
    $('bar').innerHTML = `<span class="logo" title="Kerf">${ico('kerf', 16)}</span>
      <div class="modes">
        <button class="tb${S.mode === 'preview' ? ' on' : ''}" data-act="mode" data-v="preview" title="Preview · P">${ico('play', 16)}</button>
        <button class="tb${S.mode === 'edit' ? ' on' : ''}" data-act="mode" data-v="edit" title="Edit · E">${ico('edit', 16)}</button>
      </div>
      <span class="div"></span>
      ${S.mode === 'preview'
        ? `<button class="tb${S.askOpen ? ' on' : ''}" data-act="ask" title="Ask Kerf · ⌘K">${ico('spark', 16)}</button>`
        : `<button class="tb${S.tab === 'chat' ? ' on' : ''}" data-act="tab" data-v="${S.tab === 'chat' ? 'design' : 'chat'}" title="Chat with Kerf · ⌘K">${ico('spark', 16)}</button>`}
      <button class="tb${S.tool === 'annotate' ? ' on' : ''}" data-act="tool" data-v="annotate" title="Annotate · A">${ico('pen', 16)}</button>
      ${S.tool === 'annotate' ? `<div class="shapes">${['pin', 'box', 'circle', 'arrow'].map((k, i) => `<button class="tb sm${S.shape === k ? ' on' : ''}" data-act="shape" data-v="${k}" title="${k[0].toUpperCase() + k.slice(1)} · ${i + 1}">${ico(k, 14)}</button>`).join('')}</div>` : ''}
      <span class="div"></span>
      <button class="tb" data-act="undo" title="Undo last change · ⌘Z" ${S.count ? '' : 'disabled'}>${ico('undo', 16)}</button>
      <button class="tb wide" data-act="changes" title="Changes in this session">${ico('list', 16)}<span>${S.count}</span>${S.count ? '<i class="dot"></i>' : ''}</button>`;
  }

  /* panel building blocks */
  const val = (p) => read(p, S.sel?.el);
  const nf = (p, icon, title, unit) => `<label class="inp" title="${title}"><span class="ic" data-scrub="${p}">${icon.startsWith('<') ? icon : ico(icon, 12)}</span><input type="text" inputmode="decimal" data-prop="${p}" value="${esc(val(p))}" aria-label="${title}">${unit ? `<span class="u">${unit}</span>` : ''}</label>`;
  const sec = (title, body, act = '') => `<div class="sec"><div class="secH"><span>${title}</span>${act}</div>${body}</div>`;
  const hb = (act, icon, title, v = '') => `<button class="ib sm" data-act="${act}" data-v="${v}" title="${title}" aria-label="${title}">${ico(icon)}</button>`;
  function colorRow(p, title, removeAct) {
    const hex = val(p), tok = tokenOf(p), none = hex === 'transparent';
    let h = `<div class="cr"><label class="inp" title="${title}"><button class="chip${none ? ' none' : ''}" data-act="cpick" data-v="${p}" style="background:${none ? 'transparent' : hex}" aria-label="Choose ${title}"></button><input type="text" data-prop="${p}" data-color="1" value="${none ? '' : hex.replace('#', '')}" placeholder="None" spellcheck="false" aria-label="${title} hex"><span class="u">${esc(tok && !tok.startsWith('#') ? tok : '')}</span></label>${removeAct ? `<button class="ib" data-act="${removeAct}" title="Remove">${ico('minus')}</button>` : ''}</div>`;
    if (S.cpick === p) {
      h += `<div class="cpop"><div class="cpT">Project tokens</div><div class="toks">${tokens().map(([n, v]) => `<button data-act="token" data-p="${p}" data-v="${esc(n)}" title="${esc(n)}" class="${n === tok ? 'on' : ''}"><i style="background:${esc(swatchCss(v))}"></i><span>${esc(n)}</span></button>`).join('')}</div>
        <label class="cust"><input type="color" data-colorinput="${p}" value="${/^#[0-9A-F]{6}$/.test(hex) ? hex : '#FFFFFF'}"><span>Custom color</span><span class="u">off scale</span></label></div>`;
    }
    return h;
  }
  const isText = (el) => el && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const isLayout = (el) => el && /flex|grid/.test(getComputedStyle(el).display);

  function renderPanel() {
    const p = $('panel');
    p.hidden = S.mode !== 'edit';
    if (p.hidden) return;
    const tabs = `<div class="ptabs"><button data-act="tab" data-v="design" class="${S.tab === 'design' ? 'on' : ''}">Design</button><button data-act="tab" data-v="chat" class="${S.tab === 'chat' ? 'on' : ''}">Chat <span class="kbd">⌘K</span></button></div>`;
    if (S.tab === 'chat') {
      const draft = root.getElementById('chatIn')?.value || '';
      p.innerHTML = tabs + chatHTML();
      const cs = root.getElementById('chatScroll'); if (cs) cs.scrollTop = cs.scrollHeight;
      const ci = root.getElementById('chatIn'); if (ci) { ci.value = draft; ci.focus(); }
      return;
    }
    const s = S.sel;
    if (!s) {
      p.innerHTML = tabs + `<div class="empty"><b>Nothing selected</b><span>Click anything in your app to select it. Double-click text to retype it. Changes are written to your code.</span></div>`;
      return;
    }
    const el = s.el, inf = info();
    const name = (activeLoc() === s.use ? s.useInfo?.tag : s.defInfo?.tag) || el.tagName.toLowerCase();
    const loc = activeLoc();
    let h = `<div class="sec head"><div class="secH"><span class="nm">${ico(s.use ? 'comp' : 'frame')}${esc(name)}</span>${hb('parent', 'up', 'Select parent')}</div>
      <span class="path">${esc(loc.replace(/:(\d+):\d+$/, ':$1'))}</span>
      ${s.def && s.use ? `<div class="seg"><button data-act="scope" data-v="all" class="${S.scope === 'all' ? 'on' : ''}" title="Change the component itself: every place it's used">Everywhere</button><button data-act="scope" data-v="here" class="${S.scope === 'here' ? 'on' : ''}" title="Change only this use of the component">Only here</button></div>` : ''}
      ${s.repeat > 1 ? `<span class="note">Repeated ×${s.repeat} by the same code: edits apply to all of them.</span>` : ''}</div>`;
    if (!inf) h += `<div class="sec"><span class="note">Reading code…</span></div>`;
    else if (inf.error) h += `<div class="sec"><span class="note warn">${esc(inf.error)}</span></div>`;
    else {
      h += propsSection(inf);
      if (inf.classKind === 'dynamic') h += `<div class="sec"><span class="note warn">${esc(inf.classReason)}</span></div>`;
      if (inf.text?.editable) h += sec('Content', `<label class="inp"><input type="text" data-text="1" value="${esc(inf.text.value)}" aria-label="Text"></label>`);
      else if (isText(el)) h += sec('Content', `<span class="note">${esc(inf.text?.reason || '')}</span>`);
      if (isText(el) || inf.text?.editable) {
        const fam = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '');
        const fw = val('fontWeight');
        h += sec('Typography', `<label class="inp lock"><input type="text" value="${esc(fam)}" disabled></label>
          <div class="r2"><label class="inp"><select data-sel="fontWeight" aria-label="Weight">${[[100, 'Thin'], [200, 'Extra light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']].map(([v, n]) => `<option value="${v}"${v === fw ? ' selected' : ''}>${n}</option>`).join('')}</select>${ico('chev', 12)}</label>${nf('fontSize', '<b class="tg">T</b>', 'Font size')}</div>
          <div class="r2">${nf('lineHeight', 'lh', 'Line height')}${nf('letterSpacing', 'ls', 'Letter spacing', '%')}</div>
          <div class="r2"><div class="ibs">${[['left', 'alL'], ['center', 'alC'], ['right', 'alR']].map(([v, i]) => `<button class="ib${val('align') === v ? ' on' : ''}" data-act="set" data-p="align" data-v="${v}" title="Align ${v}">${ico(i)}</button>`).join('')}</div><span></span></div>`);
        h += sec('Text color', colorRow('color', 'Text color'));
      }
      h += sec(isLayout(el) ? 'Auto layout' : 'Padding', `${isLayout(el) ? `<div class="r2">${nf('gap', 'gap', 'Gap')}<span></span></div>` : ''}<div class="r2">${nf('padX', 'padH', 'Horizontal padding')}${nf('padY', 'padV', 'Vertical padding')}</div>`);
      h += sec('Appearance', `<div class="r2c">${nf('opacity', 'opa', 'Opacity', '%')}${nf('radius', 'rad', 'Corner radius')}<button class="ib${S.corners ? ' on' : ''}" data-act="corners" title="Independent corners">${ico('corners')}</button></div>
        ${S.corners ? `<div class="r4">${nf('rTL', cornerIco(0), 'Top left')}${nf('rTR', cornerIco(90), 'Top right')}${nf('rBR', cornerIco(180), 'Bottom right')}${nf('rBL', cornerIco(270), 'Bottom left')}</div>` : ''}`);
      const hasFill = val('bg') && val('bg') !== 'transparent';
      h += sec('Fill', hasFill ? colorRow('bg', 'Fill', 'rmFill') : '', hasFill ? '' : hb('addFill', 'plus', 'Add fill'));
      const hasStroke = val('borderW') > 0;
      h += sec('Stroke', hasStroke ? colorRow('borderC', 'Stroke color', 'rmStroke') + `<div class="r2">${nf('borderW', 'sw', 'Stroke width')}<span></span></div>` : '', hasStroke ? '' : hb('addStroke', 'plus', 'Add stroke'));
      const sh = shadowOf(), keys = (S.theme?.shadow || []).filter((k) => k !== 'none' && k !== 'inner');
      h += sec('Effects', sh !== 'none' ? `<div class="cr"><label class="inp"><select data-sel="shadow">${keys.map((k) => `<option value="${esc(k)}"${k === sh ? ' selected' : ''}>Shadow · ${k === 'DEFAULT' ? 'default' : esc(k)}</option>`).join('')}</select>${ico('chev', 12)}</label><button class="ib" data-act="set" data-p="shadow" data-v="none" title="Remove">${ico('minus')}</button></div>` : '', sh !== 'none' ? '' : hb('set', 'plus', 'Add shadow', 'sm').replace('data-act="set"', 'data-act="set" data-p="shadow"'));
    }
    const st = p.querySelector('.scroll')?.scrollTop || 0;
    p.innerHTML = tabs + `<div class="scroll">${h}</div>`;
    p.querySelector('.scroll').scrollTop = st;
  }

  async function renderChanges() {
    const c = $('changes');
    c.hidden = !S.changesOpen;
    if (c.hidden) return;
    try { S.changes = await api('/changes'); } catch { S.changes = []; }
    c.innerHTML = `<div class="secH"><span>Changes this session</span>${hb('changes', 'x', 'Close')}</div>` + (S.changes.length
      ? S.changes.slice().reverse().map((x) => `<div class="chg"><span class="mono">${esc(x.file)}</span><span>${esc([x.summary.removed.join(' '), x.summary.added.join(' ')].filter(Boolean).join(' → ') || '')}${x.summary.text ? ` “${esc(x.summary.text.to)}”` : ''}</span></div>`).join('')
      : '<span class="note">No changes yet.</span>');
  }

  let toastT;
  function toast(msg, sub, err) {
    const t = $('toast');
    t.hidden = false;
    t.className = 'toast' + (err ? ' err' : '');
    t.innerHTML = `<span class="mono">${esc(msg)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}`;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), err ? 6000 : 3500);
  }

  function setMode(m) {
    S.mode = m;
    if (m === 'preview') { S.sel = null; S.hover = null; S.changesOpen = false; renderChanges(); }
    if (m === 'edit') S.askOpen = false;
    renderBar();
    renderPanel();
    renderAsk();
  }

  /* ---------- outlines follow the page ---------- */
  function place(box, el, label) {
    if (!el || !el.isConnected) { box.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.transform = `translate(${r.left}px,${r.top}px)`;
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    if (label != null) box.querySelector('.tag').textContent = label;
  }
  function loop() {
    refind();
    const edit = S.mode === 'edit';
    place($('hov'), edit && S.hover !== S.sel?.el ? S.hover : null, S.hover ? labelOf(S.hover) : '');
    place($('sel'), edit ? S.sel?.el : null, S.sel ? labelOf(S.sel.el) : '');
    const sibs = $('sibs');
    const list = edit && S.sel && S.sel.repeat > 1 ? [...sameLoc(S.sel.el)].filter((x) => x !== S.sel.el).slice(0, 60) : [];
    while (sibs.children.length < list.length) { const d = document.createElement('div'); d.className = 'box sib'; d.innerHTML = '<span class="tag"></span>'; sibs.appendChild(d); }
    [...sibs.children].forEach((b, i) => place(b, list[i] || null, null));
    const amb = $('amb');
    const aEls = (S.amber || []).flatMap((loc) => [...document.querySelectorAll(`[data-kerf="${CSS.escape(loc)}"],[data-kerf-use="${CSS.escape(loc)}"]`)]).slice(0, 60);
    while (amb.children.length < aEls.length) { const d = document.createElement('div'); d.className = 'box amber'; d.innerHTML = '<span class="tag"></span>'; amb.appendChild(d); }
    [...amb.children].forEach((b, i) => place(b, aEls[i] || null, null));
    $('marksG').setAttribute('transform', `translate(${-scrollX} ${-scrollY})`);
    if (S.noteDraft && !$('notePop').hidden) renderMarks();
    requestAnimationFrame(loop);
  }
  const labelOf = (el) => {
    const u = useOf(el), d = defOf(el);
    return `${el.tagName.toLowerCase()} · ${fileName(u || d)}`;
  };

  /* ---------- events: app page ---------- */
  const inUI = (e) => e.composedPath().includes(host);
  const block = (e) => {
    if (S.mode !== 'edit' || inUI(e)) return;
    if (S.editing && S.editing.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'touchstart', 'submit', 'contextmenu'].forEach((t) => window.addEventListener(t, block, true));
  let lastClick = null;
  window.addEventListener('click', (e) => {
    if (S.mode !== 'edit' || inUI(e)) return;
    if (S.editing && S.editing.contains(e.target)) return;
    block(e);
    // A click on a <label> makes the browser click its input too: ignore that echo.
    const now = performance.now();
    if (lastClick && now - lastClick.t < 80 && lastClick.el !== e.target && !lastClick.el.contains(e.target)) return;
    lastClick = { el: e.target, t: now };
    const el = pick(e.target);
    if (S.editing) S.editing.blur();
    select(el);
  }, true);
  window.addEventListener('dblclick', (e) => {
    if (S.mode !== 'edit' || inUI(e)) return;
    block(e);
    if (S.sel && S.sel.el.contains(e.target)) beginText();
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (S.mode !== 'edit' || inUI(e)) { S.hover = null; return; }
    S.hover = pick(e.target);
  }, true);
  window.addEventListener('keydown', (e) => {
    const t = e.composedPath()[0];
    const typing = t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
    if (typing) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (S.mode === 'edit') { S.tab = 'chat'; renderPanel(); renderBar(); } else { S.askOpen = true; renderAsk(); renderBar(); }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && S.mode === 'edit') { e.preventDefault(); undo(); return; }
    if (e.key === 'Escape' && (S.noteDraft || S.tool === 'annotate' || S.askOpen)) {
      e.preventDefault();
      if (S.noteDraft) { S.noteDraft = null; renderMarks(); } else if (S.tool === 'annotate') setTool('select'); else { S.askOpen = false; S.amber = []; renderAsk(); renderBar(); }
      return;
    }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); setTool(S.tool === 'annotate' ? 'select' : 'annotate'); return; }
    if (S.tool === 'annotate' && ['1', '2', '3', '4'].includes(e.key)) { S.shape = ['pin', 'box', 'circle', 'arrow'][+e.key - 1]; renderBar(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'e' || e.key === 'E') setMode('edit');
    else if (e.key === 'p' || e.key === 'P') setMode('preview');
    else if (S.mode !== 'edit') return;
    else if (e.key === 'Escape') { if (S.cpick) { S.cpick = null; renderPanel(); } else if (S.sel) select(null); else setMode('preview'); }
    else if (e.key === 'Enter' && S.sel) { e.preventDefault(); beginText(); }
    else return;
    e.preventDefault();
  }, true);

  async function undo() {
    try {
      const r = await api('/undo', {});
      if (r.undone) { S.count = r.n; toast(`Undone in ${fileName(r.file)}`); afterEdit(); renderBar(); renderChanges(); }
    } catch (e) { toast(e.message, '', true); }
  }

  /* ---------- events: Kerf UI ---------- */
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) { if (S.cpick && !e.target.closest('.cpop')) { S.cpick = null; renderPanel(); } return; }
    const act = a.dataset.act, v = a.dataset.v;
    switch (act) {
      case 'mode': setMode(v); break;
      case 'undo': undo(); break;
      case 'changes': S.changesOpen = !S.changesOpen; renderChanges(); break;
      case 'scope': S.scope = v; S.cpick = null; renderPanel(); break;
      case 'parent': { const p = S.sel && pick(S.sel.el.parentElement); if (p) select(p); break; }
      case 'corners': S.corners = !S.corners; renderPanel(); break;
      case 'cpick': S.cpick = S.cpick === v ? null : v; renderPanel(); break;
      case 'token': commit({ ops: [{ prop: a.dataset.p, value: v }] }); break;
      case 'set': commit({ ops: [{ prop: a.dataset.p, value: v }] }); break;
      case 'addFill': commit({ ops: [{ prop: 'bg', value: tokens().find(([n]) => n === 'surface')?.[0] || 'white' }] }); break;
      case 'rmFill': S.cpick = null; commit({ ops: [{ prop: 'bg', value: 'transparent' }] }); break;
      case 'addStroke': commit({ ops: [{ prop: 'borderW', value: 1 }, { prop: 'borderC', value: tokens().find(([n]) => n === 'border')?.[0] || 'black' }] }); break;
      case 'rmStroke': S.cpick = null; commit({ ops: [{ prop: 'borderW', value: 0 }] }); break;
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
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
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.colorinput && S.sel) preview(S.sel.el, t.dataset.colorinput, t.value);
  });
  root.addEventListener('keydown', (e) => {
    const t = e.target, p = t.dataset && t.dataset.prop;
    e.stopPropagation();
    if (!p || t.dataset.color || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const n = clamp(p, (parseFloat(t.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
    t.value = n;
    preview(S.sel.el, p, n);
    commitSoon(p, n);
  });
  // Drag a field's icon to scrub its value, like Figma. Preview live, write once on release.
  let scrub = null;
  root.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-scrub]');
    if (!h || !S.sel) return;
    e.preventDefault();
    const p = h.dataset.scrub;
    scrub = { p, x: e.clientX, v: parseFloat(val(p)) || 0, input: h.parentElement.querySelector('input'), n: null };
    host.style.cursor = 'ew-resize';
  });
  window.addEventListener('pointermove', (e) => {
    if (!scrub) return;
    const n = clamp(scrub.p, Math.round(scrub.v + (e.clientX - scrub.x) / 2));
    scrub.n = n;
    scrub.input.value = n;
    preview(S.sel.el, scrub.p, n);
  });
  window.addEventListener('pointerup', () => {
    if (!scrub) return;
    const s = scrub;
    scrub = null;
    host.style.cursor = '';
    if (s.n != null && s.n !== s.v) commit({ ops: [{ prop: s.p, value: s.n }] });
  });

  /* ---------- AI: Ask bar, chat, annotations ---------- */
  const PROP_NAMES = { bg: 'Fill', color: 'Text color', borderC: 'Stroke color', fontSize: 'Size', fontWeight: 'Weight', lineHeight: 'Line height', letterSpacing: 'Letter spacing', align: 'Align', radius: 'Radius', rTL: 'Top-left corner', rTR: 'Top-right corner', rBR: 'Bottom-right corner', rBL: 'Bottom-left corner', padX: 'Padding X', padY: 'Padding Y', gap: 'Gap', borderW: 'Stroke', opacity: 'Opacity', shadow: 'Shadow' };
  const UNIT = { fontSize: 'px', lineHeight: 'px', radius: 'px', rTL: 'px', rTR: 'px', rBR: 'px', rBL: 'px', padX: 'px', padY: 'px', gap: 'px', borderW: 'px', opacity: '%', letterSpacing: '%' };
  const opLabel = (o) => `${PROP_NAMES[o.prop] || o.prop} ${o.value}${UNIT[o.prop] || ''}`;
  const editLabel = (e) => [...e.ops.map(opLabel), ...(e.props || []).map((p) => `${p.name}: ${p.value}`), ...(e.text ? [`“${e.text}”`] : [])].join(' · ');

  Object.assign(S, { tab: 'design', chat: [], tool: 'select', shape: 'box', notes: [], noteDraft: null, amber: [], askOpen: false, card: null });

  function measure(el) {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, color: rgbHex(cs.color), fill: rgbHex(cs.backgroundColor), radius: cs.borderTopLeftRadius, padding: cs.padding, display: cs.display };
  }
  function targetOf(el, note) {
    const def = defOf(el), use = useOf(el);
    // Component usages (icons, buttons) carry their properties at the use site.
    const loc = use && (!def || el.tagName.toLowerCase() === 'svg') ? use : def || use;
    return { loc, shared: !!(def && use), measured: measure(el), text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100), note };
  }
  function uniq(list) {
    const seen = new Set(), out = [];
    for (const t of list) if (t.loc && !seen.has(t.loc)) { seen.add(t.loc); out.push(t); }
    return out;
  }
  const tagged = (root = document) => [...root.querySelectorAll('[data-kerf],[data-kerf-use]')];
  const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  const visibleTargets = () => uniq(tagged().filter(onScreen).map((el) => targetOf(el))).slice(0, 80);
  function selectionTargets() {
    const el = S.sel.el, out = [targetOf(el)];
    if (activeLoc() !== out[0].loc) out.unshift({ ...out[0], loc: activeLoc() });
    let p = el.parentElement;
    for (let i = 0; p && i < 2; p = p.parentElement) { const q = pick(p); if (q) { out.push(targetOf(q)); p = q; i++; } }
    tagged(el).slice(0, 30).forEach((c) => out.push(targetOf(c)));
    return uniq(out);
  }
  // Elements under a note's mark: what's at the point, plus what sits inside a box or circle.
  function noteTargets(n, i) {
    const pts = n.shape === 'pin' ? [[n.x, n.y]] : n.shape === 'arrow' ? [[n.x2, n.y2]] : [[n.x + n.w / 2, n.y + n.h / 2]];
    const els = [];
    for (const [px, py] of pts) document.elementsFromPoint(px - scrollX, py - scrollY).map(pick).filter(Boolean).slice(0, 3).forEach((e) => els.push(e));
    if (n.shape === 'box' || n.shape === 'circle') {
      tagged().forEach((el) => {
        const r = el.getBoundingClientRect(), cx = r.left + r.width / 2 + scrollX, cy = r.top + r.height / 2 + scrollY;
        if (cx >= n.x && cx <= n.x + n.w && cy >= n.y && cy <= n.y + n.h) els.push(el);
      });
    }
    return uniq(els.map((el) => targetOf(el, i + 1))).slice(0, 20);
  }

  /* One conversation shared by the Ask bar, notes and chat */
  function historyFor() {
    const h = [];
    for (const m of S.chat) {
      if (m.role === 'user') h.push({ role: 'user', text: m.text });
      else if (m.error) h.push({ role: 'assistant', text: `(error) ${m.error}` });
      else if (m.proposal) h.push({ role: 'assistant', text: `${m.proposal.message}\nProposed: ${m.proposal.edits.map((e) => `${e.tag} ${editLabel(e)}`).join('; ') || 'no edits'}\nStatus: ${m.status}` });
    }
    // Keep strict user/assistant alternation.
    return h.filter((x, i) => !(i > 0 && h[i - 1].role === x.role));
  }
  async function runAI(text, targets, where, shown, followUp) {
    text = String(text || '').trim();
    if (!text || S.card?.busy) return;
    const history = historyFor();
    const ctx = followUp ? 'Follow-up' : where === 'chat' && S.sel ? ((S.sel.use ? S.sel.useInfo?.tag : S.sel.defInfo?.tag) || S.sel.el.tagName.toLowerCase()) : where === 'notes' ? `${S.notes.length} note${S.notes.length === 1 ? '' : 's'}` : 'Whole screen';
    S.chat.push({ role: 'user', text, shown: shown || text, ctx, where });
    const m = { role: 'kerf', busy: true, status: 'pending', where, targets };
    S.chat.push(m);
    S.card = m;
    renderAll();
    try {
      m.proposal = await api('/ai', { request: text, targets, history });
      S.amber = m.proposal.edits.map((e) => e.loc);
      if (!m.proposal.edits.length) m.status = 'info';
    } catch (e) { m.error = e.message; }
    m.busy = false;
    renderAll();
  }
  async function decide(m, v) {
    if (!m || m.status !== 'pending') return;
    S.amber = [];
    if (v === 'apply') {
      const r = await api('/ai/apply', { edits: m.proposal.edits }).catch((e) => ({ error: e.message }));
      if (r.error) { toast(r.error, '', true); return; }
      const ok = r.results.filter((x) => x.ok && x.changed).length, bad = r.results.filter((x) => !x.ok);
      S.count = r.n;
      m.status = ok ? 'applied' : 'failed';
      toast(`Applied ${ok} change${ok === 1 ? '' : 's'}`, bad.length ? `${bad.length} skipped: ${bad[0].error}` : '', !!bad.length && !ok);
      if (m.where === 'notes' && ok) S.notes = [];
      afterEdit();
    } else m.status = 'discarded';
    renderAll();
  }
  const STATUS = { applied: 'Applied', discarded: 'Discarded', failed: 'Couldn’t apply', info: '' };
  function kerfHTML(m, i) {
    if (m.busy) return `<div class="prop"><div class="kerfSays"><i class="spin"></i><span class="note">Kerf is reading the code…</span></div></div>`;
    if (m.error) return `<div class="prop err"><span class="note warn">${esc(m.error)}</span></div>`;
    const p = m.proposal;
    const badge = { partial: 'Partly possible', not_yet: 'Not possible in Kerf yet', needs_developer: 'For developers' }[p.scope];
    return `<div class="prop"><div class="kerfSays"><i class="dotA"></i><span>${badge ? `<b class="badge">${badge}</b> ` : ''}${esc(p.message)}</span></div>
      ${p.edits.length ? `<div class="edits">${p.edits.map((e) => `<div class="ed"><b>${esc(e.tag)}</b><span>${esc(e.why)}</span><span class="mono">${esc(editLabel(e))}</span></div>`).join('')}</div>` : ''}
      ${m.status === 'pending' ? `<div class="acts"><button class="ghostBtn" data-act="decide" data-i="${i}" data-v="discard">Discard</button><button class="amberBtn" data-act="decide" data-i="${i}" data-v="apply">Apply ${p.edits.length} change${p.edits.length === 1 ? '' : 's'}</button></div>` : STATUS[m.status] ? `<span class="note">${STATUS[m.status]}</span>` : ''}</div>`;
  }
  const replyForm = (where) => `<form class="reply" data-form="reply" data-where="${where}"><input id="replyIn" placeholder="Reply to Kerf…" autocomplete="off" aria-label="Reply to Kerf"><button class="sendB" aria-label="Send">${ico('up', 14)}</button></form>`;

  /* Ask bar (Preview) */
  function renderAsk() {
    const a = $('ask');
    a.hidden = !(S.askOpen && S.mode === 'preview');
    if (a.hidden) return;
    const m = S.card && S.card.where === 'ask' ? S.card : null;
    if (m) {
      a.innerHTML = `<div class="cardTop"><span class="note">Kerf</span>${hb('closeCard', 'x', 'Close')}</div>${kerfHTML(m, S.chat.indexOf(m))}${m.busy ? '' : replyForm('ask')}`;
      if (!m.busy) setTimeout(() => root.getElementById('replyIn')?.focus(), 0);
    } else {
      a.innerHTML = `<form class="askF" data-form="ask"><span class="spark">${ico('spark', 16)}</span><input id="askIn" placeholder="Ask Kerf to change something on this screen" autocomplete="off" aria-label="Ask Kerf"><button class="sendB" aria-label="Send">${ico('up', 14)}</button></form>
        <div class="askHints">${['Make this page feel more premium', 'Make the text easier to read', 'Tighten the spacing'].map((s) => `<button data-act="askHint" data-v="${s}">${s}</button>`).join('')}</div>`;
      setTimeout(() => root.getElementById('askIn')?.focus(), 0);
    }
  }

  /* Chat (Edit, ⌘K) */
  function chatHTML() {
    const ctx = S.sel ? `${esc((S.sel.use ? S.sel.useInfo?.tag : S.sel.defInfo?.tag) || S.sel.el.tagName.toLowerCase())} · ${esc(fileName(activeLoc()))}` : 'Whole screen';
    const msgs = S.chat.map((m, i) => m.role === 'user'
      ? `<div class="uMsg"><span class="ctx">${esc(m.ctx)}</span><div class="bub">${esc(m.shown || m.text)}</div></div>`
      : `<div class="kMsg">${kerfHTML(m, i)}</div>`).join('');
    return `<div class="chatScroll" id="chatScroll">${msgs || `<div class="empty"><b>Talk to Kerf</b><span>Select an element and describe the change, like “make these icons lighter”. Kerf reads the code, proposes edits in amber, and you approve them. Ask, notes and chat share this one conversation, so you can follow up here.</span></div>`}</div>
      <form class="comp" data-form="chat"><span class="ctx">${ctx}</span><textarea id="chatIn" rows="2" placeholder="Describe a change, or follow up…" aria-label="Message Kerf"></textarea><button class="sendB" aria-label="Send">${ico('up', 14)}</button></form>`;
  }

  /* Annotations */
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
    if (!chip.hidden) chip.innerHTML = `<span>${S.notes.length} note${S.notes.length === 1 ? '' : 's'}</span><button class="ghostBtn" data-act="notesClear">Clear</button><button class="lightBtn" data-act="notesApply" ${busy ? 'disabled' : ''}>${busy ? '<i class="spin dark"></i>Reading…' : `${ico('spark', 14)}Apply ${S.notes.length > 1 ? 'all ' + S.notes.length : 'note'}`}</button>`;
    const pop = $('notePop');
    pop.hidden = !S.noteDraft;
    if (S.noteDraft) {
      const n = S.noteDraft, x = Math.min(innerWidth - 340, Math.max(12, (n.shape === 'arrow' ? n.x2 : n.x + (n.w || 0)) - scrollX + 12)), y = Math.min(innerHeight - 200, Math.max(12, (n.shape === 'arrow' ? n.y2 : n.y) - scrollY));
      pop.style.transform = `translate(${x}px,${y}px)`;
      if (!pop.dataset.open) {
        pop.innerHTML = `<div class="secH"><span>Note ${S.notes.length + 1}</span>${hb('noteDiscard', 'x', 'Discard')}</div><textarea id="noteIn" rows="3" placeholder="What should change here?"></textarea><div class="acts"><span class="note">Kerf will read the code under this mark.</span><button class="lightBtn" data-act="noteAdd">Add note</button></div>`;
        pop.dataset.open = '1';
        setTimeout(() => root.getElementById('noteIn')?.focus(), 0);
      }
    } else delete pop.dataset.open;
    const res = $('noteRes');
    const m = S.card && S.card.where === 'notes' && !S.card.busy ? S.card : null;
    res.hidden = !m;
    if (m) res.innerHTML = `<div class="cardTop"><span class="note">Kerf · notes</span>${hb('closeCard', 'x', 'Close')}</div>${kerfHTML(m, S.chat.indexOf(m))}${replyForm('notes')}`;
  }
  function renderAll() {
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
  root.addEventListener('pointerdown', (e) => {
    if (S.tool !== 'annotate' || e.target.id !== 'annoCap') return;
    e.preventDefault();
    S.noteDraft = null;
    draw = { x: e.clientX + scrollX, y: e.clientY + scrollY };
  });
  window.addEventListener('pointermove', (e) => {
    if (!draw) return;
    const x2 = e.clientX + scrollX, y2 = e.clientY + scrollY;
    S.noteDraft = S.shape === 'pin' ? { shape: 'pin', x: x2, y: y2 } : S.shape === 'arrow' ? { shape: 'arrow', x: draw.x, y: draw.y, x2, y2 } : { shape: S.shape, x: Math.min(draw.x, x2), y: Math.min(draw.y, y2), w: Math.abs(x2 - draw.x), h: Math.abs(y2 - draw.y) };
    renderMarks();
  });
  window.addEventListener('pointerup', () => {
    if (!draw) return;
    const d = S.noteDraft;
    if (!d || (d.shape !== 'pin' && d.shape !== 'arrow' && d.w < 8 && d.h < 8) || (d.shape === 'arrow' && Math.hypot(d.x2 - d.x, d.y2 - d.y) < 8)) S.noteDraft = { shape: 'pin', x: draw.x, y: draw.y };
    draw = null;
    renderMarks();
  });
  function addNote() {
    const v = (root.getElementById('noteIn')?.value || '').trim();
    if (!v) return;
    S.notes.push({ ...S.noteDraft, text: v });
    S.noteDraft = null;
    renderMarks();
  }
  function setTool(t) {
    S.tool = t;
    S.noteDraft = null;
    if (t === 'annotate') { S.hover = null; S.askOpen = false; }
    renderBar(); renderMarks(); renderAsk();
  }

  /* AI-specific clicks, forms and keys */
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act, v = a.dataset.v;
    if (act === 'ask') { S.askOpen = !S.askOpen; if (S.card?.where === 'ask' && !S.card.busy && S.card.status !== 'pending') S.card = null; renderAsk(); renderBar(); }
    else if (act === 'askHint') runAI(v, visibleTargets(), 'ask');
    else if (act === 'decide') decide(S.chat[+a.dataset.i], v);
    else if (act === 'closeCard') { if (S.card?.status === 'pending') S.card.status = 'discarded'; S.card = null; S.amber = []; renderAll(); }
    else if (act === 'tab') { S.tab = v; renderPanel(); renderBar(); }
    else if (act === 'tool') setTool(S.tool === v ? 'select' : v);
    else if (act === 'shape') { S.shape = v; renderBar(); }
    else if (act === 'noteAdd') addNote();
    else if (act === 'noteDiscard') { S.noteDraft = null; renderMarks(); }
    else if (act === 'notesClear') { S.notes = []; if (S.card?.where === 'notes') S.card = null; S.amber = []; renderMarks(); }
    else if (act === 'notesApply') applyNotes();
    else if (act === 'setProp') commitProp(a.dataset.p, v);
  });
  function commitProp(name, value) { commit({ props: [{ name, value }] }); }
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.dataset.form;
    if (f === 'ask') runAI(root.getElementById('askIn').value, visibleTargets(), 'ask');
    if (f === 'chat') { const t = root.getElementById('chatIn'); const v = t.value; t.value = ''; runAI(v, S.sel ? selectionTargets() : visibleTargets(), 'chat'); }
    if (f === 'reply') {
      const v = root.getElementById('replyIn').value, where = e.target.dataset.where;
      const prev = S.card;
      runAI(v, where === 'notes' && prev?.targets ? prev.targets : visibleTargets(), where, v, true);
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.propsel) commitProp(t.dataset.propsel, t.value);
    if (t.dataset.propnum) { const n = parseFloat(t.value); if (isFinite(n)) commitProp(t.dataset.propnum, n); }
    if (t.dataset.proptext) commitProp(t.dataset.proptext, t.value);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.target.id === 'chatIn') { e.preventDefault(); const v = e.target.value; e.target.value = ''; runAI(v, S.sel ? selectionTargets() : visibleTargets(), 'chat'); }
    if (e.target.id === 'noteIn') { e.preventDefault(); addNote(); }
  });
  // Component properties section for the Design panel.
  function propsSection(inf) {
    if (!inf?.component || !inf.props?.length) return '';
    const rows = inf.props.map((p) => {
      let ctl;
      if (!p.editable) ctl = `<label class="inp lock" title="${esc(p.reason)}"><input value="set by code" disabled></label>`;
      else if (p.kind === 'option') ctl = `<label class="inp"><select data-propsel="${esc(p.name)}">${p.value == null ? '<option value="" selected>Default</option>' : ''}${p.options.map((o) => `<option${o === p.value ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>${ico('chev', 12)}</label>`;
      else if (p.kind === 'boolean') ctl = `<div class="seg"><button data-act="setProp" data-p="${esc(p.name)}" data-v="false" class="${p.value === false || p.value == null ? 'on' : ''}">Off</button><button data-act="setProp" data-p="${esc(p.name)}" data-v="true" class="${p.value === true ? 'on' : ''}">On</button></div>`;
      else if (p.kind === 'number') ctl = `<label class="inp"><input type="text" inputmode="decimal" data-propnum="${esc(p.name)}" value="${p.value ?? ''}" placeholder="Default"></label>`;
      else ctl = `<label class="inp"><input type="text" data-proptext="${esc(p.name)}" value="${esc(p.value)}"></label>`;
      return `<div class="kv"><span>${esc(p.name)}</span>${ctl}</div>`;
    }).join('');
    return sec(`Properties${inf.lib ? ` <span class="note">${esc(inf.lib.replace(/^@/, '').split('/')[0])}</span>` : ''}`, rows);
  }

  /* ---------- start ---------- */
  api('/theme').then((t) => { S.theme = t; renderPanel(); }).catch(() => {});
  api('/changes').then((c) => { S.count = c.length; renderBar(); }).catch(() => {});
  renderBar();
  renderPanel();
  requestAnimationFrame(loop);

  function CSS_TEXT() {
    return `
:host{all:initial}
*{box-sizing:border-box}
.box{position:fixed;left:0;top:0;display:none;pointer-events:none;border-radius:2px}
.hov{outline:1px solid rgba(43,102,217,.75)}
.sel{outline:1.5px solid #2B66D9}
.sib{outline:1px dashed rgba(43,102,217,.55)}
.tag{position:absolute;left:-1px;top:-21px;padding:2px 6px;border-radius:4px;background:#2B66D9;color:#fff;font:500 11px/14px Geist,ui-sans-serif,system-ui,sans-serif;white-space:nowrap}
.hov .tag{background:rgba(43,102,217,.85)}
.sib .tag{display:none}
.bar,.panel,.toast,.pop{pointer-events:auto;font:400 12px/16px Geist,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#EDEDF0;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;cursor:pointer}
.bar{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);display:flex;align-items:center;gap:2px;padding:6px;background:#2D2D32;border:1px solid #3A3A40;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.logo{display:grid;place-items:center;width:32px;height:36px;color:#EDEDF0}
.modes{display:flex;gap:2px;padding:2px;background:#1B1B1E;border-radius:10px}
.tb{display:grid;place-items:center;width:36px;height:36px;background:transparent;border:0;border-radius:8px;color:#B0B0BA;position:relative}
.tb:hover{background:#3A3A40;color:#EDEDF0}
.tb.on{background:#2B66D9;color:#fff}
.modes .tb.on{background:#3A3A40;color:#EDEDF0}
.tb[disabled]{opacity:.35;cursor:default}
.tb.wide{width:auto;display:flex;gap:6px;padding:0 10px}
.tb .dot,.dot{position:absolute;top:7px;right:6px;width:6px;height:6px;border-radius:3px;background:#E9B547}
.div{width:1px;height:28px;margin:0 6px;background:#3A3A40}
.panel{position:fixed;top:12px;right:12px;bottom:12px;width:264px;background:#232327;border:1px solid #3A3A40;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);overflow:hidden;display:flex;flex-direction:column}
.panel[hidden],.toast[hidden],.pop[hidden]{display:none}
.scroll{overflow:auto;flex:1;scrollbar-width:thin}
.empty{display:flex;flex-direction:column;gap:6px;padding:16px;color:#8B8B95;line-height:18px}
.empty b{color:#EDEDF0;font-weight:500}
.sec{display:flex;flex-direction:column;gap:8px;padding:12px;border-bottom:1px solid #3A3A40}
.secH{display:flex;align-items:center;justify-content:space-between;min-height:16px;font-weight:600;font-size:11px}
.head .nm{display:flex;align-items:center;gap:6px;font-size:13px;line-height:18px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.path{color:#8B8B95;font:400 11px/14px 'Geist Mono',ui-monospace,monospace;margin-top:-4px;word-break:break-all}
.note{color:#8B8B95;line-height:16px}
.note.warn{color:#E9B547}
.r2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.r2c{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 28px;gap:8px}
.r4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.cr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px;align-items:center}
.inp{display:flex;align-items:center;gap:6px;height:28px;padding:0 8px;background:#2D2D32;border:1px solid transparent;border-radius:5px;min-width:0;position:relative}
.inp:hover{border-color:#3A3A40}
.inp:focus-within{border-color:#2B66D9}
.inp .ic{flex:0 0 auto;display:grid;place-items:center;min-width:12px;color:#8B8B95;cursor:ew-resize;user-select:none}
.inp .tg{font:600 11px/1 Geist,system-ui,sans-serif}
.inp input,.inp select{flex:1;min-width:0;width:100%;height:100%;padding:0;background:transparent;border:0;outline:none;color:#EDEDF0;font:inherit}
.inp select{appearance:none;-webkit-appearance:none;cursor:pointer}
.inp select option{background:#232327}
.inp svg{flex:0 0 auto;color:#8B8B95}
.inp .u{flex:0 0 auto;color:#8B8B95;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.inp.lock{background:transparent;border-color:#3A3A40}
.inp.lock input{color:#B0B0BA}
.ib{display:grid;place-items:center;width:28px;height:28px;padding:0;background:transparent;border:0;border-radius:5px;color:#B0B0BA}
.ib:hover{background:#2D2D32;color:#EDEDF0}
.ib.on{background:#3A3A40;color:#EDEDF0}
.ib.sm{width:22px;height:22px;margin:-3px -4px -3px 0}
.ibs{display:flex;gap:2px;padding:2px;height:28px;background:#2D2D32;border-radius:6px}
.ibs .ib{flex:1;width:auto;height:24px;border-radius:4px}
.seg{display:flex;gap:2px;padding:2px;background:#2D2D32;border-radius:6px}
.seg button{flex:1;height:24px;border:0;border-radius:4px;background:transparent;color:#B0B0BA;font-weight:500}
.seg button.on{background:#3A3A40;color:#EDEDF0}
.chip{flex:0 0 auto;width:14px;height:14px;padding:0;border-radius:3px;border:1px solid rgba(255,255,255,.16)}
.chip.none{background:linear-gradient(135deg,transparent 45%,#F06A5F 45%,#F06A5F 55%,transparent 55%)!important}
.cpop{display:flex;flex-direction:column;gap:8px;padding:8px;background:#2D2D32;border:1px solid #3A3A40;border-radius:8px}
.cpT{color:#8B8B95;font-size:11px}
.toks{display:flex;flex-direction:column;max-height:220px;overflow:auto}
.toks button{display:flex;align-items:center;gap:8px;height:26px;padding:0 6px;border:0;border-radius:4px;background:transparent;color:#B0B0BA;text-align:left}
.toks button:hover{background:#3A3A40;color:#EDEDF0}
.toks button.on{color:#EDEDF0;box-shadow:inset 0 0 0 1px #2B66D9}
.toks i{width:14px;height:14px;border-radius:3px;border:1px solid rgba(255,255,255,.16);flex:0 0 auto}
.cust{display:flex;align-items:center;gap:8px;color:#B0B0BA;cursor:pointer}
.cust input{width:20px;height:20px;padding:0;border:0;background:none}
.cust .u{margin-left:auto;color:#8B8B95;font-size:11px}
.toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);display:flex;flex-direction:column;gap:2px;max-width:min(560px,80vw);padding:8px 12px;background:#2D2D32;border:1px solid #3A3A40;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.toast.err{border-color:#F06A5F}
.toast .sub{color:#E9B547}
.mono{font:400 11px/16px 'Geist Mono',ui-monospace,monospace}
.pop{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);width:420px;max-height:50vh;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:12px;background:#232327;border:1px solid #3A3A40;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.chg{display:flex;flex-direction:column;gap:2px;padding:6px 0;border-top:1px solid #3A3A40}
.chg span:last-child{color:#B0B0BA;font:400 11px/16px 'Geist Mono',ui-monospace,monospace}
.probe{display:none}
.amber{outline:1.5px dashed #E9B547;outline-offset:2px}
.amber .tag{display:none}
.marks{position:fixed;inset:0;pointer-events:none;overflow:visible}
.annoCap{position:fixed;inset:0;pointer-events:auto;cursor:crosshair}
.annoCap[hidden],.ask[hidden],.notePop[hidden],.notesChip[hidden],.noteRes[hidden]{display:none}
.ask,.notePop,.notesChip,.noteRes{pointer-events:auto;font:400 12px/16px Geist,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#EDEDF0;-webkit-font-smoothing:antialiased}
.ask{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);width:min(520px,calc(100vw - 32px));display:flex;flex-direction:column;gap:8px}
.askF{display:flex;align-items:center;gap:8px;height:48px;padding:0 6px 0 14px;background:#2D2D32;border:1px solid #3A3A40;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.askF:focus-within{border-color:#2B66D9}
.askF input{flex:1;min-width:0;height:100%;background:transparent;border:0;outline:none;color:#EDEDF0;font:400 13px/18px Geist,system-ui,sans-serif}
.spark{color:#E9B547;display:grid;place-items:center}
.sendB{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:8px;background:#EDEDF0;color:#1B1B1E;flex:0 0 auto}
.sendB[disabled]{opacity:.5}
.askHints{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
.askHints button{height:26px;padding:0 10px;border:1px solid #3A3A40;border-radius:999px;background:#232327;color:#B0B0BA}
.askHints button:hover{color:#EDEDF0;background:#2D2D32}
.prop{display:flex;flex-direction:column;gap:10px;padding:12px;background:#232327;border:1px solid rgba(233,181,71,.45);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.kMsg .prop{box-shadow:none}
.kerfSays{display:flex;gap:8px;line-height:18px}
.dotA{flex:0 0 auto;width:6px;height:6px;margin-top:6px;border-radius:3px;background:#E9B547}
.edits{display:flex;flex-direction:column;gap:6px;max-height:200px;overflow:auto}
.ed{display:flex;flex-direction:column;gap:2px;padding:8px;background:rgba(233,181,71,.08);border-radius:6px}
.ed b{font-weight:600}
.ed span{color:#B0B0BA}
.ed .mono{color:#E9B547}
.acts{display:flex;align-items:center;justify-content:flex-end;gap:6px}
.acts .note{margin-right:auto}
.amberBtn{height:28px;padding:0 12px;border:0;border-radius:6px;background:#E9B547;color:#1B1B1E;font-weight:500}
.ghostBtn{height:28px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:#B0B0BA;font-weight:500}
.ghostBtn:hover{background:#2D2D32;color:#EDEDF0}
.lightBtn{display:flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:0;border-radius:8px;background:#EDEDF0;color:#1B1B1E;font-weight:500}
.lightBtn[disabled]{opacity:.6}
.spin{display:inline-block;width:12px;height:12px;border:2px solid #3A3A40;border-top-color:#EDEDF0;border-radius:50%;animation:kspin 1s linear infinite}
.spin.dark{border-color:#B0B0BA;border-top-color:#1B1B1E}
@keyframes kspin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation:none}}
.shapes{display:flex;gap:2px;padding:2px;margin-left:2px;background:#1B1B1E;border-radius:10px}
.tb.sm{width:30px;height:32px}
.notePop{position:fixed;left:0;top:0;width:320px;display:flex;flex-direction:column;gap:10px;padding:12px;background:#232327;border:1px solid #3A3A40;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.notePop textarea,.comp textarea{width:100%;padding:8px 10px;background:#2D2D32;border:1px solid transparent;border-radius:6px;outline:none;resize:none;color:#EDEDF0;font:400 13px/18px Geist,system-ui,sans-serif}
.notePop textarea:focus,.comp textarea:focus{border-color:#2B66D9}
.notesChip{position:fixed;left:20px;bottom:20px;display:flex;align-items:center;gap:6px;height:52px;padding:0 8px 0 14px;background:#2D2D32;border:1px solid #3A3A40;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.noteRes{position:fixed;left:20px;bottom:84px;width:380px;max-width:calc(100vw - 40px)}
.ptabs{display:flex;gap:16px;padding:12px 12px 0;border-bottom:1px solid #3A3A40;flex:0 0 auto}
.ptabs button{padding:0 0 10px;border:0;background:none;color:#8B8B95;font:500 13px/18px Geist,system-ui,sans-serif;display:flex;gap:6px;align-items:center}
.ptabs button.on{color:#EDEDF0;font-weight:600;box-shadow:inset 0 -2px 0 #EDEDF0}
.kbd{padding:0 4px;border-radius:4px;background:#2D2D32;color:#B0B0BA;font:400 10px/16px 'Geist Mono',ui-monospace,monospace}
.chatScroll{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:14px;padding:14px 12px}
.uMsg{align-self:flex-end;max-width:220px;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.bub{white-space:pre-wrap;padding:8px 10px;background:#2D2D32;border-radius:10px 10px 4px 10px;line-height:18px}
.ctx{display:inline-flex;align-self:flex-start;padding:2px 6px;border:1px solid #2B66D9;border-radius:4px;font:500 11px/14px Geist,system-ui,sans-serif;color:#EDEDF0}
.uMsg .ctx{align-self:flex-end}
.kMsg{display:flex;flex-direction:column;gap:6px}
.comp{display:flex;flex-direction:column;gap:8px;padding:12px;border-top:1px solid #3A3A40;position:relative}
.comp .sendB{position:absolute;right:20px;bottom:20px;width:28px;height:28px}
.comp textarea{padding-right:44px}
.kv{display:grid;grid-template-columns:84px minmax(0,1fr);align-items:center;gap:8px;color:#B0B0BA}
.kv>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cardTop{display:flex;align-items:center;justify-content:space-between;padding:0 4px}
.reply{display:flex;align-items:center;gap:8px;height:44px;padding:0 6px 0 12px;background:#2D2D32;border:1px solid #3A3A40;border-radius:12px}
.reply:focus-within{border-color:#2B66D9}
.reply input{flex:1;min-width:0;height:100%;background:transparent;border:0;outline:none;color:#EDEDF0;font:400 13px/18px Geist,system-ui,sans-serif}
.noteRes{display:flex;flex-direction:column;gap:8px}
.prop.err{border-color:#F06A5F}
.badge{display:inline-block;margin-right:4px;padding:1px 6px;border-radius:4px;background:rgba(233,181,71,.16);color:#E9B547;font-weight:500;font-size:11px}
`;
  }
})();
