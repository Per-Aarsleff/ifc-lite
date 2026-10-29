#!/bin/bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# Build the static landing page and documentation with a local Python venv.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DIST="$HERE/dist"

rm -rf "$DIST"
mkdir -p "$DIST"

# 1. Copy static landing files, excluding build tooling.
(
  cd "$HERE"
  for f in *; do
    case "$f" in
      dist | build-docs.sh | node_modules | .venv-docs) continue ;;
    esac
    cp -R "$f" "$DIST/$f"
  done
)

# 2. Build documentation in an isolated Python environment.
VENV="$HERE/.venv-docs"
python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet --disable-pip-version-check -r "$ROOT/requirements-docs.txt"
"$VENV/bin/python" -m mkdocs build --strict -f "$ROOT/mkdocs.yml" -d "$DIST/docs"

echo "Built landing + docs into $DIST ($(du -sh "$DIST" | cut -f1))"
