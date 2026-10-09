#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(git rev-parse --show-toplevel)"
failed=0

echo "workspace: $workspace_root"
echo "branch:    $(git -C "$workspace_root" branch --show-current)"

if find "$workspace_root" -mindepth 2 -maxdepth 2 -name .git -print -quit | grep -q .; then
  echo "ERROR: nested Git repositories still exist" >&2
  failed=1
else
  echo "nested Git repositories: none"
fi

tracked_env="$(git -C "$workspace_root" ls-files ':(glob)**/.env' ':(glob)**/.env.dev')"
if [[ -n "$tracked_env" ]]; then
  echo "ERROR: local environment files are tracked:" >&2
  echo "$tracked_env" >&2
  failed=1
else
  echo "tracked local environment files: none"
fi

echo "registered worktrees:"
git -C "$workspace_root" worktree list

if [[ -f "$workspace_root/.hzy-worktree.env" ]]; then
  echo "worktree metadata: $workspace_root/.hzy-worktree.env"
fi

exit "$failed"
