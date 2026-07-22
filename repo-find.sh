#!/usr/bin/env bash
# Fuzzy-find your GitHub repos and act on the one you pick.
# Usage: ./repo-find.sh            -> pick a repo, print its URL
#        ./repo-find.sh open       -> pick a repo, open it in the browser
#        ./repo-find.sh clone      -> pick a repo, clone it here
#        ./repo-find.sh view       -> pick a repo, show details in terminal
set -euo pipefail

ACTION="${1:-url}"
LIMIT="${REPO_LIMIT:-300}"

# Per-user cache dir (never a shared, world-writable path like /tmp, where
# another user could pre-plant a symlink and have us truncate its target).
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/prwatch"
mkdir -p "$CACHE_DIR"
CACHE="$CACHE_DIR/gh-repo-list.tsv"

# Pull repos as "owner/name<TAB>description". Cached 10 min to keep it snappy.
# Write to a private temp file and rename over the cache so a killed `gh` can
# never leave a half-written list behind.
if [[ ! -f "$CACHE" ]] || [[ -n "$(find "$CACHE" -mmin +10 2>/dev/null)" ]]; then
  tmp="$(mktemp "$CACHE_DIR/repos.XXXXXX")"
  gh repo list --limit "$LIMIT" --json nameWithOwner,description \
    --jq '.[] | "\(.nameWithOwner)\t\(.description // "")"' > "$tmp"
  mv "$tmp" "$CACHE"
fi

# Fuzzy-pick. Preview pane shows the live repo detail via `gh repo view`.
# `|| true`: fzf exits non-zero when cancelled (130 on Esc/Ctrl-C, 1 on no
# match); without this, `set -e` would abort before the guard below.
LINE="$(fzf --with-nth=1,2 --delimiter='\t' \
  --prompt='repo> ' \
  --height=80% --border --ansi \
  --preview 'gh repo view {1} 2>/dev/null | head -40' \
  --preview-window=right:60%:wrap < "$CACHE" || true)"

[[ -z "$LINE" ]] && { echo "Nothing selected."; exit 0; }
SELECTED="${LINE%%$'\t'*}" # the owner/name field, before the first tab

case "$ACTION" in
  open)  gh repo view "$SELECTED" --web ;;
  clone) gh repo clone "$SELECTED" ;;
  view)  gh repo view "$SELECTED" ;;
  url|*) echo "https://github.com/$SELECTED" ;;
esac
