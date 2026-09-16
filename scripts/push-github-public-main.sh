#!/usr/bin/env bash
set -euo pipefail

GITHUB_REPOSITORY="https://github.com/guangying-zhou/huizhi-yun.git"
GITLAB_ORIGIN="https://gitlab.wiztek.cn/huizhi-yun/huizhiyun.git"
SOURCE_BRANCH="main"

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

workspace_root="$(git rev-parse --show-toplevel)"
gitlab_origin="$(git -C "$workspace_root" remote get-url origin)"

if [[ "$gitlab_origin" != "$GITLAB_ORIGIN" ]]; then
  echo "origin must be $GITLAB_ORIGIN before creating the public snapshot" >&2
  exit 1
fi

if ! git -C "$workspace_root" show-ref --verify --quiet "refs/heads/$SOURCE_BRANCH"; then
  echo "source branch does not exist: $SOURCE_BRANCH" >&2
  exit 1
fi

if ! command -v perl >/dev/null 2>&1; then
  echo "perl is required for binary-safe credential scanning" >&2
  exit 1
fi

local_main="$(git -C "$workspace_root" rev-parse "refs/heads/$SOURCE_BRANCH")"
origin_main="$(git -C "$workspace_root" ls-remote --refs origin "refs/heads/$SOURCE_BRANCH" | awk 'NR == 1 { print $1 }')"
if [[ -z "$origin_main" || "$local_main" != "$origin_main" ]]; then
  echo "local $SOURCE_BRANCH must match origin/$SOURCE_BRANCH before creating the public snapshot" >&2
  exit 1
fi

remote_main="$(git ls-remote --refs "$GITHUB_REPOSITORY" "refs/heads/$SOURCE_BRANCH" | awk 'NR == 1 { print $1 }')"
snapshot_dir="$(mktemp -d "${TMPDIR:-/tmp}/hzy-github-public.XXXXXX")"
trap 'rm -rf "$snapshot_dir"' EXIT

echo "Exporting committed $SOURCE_BRANCH snapshot from $workspace_root"
git -C "$workspace_root" archive --format=tar "refs/heads/$SOURCE_BRANCH" | tar -xf - -C "$snapshot_dir"

echo "Removing sensitive file carriers from the public snapshot"
find "$snapshot_dir" \( -type f -o -type l \) \( -iname ".env" -o -iname ".env.*" -o -iname ".envrc" -o -iname ".npmrc" -o -iname ".netrc" -o -iname ".git-credentials" -o -iname ".pypirc" -o -iname "*.pem" -o -iname "*.key" -o -iname "*.p8" -o -iname "*.ppk" -o -iname "*.p12" -o -iname "*.pfx" -o -iname "*.jks" -o -iname "*.keystore" -o -iname "credentials.json" -o -iname "service-account.json" -o -iname "id_rsa" -o -iname "id_dsa" -o -iname "id_ecdsa" -o -iname "id_ecdsa_sk" -o -iname "id_ed25519" -o -iname "id_ed25519_sk" -o -iname "id_ed448" -o -path "*/.aws/credentials" -o -path "*/.docker/config.json" -o -path "*/.kube/config" \) \
  ! -iname ".env.example" ! -iname ".env.*.example" -delete

remaining_sensitive_files="$(find "$snapshot_dir" \( -type f -o -type l \) -print | perl -ne 'chomp; next if m{(^|/)\.env(?:\.[^/]+)*\.example$}i; print if m{(^|/)(?:\.env(?:\..*)?|\.envrc|\.npmrc|\.netrc|\.git-credentials|\.pypirc|id_(?:rsa|dsa|ecdsa(?:_sk)?|ed25519(?:_sk)?|ed448)|[^/]*\.(?:pem|key|p8|ppk|p12|pfx|jks|keystore)|(?:credentials|service-account)\.json|\.aws/credentials|\.docker/config\.json|\.kube/config)$}i')"
if [[ -n "$remaining_sensitive_files" ]]; then
  echo "public snapshot still contains a sensitive environment or key file" >&2
  exit 1
fi

credential_pattern='-----BEGIN (?:ENCRYPTED )?(?:RSA|OPENSSH|EC|DSA|PRIVATE) KEY-----[\s\S]+?-----END (?:ENCRYPTED )?(?:RSA|OPENSSH|EC|DSA|PRIVATE) KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]+?-----END PGP PRIVATE KEY BLOCK-----|(?<![A-Z0-9])A(?:KIA|SIA)[0-9A-Z]{16}(?![A-Z0-9])|(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9_]{20,}(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}(?![A-Za-z0-9_])|(?<![A-Za-z0-9_-])gl(?:pat|cb|ptt|dt|rt)-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])|(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9-])|(?<![A-Za-z0-9_])npm_[A-Za-z0-9_]{20,}(?![A-Za-z0-9_])|(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{20,}(?![A-Za-z0-9_-])|(?<![A-Za-z0-9_])sk_live_[A-Za-z0-9]{20,}(?![A-Za-z0-9_])'
while IFS= read -r -d '' file; do
  if ! perl -0777 -ne "exit 1 if /$credential_pattern/" "$file"; then
    echo "public snapshot contains a private key or credential pattern" >&2
    exit 1
  fi
done < <(find "$snapshot_dir" -type f -print0)

git -C "$snapshot_dir" init --quiet --initial-branch="$SOURCE_BRANCH"
git -C "$snapshot_dir" add --all
git -C "$snapshot_dir" -c user.name="Huizhi.Yun Public Mirror" -c user.email="public-mirror@users.noreply.github.com" \
  commit --quiet --message="chore: update public snapshot"

snapshot_head="$(git -C "$snapshot_dir" rev-parse "$SOURCE_BRANCH")"
echo "Public snapshot: $snapshot_head"

if [[ "$dry_run" == "1" ]]; then
  echo "Dry run complete; GitHub was not modified."
  exit 0
fi

git -C "$snapshot_dir" remote add github "$GITHUB_REPOSITORY"
git -C "$snapshot_dir" push \
  "--force-with-lease=refs/heads/$SOURCE_BRANCH:$remote_main" \
  github "refs/heads/$SOURCE_BRANCH:refs/heads/$SOURCE_BRANCH"

published_head="$(git -C "$snapshot_dir" ls-remote github "refs/heads/$SOURCE_BRANCH" | awk 'NR == 1 { print $1}')"
if [[ "$published_head" != "$snapshot_head" ]]; then
  echo "GitHub main does not match the public snapshot after push" >&2
  exit 1
fi

echo "Published public snapshot to $GITHUB_REPOSITORY"
