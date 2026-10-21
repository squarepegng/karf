# Kerf: decision checklist

Everything I've suggested so far, in plain words. For each item, mark what you want:

- **Keep**: build it next
- **Later**: good, but not now
- **Remove**: drop it

When you've decided, tell me which items to keep and which to remove. I'll build the "Keep" items in order.

---

## 1. Getting ready for testers

| # | Item | What it means | Status | Decision |
|---|---|---|---|---|
| 1.1 | One-step install | A single download or command that checks everything a tester needs (Node, git, GitHub login) and sets it up. Today a developer has to do this. | Not started | [ ] Keep [ ] Later [ ] Remove |
| 1.2 | Sign-in to the tester's app | If the app needs a login or access code, a clear "sign in here once" step, so the preview is signed in too. | Not started | [ ] Keep [ ] Later [ ] Remove |
| 1.3 | Safer pull requests | Before opening a PR, Kerf checks the code still builds, attaches before/after screenshots, and never writes straight to main. | Partly done (no build check or screenshots yet) | [ ] Keep [ ] Later [ ] Remove |
| 1.4 | Error reporting and "Report a problem" | Testers can send a report with one click, and you see what failed without asking them. Opt-in. | Not started | [ ] Keep [ ] Later [ ] Remove |
| 1.5 | Next.js support | Apps built with Next.js can be opened and edited, not just Vite apps. | Done, on main (sample app tested; not yet a real project) | [ ] Keep [ ] Later [ ] Remove |
| 1.6 | Edit per screen size | Choose "all sizes" or "only on mobile" (or tablet, desktop) so a change on one size doesn't leak onto the others. | Done, on main | [ ] Keep [ ] Later [ ] Remove |
| 1.7 | Tailwind v4 support | Newer projects that use Tailwind v4 can be opened. Kerf reads Tailwind v3 only today. | Not started | [ ] Keep [ ] Later [ ] Remove |

## 2. Features that make Kerf stand out

| # | Item | What it means | Status | Decision |
|---|---|---|---|---|
| 2.1 | **Match to Figma** | Paste a Figma frame link. Kerf compares it with the live screen and marks everywhere the build differs (spacing, colour, type, radius, missing parts). One click fixes them as a PR. This is my top recommendation. | Not started | [ ] Keep [ ] Later [ ] Remove |
| 2.2 | Polish pass | One button checks a screen and lists problems with one-click fixes: spacing off the scale, near-duplicate greys, low-contrast text, misaligned items, buttons that differ from their siblings. | Not started | [ ] Keep [ ] Later [ ] Remove |
| 2.3 | States and real content | Edit hover, focus, disabled, loading, empty and error states. Test with long names, empty lists and large numbers. | Not started | [ ] Keep [ ] Later [ ] Remove |
| 2.4 | "Used in 12 places" | Before changing a shared component, show every screen it appears on, with thumbnails. | Not started | [ ] Keep [ ] Later [ ] Remove |
| 2.5 | Live preview of AI changes | See the AI's proposed change on the screen before applying it, with a before/after slider. | Not started | [ ] Keep [ ] Later [ ] Remove |
| 2.6 | Edit the design system | Change the brand colour, type scale or corner radius once, and it updates the Tailwind config everywhere. | Not started | [ ] Keep [ ] Later [ ] Remove |
| 2.7 | Before/after screenshots in PRs | Every pull request includes images of the screen before and after the change, so reviewers see it without running the app. | Not started (part of 1.3) | [ ] Keep [ ] Later [ ] Remove |
| 2.8 | Share a link to a screen | A PM or developer opens an edited screen in a browser and leaves comments, with no install. Needs cloud mode. | Not started (later phase) | [ ] Keep [ ] Later [ ] Remove |
| 2.9 | Onboarding for the first edit | A short guided first change, so new users learn by doing. | Not started | [ ] Keep [ ] Later [ ] Remove |

## 3. Merge and simplify (decide each one)

| # | Item | What it means | Decision |
|---|---|---|---|
| 3.1 | Merge Ask bar and ⌘K chat | One "Ask Kerf" box. It works on whatever is selected, or the whole screen if nothing is. Removes one of the three AI entry points. | [ ] Keep [ ] Later [ ] Remove |
| 3.2 | Merge Ask bar with notes (marks) | One box for everything. Marks become a way to point at things, not a separate mode. Note: this is different from 3.1. I earlier suggested keeping notes separate, then suggested merging them. Choose one. | [ ] Keep [ ] Remove |
| 3.3 | Keep notes as their own mode | Notes stay separate: one mark, one note, one result per note. My earlier advice. | [ ] Keep [ ] Remove |
| 3.4 | One "Changes" list | Combine undo, the Changes list, Versions and the PR into one list. Each item can be undone. Versions become automatic checkpoints. | [ ] Keep [ ] Later [ ] Remove |
| 3.5 | Margin moved under "More" | Figma has no margin, and it leads to messy layouts. Steer people to padding and gap, and hide margin unless asked. | [ ] Keep [ ] Remove |
| 3.6 | Hide code by default | Code stays hidden unless someone asks for it. Already mostly the case. | [ ] Keep [ ] Remove |
| 3.7 | API key moves into Settings | Remove the key box from the start page; put it in a small Settings panel. | [ ] Keep [ ] Later [ ] Remove |

## 4. Things to never add

| # | Item | Why not | Decision |
|---|---|---|---|
| 4.1 | Free positioning, drag anywhere | Breaks responsive layouts, and developers reject the code it produces. Auto layout stays the backbone, as the PRD says. | [ ] Agree [ ] Disagree |

---

## Notes for your decision

- **Items 3.2 and 3.3 conflict.** Pick one.
- **1.5 and 1.6** are finished and merged into main.
- **Your call on order:** my recommendation is 2.1 (Match to Figma) first, then 2.3 (states and real content), with 1.1 and 1.3 needed before any tester uses Kerf alone.
