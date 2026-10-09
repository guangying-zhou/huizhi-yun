#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: pnpm worktree:remove <name>"
  echo "Optional: HZY_WORKTREE_ROOT=/absolute/path"
}

name="${1:-}"
if [[ -z "$name" ]]; then
  usage
  exit 2
fi

workspace_root="$(git rev-parse --show-toplevel)"
worktree_root="${HZY_WORKTREE_ROOT:-$(dirname "$workspace_root")/huizhi-yun-worktrees}"
if [[ ! -d "$worktree_root" ]]; then
  echo "worktree root does not exist: $worktree_root" >&2
  exit 1
fi
worktree_root="$(cd "$worktree_root" && pwd -P)"
target_dir="$worktree_root/$name"

registered="$(git -C "$workspace_root" worktree list --porcelain | awk -v target="$target_dir" '$1 == "worktree" && $2 == target { print $2 }')"
if [[ -z "$registered" ]]; then
  echo "worktree is not registered: $target_dir" >&2
  exit 1
fi

if [[ -n "$(git -C "$target_dir" status --porcelain)" ]]; then
  echo "worktree is dirty; commit or revert changes before removal: $target_dir" >&2
  exit 1
fi

git -C "$workspace_root" worktree remove "$target_dir"
echo "removed worktree: $target_dir"
echo "branch was preserved and can be deleted separately after merge"
