# Farm Proto

A farming-focused colony simulation game — early prototype.

Inspired by colony sims like RimWorld and Dwarf Fortress, this project
centers on **agriculture and the seasons**: planting crops, stockpiling,
and surviving the winter.

## Progress

### Alpha 1 — random map & tile rendering

- Tile grid drawn on an HTML Canvas, a single biome with water bodies
- Each tile carries several terrain parameters — elevation, fertility,
  moisture, sunlight — rather than one single "fertility" number, so
  later versions can decide which crops thrive where
- Switchable views (terrain / fertility / moisture / sunlight),
  per-tile inspection on hover, and a reproducible numeric seed

### Alpha 2 — scrollable map & a colonist

- 100×100 tile map with a scrolling camera viewport
- Scroll by dragging the map, by on-screen arrows, or with W/A/S/D —
  works with both mouse and touch
- One colonist who walks the map: click/tap a tile to send it there
  (A* pathfinding, routing around water), and it wanders on its own
  when left idle

### Alpha 3 — a minimal task system

- Wild plants are scattered across the map
- Three task tools — **Move**, **Harvest**, **Sow** — pick one, then
  click tiles to queue tasks for the colonist
- The colonist works through its task queue (FIFO): it walks to each
  target, spends a moment working, and the task takes effect
- Tasks are drawn on the map (numbered markers) and a debug panel shows
  the current task, why it was chosen, resource counts and a task log

### Alpha 4 — the farming loop

- Three crops (wheat, potato, bean), each with its own growth time and yield
- **Sow** a crop, watch it grow over time, then **Harvest** it once ripe —
  harvested crops and foraged wild plants stock the colony's food store
- Sown crops can wither before ripening: the initial strains are weak, and
  how well a tile's soil suits the crop decides its odds of survival
- The colonist eats from the store on a fixed timer
- Colony panel shows food storage, meals, and an activity log
- Game speed control (5 steps) and map zoom (3 steps)

### Alpha 5 — seasons & temperature

- A game clock with four seasons making up each year
- Temperature and daylight follow a yearly cycle; crop growth speed
  depends on both — crops are dormant in the winter cold
- A Season panel shows the date, temperature and daylight; transient
  popups explain tools and announce season changes, keeping the normal
  screen uncluttered

### Alpha 6 — colonists, autonomy & languages

- Several colonists share one work queue; each runs a small priority AI —
  it eats when due, takes queued work, or rests / strolls / sleeps
- Two new tools: **Till** (tilled soil helps crops survive) and **Water**
  (watered crops grow faster for a while)
- The interface can switch between English and Japanese

### Alpha 7 — survival stats & wild animals

- Every colonist has three survival stats — **hunger**, **health** and
  **mood** — shown as bars in the Colonists panel
- Hunger climbs over time; colonists seek food on their own when hungry,
  and starvation drains health. A miserable colonist may slack off work
- Wild boar roam the map and harry nearby colonists with minor attacks
- A new **Hunt** tool: click a boar to send a colonist after it for meat
- If every colonist falls, the colony is lost — start over to try again

### Alpha 8 — building, storage & pests

- A new **Build** tool raises three structures: **fences** (wild animals
  will not cross them — ring the farm to keep boar out), **huts** (a
  colonist resting nearby recovers its mood faster), and **stockpiles**
  (a storage ground that blunts pest losses)
- **Pests** strike the food store on a timer; the more stockpile tiles
  the colony has built, the less food they spoil
- **Pause / resume** the simulation at any time (button or spacebar)
- Work orders can be addressed to the **whole colony** or to **one
  colonist** — pick a worker in the Colonists panel to direct their tasks

### Alpha 9 — cooking, firewood & the cold

- A fourth structure, the **hearth**: it burns **firewood** to keep
  nearby colonists warm and to cook on. Firewood is gathered by
  harvesting wild plants
- In cold weather a colonist away from a lit hearth suffers — losing
  health and mood — so the colony must stock firewood for winter
- A new **Cook** tool turns raw food into **cooked meals** at a hearth;
  a cooked meal lifts a colonist's mood, and pests cannot spoil it
- Control panels are compact and collapsible, so the game fits one
  screen and reads well on a phone
- **Drag** to apply a range tool (sow, till, water, build, harvest) over
  many tiles at once; the activity log keeps a longer, scrollable history

### Alpha 10 — the year goal & smarter colonists

- **Survive a full year** and a results screen celebrates the milestone —
  then play continues if you want to keep building
- Idle colonists now **tend the farm on their own**: harvesting ripe
  crops, watering dry ones, and cooking when a hearth is lit
- **Auto-hunt** toggle — when on, idle colonists hunt boar once the
  colony's food runs low
- **All-colonist orders**: with "All colonists" selected, a Move order
  sends every colonist at once
- Press **1–5** to switch game speed; stat panels are denser (two
  columns) and the activity log is readable and scrolls properly

## Version archive

Every released version stays playable. The live site links to an
archive at `/versions/`, with each build at `/versions/alphaN/`.

## Development

Requires [Node.js](https://nodejs.org/).

```sh
npm install
npm run dev      # start the dev server
npm run build    # production build into dist/
npm run preview  # preview the production build
npm test         # run the map-generation logic tests
```

## Tech

Vite + plain JavaScript (ES Modules) + Canvas 2D. No runtime dependencies.

## Deployment

Pushing to `main` builds the project and publishes it to GitHub Pages
via the workflow in `.github/workflows/deploy.yml`.
