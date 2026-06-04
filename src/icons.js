// α29: custom mini-icon set. Every place that used to lean on an emoji
// renders one of these inline SVGs instead, so the UI carries no emoji
// glyphs at all.
//
// D7: the icons are a single-weight LINE-ART set (Lucide/Feather style)
// drawn in `currentColor` — deliberately flat, monochrome and stroked so
// they read as a custom UI icon set and never get mistaken for a colour
// emoji. In the activity log they inherit the log line's colour, so a
// "done" line gets a green check, a "fail" line a red cross, etc.
//
// `icon(name)` returns an inline <svg> string sized via the `.mi` CSS
// class. Unknown names return '' so a stray lookup never leaks anything.

const VB = '0 0 24 24';

// Inner markup of each 24×24 line icon. The wrapper sets fill:none,
// stroke:currentColor, width 2, round caps — so most entries are just
// the path/line geometry. Filled dots set fill explicitly.
const PARTS = {
  // status / generic
  check: '<polyline points="4 12.5 9.5 18 20 6"/>',
  cross: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  warn: '<path d="M12 3.5L22 20H2z"/><line x1="12" y1="9.5" x2="12" y2="14"/><circle cx="12" cy="17" r="0.4" fill="currentColor"/>',
  skip: '<polygon points="5 5 13 12 5 19"/><line x1="14.5" y1="5" x2="14.5" y2="19"/>',
  sparkle: '<path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z"/>',
  star: '<path d="M12 3.2l2.5 5.5 6 .6-4.5 4.1 1.3 5.9L12 16.9 6.7 19.3l1.3-5.9L3.5 9.3l6-.6z"/>',
  trophy: '<path d="M7 4h10v4.5a5 5 0 01-10 0z"/><path d="M7 5.5H4V8a3 3 0 003 3M17 5.5h3V8a3 3 0 01-3 3"/><line x1="12" y1="13.5" x2="12" y2="17"/><line x1="8" y1="20.5" x2="16" y2="20.5"/><line x1="12" y1="17" x2="12" y2="20.5"/>',
  swords: '<line x1="4" y1="5" x2="14.5" y2="15.5"/><line x1="20" y1="5" x2="9.5" y2="15.5"/><line x1="3" y1="18" x2="6" y2="21"/><line x1="21" y1="18" x2="18" y2="21"/>',
  skull: '<path d="M5 11.5a7 7 0 0114 0V14l-2 1.5v2H7v-2L5 14z"/><circle cx="9" cy="11.5" r="1.5"/><circle cx="15" cy="11.5" r="1.5"/>',
  cold: '<line x1="12" y1="3" x2="12" y2="21"/><line x1="4" y1="7.5" x2="20" y2="16.5"/><line x1="20" y1="7.5" x2="4" y2="16.5"/>',
  injured: '<rect x="3.5" y="9" width="17" height="6" rx="3" transform="rotate(-28 12 12)"/><line x1="11" y1="9.6" x2="13" y2="14.4"/><line x1="9.6" y1="13" x2="14.4" y2="11"/>',
  sleep: '<path d="M5 7h6L5 17h6"/><path d="M14 4h5l-5 5h5"/>',
  // resources / food
  people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0111 0"/><path d="M16 5.3a3 3 0 010 5.4"/><path d="M15.5 14.6a5.5 5.5 0 015 5.4"/>',
  food: '<path d="M3 12.5c0-3.2 4-5.5 9-5.5s9 2.3 9 5.5c0 1.2-1 2.2-2.2 2.2H5.2C4 14.7 3 13.7 3 12.5z"/><line x1="8" y1="9.5" x2="7" y2="12.5"/><line x1="12" y1="9" x2="12" y2="12.5"/><line x1="16" y1="9.5" x2="17" y2="12.5"/>',
  meal: '<path d="M3 12h18a9 6 0 01-18 0z"/><path d="M8 6.5c0-1.6.6-2.2 1.3-3.2M12 6c0-1.6.6-2.2 1.3-3.2M16 6.5c0-1.6.6-2.2 1.3-3.2"/>',
  wood: '<rect x="3" y="9" width="18" height="6.5" rx="3.2"/><ellipse cx="6.6" cy="12.25" rx="2" ry="3.2"/><ellipse cx="6.6" cy="12.25" rx="0.7" ry="1.2"/>',
  warehouse: '<path d="M12 3l9 4.5v9L12 21l-9-4.5v-9z"/><path d="M3.2 7.6L12 12l8.8-4.4M12 12v9"/>',
  bed: '<path d="M3 8v12"/><path d="M3 13h15a3 3 0 013 3v4"/><path d="M3 19.5h18"/><rect x="5.5" y="9.5" width="5" height="3.2" rx="1.2"/>',
  meat: '<ellipse cx="13.5" cy="10.5" rx="6.5" ry="5"/><ellipse cx="13.5" cy="10.5" rx="2.6" ry="1.8"/><circle cx="5.5" cy="17" r="2.2"/><circle cx="7" cy="18.4" r="1.9"/>',
  herb: '<path d="M12 21C12 12.5 16 6.5 21 5.5c0 8.5-4 13.5-9 15.5z"/><path d="M12 21c0-6.5-3-10.5-8-11.5 0 6.5 3 10.5 8 11.5z"/>',
  grain: '<line x1="12" y1="21" x2="12" y2="8.5"/><ellipse cx="12" cy="5" rx="1.6" ry="2.6"/><ellipse cx="8.6" cy="9" rx="1.5" ry="2.4" transform="rotate(-32 8.6 9)"/><ellipse cx="15.4" cy="9" rx="1.5" ry="2.4" transform="rotate(32 15.4 9)"/><ellipse cx="8.6" cy="13.5" rx="1.5" ry="2.4" transform="rotate(-32 8.6 13.5)"/><ellipse cx="15.4" cy="13.5" rx="1.5" ry="2.4" transform="rotate(32 15.4 13.5)"/>',
  sprout: '<path d="M12 21V10"/><path d="M12 12C8.2 12 5.2 9 5.2 5.2 9 5.2 12 8.2 12 12z"/><path d="M12 13.5c3.8 0 6.8-3 6.8-6.8C15 6.7 12 9.7 12 13.5z"/>',
  wilt: '<path d="M14.5 21c0-6.5-1.2-9.8-4.5-12"/><ellipse cx="8.5" cy="8" rx="3.2" ry="4.2" transform="rotate(40 8.5 8)"/><path d="M14.5 11.5c2.2-1 4.5-.8 4.5-.8"/>',
  pest: '<ellipse cx="12" cy="13" rx="5" ry="6"/><line x1="12" y1="7" x2="12" y2="3"/><line x1="7" y1="10" x2="3" y2="9"/><line x1="7" y1="13" x2="2.8" y2="13"/><line x1="7" y1="16" x2="3.3" y2="17.5"/><line x1="17" y1="10" x2="21" y2="9"/><line x1="17" y1="13" x2="21.2" y2="13"/><line x1="17" y1="16" x2="20.7" y2="17.5"/>',
  fork: '<path d="M7.5 3v5.5a2 2 0 002 2v10M7.5 3v4.5M9.5 3v4.5"/><path d="M16.5 3c-1.7 0-1.7 7.5 0 7.5s1.7-7.5 0-7.5zM16.5 10.5V21"/>',
  // creatures / events
  deer: '<path d="M8 12.5a4 4 0 008 0c0-2.6-1.8-4.2-4-4.2s-4 1.6-4 4.2z"/><path d="M9 8.3L7 4M9.5 8l.6-4M15 8.3l2-4.3M14.5 8l-.6-4"/><circle cx="10.6" cy="12.4" r="0.5" fill="currentColor"/><circle cx="13.4" cy="12.4" r="0.5" fill="currentColor"/>',
  baby: '<circle cx="12" cy="12.5" r="7.5"/><circle cx="9.3" cy="12.5" r="0.6" fill="currentColor"/><circle cx="14.7" cy="12.5" r="0.6" fill="currentColor"/><path d="M9.6 15.5a4 4 0 004.8 0"/><path d="M12 4.2c2.2 0 2.2 2.4 0 2.4"/>',
  cart: '<circle cx="9" cy="20" r="1.6"/><circle cx="17.5" cy="20" r="1.6"/><path d="M2.5 3.5h3l2.6 12.5h10.4l2-8.5H6.2"/>',
  // α30: malnutrition — a slightly drawn face with frown to signal "not
  // well-fed". Same single-weight line-art style as the rest of the set.
  malnutrition: '<circle cx="12" cy="12" r="8"/><circle cx="9.3" cy="11" r="0.7" fill="currentColor"/><circle cx="14.7" cy="11" r="0.7" fill="currentColor"/><path d="M8.5 16c1.6 2 5.4 2 7 0"/>',
};

/** Inline SVG markup for a named mini-icon (or '' when unknown). */
export function icon(name) {
  const inner = PARTS[name];
  if (!inner) return '';
  return (
    `<svg class="mi mi-${name}" viewBox="${VB}" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true" focusable="false">${inner}</svg>`
  );
}

/** Names available — handy for tests / verification. */
export const ICON_NAMES = Object.keys(PARTS);
