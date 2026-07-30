#!/usr/bin/env bash
set -euo pipefail

# Read-only upstream drift check. It updates remote-tracking refs, but never
# changes the current branch, index, or working tree.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
remote="${PI_WEB_UPSTREAM_REMOTE:-upstream}"
branch="${PI_WEB_UPSTREAM_BRANCH:-main}"
local_ref="${PI_WEB_LOCAL_REF:-HEAD}"
remote_ref="refs/remotes/$remote/$branch"

cd "$repo_root"

if ! git remote get-url "$remote" >/dev/null 2>&1; then
  echo "ERROR: Git remote '$remote' is not configured." >&2
  exit 2
fi

echo "Fetching $remote/$branch ..."
git fetch "$remote" "$branch" --prune --tags

if ! git rev-parse --verify "$remote_ref" >/dev/null 2>&1; then
  echo "ERROR: $remote_ref was not created by fetch." >&2
  exit 3
fi

read -r local_only upstream_only < <(
  git rev-list --left-right --count "$local_ref...$remote_ref"
)

echo "Local ref:       $local_ref ($(git rev-parse --short "$local_ref"))"
echo "Upstream ref:    $remote/$branch ($(git rev-parse --short "$remote_ref"))"
echo "Local-only:      $local_only commit(s)"
echo "Upstream-only:   $upstream_only commit(s)"
echo "Working tree:    $(if [[ -n "$(git status --porcelain)" ]]; then echo dirty; else echo clean; fi)"

if (( upstream_only > 0 )); then
  echo
  echo "Upstream updates are available:"
  git log --oneline --decorate "$local_ref..$remote_ref"
  echo
  echo "Next: follow docs/maintenance-playbook.zh-CN.md; do not auto-merge a dirty tree."
else
  echo "Status: already contains the latest $remote/$branch."
fi
