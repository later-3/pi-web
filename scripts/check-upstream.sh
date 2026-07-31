#!/usr/bin/env bash
set -euo pipefail

# Read-only upstream drift check. It updates remote-tracking refs and queries
# published Pi package versions, but never changes the current branch, index,
# working tree, package manifest, or lockfiles.

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

if [[ "${PI_WEB_CHECK_PI_PACKAGES:-1}" == "0" ]]; then
  echo
  echo "Official Pi package check: skipped (PI_WEB_CHECK_PI_PACKAGES=0)."
  exit 0
fi

pi_packages=(
  "@earendil-works/pi-coding-agent"
  "@earendil-works/pi-agent-core"
  "@earendil-works/pi-ai"
  "@earendil-works/pi-tui"
)
pi_update_count=0
pi_unknown_count=0

echo
echo "Official Pi stable package releases:"
for package in "${pi_packages[@]}"; do
  pinned="$({
    node -e '
      const manifest = require(process.argv[1]);
      const packageName = process.argv[2];
      const version = manifest.dependencies?.[packageName] ?? manifest.devDependencies?.[packageName];
      if (typeof version !== "string") process.exit(1);
      process.stdout.write(version);
    ' "$repo_root/package.json" "$package"
  } 2>/dev/null || true)"

  latest="$(npm view "$package" version --silent 2>/dev/null || true)"
  latest="${latest##*$'\n'}"

  if [[ -z "$pinned" ]]; then
    printf '  %-42s pinned: %-12s latest: %s\n' "$package" "not-used" "${latest:-unknown}"
    continue
  fi
  if [[ -z "$latest" ]]; then
    printf '  %-42s pinned: %-12s latest: unknown\n' "$package" "$pinned"
    ((pi_unknown_count += 1))
    continue
  fi
  if [[ "$pinned" == "$latest" ]]; then
    printf '  %-42s pinned: %-12s latest: %-12s OK\n' "$package" "$pinned" "$latest"
  else
    printf '  %-42s pinned: %-12s latest: %-12s REVIEW\n' "$package" "$pinned" "$latest"
    ((pi_update_count += 1))
  fi
done

if (( pi_update_count > 0 )); then
  echo "Pi status: $pi_update_count stable package update(s) require a separate compatibility review."
elif (( pi_unknown_count > 0 )); then
  echo "Pi status: no mismatch found, but $pi_unknown_count package version(s) could not be queried."
else
  echo "Pi status: all pinned Pi packages match their latest stable releases."
fi

echo "Policy: unreleased commits on the Pi source main branch are research input, not upgrade candidates."
