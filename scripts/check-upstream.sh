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

pi_source_dir="${PI_WEB_PI_SOURCE_DIR:-$repo_root/../opc-os/pi}"
echo
echo "OPC OS Pi monorepo source:"
if [[ ! -d "$pi_source_dir" ]] || ! git -C "$pi_source_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "  unavailable: $pi_source_dir"
  echo "  Set PI_WEB_PI_SOURCE_DIR to audit the Pi source used by Pi Web."
else
  pi_remote="${PI_SOURCE_UPSTREAM_REMOTE:-upstream}"
  pi_branch="${PI_SOURCE_UPSTREAM_BRANCH:-main}"
  if ! git -C "$pi_source_dir" remote get-url "$pi_remote" >/dev/null 2>&1; then
    echo "ERROR: Pi source remote '$pi_remote' is not configured in $pi_source_dir." >&2
    exit 4
  fi

  echo "  Fetching $pi_remote/$pi_branch and stable tags ..."
  git -C "$pi_source_dir" fetch "$pi_remote" "$pi_branch" --prune --tags
  pi_head="$(git -C "$pi_source_dir" rev-parse HEAD)"
  pi_main="refs/remotes/$pi_remote/$pi_branch"
  latest_pi_tag="$(git -C "$pi_source_dir" tag --list 'v[0-9]*' --sort=-version:refname | head -n 1)"
  if [[ -z "$latest_pi_tag" ]]; then
    echo "ERROR: no stable Pi tag was found after fetch." >&2
    exit 5
  fi

  read -r pi_local_only pi_stable_only < <(
    git -C "$pi_source_dir" rev-list --left-right --count "$pi_head...refs/tags/$latest_pi_tag"
  )
  pi_unreleased_count="$(git -C "$pi_source_dir" rev-list --count "refs/tags/$latest_pi_tag..$pi_main")"
  pi_version="$(node -e '
    const manifest = require(process.argv[1]);
    process.stdout.write(String(manifest.version ?? "unknown"));
  ' "$pi_source_dir/packages/coding-agent/package.json")"

  echo "  Source HEAD:     $(git -C "$pi_source_dir" rev-parse --short HEAD) (package $pi_version)"
  echo "  Latest stable:   $latest_pi_tag ($(git -C "$pi_source_dir" rev-parse --short "refs/tags/$latest_pi_tag^{commit}"))"
  echo "  Local-only:      $pi_local_only commit(s)"
  echo "  Stable-only:     $pi_stable_only commit(s)"
  echo "  Main-unreleased: $pi_unreleased_count commit(s)"
  echo "  Working tree:    $(if [[ -n "$(git -C "$pi_source_dir" status --porcelain)" ]]; then echo dirty; else echo clean; fi)"
  echo "  Policy: sync the whole OPC Pi monorepo at a stable tag; never upgrade only Pi Web SDK packages."
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
echo "Pi Web manifest compatibility hints (runtime must still come from OPC source):"
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

  compared_version="$pinned"
  pinned_label="$pinned"
  if [[ "$pinned" == file:* ]]; then
    local_package_dir="$repo_root/${pinned#file:}"
    compared_version="$({
      node -e '
        const manifest = require(process.argv[1]);
        process.stdout.write(String(manifest.version ?? ""));
      ' "$local_package_dir/package.json"
    } 2>/dev/null || true)"
    pinned_label="local:${compared_version:-unknown}"
  fi

  if [[ -z "$pinned" ]]; then
    printf '  %-42s pinned: %-12s latest: %s\n' "$package" "not-used" "${latest:-unknown}"
    continue
  fi
  if [[ -z "$latest" ]]; then
    printf '  %-42s declared: %-16s latest: unknown\n' "$package" "$pinned_label"
    ((pi_unknown_count += 1))
    continue
  fi
  if [[ "$compared_version" == "$latest" ]]; then
    printf '  %-42s declared: %-16s latest: %-12s OK\n' "$package" "$pinned_label" "$latest"
  else
    printf '  %-42s declared: %-16s latest: %-12s REVIEW\n' "$package" "$pinned_label" "$latest"
    ((pi_update_count += 1))
  fi
done

if (( pi_update_count > 0 )); then
  echo "Manifest status: $pi_update_count stable package update(s) require a compatibility review with the OPC source."
elif (( pi_unknown_count > 0 )); then
  echo "Manifest status: no mismatch found, but $pi_unknown_count package version(s) could not be queried."
else
  echo "Manifest status: all declared Pi compatibility versions match their latest stable releases."
fi

echo "Policy: OPC Pi is the runtime source of truth; unreleased main commits are research input, not upgrade candidates."
