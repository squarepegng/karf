// Kerf's AI: a designer's request plus the code behind the elements they point at
// goes to Claude, which answers with the same property edits the panel makes.
// Nothing is written here; the editor shows the proposal and applies it on approval.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { KerfError } from './edit.mjs';

const ENV = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env');
const MODEL = 'claude-opus-5-5';

export const PROPS = ['bg', 'color', 'borderC', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'align', 'radius', 'rTL', 'rTR', 'rBR', 'rBL', 'padX', 'padY', 'gap', 'borderW', 'opacity', 'shadow'];
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
  scope: z.enum(['visual', 'needs_developer']).describe('needs_developer when the request changes behavior, data, logic or backend rather than how things look'),
  message: z.string().describe('One or two plain sentences to the designer: what you changed and how far it reaches, or why it needs a developer'),
  edits: z.array(
    z.object({
      loc: z.string().describe('Exactly one of the element ids you were given'),
      ops: z.array(z.object({ prop: z.enum(PROPS), value: z.string().describe('A number for sizes (px; % for opacity and letterSpacing; 100-900 for fontWeight), a color token name or #RRGGBB for colors, a shadow key or "none", left/center/right/justify for align') })),
      text: z.string().nullable().describe('New text, only when the element’s text is editable and the request asks to change wording; otherwise null'),
      why: z.string().describe('A few words, e.g. "warmer, more premium card"'),
    }),
  ),
});

const SYSTEM = `You are the design assistant inside Kerf, a Figma-style editor that changes a team's real React + Tailwind code.
A designer points at elements on a live screen and says what should change. You answer with property edits on those elements; Kerf turns each edit into the right Tailwind class in the source and shows your proposal for approval before writing anything.

How to work:
- Only edit elements from the list you are given, by their exact id. Prefer the fewest edits that achieve the request.
- Use the project's own design tokens and spacing, radius and type scales (listed below) so edits stay on-system. Use raw hex colors only when no token fits.
- Each element shows its source tag, its current classes and a few measured values. An element marked "shared component" is used in many places; editing it changes all of them, so mention that in your message.
- Text is editable only where marked editable. Never invent product data.
- If the request is about behavior, data, logic, payments, accounts or anything beyond how things look and are arranged, set scope to needs_developer, return no edits, and say briefly that it is one for the developers.
- You can only change the properties in the schema (no margins, sizes or positions yet). If part of the request needs something else, say so in the message.
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

function describeTarget(t, i) {
  const lines = [`[${t.loc}] <${t.tag}>${t.shared ? ' (shared component)' : ''}${t.note != null ? ` (note ${t.note})` : ''}`];
  if (t.text) lines.push(`  text: ${JSON.stringify(t.text.slice(0, 100))}${t.textEditable ? ' (editable)' : ' (not editable)'}`);
  if (t.classes?.length) lines.push(`  classes: ${t.classes.join(' ')}`);
  if (t.measured) lines.push(`  measured: ${Object.entries(t.measured).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (t.classKind === 'dynamic') lines.push('  (classes are computed in code; do not edit this element)');
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
    } else if (prop === 'align') {
      if (['left', 'center', 'right', 'justify'].includes(v)) out.push({ prop, value: v });
    }
  }
  return out;
}

export async function propose({ request, targets }, theme) {
  const key = apiKey();
  if (!key) throw new KerfError('Add your Anthropic key on Kerf’s start page (localhost:4100) to use AI.');
  if (!request || !String(request).trim()) throw new KerfError('Say or type what should change.');
  if (!targets?.length) throw new KerfError('Nothing on screen to work with. Select something or draw a note first.');

  const allowed = new Map(targets.map((t) => [t.loc, t]));
  const client = new Anthropic({ apiKey: key });
  let res;
  try {
    res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(Proposal) },
      system: `${SYSTEM}\n\nThis project's design system:\n${themeSummary(theme)}`,
      messages: [{ role: 'user', content: `Elements on screen:\n${targets.map(describeTarget).join('\n')}\n\nRequest:\n${request}` }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new KerfError('Anthropic didn’t accept the saved key. Save a new one on Kerf’s start page.');
    if (e instanceof Anthropic.RateLimitError) throw new KerfError('Claude is busy right now. Try again in a moment.');
    if (e instanceof Anthropic.APIError) throw new KerfError(`Claude couldn’t answer (${e.status}). Try again.`);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new KerfError('Claude declined this request. Try rewording it as a visual change.');
  const p = res.parsed_output;
  if (!p) throw new KerfError('Claude’s answer couldn’t be read. Try again.');

  const edits = [];
  for (const e of p.edits || []) {
    const t = allowed.get(e.loc);
    if (!t || t.classKind === 'dynamic') continue;
    const ops = cleanOps(e.ops || [], theme);
    const text = e.text && t.textEditable ? e.text : null;
    if (ops.length || text) edits.push({ loc: e.loc, tag: t.tag, ops, text, why: e.why });
  }
  return { scope: p.scope, message: p.message, edits, model: res.model, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
}
