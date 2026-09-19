#!/usr/bin/env bash
# Shared helpers for publishing sanitized public snapshots to the GitHub mirror.
# Sourced by scripts/push-github-public-main.sh and scripts/push-github-public-branch.sh.

GITHUB_REPOSITORY="https://github.com/guangying-zhou/huizhi-yun.git"
GITLAB_ORIGIN="https://gitlab.wiztek.cn/huizhi-yun/huizhiyun.git"
PUBLIC_BASE_BRANCH="main"

public_snapshot_workspace_root() {
  git rev-parse --show-toplevel
}

public_snapshot_require_origin() {
  local workspace_root="$1"
  local gitlab_origin
  gitlab_origin="$(git -C "$workspace_root" remote get-url origin)"

  if [[ "$gitlab_origin" != "$GITLAB_ORIGIN" ]]; then
    echo "origin must be $GITLAB_ORIGIN before creating the public snapshot" >&2
    exit 1
  fi
}

public_snapshot_require_perl() {
  if ! command -v perl >/dev/null 2>&1; then
    echo "perl is required for binary-safe credential scanning" >&2
    exit 1
  fi
}

# Requires the branch to exist locally and to match its origin counterpart, so the
# public snapshot can only contain commits that already exist on GitLab.
public_snapshot_require_synced_branch() {
  local workspace_root="$1"
  local branch="$2"

  if ! git -C "$workspace_root" show-ref --verify --quiet "refs/heads/$branch"; then
    echo "source branch does not exist: $branch" >&2
    exit 1
  fi

  local local_head origin_head
  local_head="$(git -C "$workspace_root" rev-parse "refs/heads/$branch")"
  origin_head="$(git -C "$workspace_root" ls-remote --refs origin "refs/heads/$branch" | awk 'NR == 1 { print $1 }')"
  if [[ -z "$origin_head" || "$local_head" != "$origin_head" ]]; then
    echo "local $branch must match origin/$branch before creating the public snapshot" >&2
    exit 1
  fi
}

public_snapshot_export() {
  local workspace_root="$1"
  local branch="$2"
  local snapshot_dir="$3"

  echo "Exporting committed $branch snapshot from $workspace_root"
  git -C "$workspace_root" archive --format=tar "refs/heads/$branch" | tar -xf - -C "$snapshot_dir"
}

public_snapshot_sanitize() {
  local snapshot_dir="$1"

  echo "Removing sensitive file carriers from the public snapshot"
  find "$snapshot_dir" \( -type f -o -type l \) \( -iname ".env" -o -iname ".env.*" -o -iname ".envrc" -o -iname ".npmrc" -o -iname ".netrc" -o -iname ".git-credentials" -o -iname ".pypirc" -o -iname "*.pem" -o -iname "*.key" -o -iname "*.p8" -o -iname "*.ppk" -o -iname "*.p12" -o -iname "*.pfx" -o -iname "*.jks" -o -iname "*.keystore" -o -iname "credentials.json" -o -iname "service-account.json" -o -iname "id_rsa" -o -iname "id_dsa" -o -iname "id_ecdsa" -o -iname "id_ecdsa_sk" -o -iname "id_ed25519" -o -iname "id_ed25519_sk" -o -iname "id_ed448" -o -path "*/.aws/credentials" -o -path "*/.docker/config.json" -o -path "*/.kube/config" \) \
    ! -iname ".env.example" ! -iname ".env.*.example" -delete

  local remaining_sensitive_files
  remaining_sensitive_files="$(find "$snapshot_dir" \( -type f -o -type l \) -print | perl -ne 'chomp; next if m{(^|/)\.env(?:\.[^/]+)*\.example$}i; print if m{(^|/)(?:\.env(?:\..*)?|\.envrc|\.npmrc|\.netrc|\.git-credentials|\.pypirc|id_(?:rsa|dsa|ecdsa(?:_sk)?|ed25519(?:_sk)?|ed448)|[^/]*\.(?:pem|key|p8|ppk|p12|pfx|jks|keystore)|(?:credentials|service-account)\.json|\.aws/credentials|\.docker/config\.json|\.kube/config)$}i')"
  if [[ -n "$remaining_sensitive_files" ]]; then
    echo "public snapshot still contains a sensitive environment or key file" >&2
    exit 1
  fi

  # The armor header must be followed by a real line break (or an escaped \n from an
  # embedded JSON string) so this scanner's own pattern text is not a match.
  local credential_pattern='-----BEGIN (?:(?:RSA|DSA|EC|OPENSSH|ENCRYPTED|ENCRYPTED RSA) )?PRIVATE KEY-----(?:\r?\n|\\n)[\s\S]+?-----END (?:(?:RSA|DSA|EC|OPENSSH|ENCRYPTED|ENCRYPTED RSA) )?PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----(?:\r?\n|\\n)[\s\S]+?-----END PGP PRIVATE KEY BLOCK-----|(?<![A-Z0-9])A(?:KIA|SIA)[0-9A-Z]{16}(?![A-Z0-9])|(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9_]{20,}(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}(?![A-Za-z0-9_])|(?<![A-Za-z0-9_-])gl(?:pat|cb|ptt|dt|rt)-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])|(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9-])|(?<![A-Za-z0-9_])npm_[A-Za-z0-9_]{20,}(?![A-Za-z0-9_])|(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{20,}(?![A-Za-z0-9_-])|(?<![A-Za-z0-9_])sk_live_[A-Za-z0-9]{20,}(?![A-Za-z0-9_])'
  local file
  local offending_files=()
  while IFS= read -r -d '' file; do
    if ! perl -0777 -ne "exit 1 if /$credential_pattern/" "$file"; then
      offending_files+=("${file#"$snapshot_dir"/}")
    fi
  done < <(find "$snapshot_dir" -type f -print0)
  if [[ "${#offending_files[@]}" -gt 0 ]]; then
    echo "public snapshot contains a private key or credential pattern in:" >&2
    printf '  %s\n' "${offending_files[@]}" >&2
    exit 1
  fi
}

