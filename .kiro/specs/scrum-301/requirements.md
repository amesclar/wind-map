# SCRUM-301 — Make CARTO the default base map and retire the tile.openstreetmap.org layers

Epic: SCRUM-297, base maps the app is allowed to use at scale.

The app ships two base maps on `https://tile.openstreetmap.org/{z}/{x}/{y}.png` — `osm_dark`
(the default, under a CSS dark filter) and `osm_standard`. The OpenStreetMap Foundation's tile
usage policy forbids distributing an app on its volunteer servers at scale, promises no service
level, and reserves the right to block access without notice; it already did once (SCRUM-288).
CARTO is already wired behind `CARTO_API_KEY`, which is set on Cloud Run, in the local container
and in `GET /api/config`.

## Decisions settled before implementation

The epic asked for two decisions to be recorded here, with the provider's terms and the
attribution it requires.

**Provider: CARTO Basemaps, the keyed `dark_all` raster endpoint.**
`https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=…`, which
`mapTiles.ts` already builds when a key is present.

- Terms: <https://carto.com/legal/basemap-terms/>. Section 9 permits exactly this app's pattern —
  *"displaying CARTO basemaps to the users of Customer's own websites, applications and products,
  where those users' requests are served directly by the Basemap Services"* — and forbids bulk
  downloading, reselling the tiles, server-side proxying or caching, and caching in a browser for
  more than 30 days. So: no tile proxy, no server-side tile cache, and the range export's burst is
  a real risk that SCRUM-299 bounds.
- Limits (Section 12): free for non-commercial use to 5,000,000 tile requests a calendar month,
  free for commercial use to 1,000,000, then Basemaps Commercial (US$500/month or US$5,000/year)
  up to 10M, or Commercial Plus (US$1,500/month or US$15,000/year) up to 50M. Counted across all
  keys and both the raster and vector services, in UTC months.
- Revocability (Section 3.c): the free service may be suspended, rate-limited or revoked at any
  time without notice, so the failure path matters (SCRUM-302).
- Attribution (Section 13, <https://carto.com/attribution/>): `© OpenStreetMap contributors,
  © CARTO`, both linked, prominent on every map; CARTO may revoke a key whose attribution is
  obscured.
- The `API KEY REQUIRED` tile is CARTO's own notice. Section 3.d requires it to stay visible, so
  the app never hides, crops or covers it.

A third provider (MapTiler, Stadia, OpenFreeMap) was not taken: the consenting provider's
credentials are already deployed, and moving provider would not remove the need to bound the
export's burst or to show failures.

**The two OpenStreetMap entries are removed, not kept as an opt-in.**
Keeping them would still ship a base layer on a provider whose policy forbids this app's usage,
which is what the epic's "done when" rules out; an opt-in with a warning ships the same requests.
The cost is a settings migration, handled below. Because `osm_dark` is also the keyless substrate
under the paper chart, Seamap and Google Satellite, those substrates move to CARTO as well.

**Keyless use (a finding that changes the ticket's original acceptance criterion).**
Since 25 September 2026 CARTO does not serve its raster basemaps without a key: a keyless request
returns an `API KEY REQUIRED` tile
(<https://docs.carto.com/faqs/carto-basemaps#why-do-i-see-an-api-key-required-watermark>).
Verified 2026-11-27: three different keyless `dark_all` tiles (`5/5/11`, `5/6/11`, `10/100/200`)
all answer 200 `image/png` with the same 2,513-byte body, which is that notice and not a map.
The ticket's "the keyless case still renders a usable dark base" therefore cannot be met with the
raster endpoint. Since every deployment supplies the key through `/api/config`, the keyless case is
a developer running the frontend with no environment: the base then shows CARTO's own notice,
which is truthful and visible, and SCRUM-302 adds the app's own notice for tile failures. Adding a
second renderer (CARTO's still-keyless vector style through MapLibre) to fix a developer-only
view was judged not worth a second code path for one base layer.

## Requirements

### 1. CARTO is the default base map

1.1 WHEN a browser with no stored `map_tile_layer` opens the app THEN the system shall draw the
CARTO dark base.
1.2 WHEN the stored `map_tile_layer` is `osm_dark` or `osm_standard` THEN the system shall read it
as `carto_dark`, so an upgraded browser stops requesting the volunteer tiles immediately.
1.3 WHEN the stored `map_tile_layer` is `paper_chart`, `seamap` or `google_satellite` THEN the
system shall keep it, unchanged.
1.4 WHEN the server supplies a CARTO key and no light base is stored THEN the system shall keep
selecting `carto_dark` for the session, as it does today.

### 2. No shipped layer requests tile.openstreetmap.org

2.1 No value of `MapTileLayer` shall produce a tile URL on `tile.openstreetmap.org`.
2.2 WHEN Map Settings is open THEN it shall offer exactly the CARTO, NOAA, Open Waters and
Satellite bases, and mark the selected one.
2.3 WHEN the paper chart, Seamap or Google Satellite base is selected THEN its substrate shall be
the CARTO dark base, not the volunteer tiles.

### 3. Attribution and terms

3.1 The on-map attribution for the CARTO base shall read `© OpenStreetMap contributors © CARTO`,
with both names linked.
3.2 WHEN an image is exported from the CARTO base THEN the footer shall carry
`© OpenStreetMap contributors © CARTO`.
3.3 The provider, its terms URL, its limits and its attribution shall be recorded in
`requirements.md`.

### 4. Unchanged behaviour (regression prevention)

4.1 The seamark overlay, the CHS NONNA depth overlay, the wind, current and wave layers, the
chart's coverage and failure notices, and the export pipeline shall keep working on every
remaining base.
4.2 The Map Settings dialog shall keep its light/dark theme per base: light on the NOAA chart and
Seamap, dark on CARTO and Satellite.
