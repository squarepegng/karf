# Kerf: handoff for the next AI session

**Read this first, then `CLAUDE.md` (product decisions, PRD links, design tokens), then `CHECKLIST.md` (open decisions).**
Last updated: 2026-10-21.

---

## 1. What Kerf is (one paragraph)

Kerf lets designers and founders edit their team's **real, running React + Tailwind app** the way they'd edit in Figma: select anything, change colour, type, spacing, layout, size, images, structure. Kerf writes the change into the source code as a careful developer would (AST edits of Tailwind classes, never find-and-replace), and the changes go to developers as one **GitHub pull request**. It also has AI that does the same edits from plain-English requests: an Ask bar, ⌘K chat and on-screen notes. "Kerf" is the working name. The user sometimes types "Kev" or "karf". The GitHub repo is `squarepegng/karf`.

## 2. Who you're working with (important)

- **The founder is a designer, not an engineer.** Explain briefly in plain language, do the work directly, and don't re-ask for permission they already gave. They say "you" and "it" loosely.
- **They're careful with credits.** Prefer CLI and direct routes over long browser-clicking loops (a Vercel clicking loop once burned their credits and frustrated them). Keep replies short.
- **They want Figma/Framer-quality UI.** It should be clean, intuitive and Figma-like, never developer-ish. "Speak designer, not developer" is a standing rule.
- **Security rules:**
  - Never ask them to paste tokens or passwords in chat.
  - Never read, print or repeat the Anthropic API key. It lives in `engine/.env` (git-ignored) and is set from the key field on the Kerf start page.
  - Keys were pasted in chat earlier in this project. Treat those as compromised; the user was told to revoke them.
  - Don't copy sign-in tokens or other credentials between sites or apps, even for testing.
- **Git rules:**
  - Work on branches with pull requests.
  - **Merge to `main` only when the user explicitly approves** (for example: "I've reviewed PR N and approve it. Squash-merge it into main now…").
  - Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Never test on the user's real Stratemark repo in a way that pushes or changes it.** Use a throwaway `git worktree` copy (see section 7), and never click "Create pull request" against it.

## 3. Where everything is

| What | Where |
|---|---|
| Kerf repo (git root) | `/Users/mac/Documents/kerf` → GitHub `squarepegng/karf` |
| The real product (engine + editor) | `/Users/mac/Documents/kerf/engine` |
| Original single-file prototype | `index.html` on `main` of `squarepegng/karf`, deployed by Vercel from `main` |
| Project context and decisions | `/Users/mac/Documents/kerf/CLAUDE.md` |
| Open decisions checklist | `/Users/mac/Documents/kerf/CHECKLIST.md` |
| The user's own test app: Stratemark | `/Users/mac/Documents/STRATEMARK-app` → GitHub `squarepegng/STRATEMARK-app` (web app in `apps/web`, Vite + React + Tailwind v3) |
| Kerf's own copy of Stratemark (opened from its GitHub link) | `/Users/mac/Kerf/projects/squarepegng-stratemark-app`. **The user's ~63 unsent Kerf edits live here**, saved in `apps/web/.kerf/session.json`. Do not reset or delete. |
| PRD | https://claude.ai/code/artifact/dcb2536a-92df-4e67-b457-ef372bced01b |
| Design system | https://claude.ai/artifact/9zuJsZn7HJ4JoPgjHpsgDH |
| Editor UI designs (6 screens) | https://claude.ai/artifact/HvAysqH9RWNmgXdTbJanM9 |
| Live prototype | https://claude.ai/artifact/XCK8KwfQjqVnceGr1PvoYt |

## 4. How to run it

```bash
cd ~/Documents/kerf/engine && node bin/kerf-home.mjs
```

- This opens the **start page at http://localhost:4100**: paste a GitHub link or a folder path, save the Anthropic key, open the project.
- The user usually runs this in the Claude terminal tab `c4`.
- If port 4100 or 5173 is busy, stop the old processes first: `lsof -t -iTCP:4100 -sTCP:LISTEN | xargs kill`.
- The app opens with the editor at `http://localhost:<port>/__kerf/`.
- To run one app directly: `node bin/kerf.mjs /path/to/app`. It picks Vite or Next.js automatically.
- Tests: `cd engine && node --test test/`. 33 tests, all passing.

