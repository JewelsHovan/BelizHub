# Beliz Hub

A home for interactive learning tools, deployed with GitHub Pages.

**Live:** https://julienhovan.com/BelizHub/

## Apps

| App | Folder | Live |
| --- | --- | --- |
| PCR, from molecule to protocol | [`pcr-explained/`](pcr-explained/) | https://julienhovan.com/BelizHub/pcr-explained/ |

Each app is a self-contained project in its own folder with its own README, tests and build. The root `index.html` is the landing page that links to them.

## How deployment works

`.github/workflows/pages.yml` runs on every push to `main`:

1. installs, tests and builds each app (Vite apps get `VITE_BASE=/BelizHub/<app>/` so asset paths resolve under the sub-path)
2. copies the root `index.html` plus each app's build output into `site/`
3. publishes `site/` to GitHub Pages

The repo's Pages source is set to **GitHub Actions**, so there is no `gh-pages` branch to maintain.

## Adding another app

1. Put it in a new folder, e.g. `my-app/`, with its own `package.json` (or plain static files).
2. In `pages.yml`, add a build step and copy its output into `site/my-app/`. Static apps just need the copy.
3. Add a card for it in the root `index.html`.

## Working locally

```bash
cd pcr-explained
npm install
npm run dev      # dev server with hot reload
npm test         # unit tests
npm run build    # production build to dist/
```

To preview the hub page locally, open `index.html` in a browser; the app link works after `npm run build` only when served under the same paths as Pages, so for app work use `npm run dev` inside the app folder instead.
