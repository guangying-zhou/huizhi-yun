#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: pnpm worktree:create <name> [base-ref]"
  echo "Optional: HZY_WORKTREE_ROOT=/absolute/path HZY_WORKTREE_SKIP_INSTALL=1"
}

name="${1:-}"
base_ref="${2:-HEAD}"

if [[ -z "$name" ]]; then
  usage
  exit 2
fi

if [[ ! "$name" =~ ^[a-z0-9][a-z0-9._-]*$ ]]; then
  echo "worktree name must match ^[a-z0-9][a-z0-9._-]*$" >&2
  exit 2
fi

workspace_root="$(git rev-parse --show-toplevel)"
worktree_root="${HZY_WORKTREE_ROOT:-$(dirname "$workspace_root")/huizhi-yun-worktrees}"
branch="codex/$name"

if [[ -n "$(git -C "$workspace_root" status --porcelain)" ]]; then
  echo "main workspace is dirty; commit or revert changes before creating a worktree" >&2
  exit 1
fi

if git -C "$workspace_root" show-ref --verify --quiet "refs/heads/$branch"; then
  echo "branch already exists: $branch" >&2
  exit 1
fi

mkdir -p "$worktree_root"
worktree_root="$(cd "$worktree_root" && pwd -P)"
target_dir="$worktree_root/$name"

if [[ -e "$target_dir" ]]; then
  echo "target already exists: $target_dir" >&2
  exit 1
fi

git -C "$workspace_root" worktree add -b "$branch" "$target_dir" "$base_ref"

slot="$(git -C "$workspace_root" worktree list --porcelain | awk '$1 == "worktree" { count++ } END { print count - 1 }')"
cat > "$target_dir/.hzy-worktree.env" <<EOF
HZY_WORKTREE_NAME=$name
HZY_WORKTREE_SLOT=$slot
HZY_PORT_OFFSET=$((slot * 100))
EOF

if [[ "${HZY_WORKTREE_SKIP_INSTALL:-0}" != "1" ]]; then
  corepack pnpm --dir "$target_dir" install --frozen-lockfile
fi

echo "created: $target_dir"
echo "branch:  $branch"
echo "local env files were not copied; provision secrets explicitly outside Git"
