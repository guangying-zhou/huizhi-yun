# WebDev PoC 运行手册

日期：2026-05-26  
范围：`webdev` Cloudflare 控制面、macOS `hzy-dev-agent`、Cloudflare Tunnel、Data Runtime 元数据边界

## 当前 PoC 范围

已实现的最小闭环：

```text
Browser
  -> webdev Nuxt app
  -> /api/webdev/* server proxy
  -> hzy-dev-agent
  -> local repo command template
  -> job status / events
```

当前阶段不直连数据库，也不配置 Hyperdrive。WebDev 后续需要持久化项目、Agent、Job、事件和部署记录时，只能通过 `hzy-data-runtime` 的 `/v1/webdev/*` adapter 访问元数据数据库。

## 本地启动

### 1. 启动 Dev Agent

```bash
cd /Users/gavin/Dev/huizhi-yun/dev-agent
cp .env.example .env
openssl rand -base64 32
```

把生成值写入 `.env`：

```bash
HZY_DEV_AGENT_ID=gavin-mac
HZY_DEV_AGENT_HOST=127.0.0.1
HZY_DEV_AGENT_PORT=19090
HZY_DEV_AGENT_TOKEN=<generated-token>
HZY_DEV_AGENT_CONFIG=./config.example.json
```

启动：

```bash
go run ./cmd/hzy-dev-agent
```

`dev-agent/config.example.json` 中 repo `path` 默认是 `".."`，会按配置文件所在目录解析为仓库根目录。不同电脑 clone 路径不同也不需要修改这个字段；只有管理多个 repo 时才需要新增 repo 配置。

验证：

```bash
curl http://127.0.0.1:19090/runtime/health

curl -H "Authorization: Bearer <generated-token>" \
  http://127.0.0.1:19090/runtime/enrollment
```

### 2. 启动 WebDev

```bash
cd /Users/gavin/Dev/huizhi-yun/webdev
```

设置 `.env.dev`：

```bash
HZY_WEBDEV_DEV_AGENT_URL=http://127.0.0.1:19090
HZY_WEBDEV_DEV_AGENT_TOKEN=<generated-token>
```

启动：

```bash
pnpm exec nuxt dev --dotenv .env.dev --host 127.0.0.1 --port 3090
```

打开：

```text
http://127.0.0.1:3090/
```

## 远程访问需要你操作

### 1. 为开发机配置 Cloudflare Tunnel

在 macOS 开发机安装并登录 `cloudflared` 后执行：

```bash
cloudflared tunnel login
cloudflared tunnel create hzy-dev-agent-1
cloudflared tunnel route dns hzy-dev-agent-1 dev-agent-1.huizhi.yun
```

创建 `~/.cloudflared/config.yml`：

```yaml
tunnel: hzy-dev-agent-1
credentials-file: /Users/gavin/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: dev-agent-1.huizhi.yun
    service: http://127.0.0.1:19090
  - service: http_status:404
```

启动 Tunnel：

```bash
cloudflared tunnel run hzy-dev-agent-1
```

验证：

```bash
curl https://dev-agent-1.huizhi.yun/runtime/health
```

### 2. 部署 WebDev Worker

创建 Cloudflare env 文件：

```bash
cd /Users/gavin/Dev/huizhi-yun/webdev
cp .env.cloudflare.example .env.cloudflare
```

配置 `.env.cloudflare`：

```bash
HZY_DEPLOYMENT_PROFILE=managed-cloud-agent
HZY_WEBDEV_WORKER_NAME=hzy-webdev
HZY_WEBDEV_ROUTE_PATTERN=webdev.huizhi.yun/*
HZY_WEBDEV_ZONE_NAME=huizhi.yun
HZY_DEPLOYMENT_PUBLIC_URL=https://wiztek.huizhi.yun
HZY_APP_BASE_PATH=/webdev/
HZY_WEBDEV_DEV_AGENT_URL=https://dev-agent-1.huizhi.yun
HZY_WEBDEV_DATA_RUNTIME_URL=https://<data-runtime-endpoint>
HZY_WEBDEV_REQUIRE_APP_GRANT=true
```

token 不写入 `.env.cloudflare`，用 Cloudflare secret：

```bash
pnpm dlx wrangler@4 secret put HZY_WEBDEV_DEV_AGENT_TOKEN --name hzy-webdev
pnpm dlx wrangler@4 secret put HZY_WEBDEV_DATA_RUNTIME_TOKEN --name hzy-webdev
pnpm dlx wrangler@4 secret put HZY_TENANT_GATEWAY_TOKEN --name hzy-webdev
```

WebDev 必须作为租户应用授权后才能访问：将 `webdev/app.manifest.json` 导入 Platform，并给授权用户分配 `webdev:operator`、`webdev:deployer` 或 `webdev:admin`。导入和 policy bundle 生效前，可临时设置 `HZY_WEBDEV_ALLOWED_UIDS=<uid>`。

