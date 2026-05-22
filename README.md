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
- The colonist eats from the store on a fixed timer
- Colony panel shows food storage, meals, and an activity log
- Game speed control (5 steps) and map zoom (3 steps)

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
