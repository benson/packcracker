# pack cracker

find the valuable cards in your magic: the gathering booster packs.

**live site:** [bensonperry.com/packcracker](https://bensonperry.com/packcracker)

## features

- browse valuable cards from any mtg set (standard, modern, and beyond)
- filter by booster type (play vs collector)
- adjustable minimum price threshold ($1, $2, $5, $10)
- filter options for foils and rares/mythics
- links to tcgplayer for current market prices
- expected value calculation per pack
- url state sharing - share your exact view with others

## data

card prices come from [scryfall](https://scryfall.com/) and are cached daily via github actions. prices reflect tcgplayer market rates.

## development

static site, no build step. to run locally:

```bash
python3 -m http.server 3000
```

then open [localhost:3000](http://localhost:3000).

## credits

- code written entirely by [claude code](https://claude.ai/claude-code)
- card data from [scryfall api](https://scryfall.com/docs/api)
- prices from [tcgplayer](https://www.tcgplayer.com/) via scryfall
