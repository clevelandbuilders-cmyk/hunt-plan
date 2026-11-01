# Hunt Plan

Private, mobile-first hunt planning site for our properties. Runs on GitHub Pages.
All property data (stands, cameras, waypoints, boundaries) lives in `data/vault.json`,
encrypted with the shared password (PBKDF2-SHA256 + AES-256-GCM). Without the password
the site and repo show only ciphertext.

## Access
- **View:** anyone with the shared password.
- **Edit:** needs an editor key on that device. The owner turns it on once by pasting a
  GitHub fine-grained token (this repo only, Contents: read and write) in Menu > Editor access,
  then can send **editor links** to others. An editor link holds the key encrypted with the
  password, so the link alone is useless. Changing the password breaks old editor links.

## How saving works
Edits save on the device first (works with no signal), then commit the re-encrypted
`data/vault.json` to `main`. Several editors can work at once: records merge per item,
newest edit wins, deletions are kept as tombstones.

## Layout
- `index.html`, `css/`, `js/` – the app (plain ES modules, no build step)
  - `config.js` – repo, map layers, mark types and their fields (add types/fields here)
  - `store.js` – unlock, local cache, sync; `github.js` – reads/writes the vault
  - `model.js` – data shape and merge; any top-level array of `{id, updated}` records syncs
  - `importer.js` – onX KML/KMZ/GPX import and KML export
- `vendor/` – Leaflet, togeojson, JSZip (vendored so nothing loads from CDNs)
- `tools/vault.mjs` – command line: `HUNT_PLAN_PASSWORD=… node tools/vault.mjs show|write|merge|init`

## Plugging in later steps
- **Scouting / funnel grades:** funnels, stands, crossings, trails and bedding already carry a
  1–5 `props.grade`. Add analysis layers in `app.js` render and new types in `config.js`.
- **Sit planner:** stands carry `props.bestWinds` and `props.timeOfDay`; a planner can read
  the forecast and rank stands per property.
- **Buck tracking:** add a `bucks` and `sightings` collection (arrays of records with `id`
  and `updated`); sync and merge handle them automatically.
- **Weekly sync:** a script on Dan's computer can pull cam data and run
  `tools/vault.mjs merge new-records.json`, then commit.
