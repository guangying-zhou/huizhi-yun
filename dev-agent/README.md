# hzy-dev-agent

PoC local development execution agent for ADR-015.

`hzy-dev-agent` runs on the developer's macOS machine, listens on
`127.0.0.1`, and executes only configured repo/command templates. WebDev calls
it through Cloudflare Tunnel.

## Run Locally

```bash
cd /Users/gavin/Dev/huizhi-yun/dev-agent
cp .env.example .env
openssl rand -base64 32
# write the generated value to HZY_DEV_AGENT_TOKEN in .env
# set HZY_DEV_AGENT_CONFIG=./config.example.json
go run ./cmd/hzy-dev-agent
```

`config.example.json` uses `"path": ".."` for the `huizhi-yun` repo. Relative
repo paths are resolved from the config file directory, so the same config works
after cloning the repo to a different machine or directory.

Verify:

```bash
curl http://127.0.0.1:19090/runtime/health

curl -H 'Authorization: Bearer change-me' \
  http://127.0.0.1:19090/runtime/enrollment
```

When using `config.example.json`, replace `change-me` with the token generated
for `HZY_DEV_AGENT_TOKEN`.

`codex.app-server` is the preferred WebDev PoC runner. It starts Codex
`app-server` over stdio, creates one thread/turn per job, and maps Codex
thread, turn, command, diff, and agent-message notifications into Dev Agent job
events:

```json
["codex", "app-server", "--listen", "stdio://"]
```

By default, `codex.app-server` uses a workspace-write sandbox with network
enabled. If a trusted local developer machine needs Codex to run `git fetch` or
`git pull`, set the template's sandbox policy to `dangerFullAccess` in the
active Dev Agent config, then restart the agent:

```json
{
  "id": "codex.app-server",
  "runner": "codex_app_server",
  "codexSandboxPolicy": "dangerFullAccess"
}
```

Use this only for local trusted workstations. It lets Codex run without the
workspace-write sandbox for that template.

`codex.exec` remains available as a fallback command-template runner. It uses
Codex `workspace-write` sandbox with explicit network access:

```json
["codex", "exec", "--sandbox", "workspace-write", "--config", "sandbox_workspace_write.network_access=true", "{{prompt}}"]
```

This is required when a WebDev job asks Codex to run `git pull`, call GitLab, or
download dependencies. Without this override, Codex may start with a workspace
sandbox that has no DNS/network access even though the developer's terminal can
access the same hosts.

Create a safe git status job:

```bash
curl -X POST http://127.0.0.1:19090/v1/jobs \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  -d '{"type":"git_diff","templateId":"root.git-status"}'
```

Read events:

```bash
curl -H 'Authorization: Bearer change-me' \
  http://127.0.0.1:19090/v1/jobs/<job-id>/events
```

Upload files for a job:

```bash
curl -X POST http://127.0.0.1:19090/v1/attachments \
  -H 'Authorization: Bearer change-me' \
  -F 'files=@/path/to/screenshot.png' \
  -F 'files=@/path/to/notes.md'
```

The response contains attachment IDs. Include those objects in `attachments`
when creating a Codex job. The agent copies them into a per-job temp directory,
writes an `attachments.json` manifest, and appends the local paths to the
prompt sent to Codex.

## Idempotent job creation

`POST /v1/jobs` accepts an optional `clientRequestId` idempotency key. Repeated
requests with the same key return the **same** job (HTTP 200) instead of
creating and executing a new one (HTTP 202 on first create). This makes job
creation safe against caller retries and concurrency — e.g. WebDev claiming an
Issue, where a lost response or an auto-claim/manual-claim race must not spawn
duplicate Agent runs.

```bash
# First call creates the job (202 Accepted)
curl -X POST http://127.0.0.1:19090/v1/jobs \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  -d '{"type":"codex_task","templateId":"codex.app-server","prompt":"fix it","clientRequestId":"issue-208-claim"}'

# Same clientRequestId returns the existing job (200 OK), no new execution
```

The key is matched in-memory; it resets on agent restart (consistent with the
PoC's in-memory job store). Callers needing durable idempotency across restarts
should also use a stable, deterministic key and reconcile against persisted job
metadata.

## Cloudflare Tunnel

```yaml
tunnel: hzy-dev-agent-1
credentials-file: /etc/cloudflared/hzy-dev-agent-1.json

ingress:
  - hostname: dev-agent-1.huizhi.yun
    service: http://127.0.0.1:19090
  - service: http_status:404
```

```bash
cloudflared tunnel create hzy-dev-agent-1
cloudflared tunnel route dns hzy-dev-agent-1 dev-agent-1.huizhi.yun
cloudflared tunnel run hzy-dev-agent-1
```

## Safety

- No generic shell endpoint.
- All jobs use configured command templates.
- Each template is bound to one repo whitelist entry.
- Commands are executed with `exec.Command`, not through a shell.
- Token authentication is required when `HZY_DEV_AGENT_TOKEN` is set.
