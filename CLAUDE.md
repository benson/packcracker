# Pack Cracker

MTG booster pack value guide. Static site hosted on GitHub Pages.

## Architecture
- Pure client-side JS, no build step
- `app.js` - main application logic
- `scripts/cache-cards.js` - GitHub Actions script for daily price cache
- `data/` - cached card data JSON files per set
- `sets.json` - set metadata

## Key patterns

### Card fetching flow
1. Check in-memory `cardCache` Map
2. Try cached JSON from `data/{set}-{boosterType}.json`
3. Fall back to live Scryfall API via `fetchLiveCards()`

### Filtering collector exclusives
Scryfall's query filters don't work reliably for new sets. Use client-side filtering:
- `COLLECTOR_EXCLUSIVE_PROMOS` - promo_types to exclude
- `COLLECTOR_EXCLUSIVE_FRAMES` - frame_effects to exclude (e.g., 'inverted')

See `~/.claude/magic-nuances.md` for full MTG/Scryfall details.

## Pitfalls encountered

### New set data issues
- Scryfall metadata (`is:boosterfun`, promo filters) not populated until after release
- Cards may have `booster: true` even when collector-exclusive
- Always verify with actual card data, not just query filters

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
