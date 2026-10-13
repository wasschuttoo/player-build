# Build Album

Plan eFootball player training builds around the managers you own and their playstyles. Paste an efhub player link (or search by name), pick a manager and playstyle, and get the progression-point split that gives the highest overall. A squad builder suggests and rates a full XI from your club.

## Run locally

Requires Node 24 or newer. No npm install needed.

```
node server.js
```

Open http://localhost:4747. On Windows you can double-click `start.cmd`.

## Where data lives

The server is stateless. Your managers, club, saved squads and recent cards are stored in your browser's localStorage, so they stay on that device and browser. Clearing site data removes them. If you used an older version that kept `my-managers.json` and `my-club.json` next to the server, they are imported into the browser once on first load.

## Live site (GitHub Pages)

https://wasschuttoo.github.io/player-build/

The live site is fully static. All build maths runs in your browser, and managers, boosts and the player search index are read straight from efhub.

Player cards come from the library in `public/data/cards/`. efhub doesn't allow browsers to read player pages directly, so new cards are added through GitHub:

1. Paste an efhub link for a card that isn't in the library. The app offers a **Request this card** link.
2. That opens a GitHub issue titled `Add player <id>`. Submit it.
3. The **Add player card** workflow fetches the card, commits it, redeploys the site, and closes the issue. This takes about a minute.

### One-time setup

In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**. Every push to `main` then deploys through `.github/workflows/pages.yml`.

### Adding cards by hand

```
node scripts/fetch-card.js https://efhub.com/players/88046292701296
node scripts/fetch-card.js --import cache/players
```

The first fetches one or more cards from efhub. The second copies cards already cached by the local server. Commit `public/data/cards/` afterwards.

Player data comes from efhub.com. Respect their terms and keep traffic light.
