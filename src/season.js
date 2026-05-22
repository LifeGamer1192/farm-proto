// Seasons, the game clock, and how weather affects crop growth.
//
// The clock counts elapsed simulation-seconds. Four seasons make a year;
// temperature and daylight follow a smooth yearly cycle, and together they
// decide how fast crops grow.

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_LABELS = ['Spring', 'Summer', 'Autumn', 'Winter'];

export const SEASON_LENGTH = 60; // simulation-seconds in one season
export const DAYS_PER_SEASON = 10;

// A faint full-canvas tint so the current season reads at a glance.
export const SEASON_TINT = {
  spring: 'rgba(120,200,120,0.06)',
  summer: 'rgba(255,224,130,0.05)',
  autumn: 'rgba(214,130,56,0.10)',
  winter: 'rgba(150,184,224,0.13)',
};

// One-line description of a season and its effect on crops.
export const SEASON_NOTE = {
  spring: 'Spring — mild. Crops grow steadily; a good time to sow.',
  summer: 'Summer — warm and bright. Crops grow fastest.',
  autumn: 'Autumn — cooling down. Crop growth slows.',
  winter: 'Winter — cold. Crops barely grow until it warms again.',
};

/** Break a clock value (elapsed sim-seconds) into calendar fields. */
export function clockInfo(elapsed) {
  const totalSeasons = elapsed / SEASON_LENGTH;
  const whole = Math.floor(totalSeasons);
  const seasonIndex = ((whole % 4) + 4) % 4;
  const seasonProgress = totalSeasons - whole; // 0..1 within the season
  const year = Math.floor(whole / 4) + 1;
  const day = Math.min(DAYS_PER_SEASON, Math.floor(seasonProgress * DAYS_PER_SEASON) + 1);
  const yearProgress = (seasonIndex + seasonProgress) / 4; // 0..1 within the year
  return {
    year,
    seasonIndex,
    season: SEASONS[seasonIndex],
    seasonProgress,
    day,
    yearProgress,
  };
}

// Temperature (°C): warmest around the spring→summer turn, coldest at the
// autumn→winter turn. A smooth cosine over the year.
export function temperatureAt(yearProgress) {
  return 12 + 16 * Math.cos(2 * Math.PI * (yearProgress - 0.25));
}

// Daylight strength 0..1 — longer days near summer, shorter near winter.
export function daylightAt(yearProgress) {
  return 0.75 + 0.25 * Math.cos(2 * Math.PI * (yearProgress - 0.25));
}

// How fast crops grow at a given temperature: dormant when freezing,
// full speed in the mild range, a little slower in extreme heat.
export function tempGrowthFactor(temp) {
  if (temp <= 2) return 0;
  if (temp < 16) return (temp - 2) / 14;
  if (temp <= 27) return 1;
  return Math.max(0.3, 1 - (temp - 27) / 28);
}

// How much light a tile gets helps growth (0.35..1). Combines the tile's
// own sunlight (low in mountain shade) with the season's daylight.
export function sunGrowthFactor(tileSunlight, daylight) {
  return 0.35 + 0.65 * tileSunlight * daylight;
}
