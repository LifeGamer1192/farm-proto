// Generate the version-archive index page.
//
// Scans a directory for `alphaN/` subfolders (each a built version) and
// writes an index.html linking to all of them. Run at deploy time:
//   node scripts/gen-versions-index.mjs dist/versions
//
// α32 onwards: this archive is explicitly the PROTOTYPE era (α4–α31).
// The live site at ../ runs the post-prototype α version.

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || 'dist/versions';

const versionNum = (name) => {
  const m = name.match(/\d+/);
  return m ? Number(m[0]) : 0;
};

const versions = readdirSync(dir)
  .filter((name) => {
    try {
      return /^alpha\d+$/.test(name) && statSync(join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  })
  .sort((a, b) => versionNum(b) - versionNum(a)); // newest first

const items = versions
  .map((name, i) => {
    const num = versionNum(name);
    const label = `Alpha ${num}`;
    // Tag the last prototype-era version (the freshly-finished α31) so
    // returning players can find it without scrolling.
    let tag = '';
    if (num === 31) tag = ' <span class="tag tag-final">final prototype</span>';
    else if (i === 0 && num !== 31) tag = ' <span class="tag">newest archived</span>';
    return `      <li><a href="./${name}/">${label}</a>${tag}</li>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Farm Proto — Prototype Archive (α4–α31)</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        background: #14181f;
        color: #e6e9ef;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      }
      main { max-width: 580px; margin: 0 auto; padding: 40px 20px; }
      h1 { font-size: 1.5rem; margin: 0 0 4px; }
      p.sub { color: #93a0b4; margin: 0 0 6px; }
      .era-note {
        margin: 14px 0 24px;
        padding: 12px 14px;
        background: rgba(95, 174, 107, 0.08);
        border-left: 3px solid #5fae6b;
        border-radius: 4px;
        font-size: 0.92rem;
        color: #c9d4dd;
      }
      a { color: #5fae6b; }
      ul { list-style: none; padding: 0; margin: 0; }
      li {
        background: #1e2530;
        border: 1px solid #333d4d;
        border-radius: 6px;
        padding: 14px 16px;
        margin-bottom: 10px;
        font-size: 1.05rem;
      }
      .tag {
        font-size: 0.72rem;
        color: #11240f;
        background: #5fae6b;
        padding: 2px 8px;
        border-radius: 10px;
        margin-left: 6px;
      }
      .tag-final {
        background: #d8b25a;
        color: #2d2410;
      }
      .latest { margin-bottom: 4px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Farm Proto — Prototype Archive</h1>
      <p class="sub">Versions α4 through α31 — the prototype era.</p>
      <p class="latest">▶ <a href="../">Play the current α version</a></p>
      <div class="era-note">
        Versions below are preserved as a record of the prototype phase
        (genetics → nutrients → workshops). The current α version on
        the main page continues from α32 onwards as the post-prototype
        release line.
      </div>
      <ul>
${items}
    </ul>
    </main>
  </body>
</html>
`;

writeFileSync(join(dir, 'index.html'), html);
console.log(`Wrote ${join(dir, 'index.html')} with ${versions.length} version(s).`);
