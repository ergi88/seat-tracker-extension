#!/bin/sh
# Build seat-tracker.zip for a GitHub release.
#
#   ./release.sh
#
# The zip always holds one folder named seat-tracker/, whatever this folder is
# called on your PC, so friends unzip it over the same folder every time and
# Chrome keeps the same extension (and their sign-in). Left out: git, the
# tests, local notes that hold real emails (supabase/team.sql), the graphify
# graph and Claude notes, old zips and Mac clutter.
#
# Needs zip, or on Windows (Git Bash has no zip) the tar.exe that comes with
# Windows 10 and later.
#
# Then on GitHub: Releases -> Draft a new release -> tag v<version> ->
# attach seat-tracker.zip -> Publish. The Updates link
#   https://github.com/ergi88/seat-tracker-extension/releases/latest/download/seat-tracker.zip
# always gives the newest one.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
name=seat-tracker        # the folder friends already have: never change it
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

# copy what ships into a temporary seat-tracker/ folder, then zip that folder
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/$name"
find . \( -path ./.git -o -path ./tests -o -path ./graphify-out -o -path ./.claude \
          -o -name node_modules \) -prune -o -type f \
     ! -name .gitignore ! -name release.sh ! -name CLAUDE.md \
     ! -name '*.zip' ! -name .DS_Store ! -path ./supabase/team.sql -print \
  | tar -cf - -T - | (cd "$tmp/$name" && tar -xf -)

wintar=""
if [ -n "${SYSTEMROOT:-}" ] && command -v cygpath >/dev/null 2>&1; then
  wintar="$(cygpath -u "$SYSTEMROOT")/System32/tar.exe"
fi

rm -f "$zipfile"
cd "$tmp"
if command -v zip >/dev/null 2>&1; then
  zip -rqX "$zipfile" "$name"
elif [ -n "$wintar" ] && [ -x "$wintar" ]; then
  "$wintar" -a -cf "$(cygpath -w "$zipfile")" "$name"    # .zip -> zip format
else
  echo "Stopped: needs zip (or, on Windows, C:\\Windows\\System32\\tar.exe)." >&2
  exit 1
fi
cd "$here"

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
