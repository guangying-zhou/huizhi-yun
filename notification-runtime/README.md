# Notification Runtime

`notification-runtime` 是汇智云客户侧通知运行时。一期只支持企业微信
textcard 通知，目标是让部署在 Cloudflare 的业务应用不再直接访问企业微信 API，
而是调用客户侧固定出口 IP 的运行时服务。

## 架构

```text
Cloudflare app
  -> Foundation sendNotification()
  -> notification-runtime /v1/notifications/send
  -> Console OAuth2 client_credentials
  -> Console Integration + Vault
  -> 企业微信 API
```

业务应用只需要获取 `audience=notification-runtime`、
`scope=notification-runtime:send` 的 Console service token。企业微信
`corpid`、`agentid` 和 `corpsecret` 继续在 Console Integration/Vault 中维护。

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
    "touser": "zhangsan",
    "title": "审批待处理",
    "description": "你有一个新的审批任务",
    "url": "https://example.com/workflow/tasks/1",
    "btntxt": "查看详情"
  }'
```

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
