// α29: custom mini-icon set. Every place that used to lean on an emoji
// now renders one of these inline SVGs instead, so the UI carries no
// emoji glyphs at all (consistent across platforms / fonts).
//
// `icon(name)` returns an inline <svg> string sized to 1em via the `.mi`
// CSS class (see style.css). Unknown names return '' so a stray lookup
// never leaks a literal back into the DOM.

const VB = '0 0 16 16';

// Each entry is the inner markup of a 16×16 SVG.
const PARTS = {
  // status / generic
  check: '<path d="M3 8.6l3.2 3.2L13 4.4" fill="none" stroke="#5fc46f" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  cross: '<path d="M4 4l8 8M12 4l-8 8" stroke="#d2493a" stroke-width="2.3" stroke-linecap="round"/>',
  warn: '<path d="M8 2l6.2 11.4H1.8z" fill="#e8b23c" stroke="#7a5a12" stroke-width="1"/><path d="M8 5.8v3.6" stroke="#3a2a06" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.4" r="1" fill="#3a2a06"/>',
  skip: '<path d="M3 4l4.5 4L3 12z" fill="#9ab3a0"/><path d="M7.5 4L12 8l-4.5 4z" fill="#9ab3a0"/><rect x="12.2" y="4" width="1.6" height="8" rx="0.5" fill="#9ab3a0"/>',
  sparkle: '<path d="M8 1l1.7 5.1L15 8l-5.3 1.9L8 15l-1.7-5.1L1 8l5.3-1.9z" fill="#ffd95a" stroke="#caa12a" stroke-width="0.6"/><circle cx="13" cy="3" r="1" fill="#fff0b0"/>',
  star: '<path d="M8 1.4l1.95 4.0 4.4.6-3.2 3.1.75 4.4L8 11.0 3.9 13.5l.75-4.4L1.45 6l4.4-.6z" fill="#ffcf4a" stroke="#c8a02a" stroke-width="0.5"/>',
  trophy: '<path d="M5 2h6v3.2a3 3 0 01-6 0z" fill="#ffcf4a" stroke="#b8902a" stroke-width="0.8"/><path d="M5 3.2H2.8v1.4A2.2 2.2 0 005 6.8M11 3.2h2.2v1.4A2.2 2.2 0 0111 6.8" fill="none" stroke="#b8902a" stroke-width="0.9"/><rect x="7.1" y="7.6" width="1.8" height="2.8" fill="#b8902a"/><rect x="4.8" y="10.3" width="6.4" height="2.2" rx="0.6" fill="#ffcf4a" stroke="#b8902a" stroke-width="0.6"/>',
  swords: '<path d="M3 3.5l7 7M10 3.5l-7 7" stroke="#cfd6dd" stroke-width="1.7" stroke-linecap="round"/><path d="M2 11l2 2M14 11l-2 2" stroke="#8a6a3a" stroke-width="1.6" stroke-linecap="round"/>',
  skull: '<path d="M3 7a5 5 0 0110 0v3l-1.4 1H4.4L3 10z" fill="#e9e7dd" stroke="#9a978c" stroke-width="0.7"/><circle cx="6" cy="7" r="1.3" fill="#26241f"/><circle cx="10" cy="7" r="1.3" fill="#26241f"/><path d="M7 10.4l1 1.6 1-1.6" fill="#26241f"/>',
  // climate / status conditions
  cold: '<g stroke="#7fc7ef" stroke-width="1.5" stroke-linecap="round"><path d="M8 2v12M2.7 5l10.6 6M13.3 5L2.7 11"/></g>',
  injured: '<rect x="1.6" y="6.2" width="12.8" height="3.6" rx="1.8" transform="rotate(-28 8 8)" fill="#f1d9b4" stroke="#b48a4a" stroke-width="0.8"/><path d="M8 6.2v3.6M6.2 8h3.6" stroke="#d2493a" stroke-width="1.3"/>',
  sleep: '<path d="M4 5h5L4 11h5" fill="none" stroke="#8fb0d0" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/><path d="M10 3h3l-3 3h3" fill="none" stroke="#8fb0d0" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>',
  // resources / food
  people: '<circle cx="5.4" cy="5.6" r="2.4" fill="#9fbce0"/><circle cx="10.6" cy="5.6" r="2.4" fill="#7fa0c8"/><path d="M1.4 13.5c0-2.6 1.8-4.2 4-4.2s4 1.6 4 4.2z" fill="#9fbce0"/><path d="M6.6 13.5c0-2.6 1.8-4.2 4-4.2s4 1.6 4 4.2z" fill="#7fa0c8"/>',
  food: '<ellipse cx="8" cy="9" rx="6.2" ry="3.7" fill="#d9a258" stroke="#a06a2a" stroke-width="0.8"/><path d="M4.8 7.4l1 2.2M8 7l1 2.4M11.2 7.4l1 2.2" stroke="#8a5a22" stroke-width="0.9" stroke-linecap="round"/>',
  meal: '<path d="M1.8 7.6h12.4a6.2 4.4 0 01-12.4 0z" fill="#c98a4a" stroke="#7a4f22" stroke-width="0.8"/><ellipse cx="8" cy="7.6" rx="6.2" ry="1.7" fill="#e8c98a" stroke="#7a4f22" stroke-width="0.6"/><path d="M5.6 5.2c0-1.1.2-1.6.8-2.2M8 4.8c0-1.1.2-1.6.8-2.2M10.4 5.2c0-1.1.2-1.6.8-2.2" stroke="#cfcfcf" stroke-width="0.9" fill="none" stroke-linecap="round"/>',
  wood: '<rect x="1.8" y="5.6" width="12.4" height="4.8" rx="2.4" fill="#9c6b3a" stroke="#5e3f1e" stroke-width="0.8"/><ellipse cx="4.2" cy="8" rx="1.7" ry="2.4" fill="#c79355" stroke="#5e3f1e" stroke-width="0.6"/><ellipse cx="4.2" cy="8" rx="0.7" ry="1.1" fill="#9c6b3a"/>',
  warehouse: '<path d="M8 1.8l6.2 3v7.4L8 15.2 1.8 12.2V4.8z" fill="#c79a5a" stroke="#7a5a2a" stroke-width="0.8"/><path d="M1.8 4.8L8 7.8l6.2-3M8 7.8v7.4" fill="none" stroke="#7a5a2a" stroke-width="0.8"/>',
  bed: '<rect x="1.6" y="6.6" width="12.8" height="5" rx="1" fill="#a86c4a"/><rect x="2.8" y="5" width="4.6" height="3.2" rx="1" fill="#ece2d2"/><rect x="1.6" y="10.4" width="12.8" height="2.4" rx="0.6" fill="#7a4f32"/><path d="M2 12.8v1.4M14 12.8v1.4" stroke="#7a4f32" stroke-width="1.2" stroke-linecap="round"/>',
  meat: '<ellipse cx="9" cy="7.2" rx="5" ry="4" fill="#c8607a" stroke="#8a3a52" stroke-width="0.8"/><ellipse cx="9" cy="7.2" rx="2.3" ry="1.7" fill="#e7a6b6"/><circle cx="3" cy="11" r="1.7" fill="#efe8df" stroke="#b0a89a" stroke-width="0.6"/><circle cx="4.4" cy="12.2" r="1.5" fill="#efe8df" stroke="#b0a89a" stroke-width="0.6"/>',
  herb: '<path d="M8 14.5C8 8.5 11 4.2 14.2 3c0 6.2-3.2 10.2-6.2 11.5z" fill="#5fa84a" stroke="#3a6e2a" stroke-width="0.7"/><path d="M8 14.5C8 9.5 5.8 6.2 2.6 5c0 5.4 2.4 8.6 5.4 9.5z" fill="#6fb858" stroke="#3a6e2a" stroke-width="0.7"/>',
  grain: '<path d="M8 15V5.2" stroke="#b8923a" stroke-width="1.2" stroke-linecap="round"/><g fill="#d9b455" stroke="#a8842e" stroke-width="0.4"><ellipse cx="8" cy="3.4" rx="1.1" ry="2"/><ellipse cx="5.9" cy="6" rx="1" ry="1.8" transform="rotate(-32 5.9 6)"/><ellipse cx="10.1" cy="6" rx="1" ry="1.8" transform="rotate(32 10.1 6)"/><ellipse cx="5.9" cy="9" rx="1" ry="1.8" transform="rotate(-32 5.9 9)"/><ellipse cx="10.1" cy="9" rx="1" ry="1.8" transform="rotate(32 10.1 9)"/></g>',
  sprout: '<path d="M8 14.5V6.5" stroke="#4f8a3a" stroke-width="1.4" stroke-linecap="round"/><path d="M8 8.5C5.6 8.5 3.6 6.7 3.6 4.3 6.2 4.3 8 6.1 8 8.5z" fill="#6fb24a" stroke="#3a6e2a" stroke-width="0.5"/><path d="M8 9.5c2.4 0 4.4-1.8 4.4-4.2C9.8 5.3 8 7.1 8 9.5z" fill="#7cc257" stroke="#3a6e2a" stroke-width="0.5"/>',
  wilt: '<path d="M9 14.5C9 11 8 9 6 8" fill="none" stroke="#86863f" stroke-width="1.3" stroke-linecap="round"/><g transform="rotate(48 6 7)"><ellipse cx="6" cy="7" rx="2.6" ry="3.4" fill="#b9708a" stroke="#7a3f55" stroke-width="0.6"/><circle cx="6" cy="7" r="1.2" fill="#e7c46a"/></g><path d="M9 8c1.6-.6 3-.4 3-.4" stroke="#86863f" stroke-width="1" stroke-linecap="round"/>',
  pest: '<ellipse cx="8" cy="9.2" rx="3.4" ry="4" fill="#6f9a3a" stroke="#3f5a1e" stroke-width="0.8"/><circle cx="8" cy="4.6" r="2.1" fill="#3f5a1e"/><path d="M4.7 7.4H1.8M4.6 9.4H1.6M4.9 11.4H2.2M11.3 7.4h2.9M11.4 9.4h3M11.1 11.4h2.7" stroke="#3f5a1e" stroke-width="0.9" stroke-linecap="round"/><path d="M6.8 3.4L5.8 1.6M9.2 3.4l1-1.8" stroke="#3f5a1e" stroke-width="0.9" stroke-linecap="round"/>',
  fork: '<path d="M4.6 2v3.4c0 .8.7 1.2.7 1.2V14M3.4 2v3M5.8 2v3" fill="none" stroke="#cfd6dd" stroke-width="1.2" stroke-linecap="round"/><path d="M11 2c-1.4 0-1.4 5 0 5s1.4-5 0-5zM11 7v7" fill="none" stroke="#cfd6dd" stroke-width="1.2" stroke-linecap="round"/>',
  // creatures / events
  deer: '<path d="M5 8.4a3 3 0 006 0c0-2-1.4-3.2-3-3.2S5 6.4 5 8.4z" fill="#a06a3a" stroke="#6e4520" stroke-width="0.7"/><path d="M6 5.2L4.2 2.2M6 5.2L6.6 2.2M10 5.2l1.8-3M10 5.2l-.6-3" stroke="#7a4f22" stroke-width="1" stroke-linecap="round"/><circle cx="6.8" cy="8" r="0.8" fill="#26201a"/><circle cx="9.2" cy="8" r="0.8" fill="#26201a"/><circle cx="8" cy="10.2" r="0.7" fill="#3a2a1a"/>',
  baby: '<circle cx="8" cy="8.4" r="5.4" fill="#f3c9a0" stroke="#c79a6a" stroke-width="0.8"/><circle cx="6" cy="8.4" r="0.9" fill="#3a2a1a"/><circle cx="10" cy="8.4" r="0.9" fill="#3a2a1a"/><path d="M6.4 10.6c.9.9 2.3.9 3.2 0" fill="none" stroke="#a05a3a" stroke-width="0.9" stroke-linecap="round"/><path d="M8 3c1.4 0 1.4 1.6 0 1.6" fill="none" stroke="#7a5630" stroke-width="1"/>',
  cart: '<circle cx="6" cy="13.2" r="1.3" fill="#5a7a9a"/><circle cx="11.2" cy="13.2" r="1.3" fill="#5a7a9a"/><path d="M1.6 2.8h2.2l1.6 7.2h7.2l1.4-5.2H5.2" fill="none" stroke="#5a7a9a" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>',
};

/** Inline SVG markup for a named mini-icon (or '' when unknown). */
export function icon(name) {
  const inner = PARTS[name];
  if (!inner) return '';
  return `<svg class="mi mi-${name}" viewBox="${VB}" aria-hidden="true" focusable="false">${inner}</svg>`;
}

/** Names available — handy for tests / verification. */
export const ICON_NAMES = Object.keys(PARTS);
