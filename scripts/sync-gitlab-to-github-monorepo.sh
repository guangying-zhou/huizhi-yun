#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODULES=(
  aims
  align
  altoc
  assets
  codocs
  collab
  console
  finance
  insights
  nuxt-template
  people
  platform
  webdev
  workflow
)

looks_like_source_workspace() {
  local path="$1"
  [[ -d "$path/.git" && -d "$path/aims/.git" && -d "$path/console/.git" ]]
}

if [[ -n "${HZY_GITLAB_WORKSPACE:-}" ]]; then
  SOURCE_WORKSPACE="$(cd "$HZY_GITLAB_WORKSPACE" && pwd)"
elif looks_like_source_workspace "$SCRIPT_ROOT"; then
  SOURCE_WORKSPACE="$SCRIPT_ROOT"
else
  SOURCE_WORKSPACE="$(cd "$SCRIPT_ROOT/../huizhi-yun" && pwd)"
fi

if [[ -n "${HZY_GITHUB_MONOREPO:-}" ]]; then
  TARGET_MONOREPO="$(cd "$HZY_GITHUB_MONOREPO" && pwd)"
elif looks_like_source_workspace "$SCRIPT_ROOT"; then
  TARGET_MONOREPO="$(cd "$SCRIPT_ROOT/../huizhi-yun-github-monorepo" && pwd)"
else
  TARGET_MONOREPO="$SCRIPT_ROOT"
fi

# Files owned by the public mirror itself rather than the internal source
# workspace. Preserve them across snapshot refreshes.
TARGET_PRESERVED_FILES=(
  README.md
  .gitignore
)

if [[ ! -d "$SOURCE_WORKSPACE/.git" ]]; then
  echo "Source workspace is not a git repository: $SOURCE_WORKSPACE" >&2
  exit 1
fi

if [[ ! -d "$TARGET_MONOREPO/.git" ]]; then
  echo "Target monorepo is not a git repository: $TARGET_MONOREPO" >&2
  exit 1
fi

if [[ "$SOURCE_WORKSPACE" == "$TARGET_MONOREPO" ]]; then
  echo "Source workspace and target monorepo must be different directories." >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required for snapshot sync." >&2
  exit 1
fi

if [[ "${HZY_ALLOW_DIRTY_TARGET:-0}" != "1" && -n "$(git -C "$TARGET_MONOREPO" status --porcelain --untracked-files=no)" ]]; then
  echo "Target monorepo tracked worktree is not clean. Commit or stash tracked changes before syncing." >&2
  exit 1
fi

staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/hzy-github-monorepo.XXXXXX")"
trap 'rm -rf "$staging_dir"' EXIT

copy_index_snapshot() {
  local source_repo="$1"
  local destination="$2"
  local label="$3"

  if [[ ! -d "$source_repo/.git" ]]; then
    echo "Skipping $label: not a git repository at $source_repo" >&2
    return
  fi

  if ! git -C "$source_repo" diff --quiet; then
    echo "Warning: $label has unstaged changes; snapshot uses the Git index, not the worktree." >&2
  fi

  mkdir -p "$destination"

  (
    cd "$source_repo"
    git ls-files -z |
      while IFS= read -r -d '' path; do
        local name="${path##*/}"
        case "$path" in
          .codex/tmp/*|.playwright-cli/*|.tmp-design/*|memory/*)
            continue
            ;;
          .nuxt/*|.output/*|build/*|coverage/*|dist/*)
            continue
            ;;
          */.nuxt/*|*/.output/*|*/build/*|*/coverage/*|*/dist/*)
            continue
            ;;
        esac
        case "$name" in
          .DS_Store|license.lic|*.bin|*.dmg|*.docx|*.exe|*.gz|*.pdf|*.pptx|*.sha256|*.tar.gz|*.tgz|*.xls|*.xlsx|*.zip)
            continue
            ;;
        esac
        if [[ "$name" == ".env" || "$name" == .env.* ]]; then
          if [[ "$name" != ".env.example" && "$name" != .env.*.example ]]; then
            continue
          fi
        fi
        printf '%s\0' "$path"
      done |
      git checkout-index --force --stdin -z --prefix="$destination/"
  )
}

echo "Building public snapshot from indexed source files at $SOURCE_WORKSPACE"
copy_index_snapshot "$SOURCE_WORKSPACE" "$staging_dir" "root workspace"

for module in "${MODULES[@]}"; do
  copy_index_snapshot "$SOURCE_WORKSPACE/$module" "$staging_dir/$module" "$module"
done

for file in "${TARGET_PRESERVED_FILES[@]}"; do
  if [[ -f "$TARGET_MONOREPO/$file" ]]; then
    mkdir -p "$staging_dir/$(dirname "$file")"
    cp "$TARGET_MONOREPO/$file" "$staging_dir/$file"
  fi
done

echo "Replacing tracked files in $TARGET_MONOREPO"
(
  cd "$TARGET_MONOREPO"
  git ls-files -z | xargs -0 rm -f
  rsync -a "$staging_dir/" "$TARGET_MONOREPO/"
)

echo "Snapshot sync complete."
echo "Review with: git -C \"$TARGET_MONOREPO\" status --short"
echo "Then stage and commit in the target monorepo."
