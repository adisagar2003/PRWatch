#!/usr/bin/env bash
# Fuzzy-find your GitHub repos and act on the one you pick.
# Usage: ./repo-find.sh            -> pick a repo, print its URL
#        ./repo-find.sh open       -> pick a repo, open it in the browser
#        ./repo-find.sh clone      -> pick a repo, clone it here
#        ./repo-find.sh view       -> pick a repo, show details in terminal
set -euo pipefail

ACTION="${1:-url}"
LIMIT="${REPO_LIMIT:-300}"

# Pull repos: "owner/name<TAB>description". Cached 10 min to keep it snappy.
CACHE="${TMPDIR:-/tmp}/gh-repo-list.tsv"
if [[ ! -f "$CACHE" ]] || [[ $(find "$CACHE" -mmin +10 2>/dev/null) ]]; then
  gh repo list --limit "$LIMIT" --json nameWithOwner,description \
    --jq '.[] | "\(.nameWithOwner)\t\(.description // "")"' > "$CACHE"
fi

# Fuzzy-pick. Preview pane shows the live repo detail via `gh repo view`.
SELECTED=$(fzf --with-nth=1,2 --delimiter='\t' \
  --prompt='repo> ' \
  --height=80% --border --ansi \
  --preview 'gh repo view {1} 2>/dev/null | head -40' \
  --preview-window=right:60%:wrap < "$CACHE" | cut -f1)

[[ -z "${SELECTED:-}" ]] && { echo "Nothing selected."; exit 0; }

case "$ACTION" in
  open)  gh repo view "$SELECTED" --web ;;
  clone) gh repo clone "$SELECTED" ;;
  view)  gh repo view "$SELECTED" ;;
  url|*) echo "https://github.com/$SELECTED" ;;
esac
