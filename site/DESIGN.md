# Tovi landing page: design plan

**Subject.** Tovi lets designers edit their team's real, running React + Tailwind app by hand, Figma-style, and sends the changes to developers as one pull request.
**Audience.** Product designers on React + Tailwind teams; founders and builders without design training.
**Job of the page.** Make the core idea obvious in five seconds (you edit the real product and the code changes) and get people onto the private beta list.

## Tokens

| Name | Hex | Role |
|---|---|---|
| paper | `#FBFBFC` | Page background: the light around a design canvas |
| ink | `#1B1B1E` | Text, and the editor window (it's Tovi's own canvas colour) |
| ink-2 | `#5B5B66` | Secondary text |
| line | `#E3E3E8` | Hairlines and field borders |
| select | `#2B66D9` | Blue: "what you're touching". Selection, focus, the main button |
| intent | `#E9B547` | Amber: "Tovi's interpretation". Diff markers, rule prompts, AI proposals |

The two accents carry the same meaning on the page as they do in the product, and the page says so.

**Type.** Geist for everything (it's the product's typeface), with tight, large headlines (weight 600, negative tracking). Geist Mono only for real code and file paths. Sentence case everywhere; no all-caps labels.

## Layout

```
[nav: Tovi            How it works  AI  Pricing  FAQ      (Join the beta)]

  Design the real product.        <- headline wrapped in a blue selection box,
  sub-copy                           with handles and a "Hug × Hug" size tag
  [email][Join the beta]

  +------------------- live editor (dark) -------------------+
  |  canvas: a product card (selected, padding visible)       |
  |                                  | Design panel: padding, |
  |                                  | radius                 |
  |  ProductCard.jsx diff: p-4 → p-6 (amber markers)          |
  +-----------------------------------------------------------+

  The gap: a picture of the product vs. the product (two columns, prose)
  How it works: 4 real steps on a single line (numbered, because it's a sequence)
  Code a careful developer would write: PR diff + "Only here / Everywhere" prompt
  One AI, three ways to point: Ask bar / ⌘K chat / Notes (different shapes, not a card grid)
  Guardrails: snapping to the scale, contrast warning
  Pricing: two plans, prices to be set at launch
  FAQ (details/summary)
  Final call to action, footer
```

Left-aligned text throughout; the hero is centred on the editor window.

## Principles

- **The demo is the hero.** One bold thing: a working mini-editor. Change the padding and the JSX updates on the spot. Everything else stays quiet.
- **One orchestrated moment.** On load, a cursor clicks "+" once, so visitors see the idea without doing anything. No scroll-triggered fade-ins.
- **Real vocabulary.** Gap, padding, hug/fill, variants, pull request. Plain verbs, no hype.
- **Quality floor.** Works down to 360px, visible keyboard focus, honours reduced motion, AA contrast.

## Checked against the generic defaults

- Not cream with a serif and terracotta, and not near-black with an acid accent. The light paper page with a dark editor comes from the product's own canvas.
- No identical card grid. The AI section uses three different shapes: a bar, a chat and a pinned note.
- No eyebrow labels, no "→" on buttons, no middle-dot meta strings. Mono is used only for code.
- Numbers appear only in "How it works", which really is a sequence.
