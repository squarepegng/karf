# Tovi: project context for Claude Code

This file summarizes every decision made so far in planning sessions with Claude (claude.ai). Read it before doing any work. The product is named **Tovi** (renamed from the working name "Kerf" in October 2026). Planned domains: usetovi.com (main) and tovi.design. The GitHub repo is still named `karf`.

> **Naming in code:** everything people see says Tovi. Internal identifiers keep "kerf" on purpose: the `data-kerf` tags, the `/__kerf/` editor address, the `.kerf/` session folder, `~/Kerf/projects/`, the `kerf/…` PR branches, `kerf-*.mjs` file names, `KerfError`/`createKerf`. Renaming those would break saved sessions and open PRs; do it only as a planned migration.

> **Picking this project up in a new session?** Read `HANDOFF.md` first: it has the current state (what's built, open PRs, how to run and test, rules, open decisions). Then read `CHECKLIST.md` for the decisions the founder is making. The "Immediate tasks" below are done; the build has moved on to the real engine in `engine/`.

## Who you're working with

The founder is a designer, not an engineer. Work directly: do the task, explain briefly in plain language, don't over-explain, and don't re-ask for permission already given. Never ask them to paste tokens or passwords; sign-ins happen on the service's own pages.

GitHub account: **squarepegng**. Repo: **https://github.com/squarepegng/karf** (public, currently empty).

## Immediate tasks, in order

1. Push `index.html` (the working prototype, in this folder) to `squarepegng/karf` on the `main` branch. Add this `CLAUDE.md` too.
2. Help connect the repo to Vercel: Add New → Project → Import `karf`, framework preset "Other", no build command, no output directory, Deploy. The founder hasn't confirmed whether they have a Vercel account yet; ask.
3. Write the technical architecture doc (see "Technical approach" below).
4. Start Phase 1 of the real product.

From now on, changes go to GitHub as branches and pull requests, not direct pushes to `main` (except the initial prototype upload).

## The product

**Problem.** Figma designs aren't usable until developers rebuild them in code, and things get lost along the way. AI app builders (Lovable, v0, Bolt) replace hands-on design craft with chat instructions. Designers have no way to fix the real product directly.

**What Tovi does.** Designers open their team's real, running web product, fix screens by hand with Figma-style editing, and send the changes to developers as a GitHub pull request, without touching code.

**Users.** Product designers on React + Tailwind teams, and founders/CEOs/builders without design training. The second group needs guardrails: values snap to the design scale, and contrast warnings appear.

**Goal.** A public launch (not just an internal MVP), preceded by a short private beta with 20–50 invited users.

## Core flow (two modes only)

1. **Connect repo** once.
2. **Preview**: use the live product normally to find problems and check fixes.
3. **Edit screen**: freezes that exact screen in its current state (data, scroll, open menus) so it can be edited by hand.
4. Back to **Preview**: automatically saves a version.
5. **Version history**: before/after with a drag slider or side-by-side; restore a version or remove changes.
6. **Create PR**: all changes across all screens go into one pull request, with before/after images attached.

## Editing feel

Like Figma, not like a page builder. Auto layout is the backbone. Use Figma's vocabulary: gap, padding, hug/fill, variants. Absolute positioning is an explicit toggle. When an edit touches a shared component, Tovi asks "Only here / Everywhere" (the rule prompt).

## AI layer: one AI, three ways to point

1. **Ask bar**: floating input in Preview.
2. **Selection-aware chat** in Edit mode (⌘K), aware of what's selected.
3. **Annotations**: pin, circle, box, or arrow drawn on any screen; a note opens at the mark (typed or voice); "Apply all" runs them as a batch.

Rules: before big changes, the AI shows its interpretation in amber for approval. It stays out of behaviour, data, and backend work (visual/layout only). Every AI change becomes an undoable version.

## Business model

Free when users bring their own AI key; paid when using Tovi's AI. Open question: how preview hosting works on the free plan (user's own machine vs a small cloud allowance).

## Technical approach

Two modes:

- **Local mode (build first).** The user's app runs on localhost; a small helper on their machine reads and writes source files.
- **Cloud mode (Phase 3).** The GitHub repo is copied into Tovi's cloud environment; Vercel builds preview deployments for each PR.

Key mechanism: map each element on the screen back to its exact place in the source code (component file and JSX node), then make edits as **AST-based code changes** (for example, changing Tailwind classes on the right JSX element), never as raw text find-and-replace. The diff should look like what a careful developer would write.

## Build order (each phase has a gate: don't move on until it works)

1. **Core trick.** Click an element in the running app → change its padding → the real source file updates correctly. Nothing else matters until this works.
2. **Figma feel.** Selection, property panel, auto layout controls, snapping, variants.
3. **GitHub + Vercel.** Repo connection, version history, PRs with before/after images, cloud mode.
4. **AI layer.** Ask bar, ⌘K chat, annotations.

Proposed test project: build a small sample React + Tailwind store ourselves (the prototype's sample store is called "Northfold") to test Tovi against.

## Design system

One dark theme for now (light theme and core components still to do).

| Token | Value |
|---|---|
| canvas | #1B1B1E |
| panel | #232327 |
| raised | #2D2D32 |
| line | #3A3A40 |
| ink | #EDEDF0 |
| ink-2 | #B0B0BA |
| ink-3 | #8B8B95 |
| select (blue) | #2B66D9 |
| intent (amber) | #E9B547 |
| danger | #F06A5F |

**Core colour rule: blue means "what you're touching"** (selection, focus, the Create PR button). **Amber means "Tovi's interpretation"** (guides, rule prompts, change markers, AI proposals).

Type: Geist for the interface (12px is the workhorse size), Geist Mono for code paths. Spacing: 4 / 8 / 12 / 16. Radii: 4 / 6 / 10.

Polish target: Framer-level finish with Figma's structure. All floating controls live in **one minimal bottom toolbar** of icons with hover tooltips (name + shortcut). The Preview/Edit mode switch is in that toolbar; sub-tools open in flyouts; the pending change count is an amber dot on the history icon.

## The prototype (`index.html`)

A single self-contained HTML file (~80 KB, no build step). It demonstrates the whole flow: a live sample shop (filtering, add to cart), Edit mode with selection and a property panel, the Only here / Everywhere prompt, ⌘K chat that applies changes and saves versions with Undo/Compare, annotation drawing with notes and "Apply all", version history with a drag slider, and a Create PR modal listing the changes and files. On claude.ai it uses Claude for the AI; elsewhere (like Vercel) it falls back to built-in pattern matching. Voice input is simulated. It's a demo, not the real product: the real product is built from scratch in the phases above.

## Other documents (on claude.ai, owned by the founder)

- PRD "Kerf — Product Requirements" (made before the rename): https://claude.ai/code/artifact/dcb2536a-92df-4e67-b457-ef372bced01b
- Design system "Kerf": https://claude.ai/artifact/9zuJsZn7HJ4JoPgjHpsgDH
- Design canvas "Kerf editor UI" (six screens: Preview, Edit, History, Create PR, Annotate, Edit chat): https://claude.ai/artifact/HvAysqH9RWNmgXdTbJanM9
- Live prototype: https://claude.ai/artifact/XCK8KwfQjqVnceGr1PvoYt

## Open questions (not yet decided)

- Free-plan preview hosting: local machine vs cloud allowance.
- How many hours a week the founder can put in.
- Confirm the test project (sample React + Tailwind store built by us).
- Where to find the 20–50 beta users.
- Whether Edit mode can reach hover and hidden states at launch.
- Success measure targets (still "to set").
