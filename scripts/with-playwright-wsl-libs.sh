#!/usr/bin/env bash

set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 1
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  exec "$@"
fi

if ! command -v apt >/dev/null 2>&1 || ! command -v dpkg-deb >/dev/null 2>&1; then
  echo "apt and dpkg-deb are required to provision Playwright browser libraries on WSL." >&2
  exit 1
fi

CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/colony-maintenance/playwright-libs"
EXTRACT_ROOT="$CACHE_ROOT/extracted"
LIB_DIR="$EXTRACT_ROOT/usr/lib/x86_64-linux-gnu"

if [[ ! -f "$LIB_DIR/libnspr4.so" || ! -f "$LIB_DIR/libnss3.so" || ! -e "$LIB_DIR/libasound.so.2" ]]; then
  mkdir -p "$CACHE_ROOT" "$EXTRACT_ROOT"
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' EXIT

  (
    cd "$temp_dir"
    apt download libnspr4 libnss3 libasound2t64 >/dev/null
  )

  for package_file in "$temp_dir"/*.deb; do
    dpkg-deb -x "$package_file" "$EXTRACT_ROOT"
  done
fi

export LD_LIBRARY_PATH="$LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

exec "$@"
