# Migration and rollback

The old local resources register the same element names as the bundled resource. Installation is staged to preserve the existing cards.

## Install and verify

1. Add `jtonk/ha-wind-tile-features` as a custom dashboard repository in Marketplace/HACS.
2. Download the repository and verify the installed `wind-tile-features.js` file is served successfully.
3. List HA dashboard resources through its API and confirm the combined resource is registered once.
4. Remove only the two original resource registrations (`/local/wind-history-tile-feature.js?...` and `/local/wind-live-tile-feature.js?...`). Save their original IDs/URLs first.
5. Refresh the browser. Verify both custom feature picker entries and existing wind tiles.
6. Archive the old local files after verification. Never delete `src/` or other unrelated resources.

The existing feature identifiers remain `custom:wind-history-tile-feature` and `custom:wind-live-tile-feature`. Sensor entity names and dashboard layout are preserved.

## Rollback

Remove the combined bundle's resource registration, restore the two original registrations from the migration backup, and refresh all browsers. If the old local files were archived, restore them to `/config/www/` first. No HA restart is required. This rolls back only the custom frontend package, not the dashboard or other HA configuration.