推荐用户入口是：

```text
https://wiztek.huizhi.yun/webdev/
```

`https://webdev.huizhi.yun` 只作为 Worker origin route 使用。

发布：

```bash
pnpm run deploy:cloudflare
```

### 3. 保持本机凭据留在开发机

这些内容不写入 WebDev Worker：

```text
OPENAI_API_KEY / Codex 登录态
CLOUDFLARE_API_TOKEN
WRANGLER 环境
SSH key
各模块 .env
```

它们只留在 macOS 开发机，由 `hzy-dev-agent` 在本机执行命令时使用。

## 命令模板

当前 `dev-agent/config.example.json` 已配置：

```text
root.git-status
root.git-diff-stat
finance.typecheck
workflow.typecheck
finance.deploy.cloudflare
workflow.deploy.cloudflare
codex.app-server
codex.exec
```

新增模块发布前，先在 `config.example.json` 增加模板，再重启 Dev Agent。

`codex.app-server` 是当前 WebDev 优先使用的 PoC 模板。Dev Agent 会启动
`codex app-server --listen stdio://`，为每个任务创建一个 Codex thread/turn，
并把 app-server 的 thread、turn、command、diff、agent message 通知转换为
WebDev job events。

```json
["codex", "app-server", "--listen", "stdio://"]
```

默认 `codex.app-server` 使用 `workspaceWrite` 沙箱并开启网络访问。可信本地开发机如果需要
Codex 执行 `git fetch` / `git pull` 这类会写 `.git/objects` 的操作，可在实际使用的
Dev Agent 配置文件中把该模板改为高权限模式，然后重启 Agent：

```json
{
  "id": "codex.app-server",
  "runner": "codex_app_server",
  "codexSandboxPolicy": "dangerFullAccess"
}
```

该配置只建议用于本地可信工作站；它会让该模板不再使用 workspace-write 沙箱。

`codex.exec` 保留为回退模板。它需要显式允许内层 Codex 沙箱访问网络：

```json
["codex", "exec", "--sandbox", "workspace-write", "--config", "sandbox_workspace_write.network_access=true", "{{prompt}}"]
```

如果日志中出现 `Could not resolve host`、`scutil --dns` 显示 `No DNS configuration available`，说明失败发生在 Codex 子进程沙箱内，不是 WebDev、Tunnel 或 Dev Agent 连接问题。更新实际使用的 Dev Agent 配置文件后，重启 `hzy-dev-agent` 再重新执行任务。

## Data Runtime 边界

WebDev 的数据库访问必须是：

```text
WebDev Worker
  -> HZY_WEBDEV_DATA_RUNTIME_URL
  -> hzy-data-runtime /v1/webdev/*
  -> hzy_webdev metadata DB
```

不允许：

```text
WebDev Worker -> Hyperdrive -> MySQL
WebDev Worker -> direct DB driver -> MySQL
Dev Agent -> WebDev metadata DB
```

PoC 已在 `hzy-data-runtime` 增加 WebDev adapter 骨架，开启方式：

```bash
HZY_WEBDEV_AGENT_ENABLED=true
HZY_WEBDEV_DB_NAME=hzy_webdev
```

建表脚本：

```text
webdev/docs/webdev_schema.sql
```

当前 adapter 覆盖以下固定元数据 API：

```text
GET   /v1/webdev/projects
GET   /v1/webdev/agents
GET   /v1/webdev/jobs?page=1&pageSize=20&status=running&keyword=...
POST  /v1/webdev/jobs
GET   /v1/webdev/jobs/:id
PATCH /v1/webdev/jobs/:id
POST  /v1/webdev/jobs/:id/events
GET   /v1/webdev/jobs/:id/events
```

WebDev 应用检测到以下变量后，会把 job snapshot 和 event 以 best-effort 方式写入 Data Runtime：

```bash
HZY_WEBDEV_DATA_RUNTIME_URL=https://<data-runtime-endpoint>
HZY_WEBDEV_DATA_RUNTIME_TOKEN=<platform-issued-token>
```

表结构沿用 ADR-015：

```text
webdev_agents
webdev_projects
webdev_project_repos
webdev_command_templates
webdev_jobs
webdev_job_events
webdev_job_artifacts
webdev_deployments
```

## 本地验证命令

```bash
cd /Users/gavin/Dev/huizhi-yun/dev-agent
go test ./...

cd /Users/gavin/Dev/huizhi-yun
pnpm -C webdev run typecheck

curl -sS -b '<authenticated-cookie>' http://127.0.0.1:3090/api/webdev/agent/enrollment

curl -sS -X POST http://127.0.0.1:3090/api/webdev/jobs \
  -b '<authenticated-cookie>' \
  -H 'content-type: application/json' \
  --data '{"type":"git_diff","templateId":"root.git-status"}'
```
