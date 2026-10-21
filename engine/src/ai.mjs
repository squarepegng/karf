// Kerf's AI: a designer's request plus the code behind the elements they point at
// goes to Claude, which answers with the same property edits the panel makes.
// Nothing is written here; the editor shows the proposal and applies it on approval.
import { designName } from './labels.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { KerfError } from './edit.mjs';
import { checkProp } from './props.mjs';
import { checkSnippet } from './structure.mjs';

const ENV = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env');
const MODEL = 'claude-opus-5-5';

export const PROPS = ['bg', 'color', 'borderC', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'align', 'radius', 'rTL', 'rTR', 'rBR', 'rBL', 'padX', 'padY', 'gap', 'borderW', 'opacity', 'shadow', 'fit', 'gradient', 'clipText', 'mX', 'mY', 'w', 'h', 'layout', 'alignItems', 'justify', 'wrap'];
const NUMERIC = new Set(['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'radius', 'rTL', 'rTR', 'rBR', 'rBL', 'padX', 'padY', 'gap', 'borderW', 'opacity']);
const COLOR = new Set(['bg', 'color', 'borderC']);

// The key is read on each request, so saving a new one on the start page takes effect at once.
function apiKey() {
  try {
    const m = fs.readFileSync(ENV, 'utf8').match(/^ANTHROPIC_API_KEY=(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const Proposal = z.object({
  scope: z.enum(['done', 'partial', 'not_yet', 'needs_developer']).describe('done: edits cover the request. partial: edits cover part of it and the rest needs something Kerf cannot change yet. not_yet: it is a visual change but nothing in the toolset can do it yet. needs_developer: it changes behavior, data, logic or backend.'),
  message: z.string().describe('One or two plain sentences to the designer: what you changed and how far it reaches, or why it needs a developer'),
  notes: z.array(z.object({
    note: z.number().int(),
    status: z.enum(['done', 'partial', 'not_possible']),
    summary: z.string().describe('One short plain sentence for this note: what you changed, or why it could not be done here'),
  })).nullable().describe('Only when the request has numbered notes: one entry per note, in order. Otherwise null'),
  edits: z.array(
    z.object({
      loc: z.string().describe('Exactly one of the element ids you were given'),
      note: z.number().int().nullable().describe('When the request has numbered notes: the note this edit answers; otherwise null'),
      ops: z.array(z.object({ prop: z.enum(PROPS), value: z.string().describe('For w/h: hug, fill or px. For layout: row, col or none. A number for sizes (px; % for opacity and letterSpacing; 100-900 for fontWeight), a color token name or #RRGGBB for colors, a shadow key or "none", left/center/right/justify for align') })),
      text: z.string().nullable().describe('New text, only when the element’s text is editable and the request asks to change wording; otherwise null'),
      props: z.array(z.object({ name: z.string(), value: z.string() })).describe('Component property changes, only names listed as editable for that element, with one of its allowed values; [] if none'),
      target: z.string().nullable().describe('For style edits: where to make the change. null lets Kerf choose (where the property is set now). Otherwise one of the element’s listed style targets: "element" (only this element), "table:NAME:KEY" (that entry of a style table, so every element using it), "table:NAME:*" (every entry), "css:NAME" (that CSS class everywhere), "const:NAME"'),
      action: z.enum(['style', 'delete', 'duplicate', 'move', 'swap', 'insert', 'replace', 'group', 'ungroup', 'image', 'token', 'code']).describe('style: ops/props/text only. The others change structure; put style changes for the same element in a separate style edit. token changes a design-system colour everywhere; code is a last-resort code change'),
      token: z.object({
        name: z.string().describe('A colour token name from the list'),
        value: z.string().describe('The new colour as #RRGGBB'),
        theme: z.enum(['light', 'dark', 'both']).describe('Which theme value to change'),
      }).nullable().describe('For token only; otherwise null'),
      code: z.object({
        file: z.string().describe('The file path shown for this element or one of its style sources'),
        find: z.string().describe('An exact snippet of that file you were shown, which occurs once'),
        replace: z.string().describe('The new text for that snippet'),
      }).nullable().describe('For code only; otherwise null'),
      moveDir: z.enum(['up', 'down']).nullable().describe('For move: one place earlier or later among its siblings'),
      swapTo: z.string().nullable().describe('For swap: exact name of an icon from the project’s icon library or one of its components'),
      insertPosition: z.enum(['before', 'after', 'inside']).nullable().describe('For insert: relative to this element; inside puts it at the end of its children'),
      insertJsx: z.string().nullable().describe('For insert or replace: the new JSX. Plain tags (div, p, h2, span, img, button, ul/li…) or the project’s components and icons, Tailwind classes using the project’s tokens, fixed text only. No handlers, no expressions.'),
      groupWith: z.array(z.string()).nullable().describe('For group: ids of the neighboring siblings to wrap together with this element, in the same parent'),
      groupClass: z.string().nullable().describe('For group: Tailwind classes for the new frame, e.g. "flex flex-row items-center gap-3"'),
      imageSrc: z.string().nullable().describe('For image: one of the uploaded images, "attachment:N" for an image attached to this message, or a URL the designer gave'),
      imageAlt: z.string().nullable().describe('For image: alt text describing the image'),
      why: z.string().describe('A few words, e.g. "warmer, more premium card"'),
    }),
  ),
});

const SYSTEM = `You are the design assistant inside Kerf, a Figma-style editor that changes a team's real React + Tailwind code.
A designer points at elements on a live screen and says what should change. You answer with property edits on those elements; Kerf turns each edit into the right Tailwind class in the source and shows your proposal for approval before writing anything.

Choose the best approach first, as a senior product designer who also reads code would:
1. What does the designer really mean? Read the request against the screen. "Too bright" on a dark screen means lower contrast so it sits in the dark theme (a darker, quieter fill, softer text, a subtler border), not just darker text. "Make it pop" means more contrast or emphasis against what's around it.
2. Where does the style really live? On the element itself, in a style table (one entry per status or variant), in a CSS class, in a shared component, or in a design token. Each element in the list says where its styles come from.
3. How far should the change reach? If the request is about a kind of thing ("the chips", "all buttons", "the cards", "the dark theme"), change it at its source so every instance stays consistent: the table entry or every entry, the CSS class, the component definition, or the token. If it's about this one instance, change only it (target "element"). For a table of statuses or variants, give each entry the value that fits it and keep each status its own hue.
4. Prefer, in order: style edits on the element or its source, then component properties, then token edits (only when the request is about the palette or theme itself, since a token changes every screen), then code edits (only when nothing else can do it).
Start message with that approach in one plain sentence that says the reach, e.g. "Your status chips take their colours from one table used in 4 files, so I gave all four a darker fill and softer text there."

How to work:
- When the request has numbered notes (the designer marked parts of the screen), answer each note on its own: set note on every edit, and fill notes with one entry per note saying what you changed for it or why it could not be done. Elements tagged (note N) sit under that note's mark. Keep message to one short overall sentence.
- Only edit elements from the list you are given, by their exact id. Prefer the fewest edits that achieve the request.
- Use the project's own design tokens and spacing, radius and type scales (listed below) so edits stay on-system. Use raw hex colors only when no token fits.
- Each element shows its source tag, its current classes and a few measured values. An element marked "shared component" is used in many places; editing it changes all of them, so mention that in your message.
- Text is editable only where marked editable. Never invent product data.
- Components can also have editable properties, like Figma component properties (an icon's weight or stroke, a button's variant). Use them: they are often the right tool for "more refined", "lighter", "bolder" icons and controls. Only use property names and values listed for that element.
- You can also change structure, like a designer in Figma: delete an element, duplicate it, move it up or down among its siblings, swap an icon or component for another (use the exact icon names from the project's library, e.g. "replace the bookmark with a heart" is a swap to Heart), insert new elements before, after or inside an element, and change an image's source or alt text. To replace an element with something different, use replace with the new JSX (never insert plus delete).
- Gradients are a style: set the gradient property to "<direction> <from> <to>" or "<direction> <from> <via> <to>" with directions t, tr, r, br, b, bl, l, tl and project color tokens (e.g. "r primary positive"); "none" removes it. For gradient text, also set clipText to "on". Don't also set a fill: the gradient is the fill. Never rebuild an element just to restyle it. Elements shown by a condition or repeated by a list can't be deleted or moved; edit their parent or their style instead.
- To arrange some siblings differently from the rest (e.g. put an input and a button side by side while the label stays above), group them: action group on the first one, groupWith the others, and groupClass for the new frame's layout. Then set Fill width on the child that should take the remaining space. Ungroup removes a plain wrapper and keeps its children.
- New elements must fit the design: reuse the project's components where one fits, and use the project's tokens and scales in their classes.
- Layout works like Figma auto layout: layout row/col/none (direction), alignItems start/center/end/stretch, justify start/center/end/between, wrap wrap/nowrap, gap, padX/padY, margins mX/mY (px or auto), and width/height w/h as hug, fill or a px size.
- action token changes a design-system colour everywhere it's used: token.name from the token list, token.value #RRGGBB, token.theme light, dark or both.
- action code is the last resort for visual changes no other action can make (classes computed in an unusual way, inline styles): code.file is the file shown for that element or its style sources, code.find an exact snippet of code you were shown that occurs once, code.replace the new text. Keep it minimal and visual only: never change logic, data, handlers or imports.
- Always do what you can. If part of a request needs something not in your toolset yet (free positioning, animation, hover states, new pages), make the edits that get closest, set scope to partial, and say in one short sentence what you could not do yet. Never refuse a visual request outright when some of it is possible.
- needs_developer is only for requests that change behavior, data, logic, payments or accounts. Visual changes are never developer work, even when Kerf cannot make them yet; use not_yet for those.
- This can be a conversation: earlier turns are included. Read follow-ups ("smaller", "undo that", "try again but warmer") against what you proposed before and whether it was applied.
- Never say whether anything changed ("Nothing changed yet", "I haven't changed anything", "No edits"): Kerf shows that itself, next to your reply. When the designer is only asking a question, just answer it.
- The message must describe only the edits you actually return. Write it for a designer, not a developer: plain words, no class names.`;

function themeSummary(theme) {
  const tokens = Object.keys(theme.colors).filter((k) => !/-(50|[1-9]00|950)$/.test(k) && !['inherit', 'current'].includes(k));
  const scale = (m) => Object.entries(m).map(([px, k]) => `${k}=${px}px`).join(', ');
  return [
    `Color tokens: ${tokens.join(', ')}`,
    `Spacing scale: ${scale(theme.spacing)}`,
    `Radius scale: ${scale(theme.radius)}`,
    `Font sizes: ${scale(theme.fontSize)}`,
    `Shadows: ${theme.shadow.join(', ')}`,
  ].join('\n');
}

function libSummary(library) {
  if (!library) return '';
  const comps = [...library.componentList().keys()].sort();
  const libs = Object.entries(library.iconLibs()).map(([k, v]) => `${k} (${v.size} icons; use exact names like ${[...v].slice(0, 3).join(', ')})`);
  const ups = library.uploads();
  return [
    comps.length ? `Components you can insert or swap to: ${comps.join(', ')}` : '',
    libs.length ? `Icon libraries: ${libs.join('; ')}` : '',
    ups.length ? `Uploaded images: ${ups.join(', ')}` : 'No uploaded images yet.',
  ].filter(Boolean).join('\n');
}

function describeTarget(t, i) {
  if (t.imgSrc) t = { ...t, text: `image: ${t.imgSrc}${t.alt ? ` (alt: ${t.alt})` : ''}` };
  const lines = [`[${t.loc}] <${t.tag}>${t.shared ? ' (component definition: editing it changes every place it’s used)' : ''}${t.instance ? ' (this one use of the component: delete, move or restyle just this one here)' : ''}${t.note != null ? ` (note ${t.note})` : ''}`];
  if (t.text) lines.push(`  text: ${JSON.stringify(t.text.slice(0, 100))}${t.textEditable ? ' (editable)' : ' (not editable)'}`);
  if (t.classes?.length) lines.push(`  classes: ${t.classes.join(' ')}`);
  if (t.measured) lines.push(`  measured: ${Object.entries(t.measured).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (t.classKind === 'dynamic') lines.push(`  (classes are computed in code, so style ops won't work here; use action code if this element must change)`);
  if (t.classKind === 'sourced' && t.sources) {
    lines.push('  its styles come from (later wins):');
    for (const x of t.sources) {
      if (x.kind === 'table') lines.push(`    - style table ${x.name} in ${x.file}, used in ${x.usedIn} files; this element uses "${x.key}". Entries: ${x.entries.map((e) => `${e.key}="${e.value}"`).join('; ')}`);
      else if (x.kind === 'css') lines.push(`    - CSS class .${x.name} in ${x.file} (@apply ${x.value}), used in ${x.usedIn} files`);
      else if (x.kind === 'const') lines.push(`    - constant ${x.name}="${x.value}" in ${x.file}, used in ${x.usedIn} files`);
      else lines.push(`    - its own classes "${x.value}"${x.kind === 'branch' ? (x.active ? ' (inside a condition, active now)' : ' (inside a condition, not active now)') : ''}`);
    }
    lines.push(`  style targets: ${(t.sourceTargets || []).join(', ')}${t.merge ? '' : ' (classes are not merged, so "element" can only add properties nothing else sets)'}`);
  }
  if ((t.classKind === 'sourced' || t.classKind === 'dynamic') && t.snippet) lines.push(`  code in ${t.file}: ${t.snippet.replace(/\s+/g, ' ').slice(0, 320)}`);
  const editable = (t.props || []).filter((p) => p.editable);
  if (editable.length) lines.push(`  properties${t.lib ? ` (${t.lib})` : ''}: ${editable.map((p) => `${p.name}=${p.value ?? 'unset'}${p.options ? ` [${p.options.join('|')}]` : ` (${p.kind})`}`).join(', ')}`);
  return lines.join('\n');
}

// Make Claude's values safe and in the shape the editor expects.
export function cleanOps(ops, theme) {
  const out = [];
  for (const { prop, value } of ops) {
    if (!PROPS.includes(prop)) continue;
    const v = String(value).trim();
    if (NUMERIC.has(prop)) {
      const n = parseFloat(v);
      if (!isFinite(n)) continue;
      out.push({ prop, value: prop === 'fontWeight' ? Math.round(n / 100) * 100 : Math.round(n * 10) / 10 });
    } else if (COLOR.has(prop)) {
      if (v === 'transparent' || v in theme.colors) out.push({ prop, value: v });
      else if (/^#?[0-9a-f]{6}$/i.test(v)) out.push({ prop, value: '#' + v.replace('#', '').toUpperCase() });
    } else if (prop === 'shadow') {
      if (v === 'none' || theme.shadow.includes(v)) out.push({ prop, value: v });
    } else if (prop === 'mX' || prop === 'mY') {
      if (v === 'auto') out.push({ prop, value: 'auto' });
      else if (isFinite(parseFloat(v))) out.push({ prop, value: Math.round(parseFloat(v)) });
    } else if (prop === 'w' || prop === 'h') {
      if (['hug', 'fill', 'auto'].includes(v)) out.push({ prop, value: v });
      else if (isFinite(parseFloat(v))) out.push({ prop, value: Math.round(parseFloat(v)) });
    } else if (prop === 'layout') {
      if (['row', 'col', 'none'].includes(v)) out.push({ prop, value: v });
    } else if (prop === 'alignItems') {
      if (['start', 'center', 'end', 'stretch', 'baseline'].includes(v)) out.push({ prop, value: v });
    } else if (prop === 'justify') {
      if (['start', 'center', 'end', 'between', 'around', 'evenly'].includes(v)) out.push({ prop, value: v });
    } else if (prop === 'wrap') {
      if (['wrap', 'nowrap'].includes(v)) out.push({ prop, value: v });
    } else if (prop === 'gradient') {
      const parts = v.split(/\s+/);
      const ok = (c) => c in theme.colors || /^#[0-9a-f]{6}$/i.test(c);
      if (v === 'none') out.push({ prop, value: 'none' });
      else if (['t', 'tr', 'r', 'br', 'b', 'bl', 'l', 'tl'].includes(parts[0]) && parts.length >= 3 && parts.length <= 4 && parts.slice(1).every(ok)) out.push({ prop, value: v });
    } else if (prop === 'clipText') {
      out.push({ prop, value: /^(on|true|yes)$/i.test(v) ? 'on' : 'off' });
    } else if (prop === 'fit') {
      if (['cover', 'contain', 'fill', 'none', 'scale-down'].includes(v)) out.push({ prop, value: v });
    } else if (prop === 'align') {
      if (['left', 'center', 'right', 'justify'].includes(v)) out.push({ prop, value: v });
    }
  }
  return out;
}

const IMG_TYPES = /^image\/(jpeg|png|gif|webp)$/;

// How the designer would recognise an element: its text, or its tag.
const nameFor = (t) => designName(t.tag, t.text, { icon: !!t.lib });
const noteOf = (e, t) => (Number.isInteger(e.note) && e.note > 0 ? e.note : Number.isInteger(t.note) ? t.note : null);

export async function propose({ request, targets, history = [], images = [], tokens = [], webRoot = null }, theme, library) {
  const key = apiKey();
  if (!key) throw new KerfError('Add your Anthropic key on Kerf’s start page (localhost:4100) to use AI.');
  if (!request || !String(request).trim()) throw new KerfError('Say or type what should change.');
  if (!targets?.length) throw new KerfError('Nothing on screen to work with. Select something or draw a note first.');

  const allowed = new Map(targets.map((t) => [t.loc, t]));
  // Images the designer attached: Claude sees them, and can place one in the design as "attachment:N".
  const imgs = (Array.isArray(images) ? images : []).slice(0, 4).filter((i) => i && IMG_TYPES.test(i.media_type) && typeof i.data === 'string' && i.data.length < 7e6);
  const saved = new Map();
  const attachmentSrc = (n) => {
    const im = imgs[n - 1];
    if (!im) return null;
    if (!saved.has(n)) {
      try { saved.set(n, library.saveUpload(/\.\w+$/.test(im.name || '') ? im.name : `attachment-${n}.png`, im.orig || im.data).src); } catch { saved.set(n, null); }
    }
    return saved.get(n);
  };
  const lastText = `Elements on screen:\n${targets.map(describeTarget).join('\n')}\n\n${imgs.length ? `The designer attached ${imgs.length} image${imgs.length > 1 ? 's' : ''} (above). Treat them as a reference to match, a screenshot pointing at a problem, or an image to put in the design, whichever the request means. To place one, use imageSrc "attachment:N" (or src="attachment:N" in insertJsx).\n\n` : ''}Request:\n${request}`;
  const lastContent = imgs.length
    ? [...imgs.flatMap((im, n) => [{ type: 'text', text: `Attachment ${n + 1}: ${String(im.name || 'image').slice(0, 80)}` }, { type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } }]), { type: 'text', text: lastText }]
    : lastText;
  const client = new Anthropic({ apiKey: key });
  let res;
  try {
    res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(Proposal) },
      system: `${SYSTEM}\n\nThis project's design system:\n${themeSummary(theme)}\n${tokens.length ? `Colour tokens you can change with action token (light / dark values): ${tokens.map((t) => `${t.name} ${t.values.map((v) => `${v.theme} ${v.hex}`).join(' / ')}`).join('; ')}\n` : ''}${libSummary(library)}`,
      messages: [
        ...history.slice(-8).map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.text).slice(0, 2000) })),
        { role: 'user', content: lastContent },
      ],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new KerfError('Anthropic didn’t accept the saved key. Save a new one on Kerf’s start page.');
    if (e instanceof Anthropic.RateLimitError) throw new KerfError('Claude is busy right now. Try again in a moment.');
    if (e instanceof Anthropic.APIError) { console.error('Kerf AI error:', e.status, e.message); throw new KerfError(`Claude couldn’t answer (${e.status}). Try again.`); }
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new KerfError('Claude declined this request. Try rewording it as a visual change.');
  const p = res.parsed_output;
  if (!p) throw new KerfError('Claude’s answer couldn’t be read. Try again.');

  const edits = [];
  const known = (nm) => !!library.findIcon(nm) || library.componentList().has(nm);
  const urls = new Set([...String(request).matchAll(/https?:\/\/\S+/g)].map((m) => m[0].replace(/[).,]+$/, '')));
  const uploads = new Set(library.uploads());
  // Files Claude may change with a code edit: the elements' own files and their style sources.
  const codeFiles = new Set(targets.flatMap((t) => [t.file, ...(t.sources || []).map((x) => x.file)]).filter(Boolean));
  const tokenNames = new Set(tokens.map((x) => x.name));
  const whereOf = (tg) => {
    const m = String(tg || '').match(/^(table|css|const):([^:]+)(?::(.+))?$/);
    if (!m) return tg === 'element' ? 'only this element' : null;
    return m[1] === 'table' ? (m[3] === '*' ? `every entry of ${m[2]}` : `${m[2]} “${m[3]}”`) : m[1] === 'css' ? `.${m[2]} class` : m[2];
  };
  for (const e of p.edits || []) {
    const t = allowed.get(e.loc) || (e.action === 'token' ? targets[0] && allowed.get(targets[0].loc) : null);
    if (!t) continue;
    if (e.action === 'token') {
      const k = e.token;
      if (!k || !tokenNames.has(k.name) || !/^#[0-9a-f]{6}$/i.test(k.value || '')) continue;
      edits.push({ loc: t.loc, tag: 'Colour token', name: `Colour “${k.name}”`, note: noteOf(e, t), ops: [], props: [], text: null, structure: { type: 'token', name: k.name, hex: k.value.toUpperCase(), which: k.theme || 'both' }, why: e.why });
      continue;
    }
    if (e.action === 'code') {
      const c = e.code;
      const file = String(c?.file || '').replace(/^\.?\//, '');
      if (!c || !codeFiles.has(file) || !c.find || c.replace == null || c.find === c.replace) continue;
      if (webRoot) {
        let content = '';
        try { content = fs.readFileSync(path.join(webRoot, file), 'utf8'); } catch { continue; }
        if (content.split(c.find).length !== 2) continue;
      }
      edits.push({ loc: e.loc, tag: t.tag, name: nameFor(t), note: noteOf(e, t), ops: [], props: [], text: null, structure: { type: 'code', file, find: c.find, replace: c.replace }, why: e.why });
      continue;
    }
    if (e.action && e.action !== 'style') {
      const st = { type: e.action };
      if (e.action === 'move') st.dir = e.moveDir || 'down';
      if (e.action === 'swap') { if (!known(e.swapTo)) continue; st.to = e.swapTo; }
      if (e.action === 'insert' || e.action === 'replace') {
        try { checkSnippet(e.insertJsx || '', known); } catch { continue; }
        if (/attachment:\d/.test(e.insertJsx.replace(/attachment:(\d)/g, (m, n) => (imgs[+n - 1] ? '' : m)))) continue;
        st.jsx = e.insertJsx.replace(/attachment:(\d)/g, (m, n) => attachmentSrc(+n) || m);
        if (e.action === 'insert') st.position = e.insertPosition || 'after';
      }
      if (e.action === 'group') {
        st.others = (e.groupWith || []).filter((l) => allowed.has(l) && l.split(':')[0] === e.loc.split(':')[0]);
        st.className = (e.groupClass || 'flex flex-row items-center gap-2').replace(/[^\w\s:/.[\]#-]/g, '');
      }
      if (e.action === 'image') {
        const att = String(e.imageSrc || '').match(/^attachment:(\d)$/);
        if (att) e.imageSrc = attachmentSrc(+att[1]);
        else if (e.imageSrc && !uploads.has(e.imageSrc) && !urls.has(e.imageSrc)) e.imageSrc = null;
        if (!e.imageSrc && e.imageAlt == null) continue;
        if (e.imageSrc) st.src = e.imageSrc;
        if (e.imageAlt != null) st.alt = e.imageAlt;
      }
      edits.push({ loc: e.loc, tag: t.tag, name: nameFor(t), note: noteOf(e, t), ops: [], props: [], text: null, structure: st, why: e.why });
      continue;
    }
    if (t.classKind === 'dynamic') continue;
    let ops = cleanOps(e.ops || [], theme);
    // A gradient is the fill: drop a solid fill in the same edit so it can’t cancel the gradient.
    if (ops.some((o) => o.prop === 'gradient' && o.value !== 'none')) ops = ops.filter((o) => o.prop !== 'bg');
    const text = e.text && t.textEditable ? e.text : null;
    const props = [];
    for (const p of e.props || []) {
      try { props.push({ name: p.name, value: checkProp({ props: t.props || [] }, p.name, p.value) }); } catch { /* not allowed here */ }
    }
    const target = e.target && (t.sourceTargets || []).includes(e.target) ? e.target : null;
    if (ops.length || text || props.length) edits.push({ loc: e.loc, tag: t.tag, name: nameFor(t), note: noteOf(e, t), ops, text, props, why: e.why, dom: t.dom || [], ...(target ? { target, where: whereOf(target) } : {}) });
  }
  const notes = Array.isArray(p.notes) ? p.notes.filter((n) => Number.isInteger(n.note) && n.note > 0).map((n) => ({ note: n.note, status: n.status, summary: n.summary })) : null;
  return { scope: p.scope, message: p.message, notes: notes?.length ? notes : null, edits, model: res.model, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
}
