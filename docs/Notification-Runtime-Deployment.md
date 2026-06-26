# Notification Runtime Deployment

`notification-runtime` 用于解决 Cloudflare Worker 无固定出口 IP 时无法直接调用企业微信 API 的问题。运行时部署在客户国内服务器或 `gitlab.wiztek.cn` 同网络出口，通过 Console Integration/Vault 获取企业微信配置并代发通知。

租户操作手册见：[Notification Runtime 租户操作手册](./Notification-Runtime-Tenant-Runbook.md)。

## 调用链路

```text
Cloudflare 业务应用
  -> Foundation sendNotification()
  -> notification-runtime
  -> Console OAuth2 + Integration/Vault
  -> 企业微信 API
```

## Console 配置

1. 在 Console `集成中心` 配置 `wecom.default`，包含 `corpid`、`agentid` 和 `corpsecret`。
2. 在 Console `通知运行时` 页面配置 `notification.runtimeApiUrl`。
3. 为业务应用 service client 授权 `notification-runtime:send`。
4. 在 `通知运行时` 页面点击“生成指令”。Console 会创建或复用 `notification-runtime` service client secret，并自动确保 `integration_config:view`、`credential_vault:resolve` 授权存在。
5. 在 `通知运行时` 页面执行企业微信配置检测，并向指定企业微信 UserID 发送测试消息；测试结果会写入当前操作者的统一消息中心通知抽屉。

SQL seed: `docs/Console-SQL-Seed-v1.9-notification-runtime.sql`。

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
    bash
```

安装器会创建 `hzy-notification-runtime.service` 和 `hzy-notification-runtime-update.timer`，默认每 5 分钟检查自动升级。

## Cloudflare

Cloudflare Worker 不配置企业微信 secret。可选兜底变量：

```text
HZY_NOTIFICATION_RUNTIME_API_URL=https://notify.example.com
HZY_NOTIFICATION_RUNTIME_AUDIENCE=notification-runtime
HZY_NOTIFICATION_RUNTIME_LEGACY_FALLBACK=false
```

生产环境配置了 runtime 后，`sendNotification()` 默认不会在 runtime 调用失败时回退直连企业微信；本地开发可设置 `HZY_NOTIFICATION_RUNTIME_LEGACY_FALLBACK=true`。
