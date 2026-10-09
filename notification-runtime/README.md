# Notification Runtime

> 演进说明：方案 B（企业连接运行时）已批准。本服务是迁移兼容源，当前仍独立运行，
> 不会通过普通自动升级静默改名。类型化能力与显式回滚契约见
> `../connector-runtime/docs/Enterprise-Connector-Runtime-Migration.md`。

`notification-runtime` 是汇智云客户侧通知运行时。一期只支持企业微信
textcard 通知，目标是让部署在 Cloudflare 的业务应用不再直接访问企业微信 API，
而是调用客户侧固定出口 IP 的运行时服务。

## 架构

```text
Cloudflare app
  -> Foundation sendNotification()
  -> notification-runtime /v1/notifications/send
  -> notification-runtime durable delivery ledger (SQLite default)
  -> Console OAuth2 client_credentials
  -> Console Integration + Vault
  -> 企业微信 API
```

业务应用只需要获取 `audience=notification-runtime`、
`scope=notification-runtime:send` 的 Console service token。企业微信
`corpid`、`agentid` 和 `corpsecret` 继续在 Console Integration/Vault 中维护。

`GET /runtime/capabilities` 同时返回原有 `channels/messageTypes/scopes` 字段和
`hzy.connector-capabilities.v1` 类型化注册表。注册表明确声明
`arbitraryHttpProxy=false`；当前只发布已经实现的企业微信通知和 delivery 运维能力，
不会提前宣称身份交换或人事同步可用。

## 运行

```bash
cd notification-runtime
cp .env.example .env
go run ./cmd/hzy-notification-runtime
curl http://127.0.0.1:18081/runtime/health
```

发送示例：

```bash
curl -X POST http://127.0.0.1:18081/v1/notifications/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "wecom",
    "integrationCode": "wecom.default",
    "sourceAppCode": "workflow",
    "touser": "zhangsan",
    "title": "审批待处理",
    "description": "你有一个新的审批任务",
    "url": "https://example.com/workflow/tasks/1",
    "btntxt": "查看详情",
    "idempotencyKey": "workflow:task:123:created:v1"
  }'
```

## 持久化投递账本

发送接口要求 `sourceAppCode` 和 `idempotencyKey`。运行时以
`tenant + deployment + source_app + idempotency_key` 作为唯一投递身份，
client ID 只保留为审计信息，因此 service credential 轮换不会产生新的投递。
channel、integration、收件人和消息内容进入不可变 SHA-256；同一身份提交不同
内容返回 HTTP 409。

首次发送必须先取得持久化 `processing` lease 和 fencing token。`succeeded` 重放
直接返回最小公开结果且不调用 provider；活跃/过期 `processing` 以及
`partial_unknown` 都不会盲目重发。只有已明确记录为 `failed` 的投递可取得新的
fencing token 重试。Provider transport 结果不确定、或成功 checkpoint 失败时，
记录/保守保留为 `partial_unknown`，等待人工或后续对账。

单 systemd 实例默认使用 SQLite，安装器会自动创建 schema：

```bash
HZY_NOTIFICATION_RUNTIME_STORE=sqlite
HZY_NOTIFICATION_RUNTIME_SQLITE_PATH=/opt/hzy/notification-runtime/data/delivery.db
```

SQLite 文件目录使用 0700、数据库文件使用 0600，并启用 WAL、foreign keys、FULL
synchronous 与 5 秒 busy timeout。它只适用于同一台服务器上的单 runtime 进程，文件
必须位于本机磁盘，不能放在 NFS、SMB 或由多个实例共享的卷。进程启动和 updater
都会校验 store；不可写、损坏或 schema 不完整时失败关闭，不存在内存 fallback。

多实例/高可用部署可显式设置 `HZY_NOTIFICATION_RUNTIME_STORE=mysql`，创建独立
`hzy_notification_runtime` 库并按顺序执行 `schema/001_notification_delivery_ledger.sql`
和 `schema/002_notification_delivery_reconciliation.sql`，再配置
`HZY_NOTIFICATION_RUNTIME_DB_HOST/PORT/USER/PASSWORD/NAME`。发布包继续携带带校验值的
MySQL migration artifact，updater 会先校验 schema 再替换二进制。

兼容规则：旧 `.env` 没有 `HZY_NOTIFICATION_RUNTIME_STORE`、但包含 MySQL host/user 时
继续按 MySQL 启动，不会因自动升级静默切换。主动从 MySQL 切到 SQLite 会建立新的
投递账本；应在受控维护窗口确认没有未处理的 `processing/partial_unknown` 记录并保留
旧库审计后再切换。

## Delivery 运维 API

运维 API 使用独立精确 scope，不由 `notification-runtime:send` 蕴含：

```text
notification-runtime:deliveries:read
notification-runtime:deliveries:reconcile
```

查询当前 token 所属 tenant/deployment 的脱敏记录：

```bash
curl -H "Authorization: Bearer $OPS_TOKEN" \
  'http://127.0.0.1:18081/v1/deliveries?status=partial_unknown&limit=50'
```

