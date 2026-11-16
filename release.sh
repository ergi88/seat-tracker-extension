#!/bin/sh
# Build seat-tracker.zip for a GitHub release.
#
#   ./release.sh
#
# The zip holds one folder named like this one (seat-tracker/), so friends
# unzip it over the same folder every time and Chrome keeps the same
# extension (and their sign-in). Left out: git, the tests, local notes that
# hold real emails (supabase/team.sql), old zips and Mac clutter.
#
# Then on GitHub: Releases -> Draft a new release -> tag v<version> ->
# attach seat-tracker.zip -> Publish. The Updates link
#   https://github.com/ergi88/seat-tracker-extension/releases/latest/download/seat-tracker.zip
# always gives the newest one.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
name=$(basename "$here")
zipfile="$here/seat-tracker.zip"
cd "$here"

version=$(node -p "require('./manifest.json').version")

# what is not committed would be in the zip but not on GitHub
if [ -d .git ] && [ -n "$(git status --porcelain)" ]; then
  echo "Note: there are changes not committed yet (they go in the zip):"
  git status --short | sed 's/^/  /'
fi
if [ -d .git ] && git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
  echo "Note: tag v$version already exists. Raise \"version\" in manifest.json for a new release."
fi

rm -f "$zipfile"
cd ..
zip -rqX "$zipfile" "$name" \
  -x "$name/.git/*" "$name/.gitignore" \
     "$name/tests/*" \
     "$name/supabase/team.sql" \
     "$name/*.zip" "$name/release.sh" \
     "*.DS_Store" "*/node_modules/*"

# never publish real emails: stop if one slipped in
if unzip -p "$zipfile" | grep -aqiE '[a-z0-9._%+-]+@gmail\.com'; then
  rm -f "$zipfile"
  echo "Stopped: a @gmail.com address is in the files. Remove it and run again." >&2
  exit 1
fi

files=$(unzip -Z1 "$zipfile" | grep -cv '/$')
size=$(du -h "$zipfile" | cut -f1 | tr -d ' ')
echo "seat-tracker.zip: version $version, $files files, $size, folder $name/"
echo "Next: GitHub -> Releases -> Draft a new release -> tag v$version -> attach seat-tracker.zip -> Publish."
