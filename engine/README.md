# Kerf engine (Phase 1)

The core trick from the PRD: link every element on screen to the exact line of
code that made it, then change that code the way a careful developer would.

## What it does today

- **Tags elements with their source.** A Vite plugin stamps each element with
  `data-kerf="src/file.tsx:line:col"` (where it's defined) and
  `data-kerf-use=…` (where a component like `<Card>` is used). Dev only;
  production builds are untouched.
- **Edits Tailwind classes through the syntax tree.** It finds the right JSX
  element, then rewrites only its class string, including the string inside
  `cn()`, `clsx()` and `twMerge()`. It knows which classes conflict (for
  example `text-sm` is a size but `text-muted` is a color) and leaves `hover:`,
  `md:` and `dark:` variants alone.
- **Uses the team's own scale.** Reads the app's `tailwind.config.js`, so 8px
  becomes `rounded-lg`, Bold becomes `font-bold` and `surface-2` stays a
  token. Values off the scale become arbitrary classes and are flagged.
- **Retypes fixed text.** It refuses text that comes from data or code and
  says why.
- **Is safe.** Every change is re-parsed before it's written. There's an undo
  history, and undo refuses to overwrite a file changed outside Kerf.

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

In the app: **E** to edit, **P** to preview. Click to select, double-click text
to retype, drag a field’s icon to scrub, **⌘Z** to undo.

## Run one app directly

```bash
cd engine && npm install
node bin/kerf.mjs /path/to/app/apps/web
```

This starts the app's own Vite dev server with Kerf attached. The app's repo
and config are not modified.

Local API (same origin as the app):

| Route | Does |
|---|---|
| `GET /__kerf/theme` | The app's tokens and scales |
| `POST /__kerf/inspect {loc}` | The element's tag, classes and whether its text is editable |
| `POST /__kerf/edit {loc, ops?, text?}` | Apply changes, e.g. `ops: [{prop:'radius', value:8}]` |
| `POST /__kerf/undo` | Undo the last edit |
| `GET /__kerf/changes` | Every edit made this session |

Properties: `bg`, `color`, `borderC`, `fontSize`, `fontWeight`, `lineHeight`,
`letterSpacing`, `align`, `radius`, `rTL`/`rTR`/`rBR`/`rBL`, `padX`, `padY`,
`gap`, `borderW`, `opacity`, `shadow`.

## Tests

```bash
npm test                                   # unit tests
node scripts/live-check.mjs http://localhost:5173   # real edits against a running app
```

## Next

1. AI: a request plus the selected element’s code goes to Claude, and the edits come back for approval.
2. Create a branch and PR from a session’s edits.
3. Reorder (moving JSX between siblings) and “only here” edits on shared components.
4. Next.js support.
