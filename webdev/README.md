# WebDev

PoC browser control surface for ADR-015.

## 控制台分区

控制台基于「WebDev 控制台原型」（方向 A：Nuxt UI 侧边栏仪表盘）改造，侧边栏导航由
`app/config/permissions.ts` 驱动，用户菜单由 Foundation `LayoutSidebar` 统一置于右上角：

- **总览** (`/overview`) — 任务/部署/Issue 指标、模块清单、最近活动；指标与活动由真实 jobs API 派生。
- **任务** (`/`) — 双栏工作台：左侧任务列表 + 中部对话流 + 底部指令输入，接 Dev Agent 作业执行与事件流。
- **Issue 收件箱** (`/issues`) — Issue 列表/详情/状态筛选、领取建 Agent 任务（幂等）。后端经 Data Runtime `/v1/webdev/issues*` 落库；上报入口（Foundation 报告组件）见 `docs/WebDev-Issue-Inbox-Design.md` 阶段 2/3。
- **Diff 审查** (`/review`) — 文件树 + diff + 检查结果 + 规范化提交。*示例数据，结构化 diff 待后端补齐。*
- **部署** (`/deploy`) — 环境矩阵 + 生产 type-to-confirm 确认弹窗。*示例数据，部署后端待接入。*
- **Agent** (`/agents`) — 开发机舰队、命令模板白名单、引擎偏好、健康探针；接真实 enrollment/health。
- **历史** (`/history`) — 持久化任务与日志事件（Data Runtime）。

标注「示例数据」的分区为原型示意，UI 已就绪，待对应后端能力补齐后替换数据源。

The first version proxies job calls to one configured `hzy-dev-agent`.
Job metadata persistence goes through the `hzy-data-runtime` WebDev adapter.
File and image attachments are uploaded through WebDev server routes, then
forwarded to Dev Agent. Browser clients never receive the Dev Agent token.
WebDev prefers the Dev Agent `codex.app-server` template when available, then
falls back to `codex.exec` or another `codex_task` template exposed by
enrollment.

WebDev is a tenant application and must be protected by Console OIDC. The
server-side `/api/webdev/*` routes require a logged-in Console user and, in
production, either a Platform/Console app grant for `webdev` or a temporary
`HZY_WEBDEV_ALLOWED_UIDS` bootstrap allowlist.

## Run Locally

Start the local Dev Agent first:

```bash
cd /Users/gavin/Dev/huizhi-yun/dev-agent
cp .env.example .env
# set HZY_DEV_AGENT_TOKEN and HZY_DEV_AGENT_CONFIG=./config.example.json
go run ./cmd/hzy-dev-agent
```

Then start WebDev:

```bash
cd /Users/gavin/Dev/huizhi-yun/webdev
pnpm exec nuxt dev --dotenv .env.dev --host 127.0.0.1 --port 3090
```

Open:

```text
http://127.0.0.1:3090
```

## Required Environment

```bash
HZY_WEBDEV_DEV_AGENT_URL=http://127.0.0.1:19090
HZY_WEBDEV_DEV_AGENT_TOKEN=<same-token-as-dev-agent>

HZY_WEBDEV_DATA_RUNTIME_URL=http://127.0.0.1:18080
HZY_WEBDEV_DATA_RUNTIME_TOKEN=<platform-provided-data-runtime-token>

HZY_CONSOLE_URL=http://localhost:3000
HZY_WEBDEV_REQUIRE_APP_GRANT=false

# Issue 上报入口（阶段 2）
# 允许通过 service token 上报 Issue 的业务应用（来源 hzy.appCode 白名单）
HZY_WEBDEV_REPORT_ALLOWED_APPS=codocs,finance,workflow,aims,altoc,assets,align,insights
# intake 命中后自动创建 Agent 任务的应用（severity=高 且 bug）—— 仅作兜底，
# 正式规则存于 webdev_issue_settings（Agent/项目设置页可视化维护）
HZY_WEBDEV_AUTO_CLAIM_APPS=finance,workflow,codocs
```

