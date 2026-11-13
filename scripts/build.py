#!/usr/bin/env python3
"""Build a dependency-free bundle containing two independent tile features."""
import argparse
from pathlib import Path
import json
root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text())['version']
parts = [f'/* Wind Tile Features v{version} | MIT | github.com/jtonk/ha-wind-tile-features */\n']
for name, tag in [('wind-history-tile-feature.js', 'wind-history-tile-feature'),
                  ('wind-live-tile-feature.js', 'wind-live-tile-feature')]:
    source = (root / 'src' / name).read_text()
    parts.append(f"(() => {{\n  if (customElements.get('{tag}')) return;\n{source}\n}})();\n")
content = '\n'.join(parts)
output = root / 'wind-tile-features.js'
parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
if args.check:
    if not output.exists() or output.read_text() != content:
        raise SystemExit('Bundle is stale. Run python3 scripts/build.py')
    print('Bundle matches source.')
else:
    output.write_text(content)
    print(f'Built {output.name} ({len(content)} characters).')
