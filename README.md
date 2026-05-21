# Farm Proto

A farming-focused colony simulation game — early prototype.

Inspired by colony sims like RimWorld and Dwarf Fortress, this project
centers on **agriculture and the seasons**: planting crops, stockpiling,
and surviving the winter.

## Alpha 1

The first milestone renders a randomly generated tile map.

- 30×30 tile grid drawn on an HTML Canvas
- A single biome, with water bodies
- Each tile carries several terrain parameters — elevation, fertility,
  moisture, sunlight — rather than one single "fertility" number, so
  later versions can decide which crops thrive where
- Switchable views (terrain / fertility / moisture / sunlight),
  per-tile inspection on hover, and a reproducible numeric seed

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
