// Tovi landing page: the live mini editor, its one-time intro, and the beta sign-up forms.

// Where beta sign-ups are sent: a form service URL that accepts a JSON POST of { email }
// (for example a Formspree form or a small serverless function). Empty means not connected yet.
const SIGNUP_ENDPOINT = '';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------- nav border once the page scrolls ---------- */
const nav = $('.nav');
const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------- live editor ---------- */
const demo = $('#demo');
if (demo) {
  // Tailwind's scale: what Tovi would write for each value.
  const PADS = [[8, 'p-2'], [12, 'p-3'], [16, 'p-4'], [20, 'p-5'], [24, 'p-6'], [32, 'p-8']];
  const RADS = { 6: 'rounded-md', 8: 'rounded-lg', 12: 'rounded-xl', 16: 'rounded-2xl' };
  const ORIGINAL = { pad: 2, rad: 8 };
  const state = { pad: ORIGINAL.pad, rad: ORIGINAL.rad, scope: 'all' };

  const cardA = $('#cardA'), cardB = $('#cardB');
  const padOut = $('#padOut'), code = $('#code'), codeFile = $('#codeFile'), codeState = $('#codeState');
  const minus = $('[data-pad="-1"]', demo), plus = $('[data-pad="1"]', demo);
  let padTimer;

  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const line = (kind, text) => `<span class="ln ${kind}"><b>${{ del: '−', add: '+', ctx: ' ' }[kind]}</b>${text}</span>`;
  // Highlight the classes that changed between two class lists.
  function marked(classes, other) {
    return classes.map((c) => (other.includes(c) ? esc(c) : `<mark>${esc(c)}</mark>`)).join(' ');
  }

  function render() {
    const px = PADS[state.pad][0];
    const changed = state.pad !== ORIGINAL.pad || state.rad !== ORIGINAL.rad;
    padOut.value = px;
    padOut.textContent = px;
    minus.disabled = state.pad === 0;
    plus.disabled = state.pad === PADS.length - 1;
    $$('[data-rad]', demo).forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.rad === state.rad)));
    $$('[data-scope]', demo).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.scope === state.scope)));

    // the canvas
    for (const card of [cardA, cardB]) {
      const applies = card === cardA || state.scope === 'all';
      card.style.setProperty('--pad', `${applies ? px : PADS[ORIGINAL.pad][0]}px`);
      card.style.setProperty('--rad', `${applies ? state.rad : ORIGINAL.rad}px`);
    }
    cardB.classList.toggle('mirror', changed && state.scope === 'all');

    // the code
    const before = ['rounded-lg', 'border', 'bg-surface', 'p-4'];
    const after = [RADS[state.rad], 'border', 'bg-surface', PADS[state.pad][1]];
    let html;
    if (state.scope === 'all') {
      codeFile.textContent = 'src/components/ProductCard.jsx';
      const wrap = (cls) => `    &lt;article className={cn("${cls}", className)}&gt;`;
      html = line('ctx', 'export function ProductCard({ product, className }) {') + line('ctx', '  return (')
        + (changed ? line('del', wrap(marked(before, after))) + line('add', wrap(marked(after, before))) : line('ctx', wrap(before.join(' '))));
    } else {
      codeFile.textContent = 'src/pages/Shop.jsx';
      const extra = [state.rad !== ORIGINAL.rad && RADS[state.rad], state.pad !== ORIGINAL.pad && PADS[state.pad][1]].filter(Boolean);
      const use = (cls) => `  &lt;ProductCard product={linenThrow}${cls ? ` className="<mark>${cls}</mark>"` : ''} /&gt;`;
      html = line('ctx', '&lt;div className="grid grid-cols-2 gap-4"&gt;')
        + (changed ? line('del', use('')) + line('add', use(extra.join(' '))) : line('ctx', use('')))
        + line('ctx', '  &lt;ProductCard product={oakTray} /&gt;');
    }
    code.innerHTML = html;
    codeState.textContent = changed ? (state.scope === 'all' ? 'Changed in 1 file, 12 cards follow' : 'Changed in 1 file, this card only') : 'Matches the code';
    codeState.classList.toggle('changed', changed);
    $('#prDot').classList.toggle('on', changed);
  }

  function flashPadding() {
    demo.classList.add('show-pad');
    clearTimeout(padTimer);
    padTimer = setTimeout(() => demo.classList.remove('show-pad'), 1100);
  }
  function setPad(i) {
    const next = Math.max(0, Math.min(PADS.length - 1, i));
    if (next === state.pad) return;
    state.pad = next;
    flashPadding();
    render();
  }

  let touched = false;
  demo.addEventListener('pointerdown', () => { touched = true; }, { capture: true });
  demo.addEventListener('keydown', () => { touched = true; }, { capture: true });

  demo.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !demo.contains(b)) return;
    if (b.dataset.pad) setPad(state.pad + +b.dataset.pad);
    else if (b.dataset.rad) { state.rad = +b.dataset.rad; render(); }
    else if (b.dataset.scope) { state.scope = b.dataset.scope; render(); }
  });

  // Arrow keys move within the radius and scope choices, like native radio groups.
  demo.addEventListener('keydown', (e) => {
    const b = e.target.closest('[role="radio"]');
    if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const group = $$('[role="radio"]', b.parentElement);
    const i = group.indexOf(b) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1);
    const next = group[(i + group.length) % group.length];
    e.preventDefault();
    next.focus();
    next.click();
  });

  // Drag the handle under the card: up adds padding, down removes it, snapping to the scale.
  const handle = $('#padHandle');
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const y0 = e.clientY, start = PADS[state.pad][0];
    demo.classList.add('show-pad');
    const move = (ev) => {
      const want = start + (y0 - ev.clientY) * 0.6;
      let best = 0;
      PADS.forEach(([px], i) => { if (Math.abs(px - want) < Math.abs(PADS[best][0] - want)) best = i; });
      if (best !== state.pad) { state.pad = best; render(); }
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      flashPadding();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); setPad(state.pad + 1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setPad(state.pad - 1); }
  });

  render();

  // One orchestrated moment: a cursor clicks "+" twice (16 → 24), unless the visitor got there first.
  const cursor = $('#cursor');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function intro() {
    if (reduced || touched) return;
    const at = (el) => {
      const d = demo.getBoundingClientRect(), r = el.getBoundingClientRect();
      return `translate(${r.left - d.left + r.width / 2 - 3}px, ${r.top - d.top + r.height / 2 - 2}px)`;
    };
    cursor.style.transition = 'none';
    cursor.style.transform = at($('.pcard h3', cardA));
    cursor.getBoundingClientRect();
    cursor.style.transition = '';
    cursor.style.opacity = '1';
    await wait(250);
    cursor.style.transform = at(plus);
    await wait(950);
    for (let i = 0; i < 2 && !touched; i++) {
      cursor.classList.remove('click'); cursor.getBoundingClientRect(); cursor.classList.add('click');
      setPad(state.pad + 1);
      await wait(520);
    }
    await wait(500);
    cursor.style.opacity = '0';
  }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((en) => en.isIntersecting)) { io.disconnect(); setTimeout(intro, 900); }
  }, { threshold: 0.35 });
  io.observe(demo);
}

/* ---------- beta sign-up ---------- */
for (const form of $$('[data-join]')) {
  const msg = $('.join-msg', form);
  const btn = $('button', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    msg.className = 'join-msg';
    if (!form.email.checkValidity()) { msg.textContent = 'Enter an email address like you@company.com.'; msg.classList.add('err'); form.email.focus(); return; }
    if (!SIGNUP_ENDPOINT) { msg.textContent = 'Sign-ups aren’t connected yet. Set SIGNUP_ENDPOINT in main.js.'; msg.classList.add('err'); return; }
    btn.disabled = true;
    btn.textContent = 'Joining…';
    try {
      const r = await fetch(SIGNUP_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email }) });
      if (!r.ok) throw new Error(String(r.status));
      form.reset();
      msg.textContent = 'You’re on the list. We’ll email you when your invite is ready.';
      msg.classList.add('ok');
    } catch {
      msg.textContent = 'That didn’t go through. Check your connection and try again.';
      msg.classList.add('err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Join the beta';
    }
  });
}
