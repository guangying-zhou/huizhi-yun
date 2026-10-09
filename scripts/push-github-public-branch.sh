#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/github-public-snapshot.sh
source "$script_dir/lib/github-public-snapshot.sh"

usage() {
  echo "Usage: pnpm sync:github-public-branch [--dry-run] [branch]"
  echo
  echo "Publishes a sanitized snapshot of a feature branch to the GitHub mirror as"
  echo "a standalone branch. The snapshot is committed on top of the currently"
  echo "published $PUBLIC_BASE_BRANCH so GitHub can diff it, and is never merged."
  echo "Defaults to the branch checked out in this workspace."
}

dry_run=0
source_branch=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      dry_run=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$source_branch" ]]; then
        usage >&2
        exit 2
      fi
      source_branch="$1"
      ;;
  esac
  shift
done

workspace_root="$(public_snapshot_workspace_root)"
public_snapshot_require_origin "$workspace_root"
public_snapshot_require_perl

if [[ -z "$source_branch" ]]; then
  source_branch="$(git -C "$workspace_root" rev-parse --abbrev-ref HEAD)"
fi

if [[ "$source_branch" == "HEAD" ]]; then
  echo "detached HEAD: pass an explicit branch name" >&2
  exit 1
fi

if [[ "$source_branch" == "$PUBLIC_BASE_BRANCH" ]]; then
  echo "use pnpm sync:github-public to publish $PUBLIC_BASE_BRANCH" >&2
  exit 1
fi

public_snapshot_require_synced_branch "$workspace_root" "$source_branch"

base_head="$(public_snapshot_remote_head "$PUBLIC_BASE_BRANCH")"
if [[ -z "$base_head" ]]; then
  echo "publish $PUBLIC_BASE_BRANCH with pnpm sync:github-public before publishing a branch" >&2
  exit 1
fi

remote_branch_head="$(public_snapshot_remote_head "$source_branch")"
snapshot_dir="$(mktemp -d "${TMPDIR:-/tmp}/hzy-github-public-branch.XXXXXX")"
trap 'rm -rf "$snapshot_dir"' EXIT

public_snapshot_export "$workspace_root" "$source_branch" "$snapshot_dir"
public_snapshot_sanitize "$snapshot_dir"
public_snapshot_commit "$snapshot_dir" "$source_branch" \
  "chore: update public snapshot ($source_branch)" \
  "refs/heads/$PUBLIC_BASE_BRANCH" "$base_head"

snapshot_head="$(git -C "$snapshot_dir" rev-parse "$source_branch")"
echo "Public branch snapshot: $snapshot_head (based on published $PUBLIC_BASE_BRANCH $base_head)"

if [[ "$dry_run" == "1" ]]; then
  echo "Dry run complete; GitHub was not modified."
  exit 0
fi

public_snapshot_push "$snapshot_dir" "$source_branch" "$remote_branch_head"

echo "Published public branch snapshot to $GITHUB_REPOSITORY ($source_branch, not merged into $PUBLIC_BASE_BRANCH)"
