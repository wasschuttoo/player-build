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

## Deploy to Render (free)

1. Push this folder to a GitHub repo.
2. In Render, choose **New → Blueprint** and connect the repo. `render.yaml` sets up the web service.
3. Deploy. Render sets `PORT` and `RENDER`; nothing else is needed.

Notes:

- Free instances sleep after about 15 minutes idle; the first visit afterwards takes around 50 seconds.
- The efhub card cache lives on the instance's disk and resets on every deploy or restart. Browsers send back the cards they already have, so rebuilding the cache is gradual.
- Player data comes from efhub.com. Respect their terms and keep traffic light.
