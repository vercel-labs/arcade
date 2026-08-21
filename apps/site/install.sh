#!/usr/bin/env sh
# curl -fsSL vercel-arcade.vercel.app/install | sh
#
# Served by this project at /install (see build.mjs). A thin front door for
# `npm i -g @vercel/arcade`: it checks for a usable Node, then hands off to npm.
# The "here's how to run it" banner comes from the package's own postinstall.
#
# Arcade is a private @vercel package, so npm still needs your registry auth —
# this script cannot supply it, and says so plainly when npm reports 401/403/404.
#
# POSIX sh on purpose: `curl | sh` should not assume bash.
set -eu

PKG="@vercel/arcade"
MIN_NODE_MAJOR=20

red() { printf '\033[38;2;235;130;130m%s\033[0m\n' "$1" >&2; }
dim() { printf '\033[2m%s\033[0m\n' "$1"; }

die() {
  red "$1"
  shift
  for line in "$@"; do dim "  $line"; done
  exit 1
}

command -v node >/dev/null 2>&1 || die \
  "Arcade needs Node ${MIN_NODE_MAJOR} or newer, and node was not found." \
  "Install it from https://nodejs.org (or: brew install node)."

# `node --version` prints v22.11.0; keep the major.
node_major=$(node --version | sed 's/^v//; s/\..*//')
case "$node_major" in
  '' | *[!0-9]*) die "Could not read the Node version from \`node --version\`." ;;
esac
[ "$node_major" -ge "$MIN_NODE_MAJOR" ] || die \
  "Arcade needs Node ${MIN_NODE_MAJOR} or newer (found v${node_major})." \
  "Upgrade from https://nodejs.org (or: brew upgrade node)."

command -v npm >/dev/null 2>&1 || die \
  "npm was not found, and this installer uses it to install ${PKG}." \
  "npm ships with Node — reinstall Node from https://nodejs.org."

printf '\033[2mInstalling\033[0m \033[1m%s\033[0m\033[2m with npm…\033[0m\n' "$PKG"

# Keep npm at its default log level: the package's postinstall banner is
# deliberately silent under --silent / --loglevel=error.
log=$(mktemp -t arcade-install)
if npm install --global "${PKG}@latest" 2>&1 | tee "$log"; then
  rm -f "$log"
  exit 0
fi

if grep -qE 'E40[134]|ENEEDAUTH|need auth' "$log"; then
  rm -f "$log"
  die "npm could not read ${PKG} — it is a private, Vercel-internal package." \
    "Sign in to the registry with @vercel access, then re-run this installer:" \
    "  npm login --scope=@vercel"
fi
rm -f "$log"
die "npm failed to install ${PKG} (see its output above)."
