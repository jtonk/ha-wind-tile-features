# Wind Tile Features

Two independent custom features for Home Assistant's native **Tile** card, installed from one JavaScript resource.

- **Wind history**: one-minute wind bars, separate gust caps, and direction arrows. Each bar is 4 px wide with a 1 px gap, so the available width determines the history duration. A 150 px plot shows 30 minutes; a 300 px plot shows 60 minutes. Extra card height enlarges the plot. Horizontal guides use 5 or 10 kn intervals and vertical guides mark whole 10-minute clock times. The initial bars reveal from right to left.
- **Live wind and gusts**: a fixed Windfinder color gradient with independently animated speed and gust markers, a knot scale, and Beaufort bands. The current Beaufort band is highlighted. The text reads `12.3 - 15.6 | SW` and updates immediately.

The features appear in the Tile feature picker for wind-speed sensors (`device_class: wind_speed`). KSN and Airtime speed entity names are also recognized; entity names ending in `_gusts` are excluded. Each feature occupies a normal Tile feature row. The native tile icon and information keep their normal placement.

## Installation

Requires Home Assistant 2026.10 or newer. Tested initially against 2026.10.1 and used on 2026.11.1. These are frontend features; installing them does not require a Home Assistant restart.

### Marketplace / HACS custom repository

1. Open **Settings → Marketplace** on HA 2026.11+, or **HACS** on earlier versions.
2. Add `https://github.com/jtonk/ha-wind-tile-features` as a custom repository in the Dashboard / Lovelace category.
3. Install **Wind Tile Features**.
4. Confirm that one JavaScript module resource for `wind-tile-features.js` was registered automatically.
5. Refresh the browser, then edit a Tile card and add either feature or both.

Adding a custom repository makes it available in your own Marketplace/HACS installation. It does not mean the project is in the default public catalog.

### Manual installation

Copy `wind-tile-features.js` from this repository into `/config/www/` and add this **module** resource under Settings → Dashboards → Resources:

```text
/local/wind-tile-features.js?v=0.1.0
```

Change the version query string when updating the file to prevent stale browser caches.

## Configuration

Both features work separately. Example with both:

```yaml
type: tile
entity: sensor.ksn_speed
name: Wind KSN
icon: mdi:navigation
vertical: false
features_position: bottom
grid_options:
  columns: 6
  rows: 3
features:
  - type: custom:wind-live-tile-feature
    gust_entity: sensor.ksn_speed_gusts
  - type: custom:wind-history-tile-feature
    gust_entity: sensor.ksn_speed_gusts
    direction_entity: sensor.ksn_wind_direction
```

Use only the corresponding feature entry for a slider-only or graph-only tile. Let HA choose the normal height, or add rows to give the graph more height. For a narrow card, the graph automatically shows fewer recent minutes.

| Option | Feature | Meaning |
| --- | --- | --- |
| `gust_entity` | Both | Optional gust sensor; otherwise tries `<tile entity>_gusts`, then the tile sensor's `gusts` or `vlagen` attribute for the live value. |
| `direction_entity` | History | Optional direction sensor; otherwise replaces `_speed` with `_wind_direction`. Select it in the feature editor. |
| `direction_entity` | Live | Optional YAML override for direction; otherwise uses the same naming convention, `direction`, or `cardinal` attribute. |

The scales use knots. Sensor units `kn`, `m/s`, `km/h`, and `mph` are supported. Gusts can have their own unit. The live slider covers 0–56 kn; values above that remain in the text and the marker reaches the end. The displayed Beaufort cells cover forces 0–10, so a value at or above 56 kn has no highlighted cell.

### Fifteen-second data batches

For second-by-second playback, the main wind sensor may provide these aligned arrays in its `data` attribute:

```yaml
data:
  speed: [12.3, 12.4, 12.2]     # up to 15 values, in the sensor's unit
  gusts: [15.6, 15.7, 15.5]    # same sample order
  direction: [225, 226, 224]   # degrees, wind FROM
```

A new sensor update starts playback at the first sample, then advances once a second. Up to 15 samples are used. Without arrays, the features use the latest sensor state. The graph reads historical speed/gust/direction sensor states from HA Recorder, groups them into minute bars, and refreshes the requested history about once per minute. Those sensors must be recorded for earlier bars to appear. Very old or unavailable samples remain gaps.

History duration follows the plot width, including durations longer than 60 minutes on wide cards. Direction arrows sample the same visible time range and use `mdi:navigation` artwork.

## Migrating from the original two local files

The feature type names are unchanged, so existing dashboard cards do not need editing.

1. Back up the old resource URLs and local JavaScript files.
2. Install this repository through Marketplace/HACS.
3. Verify the new combined resource is registered and its URL loads.
4. Remove the resource registrations for `wind-history-tile-feature.js` and `wind-live-tile-feature.js`.
5. Refresh all open HA clients so the installed bundle supplies both features.

Do not keep the old resources registered alongside the combined bundle. Already-open pages can retain the earlier definitions until refreshed. Old local files can be archived after migration.

## Appearance

Both features use the same Windfinder wind palette. The history guides follow the graph text color, are fully opaque, and use a 0.25 px stroke. Horizontal guides stay behind the bars; vertical time guides stay above them. The guides do not animate. The initial bar reveal respects the browser's reduced-motion preference. The features do not recolor the native tile icon.

The graph styling does not require card-mod. Existing card-mod rules, circle gauges, and tile extensions are separate customizations.

## Development

The editable source files are in `src/`. The committed root bundle is generated deterministically, with no runtime dependencies.

```sh
python3 scripts/build.py
python3 scripts/build.py --check
npm test
```

Tests use Node.js 20+ and its built-in test runner. CI checks source/bundle consistency, JavaScript syntax, registration, units, playback, bar widths, and time markers. Tagging a version such as `v0.1.0` triggers the release workflow and attaches the bundle.

## License

MIT. The direction arrow uses the Material Design Icons navigation path (Pictogrammers, Apache-2.0); see `NOTICE`.
