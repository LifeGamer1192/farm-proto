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

### Alpha 11 — seeds, crop quality & stockpiles

- Sowing now draws on the colony's **seed stock**: each sown crop spends
  one seed, shown in the Colony panel by **quality rank** (★1–★5).
  Higher-ranked seed is hardier and yields more food, and harvesting a
  ripe crop **returns seeds** — careful farming lifts their quality over
  the years, the first step toward the genetics system
- **Stockpiles** are now real containers with a limited capacity.
  Colonists **haul food into them on their own**, keeping it safe from
  pests, and fetch it back when the on-hand store runs low
- Colonists also **clear withered crops on their own** (weeding)
- A new **Cancel** tool calls off planned tasks — click or drag over
  their markers
- Hovering a tile now also shows any **structure** there (a stockpile's
  contents, whether a hearth is lit), alongside the terrain readout
- The activity log keeps a much longer history — scroll back ~1000 events

### Alpha 12 — genetics & mutation

- Every crop and seed now carries a **genome** — five genes (hardiness,
  yield, vigor, cold-hardiness, hue), each a pair of alleles with
  dominant/recessive expression
- Crops planted next to each other **cross-pollinate**: the seeds from a
  harvest mix the genes of the harvested crop and an adjacent same-crop
  neighbour (or self-pollinate if it stands alone)
- **Mutation** nudges alleles when seeds are bred, and rare "legendary"
  mutations make a large jump — the source of brand-new traits
- Genes drive the game: hardiness lifts survival odds (a well-bred strain
  can reach ~80–90%), yield swells the harvest and the fruit, vigor
  speeds growth, cold-hardiness keeps crops growing in poor weather
- The ripe fruit's **colour** shifts with the hue gene — bred varieties
  look different on the map
- A new **Variety codex** panel tracks the best variety bred for each
  crop, gene by gene, against the origin strain

### Alpha 13 — visual pass & a clearer interface

- A visual overhaul of everything but the crops: **textured terrain**
  with grassy speckles and sandy shorelines, **colonists** that face the
  way they walk, a redrawn **wild boar**, and rebuilt **structures**
- The stockpile is now a proper **warehouse** — renamed and redrawn as a
  plank-walled barn
- Tool-linked panels: the **Crop** picker shows only with the Sow tool,
  the **Structure** picker only with Build — a crop you have no seed of
  is greyed out
- When an order cannot be placed, an **error message** explains why
  (e.g. sowing with no seed in stock names the missing seed)
- **Hover hints** on every tool button, and a new **Tips** panel of
  gameplay pointers

### Alpha 14 — crops you can see the genes in

- The genome gains six **cosmetic genes** — fruit shape, leaf style,
  surface, colour hue, colour saturation and speckling — alongside the
  four gameplay genes
- Crops are now **drawn from their genome**: the fruit takes one of four
  shapes, the leaves one of three styles, the surface is smooth, ridged
  or fuzzy, and the colour and spotting vary — so a bred variety has a
  look of its own
- Starting seeds spread their cosmetic genes wide, so the very first
  crops already differ; breeding and mutation push the looks further
- The **Variety codex** now shows a picture of the best variety bred for
  each crop, beside its gameplay-gene bars
- Hovering a crop describes its look (shape, leaf and surface)

### Alpha 15 — a pool of tips

- The Tips panel now draws from a pool of about a hundred one-line
  tips, shown one at a time and rotated on a timer or with a Next button
- Tips come in three kinds, each with a coloured tag: **Game** (how this
  game works), **Genetics** (general heredity knowledge — Mendel, alleles,
  selective breeding) and **Plants** (crop and wild-plant lore)
- Every tip is written in both English and Japanese

### Alpha 16 — autonomous mode

- A new **Auto-work** toggle (on by default). With it on, idle colonists
  take up three new kinds of self-directed work on top of the existing
  autonomy:
  - **Till** ground for the next sowing — picks growth-friendly soil
    and prefers tiles next to the existing tilled patch, so farms grow
    as a cluster
  - **Sow** the most-stocked seed onto any empty tilled tile
  - **Build** infrastructure: a hut for each colonist, a hearth for
    each hut, and short straight fences when a boar wanders close
    (up to twenty fence tiles in total)

### Alpha 17 — a fuller crop catalogue

- The crop catalogue grew from three to about thirty‑five varieties
  spread across **eleven plant categories** (grains, legumes, root
  vegetables, tubers, bulbs, leaf greens, stem vegetables, flower
  vegetables, fruit vegetables, fruits and nuts).
- Each colony starts with seeds for **eight random crops**, always
  including **at least one grain** so there is a staple to plant. The
  Crop picker, Seed stock and Variety codex panels all show only the
  crops the colony actually holds.
- Crops draw with **category‑specific looks** — grains as stalks with
  seed heads, legumes with hanging pods, root vegetables as just a
  tuft of leaves (the root stays in the soil), tubers showing bumps
  through the earth, bulbs with narrow leaves over a bulb, leaf
  greens as overlapping lobes, and so on.
- Every crop carries a **nutrition** value — eating something more
  nourishing lifts mood a little more.
- Japanese labels include **furigana** (e.g. *根菜類（こんさいるい）*).

### Alpha 18 — trees and the wood economy

- Maps now sprinkle in **trees** alongside the wild bushes. A tree is
  chopped with the Harvest tool — yielding several wood — and leaves
  behind a **stump**. After a minute or so the stump grows back into
  a sapling that matures into a full tree over the next stretch.
- **Buildings cost wood**: a fence costs one, a hearth three, a
  warehouse four, a hut five. The colony starts with thirty wood — a
  rough village starter kit. Try to build with no wood on hand and
  the order is refused with a clear "not enough wood" message.
- The autonomous workers **chop trees themselves** whenever the
  reserve falls below the low-wood threshold, and a hut, hearth or
  warehouse will not auto-queue unless the wood for it is already
  in stock.

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
