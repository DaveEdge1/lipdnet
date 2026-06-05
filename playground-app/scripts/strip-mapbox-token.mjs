// Post-build: remove any hardcoded Mapbox access token from the bundled output.
//
// @linkedearth/lipd-ui's LocationEditor ships a fallback Mapbox token baked into
// its source (`process.env.MAPBOX_TOKEN || 'pk....'`). Vite inlines that literal
// into the production bundle, which (a) trips GitHub secret-scanning push
// protection on the committed dist, and (b) hardcodes a third-party token we
// don't control. This script rewrites the quoted token literal into a runtime
// lookup of `window.__MAPBOX_TOKEN__`, which the Express server injects per
// request from the MAPBOX_TOKEN environment variable. No token is ever committed.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, '..', '..', 'website', 'public', 'playground-app', 'assets');

// Matches a quoted Mapbox public/secret token literal: "pk.eyJ...." or 'sk.eyJ....'
const TOKEN_RE = /(["'])(?:pk|sk)\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\1/g;
const REPLACEMENT = '(typeof window!=="undefined"&&window.__MAPBOX_TOKEN__||"")';

let totalReplaced = 0;
for (const file of readdirSync(assetsDir)) {
  if (!file.endsWith('.js')) continue;
  const full = join(assetsDir, file);
  const src = readFileSync(full, 'utf8');
  const matches = src.match(TOKEN_RE);
  if (!matches) continue;
  writeFileSync(full, src.replace(TOKEN_RE, REPLACEMENT));
  totalReplaced += matches.length;
  console.log(`strip-mapbox-token: replaced ${matches.length} token literal(s) in ${file}`);
}

if (totalReplaced === 0) {
  console.log('strip-mapbox-token: no token literals found (nothing to do)');
} else {
  console.log(`strip-mapbox-token: done, ${totalReplaced} literal(s) externalized to window.__MAPBOX_TOKEN__`);
}
