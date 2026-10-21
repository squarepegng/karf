# Kerf engine

The core idea from the PRD: link every element on screen to the exact line of
code that made it, then change that code the way a careful developer would.
Designers edit the real, running app like Figma; the changes go to developers
as one GitHub pull request.

New to this project? Read `../HANDOFF.md` first.

## What it works with

- React apps built with **Vite**, or with **Next.js 13+** (webpack dev server; Turbopack isn't supported yet)
- Styled with **Tailwind CSS v3** (`tailwind.config` in JS or TS)

Anything else gets a plain explanation on the start page: Create React App, Remix,
Astro, Gatsby, Tailwind v4, no Tailwind, or Next.js 12 and older.

## Open a project (start screen)

```bash
cd engine && npm install
node bin/kerf-home.mjs        # then open http://localhost:4100
```

Paste a GitHub link (`github.com/team/app`) or a folder path. Kerf downloads
the repo into `~/Kerf/projects/`, finds the React + Tailwind app inside it
(monorepos included), installs it with the repo’s own package manager, starts
it with Kerf attached and opens it. Edits change Kerf’s copy, not your
original folder or GitHub, until a PR is made.

Kerf opens your app inside its editor at `/__kerf/`:
- **Top bar:** project, branch, page, desktop/tablet/mobile, zoom, version history, Create PR.
- **Left:** Layers. **Right:** Design and Chat.
- **Bottom:** the toolbar.

Keys:

| Key | Does |
|---|---|
| **E** / **P** | Edit / preview |
| **A** | Annotate |
| **⌘K** | Ask Kerf (Preview), or chat about the selection (Edit) |
| **⌘Z** | Undo |
| **⌘+** / **⌘−**, pinch | Zoom in / out |
| **⇧1** / **⇧0** | Fit / 100% |

Click to select (Shift-click for several), double-click text to retype it, and
drag a field’s icon to scrub its value.

## Run one app directly

```bash
node bin/kerf.mjs /path/to/app        # e.g. …/apps/web
```

It picks the right runner:
- **Vite:** loads the app's own `vite.config` with Kerf's plugin first.
- **Next.js:** `bin/kerf-next.mjs` starts Next's dev server behind a small Kerf server and adds Kerf's tagging loader through Next's own config loading.

Either way, the app's repo and config are not modified.

## How it works

- **Tags elements with their source.** Before the framework compiles JSX,
  each element gets `data-kerf="file.tsx:line:col"` (where it's defined), and
  component usages get `data-kerf-use=…` plus `data-kerf-n` (the component
  name). Dev only; production builds are untouched.
- **Edits Tailwind classes through the syntax tree.** It finds the right JSX
  element, then rewrites only its class string, including strings inside
  `cn()`, `clsx()`, `twMerge()` and shadcn-style `cva()` variants. It knows
  which classes conflict (`text-sm` is a size, `text-muted` is a color).
- **Uses the team's own scale.** It reads the app's Tailwind config, so 8px
  becomes `rounded-lg`, Bold becomes `font-bold` and `surface-2` stays a
  token. Values off the scale become arbitrary classes and are flagged.
- **Edits per screen size.** "All sizes", or only mobile, tablet or desktop.
  These use mobile-first `md:`/`lg:` classes, and the other sizes keep how they looked.
- **Is safe.**
  - Every change is re-parsed before it's written. If a change still breaks
    the page, Kerf undoes it automatically.
  - Undo refuses to overwrite a file that changed outside Kerf.
  - Text that comes from data or code is protected, and Kerf says why.

## Design panel

The panel shows only what fits the selected element:
- Text gets typography; icons get an icon color.
- Frames get auto layout.
- Padding and margin appear when used; otherwise there's a **+** to add them.

Everything is named the way a designer would say it, e.g.
*Title “Stratemark”*, *Button “Enter”*, *Row*, *Stack*.

The sections:
- **Typography:** size, weight, line height, letter spacing, align.
- **Color:** text color, fill (solid, gradient, gradient text), stroke.
- **Shape and effects:** radius (or per corner), opacity, shadow.
- **Auto layout:** direction, wrap, 3×3 alignment, gap, space between, padding.
- **Size:** Hug / Fill / Fixed, plus margin.
- **Component properties** (e.g. icon weight, button variant). For variant
  components, choose *Only this one*, *All “ghost”* or *Every Button*.

On the canvas:
- Drag padding and size handles (they snap to 4px; hold Shift for 1px).
- Hold Alt to measure spacing.
- Drag the selection to reorder it.

The canvas keeps the app at its real width and scales it to fit, like a Figma frame.

## Structure

Use the action row in the Design panel, or keys:

- **Move up/down** (⌥↑ ⌥↓), or **drag** the selected element over its siblings
- **Duplicate** (⌘D) and **Delete** (⌫)
- **Group into a frame** (⌘⌥G) and **Ungroup** (⇧⌘G)
- **Swap** an icon (searchable picker with previews, from the same icon library) or a component for another of yours
- **Add** (I): text, heading, button (your Button if you have one), image (upload), icon, frame, or any of your components, before, after or inside the selection
- **Images**: replace by upload or link, alt text, cover/contain/fill. Uploads go to `public/kerf/`.

Kerf adds and removes imports for you. Elements shown by a condition or
repeated by a list are protected: Kerf explains and points you to the parent.

## AI

Paste your Anthropic key on the start page once. It's saved to `engine/.env`,
which is git-ignored. Then:

- **Ask bar (Preview):** describe a change to the whole screen.
- **Chat (Edit, ⌘K):** the same, scoped to the selection, its parents and children.
- **Notes (A):** draw a pin, box, circle or arrow and write a note. **Apply all**
  answers each note on its own: what Kerf changed, or why it couldn't, with a
  switch to leave any note out.
- **Attachments and voice:** paste, drop or attach images; Claude sees them and
  can place one in the design. The mic dictates in your browser's language (Chrome, Safari).

All three share one conversation, which is saved, so you can follow up anywhere.

Claude (`claude-opus-5-5`) answers with the same edits the panel makes:
- styles, properties and text
- structure: delete, duplicate, move, swap, insert, replace, group, images

Kerf highlights the targets in amber and writes nothing until you click
**Apply**. Every applied change can be undone. Requests about behavior or data
are answered as developer work, with no edits.

## Versions and pull requests

- **Saving versions:** a version is saved when you go from Edit back to Preview, or when you click **Save as a version** in History.
- **History:** shows each version. You can see the screen **before** it, or **undo back** to it.
- **Create PR:** commits Kerf’s edits on a `kerf/…` branch, pushes it, and opens the pull request with GitHub’s `gh` CLI (or gives you the link to finish on GitHub).
  - The PR description lists what changed in plain words, with code details folded away.
  - Creating it again on the same branch updates that pull request.
- **Saved sessions:** history, versions and chat are kept in the app's `.kerf/` folder (git-ignored), so they survive restarts.

## Local API (same origin as the app)

| Route | Does |
|---|---|
| `GET /__kerf/theme` | The app's tokens, scales and breakpoints |
| `POST /__kerf/inspect {loc}` | The element's tag, classes, properties and whether its text is editable |
| `POST /__kerf/edit {loc, ops?, text?, props?, cva?, bp?}` | Apply changes, e.g. `ops: [{prop:'radius', value:8}]`, `bp: {mode:'only', start:null, end:'md'}` |
| `POST /__kerf/structure {loc, op}` | Delete, duplicate, move, swap, insert, replace, group, ungroup, image |
| `POST /__kerf/undo` | Undo the last edit |
| `GET /__kerf/changes` | Every edit made this session |
| `POST /__kerf/ai`, `/__kerf/ai/apply` | Ask Claude for a proposal; apply it |
| `GET /__kerf/versions`, `POST /__kerf/version`, `/restore`, `/peek` | Versions |
| `POST /__kerf/pr` | Create or update the pull request |

Style properties: `bg`, `color`, `borderC`, `fontSize`, `fontWeight`,
`lineHeight`, `letterSpacing`, `align`, `radius`, `rTL`/`rTR`/`rBR`/`rBL`,
`padX`, `padY`, `mX`, `mY`, `gap`, `borderW`, `opacity`, `shadow`, `w`, `h`,
`layout`, `alignItems`, `justify`, `wrap`, `gradient`, `clipText`, `fit`.

## Tests

```bash
npm test                                   # engine tests
node scripts/live-check.mjs http://localhost:5173   # real edits against a running app
```

## Next

The founder is choosing what comes next from `../CHECKLIST.md`. The leading ideas:
- **Match to Figma**
- **Hover, disabled and empty states**
- **One-step install**
- **Safer PRs** (build check, before/after screenshots)
- **Tailwind v4**
