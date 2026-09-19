#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/github-public-snapshot.sh
source "$script_dir/lib/github-public-snapshot.sh"

SOURCE_BRANCH="$PUBLIC_BASE_BRANCH"

usage() {
  echo "Usage: pnpm sync:github-public [--dry-run]"
}

dry_run=0
case "${1:-}" in
  "")
    ;;
  --dry-run)
    dry_run=1
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

workspace_root="$(public_snapshot_workspace_root)"
public_snapshot_require_origin "$workspace_root"
public_snapshot_require_perl
public_snapshot_require_synced_branch "$workspace_root" "$SOURCE_BRANCH"

remote_main="$(public_snapshot_remote_head "$SOURCE_BRANCH")"
snapshot_dir="$(mktemp -d "${TMPDIR:-/tmp}/hzy-github-public.XXXXXX")"
trap 'rm -rf "$snapshot_dir"' EXIT

public_snapshot_export "$workspace_root" "$SOURCE_BRANCH" "$snapshot_dir"
public_snapshot_sanitize "$snapshot_dir"
public_snapshot_commit "$snapshot_dir" "$SOURCE_BRANCH" "chore: update public snapshot"

snapshot_head="$(git -C "$snapshot_dir" rev-parse "$SOURCE_BRANCH")"
echo "Public snapshot: $snapshot_head"

if [[ "$dry_run" == "1" ]]; then
  echo "Dry run complete; GitHub was not modified."
  exit 0
fi

public_snapshot_push "$snapshot_dir" "$SOURCE_BRANCH" "$remote_main"

echo "Published public snapshot to $GITHUB_REPOSITORY"