## 5. Branches and pull requests (state right now)

**`main` is current. It has everything below, and there are no open pull requests.** The local copy is on `main`.

| PR | What's in it | State |
|---|---|---|
| #1, #2 | Prototype Edit mode; the engine that opens a GitHub project and edits it like Figma | Merged |
| [#3](https://github.com/squarepegng/karf/pull/3) | AI (Ask, ⌘K chat, notes with per-note results, image attachments, dictation); component properties; structure edits (delete, duplicate, move, swap, insert, replace, group/ungroup, images); layout tools and on-canvas handles; plain-language changes; saved sessions; cva variant editing; history and Create PR | Merged 2026-10-21 |
| [#4](https://github.com/squarepegng/karf/pull/4) | Designer names everywhere; panel shows only what fits; Figma-style canvas (zoom, fit, device frames); fixes (disabled elements selectable, autofocus no longer steals shortcuts, plain PR dialog, Save as a version, start-page logs hidden) | Merged 2026-10-21 |
| [#5](https://github.com/squarepegng/karf/pull/5) | Edit per screen size ("All sizes" / "Mobile only"…); Next.js 13+ support; clear messages for unsupported projects; Tailwind TS configs; `HANDOFF.md`, `CHECKLIST.md`, updated README | Merged 2026-10-21 |

All were squash-merged. The old branches `kerf/ai-layer`, `kerf/sprint-1` and `kerf/sprint-2` are fully contained in `main`; don't build on them. Start new work on a fresh branch from `main`.

**Stacked PRs:** after a squash merge, the next PR in the stack conflicts. If `main` matches the merged branch exactly (check with `git diff origin/main origin/<merged-branch>`), run `git merge -s ours origin/main` on the next branch and push. That records the merge without changing any files, and the PR becomes clean.

## 6. How the engine works (map for a developer)

**Core idea:**
- A tagger stamps every JSX element with `data-kerf="file.tsx:line:col"`, and component usages with `data-kerf-use` + `data-kerf-n`, before the framework compiles it.
- The editor runs the app in a same-origin iframe at `/`, maps clicks back to source, and changes code through AST edits (Babel parser + magic-string).

| File (`engine/`) | Job |
|---|---|
| `bin/kerf-home.mjs` | Start page (port 4100): open a GitHub link or folder, save the key, show status (logs hidden under "Technical details") |
| `bin/kerf.mjs` | Runner. Next.js apps go to `kerf-next.mjs`; otherwise it loads the app's own `vite.config` with Kerf's plugin first |
| `bin/kerf-next.mjs` | Next.js runner: custom HTTP server; `/__kerf/*` goes to Kerf, the rest to Next. Adds Kerf's loader by hooking Next's config loader through `Module._load`, so the user's `next.config` is never touched |
| `src/next-loader.cjs` | Webpack "pre" loader that tags JSX for Next |
| `src/plugin.mjs` | `createKerf(webRoot)`: the shared core (tagging + `/__kerf` API routes). The default export is the Vite plugin |
| `src/project.mjs` | Clone or locate the project, find apps, `appProblem()` gives plain reasons for unsupported setups, install, start |
| `src/ast.mjs` | `tagSource`, `parseCode`, `walk` |
| `src/edit.mjs` | `editElement` (class ops, text, props, cva), `applyResponsive` (per-size edits), `describe`, `createEditor` (history, undo), `parseLoc` (only the app's own .jsx/.tsx, not node_modules) |
| `src/tailwind.mjs` | `loadTheme` (JS/TS configs; includes `screens`), `buildTheme`, `matcher`, `applyOps` (each design property ↔ Tailwind class) |
| `src/cva.mjs` | Variant components (shadcn `cva`): base, one variant, or a compound variant |
| `src/sources.mjs` | Where styles really live: style tables, constants, branches, class objects, `@apply` CSS classes; follows imports. `editSourced` in `edit.mjs` changes them there (scope here / key / all, or an AI target) |
| `src/tokens.mjs` | Design tokens: reads colour tokens (CSS variables per light/dark selector, or hex in the Tailwind config) and writes them back in their own format |
| `src/structure.mjs` | Delete, duplicate, move, swap, insert, replace, group/ungroup, image |
| `src/props.mjs` | Component properties (e.g. icon weight, button variant) |
| `src/library.mjs` | Icons (lucide, phosphor), project components, uploads to `public/kerf/` |
| `src/session.mjs` | Saves history, versions and chat to `<app>/.kerf/session.json` (git-ignored via `.git/info/exclude`); repo info; creates the PR via git + `gh` |
| `src/ai.mjs` | Claude calls (`claude-opus-5-5`, structured output via Zod). Schema covers style ops, structure actions, per-note results and image attachments (`attachment:N`) |
| `src/labels.mjs` | Plain-language labels: `changeLabel`, `designName` ("Title “Stratemark”") |
| `editor/index.html`, `editor.js`, `editor.css` | The whole editor UI: canvas with zoom, layers, design panel, toolbar, Ask/chat/notes composer, history, PR dialog |
| `test/engine.test.mjs` | Engine tests |

**Supported today:** React with **Vite** or **Next.js 13+ (webpack dev, not Turbopack)**, styled with **Tailwind v3**. Unsupported setups get a plain message: Create React App, Remix, Astro, Gatsby, Tailwind v4, no Tailwind, Next 12.

## 7. How to test safely (the pattern used so far)

```bash
SP=<your scratchpad>
cd /Users/mac/Documents/STRATEMARK-app && git worktree add -q --detach $SP/sm HEAD
ln -s /Users/mac/Documents/STRATEMARK-app/node_modules $SP/sm/node_modules
ln -s /Users/mac/Documents/STRATEMARK-app/apps/web/node_modules $SP/sm/apps/web/node_modules
cd /Users/mac/Documents/kerf/engine && node bin/kerf.mjs $SP/sm/apps/web   # usually lands on :5174
# afterwards: kill the server, then: git -C /Users/mac/Documents/STRATEMARK-app worktree remove --force $SP/sm
```

- Stratemark's screens beyond the access-code page need a sign-in Kerf can't do. Test on the access-code screen and the 404 page. **Don't** copy sign-in data across.
- For Next.js, a sample app was made with `npx create-next-app@14.2.15 shop --ts --tailwind --no-eslint --app --no-src-dir --import-alias "@/*" --use-npm` in a scratch folder.
- Real AI calls cost the user money. Keep AI tests few.
- Use the built-in browser to check the UI; `javascript_tool` is handy for reading state inside the iframe.

## 8. What works (verified)

- **Selection and naming:** select any element, including disabled buttons. Designer names show on the canvas, in layers, panel, toasts, history and the PR.
- **Design panel:**
  - Typography (size, weight, line height, letter spacing, align), text colour, fill (incl. gradients and gradient text), stroke, radius (incl. per corner), opacity, shadow.
  - Auto layout (direction, wrap, 3×3 align, gap, space between, padding), size (Hug / Fill / Fixed), margin.
  - Component properties and cva variants ("Only this one / All ghost / Every Button").
- **On the canvas:** padding and size handles (snap 4px, Shift for 1px), Alt to measure, Shift-click to multi-select, drag to reorder, zoom/fit/100%/pinch, desktop/tablet/mobile frames.
- **Structure:** delete, duplicate, move, swap icons and components, insert, replace, group/ungroup (⌘⌥G / ⇧⌘G), add and replace images (uploads).
- **Per-size edits:** "All sizes" vs "Mobile only" (and tablet, desktop) via mobile-first `md:`/`lg:` classes. Verified on Next.js: desktop 20px, tablet 16px, mobile 18px.
- **AI:**
  - Ask bar, ⌘K chat and notes (pin, box, circle, arrow) share one conversation, which is saved.
  - Proposals show in amber, then Apply or Discard. Notes results are grouped per note with Done / Partly / Not here, a switch per note, and hover highlighting.
  - Image attachments (paste, drop or button): Claude sees them and can place one in the design. Mic dictation uses the Web Speech API (Chrome and Safari).
- **History and PR:** undo, saved versions ("Save as a version", and automatically when going back to Preview), "Show before", Create PR (one PR, plain-language body with code details folded).
- **Saved sessions:** history, versions and chat survive restarts.

**Edit anywhere (built 2026-10-21):**
- Styles in style tables, constants, branches and CSS classes are edited at their source, with a reach choice in the panel.
- A colour palette (light/dark tokens) shows when nothing is selected.
- The AI chooses the approach and reach first and says it in one sentence. It can also change tokens, or make a last-resort code edit (diff shown, auto-undo if the page breaks).
- Tested with the Stratemark chip request: Claude added dark-theme colours to all four statuses in `CONFIDENCE_STYLES`, the TypeScript check passed, and undo restored everything.

## 9. Known gaps and not-verified items

- **Not verified:** double-clicking text to retype it. The code path works when triggered directly, but the test tool couldn't do a real double-click. Ask the user to try it.
- **Next.js** is tested only on a sample app, not a real team project. Turbopack isn't supported.
- **Not supported yet:** Tailwind v4 (common in new Next apps); signing in to the tester's app.
- **Setup needs a developer** (Node, git, `gh`). There's no one-step install.
- **PRs** have no build/type check and no before/after screenshots yet.
- **No hover/focus/disabled state editing**, and no "used in N places".
- **No error reporting** or "Report a problem".
- **Font size changes can change line height:** Tailwind size classes carry their own line height (e.g. 24 → 36 also set the line height 32 → 40).
- **At very narrow windows, Fit stays at a 50% minimum**, so the canvas scrolls sideways.

## 10. Open decisions (waiting on the user)

The user is marking **`CHECKLIST.md`** (Keep / Later / Remove) and will say which items to build and in what order. Highlights:

- **My top recommendations:**
  - **2.1 "Match to Figma":** compare a Figma frame with the live screen and fix the drift as a PR.
  - **2.3 States and real content.**
  - **1.1 One-step install** and **1.3 Safer PRs**, which must come before testers use Kerf alone.
- **Conflict to resolve:** 3.2 (merge notes into the Ask box) vs 3.3 (keep notes as their own mode). 3.1 (merge the Ask bar and ⌘K chat) is a separate choice.
- **Never add free positioning** (drag anywhere). Auto layout stays the backbone.

**Readiness verdict given to the user:** ready for a small **guided** test (5–10 friendly designers on a call), not yet for the 20–50 person private beta. That waits on one-step install, safer PRs and app sign-in.

## 11. Conversation history in brief

1. Pushed the prototype and `CLAUDE.md` to `squarepegng/karf` and deployed it on Vercel. A browser-clicking deploy loop wasted credits; prefer CLI.
2. The user clarified the goal: real Figma-style editing of any element, not a demo. We rebuilt Edit mode (PR #1, merged), then made it Figma/Framer-clean on request.
3. Built the real engine to open any React + Tailwind codebase from a GitHub link or folder (the start page) instead of per-app editors. Tested on Stratemark.
4. Added real Claude AI (Ask, ⌘K, notes) using the user's saved key (PR #2 merged; PR #3 open with much more).
5. On user feedback: AI must "do what it can" rather than refuse. Added structure edits (delete, replace, swap, insert, images), gradients, grouping, layout tools, plain language, saved sessions, cva variants.
6. Chat redesign: modern composer, image attachments, mic dictation, then notes answered one by one.
7. Full product review, followed by Sprint 1 (designer language, Figma canvas, quick fixes; PR #4) and Sprint 2 (per-size edits, Next.js, unsupported messages; PR #5).
8. Wrote `CHECKLIST.md` of every suggestion for the user to decide on. They'll come back with choices.

**Next step for whoever picks this up:** wait for the user's checklist choices, or answer their question. Don't start new features unasked. After any engine change, restart their Kerf (kill ports 4100/5173, then run `node bin/kerf-home.mjs` in terminal tab c4) so they get the new code.
