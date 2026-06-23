#!/bin/bash
DIR="$(cd "$(dirname "$0")/../documentation" && pwd)"

for f in "$DIR"/*; do
  name="$(basename "$f")"
  # skip if already starts with a 6-digit date
  [[ "$name" =~ ^[0-9]{6}_ ]] && continue
  date="$(date -r "$f" +%y%m%d)"
  mv "$f" "$DIR/${date}_${name}"
  echo "Renamed: $name → ${date}_${name}"
done
