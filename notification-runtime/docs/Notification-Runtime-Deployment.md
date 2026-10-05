# Notification Runtime Deployment

> **文档状态与证据边界**
>
> - **最后事实核验：** 2026-07-14。
> - **当前事实源：** [`notification-runtime/CLAUDE.md`](../CLAUDE.md)、[`notification-runtime/README.md`](../README.md)、Console `server/utils/notificationRuntimeInstall.ts`、[`docs/MODULE_CONTRACTS.md`](../../docs/MODULE_CONTRACTS.md) 与 [`docs/Development-Execution-Checklist-2026-07.md`](../../docs/Development-Execution-Checklist-2026-07.md)。
> - **执行边界：** 本文命令会创建或变更服务、数据库、Console service client/grant、企业微信配置及 Cloudflare/R2 发布状态；静态核对或本地验证不构成执行授权，须按目标 tenant/deployment 单独、明确授权。

`notification-runtime` 用于解决 Cloudflare Worker 无固定出口 IP 时无法直接调用企业微信 API 的问题。运行时部署在客户国内服务器或 `gitlab.wiztek.cn` 同网络出口，通过 Console Integration/Vault 获取企业微信配置并代发通知。

租户操作手册见：[Notification Runtime 租户操作手册](./Notification-Runtime-Tenant-Runbook.md)。

## 调用链路

```text
Cloudflare 业务应用
  -> Foundation sendNotification()
  -> notification-runtime
  -> notification-runtime durable delivery ledger (SQLite default)
  -> Console OAuth2 + Integration/Vault
  -> 企业微信 API
```

## Console 配置

1. 在 Console `集成中心` 配置 `wecom.default`，包含 `corpid`、`agentid` 和 `corpsecret`。
2. 在 Console `通知运行时` 页面配置 `notification.runtimeApiUrl`。
3. 为业务应用 service client 授权 `notification-runtime:send`。投递运维使用独立专用 client，并将 `notification-runtime:deliveries:read` 与 `notification-runtime:deliveries:reconcile` 分开按职责授予，不能批量授予业务应用。
4. 在 `通知运行时` 页面点击“生成指令”。Console 会创建或复用 `notification-runtime` service client secret，并自动确保 `integration_config:view`、`credential_vault:resolve` 授权存在。
5. 在 `通知运行时` 页面执行企业微信配置检测，并向指定企业微信 UserID 发送测试消息；测试结果会写入当前操作者的统一消息中心通知抽屉。

SQL seed: `console/docs/sql/Console-SQL-Seed-v1.9-notification-runtime.sql`。

## Delivery ledger 前置

默认的单实例部署不需要外部数据库。安装器在 `/opt/hzy/notification-runtime/data/delivery.db` 自动初始化 SQLite ledger 和 append-only reconciliation audit，并把目录/文件权限限制为 0700/0600。该文件必须位于服务器本机磁盘，不能放到 NFS/SMB/共享卷，也不能被多个 runtime 实例同时打开。多实例或高可用部署才显式选择 MySQL；此时使用受控 migration 账号按顺序执行发布包内 `schema/001_notification_delivery_ledger.sql` 与 `schema/002_notification_delivery_reconciliation.sql`，runtime 账号对 audit 只授予 `SELECT/INSERT`。

ledger 以 tenant、deployment、source app 和 idempotency key 作为唯一投递身份，使用 lease/fencing 管理并发。`succeeded` 重放不再次调用企业微信；`processing` 过期或 provider 结果不确定进入 `partial_unknown`，默认不自动重发。企业微信没有供应商幂等，不能把该能力描述为 exactly-once。

## 安装

在国内服务器执行 Console `通知运行时` 页面生成的命令。命令会带上 tenant、deployment、端口、Console OAuth 参数和 client secret，无需在服务器上手工输入这些值：

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

安装器会创建 `hzy-notification-runtime.service` 和 `hzy-notification-runtime-update.timer`，默认每 5 分钟检查自动升级。

旧安装若没有显式 store 类型但已有 MySQL host/user，会继续使用 MySQL。只有重新执行带 `HZY_NOTIFICATION_RUNTIME_STORE=sqlite` 的新命令才会主动切换；切换前应确认旧 ledger 没有待处理 `processing/partial_unknown` 并保留旧库审计。updater 会先验证当前配置的 store，未就绪时保留旧 binary 且不重启。

## partial_unknown 对账

先用具有 `notification-runtime:deliveries:read` 的专用 token 查询：

```bash
curl -H "Authorization: Bearer $OPS_READ_TOKEN" \
  'https://notify.example.com/v1/deliveries?status=partial_unknown&limit=50'
```

确认企业微信后台、工单或供应商支持记录后，使用单独持有 `notification-runtime:deliveries:reconcile` 的 token 将该记录 CAS 为 `succeeded` 或 `failed`。reason/evidence 只写最小工单引用，不粘贴正文、收件人、URL、token 或 provider body。运行时拒绝重置 processing/succeeded/failed，并写 append-only 审计。

若结果是 failed，不点击或调用任何“retry/reset”管理动作；由原业务调用使用原 key/hash 重放 send，现有 Claim 才会受控重试。known failed 同样直接走原调用重放，无需额外 reset API。

## Cloudflare

Cloudflare Worker 不配置企业微信 secret。可选兜底变量：

```text
HZY_NOTIFICATION_RUNTIME_API_URL=https://notify.example.com
HZY_NOTIFICATION_RUNTIME_AUDIENCE=notification-runtime
```

`sendNotification()` 不提供直连企业微信 fallback。Runtime 未配置或不可用时，站内通知保留成功事实，外部通道明确返回部分交付失败；业务应保持事务已提交并由受控重试重新使用原幂等键。