public_snapshot_remote_head() {
  local branch="$1"
  git ls-remote --refs "$GITHUB_REPOSITORY" "refs/heads/$branch" | awk 'NR == 1 { print $1 }'
}

public_snapshot_commit() {
  local snapshot_dir="$1"
  local branch="$2"
  local message="$3"
  local parent_ref="${4:-}"
  local parent_head="${5:-}"

  git -C "$snapshot_dir" init --quiet --initial-branch="$branch"
  if [[ -n "$parent_ref" && -n "$parent_head" ]]; then
    # Anchor the snapshot on the published base commit so GitHub can diff this
    # branch against the mirrored base branch without an unrelated-histories error.
    git -C "$snapshot_dir" remote add github "$GITHUB_REPOSITORY"
    git -C "$snapshot_dir" fetch --quiet --depth=1 github "$parent_ref"
    local fetched_head
    fetched_head="$(git -C "$snapshot_dir" rev-parse FETCH_HEAD)"
    if [[ "$fetched_head" != "$parent_head" ]]; then
      echo "published $parent_ref moved during the snapshot; rerun the sync" >&2
      exit 1
    fi
    git -C "$snapshot_dir" update-ref "refs/heads/$branch" "$parent_head"
  fi
  git -C "$snapshot_dir" add --all
  git -C "$snapshot_dir" -c user.name="Huizhi.Yun Public Mirror" -c user.email="public-mirror@users.noreply.github.com" \
    commit --quiet --message="$message"
}

public_snapshot_push() {
  local snapshot_dir="$1"
  local branch="$2"
  local expected_remote_head="$3"

  if ! git -C "$snapshot_dir" remote get-url github >/dev/null 2>&1; then
    git -C "$snapshot_dir" remote add github "$GITHUB_REPOSITORY"
  fi
  git -C "$snapshot_dir" push \
    "--force-with-lease=refs/heads/$branch:$expected_remote_head" \
    github "refs/heads/$branch:refs/heads/$branch"

  local snapshot_head published_head
  snapshot_head="$(git -C "$snapshot_dir" rev-parse "$branch")"
  published_head="$(git -C "$snapshot_dir" ls-remote github "refs/heads/$branch" | awk 'NR == 1 { print $1}')"
  if [[ "$published_head" != "$snapshot_head" ]]; then
    echo "GitHub $branch does not match the public snapshot after push" >&2
    exit 1
  fi
}
