# Tovi website

The public landing page for Tovi. Plain HTML, CSS and JavaScript, with no build step.

- `index.html`: the page
- `styles.css`: all styles (tokens at the top match the product)
- `main.js`: the live mini editor in the hero, and the beta sign-up forms
- `DESIGN.md`: the design plan the page follows

## Run it locally

```bash
cd site && python3 -m http.server 4300
```

Then open http://localhost:4300.

## Put it online (Vercel)

Make a new Vercel project from this repo and set **Root Directory** to `site`, with framework preset "Other" and no build command. Then add the domains (usetovi.com, tovi.design) under the project's Domains settings.

## Before launch

- **Connect beta sign-ups.** Set `SIGNUP_ENDPOINT` at the top of `main.js` to a form service that accepts a JSON POST of `{ email }` (for example a Formspree form). Until then, the form says sign-ups aren't connected.
- **Pro pricing** says "Priced at launch". Update it once the price is set.
