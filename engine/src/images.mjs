// Images for the design: real photos from Unsplash, and flat vector illustrations Claude draws as SVG.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { KerfError } from './edit.mjs';

const ENV = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env');
const MODEL = 'claude-opus-5-5';
// Keys are read on each request, so saving one on the start page takes effect at once.
function envKey(name) {
  try { return fs.readFileSync(ENV, 'utf8').match(new RegExp(`^${name}=(\\S+)`, 'm'))?.[1] || null; } catch { return null; }
}

/* ---------- photos (Unsplash) ---------- */
export async function searchPhotos(q, orientation) {
  const key = envKey('UNSPLASH_ACCESS_KEY');
  if (!key) return { needsKey: true, photos: [] };
  const query = String(q || '').trim().slice(0, 120);
  if (!query) return { photos: [] };
  const u = new URL('https://api.unsplash.com/search/photos');
  u.searchParams.set('query', query);
  u.searchParams.set('per_page', '12');
  u.searchParams.set('content_filter', 'high');
  if (['landscape', 'portrait', 'squarish'].includes(orientation)) u.searchParams.set('orientation', orientation);
  const r = await fetch(u, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' } });
  if (r.status === 401) throw new KerfError('Unsplash didn’t accept the saved key. Save the Access Key again on Tovi’s start page.');
  if (r.status === 403) throw new KerfError('Unsplash’s hourly limit is reached. Try again in a little while.');
  if (!r.ok) throw new KerfError(`Unsplash couldn’t search right now (${r.status}).`);
  const j = await r.json();
  return {
    photos: (j.results || []).map((p) => ({
      id: p.id,
      thumb: p.urls?.small,
      // Unsplash asks apps to use its image URLs directly (hotlinking), sized with w=.
      url: `${p.urls?.raw}&w=1600&q=80&auto=format&fit=crop`,
      alt: p.alt_description || p.description || query,
      credit: { name: p.user?.name, link: `${p.user?.links?.html}?utm_source=kerf&utm_medium=referral` },
      download: p.links?.download_location,
      color: p.color,
    })),
  };
}
// Unsplash requires a ping when a photo is actually used.
export async function photoUsed(download) {
  const key = envKey('UNSPLASH_ACCESS_KEY');
  if (!key || !/^https:\/\/api\.unsplash\.com\//.test(String(download || ''))) return { ok: false };
  await fetch(download, { headers: { Authorization: `Client-ID ${key}` } }).catch(() => {});
  return { ok: true };
}

/* ---------- illustrations (Claude draws SVG) ---------- */
// Keep only what an illustration needs: shapes, paths, gradients. No scripts, events, or outside links.
export function cleanSvg(svg) {
  let s = String(svg || '').trim();
  const start = s.indexOf('<svg'), end = s.lastIndexOf('</svg>');
  if (start < 0 || end < 0) return null;
  s = s.slice(start, end + 6);
  if (s.length > 120000) return null;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  s = s.replace(/\s(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '');
  s = s.replace(/<(image|iframe|embed|object|use)\b[^>]*>/gi, (m) => (/href\s*=\s*["']#/.test(m) ? m : ''));
  if (!/\sxmlns=/.test(s.slice(0, 200))) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}

const Drawings = z.object({
  options: z.array(z.object({
    title: z.string().describe('Two to four words, e.g. "Potter at the wheel"'),
    svg: z.string().describe('One complete, self-contained <svg> element'),
  })).describe('Exactly the requested number of distinct options'),
});

export async function illustrate({ prompt, width = 1200, height = 900, palette = [], direction = '', count = 3 }) {
  const key = envKey('ANTHROPIC_API_KEY');
  if (!key) throw new KerfError('Add your Anthropic key on Tovi’s start page (localhost:4100) to draw illustrations.');
  const ask = String(prompt || '').trim().slice(0, 600);
  if (!ask) throw new KerfError('Describe the illustration you want.');
  const w = Math.max(100, Math.min(2400, Math.round(+width || 1200))), h = Math.max(100, Math.min(2400, Math.round(+height || 900)));
  const n = Math.max(1, Math.min(3, Math.round(+count || 3)));
  const client = new Anthropic({ apiKey: key });
  let res;
  try {
    res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(Drawings) },
      system: `You are an illustrator making images for a real website. You draw flat, modern vector illustrations as SVG, the kind found on good product sites: clear silhouettes, a confident composition, a limited palette, soft shapes and subtle depth (layered shapes, gentle gradients), no clip-art look.
Rules for every SVG:
- viewBox="0 0 ${w} ${h}" with no width or height attributes, so it scales to fill its frame; fill the whole canvas with a background shape.
- Only svg, g, rect, circle, ellipse, path, polygon, polyline, line, linearGradient, radialGradient, stop, defs, clipPath. No text unless asked, no images, no scripts, no external links, no filters.
- Keep it light: at most about 120 elements, simple paths, no huge coordinate lists.
- People are drawn simply and respectfully (flat shapes, no detailed faces), with natural, varied skin tones.
- Use the site's palette below as the main colours, with tints and shades of them; one accent colour at most.`,
      messages: [{ role: 'user', content: `Draw ${n} distinct illustration${n > 1 ? 's' : ''} (different compositions or viewpoints) of: ${ask}\n\nSite palette: ${palette.length ? palette.map((p) => `${p.name} ${p.hex}`).join(', ') : 'choose a calm, harmonious palette'}\n${direction ? `Design direction: ${direction}\n` : ''}Canvas: ${w}×${h}.` }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new KerfError('Anthropic didn’t accept the saved key. Save a new one on Tovi’s start page.');
    if (e instanceof Anthropic.RateLimitError) throw new KerfError('Claude is busy right now. Try again in a moment.');
    if (e instanceof Anthropic.APIError) { console.error('Tovi illustrate error:', e.status, e.message); throw new KerfError(`Claude couldn’t draw this (${e.status}). Try again.`); }
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new KerfError('Claude declined to draw this. Try describing it differently.');
  if (res.stop_reason === 'max_tokens') throw new KerfError('The drawing got too detailed to finish. Try a simpler description, or ask for fewer options.');
  const options = (res.parsed_output?.options || []).map((o) => ({ title: String(o.title || 'Illustration').slice(0, 60), svg: cleanSvg(o.svg) })).filter((o) => o.svg);
  if (!options.length) throw new KerfError('Claude’s drawing couldn’t be read. Try again.');
  return { options };
}