Issue 领取与状态流转（待验证/已解决/已关闭）会经 Foundation `publishNotification`
通知反馈人，发布到 Console 统一消息中心。WebDev service-client 需具备
`notifications:publish` grant，且配置 Console notifications API 地址。

Issue 上报入口（`POST /api/webdev/issues/intake`、`GET /api/webdev/issues/mine`）走
Console `token_use=service` JWT 鉴权，要求 `aud=webdev`、`scope=webdev:issue:write`（mine
为 `webdev:issue:read`）。Console 需为各业务应用 service-client 配置对应 grant（阶段 0），
且 `aud` 需与 WebDev OIDC client 一致。业务应用通过 Foundation `/api/webdev-report/issues`
代理调用，不直连本服务。

For the managed Cloudflare target, WebDev must use `managed-cloud-agent` and
must not bind Hyperdrive. WebDev metadata persistence is expected to go through
`hzy-data-runtime` `/v1/webdev/*` APIs.
When `HZY_WEBDEV_DATA_RUNTIME_URL` and `HZY_WEBDEV_DATA_RUNTIME_TOKEN` are set,
the PoC performs best-effort job/event metadata writes to Data Runtime.

The PoC metadata schema lives at `webdev/docs/webdev_schema.sql`.

The actual database connection is configured on `hzy-data-runtime`, not in
WebDev:

```bash
HZY_WEBDEV_AGENT_ENABLED=true
HZY_WEBDEV_DB_NAME=hzy_webdev
HZY_DATA_RUNTIME_DB_HOST=127.0.0.1
HZY_DATA_RUNTIME_DB_PORT=3306
HZY_DATA_RUNTIME_DB_USER=cf_app
HZY_DATA_RUNTIME_DB_PASSWORD=<db-password>
```

See `docs/WebDev-PoC-Runbook.md` for Tunnel and Cloudflare operations.

## Deploy to Cloudflare

Create a local Cloudflare env file:

```bash
cd /Users/gavin/Dev/huizhi-yun/webdev
cp .env.cloudflare.example .env.cloudflare
```

Edit `.env.cloudflare`:

```bash
HZY_WEBDEV_ROUTE_PATTERN=webdev.huizhi.yun/*
HZY_WEBDEV_ZONE_NAME=huizhi.yun
HZY_DEPLOYMENT_PUBLIC_URL=https://wiztek.huizhi.yun
HZY_APP_BASE_PATH=/webdev/
HZY_WEBDEV_DEV_AGENT_URL=https://dev-agent-1.huizhi.yun
HZY_WEBDEV_DATA_RUNTIME_URL=https://<data-runtime-endpoint>
HZY_WEBDEV_REQUIRE_APP_GRANT=true
```

Set secrets in Cloudflare:

```bash
pnpm dlx wrangler@4 secret put HZY_WEBDEV_DEV_AGENT_TOKEN --name hzy-webdev
pnpm dlx wrangler@4 secret put HZY_WEBDEV_DATA_RUNTIME_TOKEN --name hzy-webdev
pnpm dlx wrangler@4 secret put HZY_TENANT_GATEWAY_TOKEN --name hzy-webdev
```

Import `webdev/app.manifest.json` into Platform and grant one of the WebDev
roles to the authorized user. Before the manifest and policy bundle are ready,
set `HZY_WEBDEV_ALLOWED_UIDS=<uid>` as a temporary Cloudflare var or secret.

Recommended tenant entry:

```text
https://wiztek.huizhi.yun/webdev/
```

`https://webdev.huizhi.yun` should be treated as the Worker origin route, not
the user-facing tenant entry.

Deploy:

```bash
pnpm run deploy:cloudflare
```

Preview locally through Wrangler:

```bash
pnpm run preview:cloudflare
```
