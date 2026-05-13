# Pack Cracker

MTG booster pack value guide. Static site hosted on GitHub Pages.

## Architecture
- Pure client-side JS, no build step
- `app.js` - main application logic
- `scripts/cache-cards.js` - GitHub Actions script for daily MTGJSON-backed cache
- `data/` - cached card data JSON files per set
- Set list (master): `https://bensonperry.com/shared/sets.json` - built by homepage's update-sets workflow. Both the frontend (via `fetchSets` in shared/mtg.js) and the cache-cards.js CI script read from there. No local `sets.json` here.
- Booster source of truth: `https://bensonperry.com/shared/boosters/{set}.json`, generated from MTGJSON by the homepage workflow.

## Key patterns

### Card fetching flow
1. Check in-memory `cardCache` Map
2. Try cached JSON from `data/{set}.json`
3. Fall back to MTGJSON booster membership enriched with live Scryfall card data

### Pack membership and odds
MTGJSON booster configs decide which cards can appear in each pack type and what their per-finish odds are.
Scryfall remains an enrichment layer for current-ish prices, image URLs, and card links.

See `~/.claude/magic-nuances.md` for full MTG/Scryfall details.

## Pitfalls encountered

### New set data issues
- Homepage must publish MTGJSON-derived shared artifacts before Packcracker refreshes its cache.
- If a set is missing from Packcracker, first check whether `shared/boosters/{set}.json` exists and has a supported app booster type.
- Always verify pack membership from MTGJSON sheets, not Scryfall search flags.

### Safari favicon caching
- Extremely aggressive, separate from regular cache
- Cache location: `~/Library/Safari/Favicon Cache/`
- Added PNG fallback (`favicon.png`) for better compatibility

### Terminal/environment
- Local dev: `python3 -m http.server 3000`
- In-memory cardCache resets on page reload (hard refresh to clear)

## Style
- All lowercase text throughout UI
- Minimal, clean aesthetic
- No auto-focus on set dropdown (let user initiate)