`status` 只接受 `processing|succeeded|failed|partial_unknown`；`limit` 为 1–100；响应的
opaque `nextCursor` 用于稳定的 ID 降序翻页。响应不包含幂等键、request hash、完整
消息、收件人、token、URL、provider body/result 或错误摘要。

只有人工证据已明确 provider 最终结果时，才能对 `partial_unknown` 执行 CAS 对账：

```bash
curl -X POST -H "Authorization: Bearer $OPS_TOKEN" -H 'Content-Type: application/json' \
  http://127.0.0.1:18081/v1/deliveries/42/reconcile \
  -d '{
    "expectedStatus":"partial_unknown",
    "result":"failed",
    "reason":"Provider admin confirmed no message was accepted",
    "evidence":{"type":"provider_admin_confirmation","reference":"INC-2026-0042"}
  }'
```

`reason` 和 evidence reference 只允许填写工单/供应商后台确认等最小证据，不得粘贴
消息正文、收件人、URL、token 或 provider response body。对账事务会 CAS 当前状态并
追加不可变审计，记录 actor source/client/subject、reason、证据引用和最小公开结果。
`processing`、`succeeded`、`failed` 均不能通过该接口重置。

对账为 `succeeded` 后，原业务请求会走现有 succeeded replay；对账为 `failed` 后，
运行时不会主动补发，也不存在 reset/retry 管理接口。只能由原业务调用方使用原
`sourceAppCode + idempotencyKey + 完全相同 payload/hash` 再次调用 send，现有 Claim
才会提升 fencing token 并执行一次受控重试。已知 `failed` 本来就具备这一路径，
无需新增无意义 reset API。

## Console 配置

运行时读取以下 Console 能力：

- `integration_config:view`：读取 `wecom.default` 集成配置。
- `credential_vault:resolve`：解析企业微信 `corpsecret`。

生产安装推荐在 Console `通知运行时` 页面点击“生成指令”。Console 会创建或复用
`notification-runtime` service client secret，并确保以下授权存在：

```text
integration_config:view
credential_vault:resolve
```

本地开发或兼容旧环境时，也可以通过 Console 环境变量物化 service client：

```bash
HZY_SERVICE_CLIENT_NOTIFICATION_RUNTIME_SECRET=<secret>
HZY_SERVICE_CLIENT_NOTIFICATION_RUNTIME_CLIENT_ID=notification-runtime
HZY_SERVICE_CLIENT_NOTIFICATION_RUNTIME_CLIENT_CODE=notification-runtime
HZY_SERVICE_CLIENT_NOTIFICATION_RUNTIME_CLIENT_NAME="Notification Runtime"
HZY_SERVICE_CLIENT_NOTIFICATION_RUNTIME_GRANTS=integration_config:view,credential_vault:resolve
```

业务应用 service client 需要被授予：

```text
notification-runtime:send
```

查询和对账能力只授予专用运维 service client；不要批量授予业务应用。read 与
reconcile 必须分开授权，`send`、通配 scope 或普通应用管理员角色均不自动包含它们。

## 安装与自动升级

```bash
curl -fsSL 'https://downloads.huizhi.yun/packages/hzy-notification-runtime/install.sh' | \
  sudo env \
    HZY_NOTIFICATION_RUNTIME_PACKAGE_BASE_URL='https://downloads.huizhi.yun/packages/hzy-notification-runtime' \
    HZY_NOTIFICATION_RUNTIME_PORT='18081' \
    HZY_NOTIFICATION_RUNTIME_TENANT='<tenant-code>' \
    HZY_NOTIFICATION_RUNTIME_DEPLOYMENT='<deployment-code>' \
    HZY_CONSOLE_API_URL='https://console.huizhi.yun' \
    HZY_CONSOLE_TOKEN_URL='https://console.huizhi.yun/oauth/token' \
    HZY_NOTIFICATION_RUNTIME_AUTH_MODE='jwt' \
    HZY_NOTIFICATION_RUNTIME_AUDIENCE='notification-runtime' \
    HZY_NOTIFICATION_RUNTIME_JWT_ISSUER='https://console.huizhi.yun' \
    HZY_NOTIFICATION_RUNTIME_JWKS_URL='https://console.huizhi.yun/.well-known/jwks.json' \
    HZY_NOTIFICATION_RUNTIME_CLIENT_ID='notification-runtime' \
    HZY_NOTIFICATION_RUNTIME_CLIENT_SECRET='<console-generated-secret>' \
    HZY_NOTIFICATION_RUNTIME_STORE='sqlite' \
    HZY_NOTIFICATION_RUNTIME_SQLITE_PATH='/opt/hzy/notification-runtime/data/delivery.db' \
    bash
```

实际命令应从 Console 页面复制，`<console-generated-secret>` 不需要手工填写。

安装器会创建：

- `/usr/local/bin/hzy-notification-runtime`
- `/opt/hzy/notification-runtime/.env`
- `hzy-notification-runtime.service`
- `hzy-notification-runtime-update.timer`

默认每 5 分钟检查 `latest.json` 并自动更新。

## 发布

```bash
cd notification-runtime
./scripts/package-release.sh
./scripts/upload-r2.sh
```

默认只发布 Linux 包：`linux/amd64` 和 `linux/arm64`。
