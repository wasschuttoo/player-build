# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One eFootball player (the owner) who trains player cards in-game. Their manager roster grows over time; today it is: Deschamps, Luis A. Roman, Lampard, Conte, Mourinho (Madrid Chamartin B, boosts Finishing + Aggression), R. Martínez (Portugal) and Chivu. They switch between team tactics. They have two jobs: deciding how to spend a card's progression points before tapping them into the game, where a wrong call wastes training points, and picking the matchday eleven from their club for a given manager and playstyle.

## Product Purpose

The tool takes an efhub.com player card (by URL or name search) plus a chosen manager and team tactic. It returns training-point allocations that give the best final in-match stats once the manager's tactic-proficiency multiplier and boost abilities are applied. Success means the user copies the slider numbers straight into the game and trusts that they are optimal for that manager.

Its second job is the squad: from the cards the user owns, it picks or helps pick the eleven that rates highest for a manager and playstyle, with every rating already including that card's best build. Success means the user sets the same eleven in-game and knows which playstyle suits it best.

## Positioning

efhub's own builder shows a card's progression but leaves the user to guess the allocation, and its "Max" button ignores the manager. This tool searches the allocation space with the manager's multiplier, the +1 boost stats and the card boosts all in play. It shows several objectives side by side so the trade-offs are visible.

## Operating Context

- Phone-first: used next to the console or game client while the user taps in sliders. It also works on a PC browser.
- Served from the user's PC on the home LAN; the phone opens it at the PC's LAN address.
- Home is the landing view: a player search, the most recently fetched cards, the current squad with its saved squads, and the "My managers" roster with the current manager marked. The brand mark returns to it from anywhere.
- Typical flow: paste an efhub player URL, or search by name, then pick a manager and tactic, then read the build, then enter the slider values in-game.
- Squad flow, before a match or a Weekend League session: open Squad, pick the manager, check the XI average on each playstyle tile, then tap "Suggest best XI" or fill places by hand, and save the squad by name.

## Capabilities and Constraints

- Data source: efhub.com. Card pages, the manager list (`cache/managers.json`, 68 managers) and card boosts (`cache/boosts.json`) are fetched and cached locally. Requests are spaced at least 5 seconds apart, as efhub's crawl-delay asks.
- Runtime: Node v24, no npm dependencies, started with `--use-system-ca` because of the corporate TLS proxy.
- Build objectives, all shown side by side:
  - **Max OVR**: highest position rating with the manager applied.
  - **Tactic-tailored**: weighted to the player's playstyle and position under the chosen tactic.
  - **Max chosen stat**: for example Finishing.
- Manager picker: the user's own managers come first, with a toggle to show all 68.
- "My managers" is an editable roster, saved on the server (`my-managers.json`) so phone and PC share it. It starts with the 7 current managers. The user can:
  - add a manager by searching the full efhub list;
  - remove one;
  - refresh the efhub manager list to pick up newly released managers;
  - enter a custom manager by hand (name, six tactic proficiencies, boost stats) when efhub doesn't list it yet.
- Squad builder (the Squad view):
  - **My club**: the cards the user owns, saved on the server (`my-club.json`). Cards are added by efhub link or name search and removed with a tap-again confirm. The club holds one entry per card; a squad holds one version of each player.
  - **Formations**: 4-3-3, 4-2-1-3, 4-2-3-1, 4-1-2-3, 4-3-1-2, 4-4-2, 4-1-4-1, 3-4-3 and 3-2-4-1, plus any formation typed by hand ("Custom…"): three to five lines, defence to attack, of one to five players adding up to ten outfielders (for example 4-1-2-1-2 or 352). The keeper is added automatically and positions are assigned per line. Changing formation moves players who no longer have a place to the bench.
  - **Suggest best XI**: an optimal assignment (Hungarian algorithm) of club cards to places. Each card is scored at its best-build OVR for that position under the chosen manager and tactic, plus a fit bonus: natural position +0.6, strong position +0.4, learned 0, off position −8. Goalkeepers only go in goal. The suggestion can be undone.
  - **Manual picking**: tapping a place lists the club cards ranked by fit, then OVR, labelled Natural, Can play, Learned or Off position.
  - **Bench**: up to 12 players.
  - **XI average**: shown for the current playstyle and on every playstyle tile.
  - **Saved squads** (`my-squads.json`): saved by name with formation, manager, tactic, eleven and bench. The working draft is kept in the browser until saved.
- Training rules:
  - 25 steps per slider; step n costs ceil(n/4); points = (level − 1) × 2.
  - Trained stats cap at 99.
  - Then the proficiency multiplier is applied, capped at 99.
  - Then +1 per manager boost stat, then card boosts, both uncapped.
- Terminology: sliders are Shooting, Passing, Dribbling, Dexterity, Lower Body Strength, Aerial Strength, Defending, and GK 1–3. "Proficiency" is the manager's team-tactic rating (40–99).

## Evidence on Hand

- Validated result: Torres (efhub id 88046292701296) with Mourinho [6,13] in Long Ball Counter (proficiency 90) gives Finishing 104 with sliders 18/0/4/4/4/0/0, OVR about 99.7.
- Core logic: `efhub_builder.js`. Cached data: `cache/`.
- The proficiency multiplier table above 90 is only partially known. Do not invent values beyond the extracted table.

## Product Principles

1. The numbers must match the game. The optimizer applies the pipeline in exactly the game's order, and nothing is approximated silently.
2. Slider values come first. The output reads as "what to tap", in game slider order.
3. Make trade-offs visible: show the competing objectives side by side, not a single opaque answer.
4. Be polite to efhub: cache everything, and never bypass the crawl delay.
5. The squad is the user's call. A suggestion never overwrites without an undo, and taking a player off the pitch never removes the card from the club.
