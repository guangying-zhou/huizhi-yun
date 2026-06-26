# Console on Cloudflare Workers

Console 可以作为客户租户入口部署到 Cloudflare Workers。迁移后不再依赖 PM2；应用启停页在 Cloudflare 运行时只展示运行状态，不执行本机进程控制。

## 当前范围

- 支持：Console SSR/API、OIDC Provider、目录/权限/服务客户端、Vault、Hyperdrive 连接 `hzy_console`。
- 支持：共享 Cloudflare Console 使用 `managed-cloud-multitenant` 激活模式。租户、deployment 与环境由 Tenant Gateway 按请求注入，Console 使用 Platform internal service token 拉取签名 policy bundle，并按租户 scope 缓存到 MySQL。
- 诊断：`/api/activation/diagnostics` 默认不允许公网访问；Cloudflare 上需要设置 `HZY_CONSOLE_DIAGNOSTICS_TOKEN` 后用 Bearer token 探测。
- 暂停：内嵌 Hocuspocus、LDAP 同步、本机 PM2 启停。
- 后续：协同服务改为 Durable Objects/WebSocket 架构；本地文件型对象存储改为 R2/OSS/数据库引用。

## 数据库准备

Cloudflare 访问 MySQL 通过 Hyperdrive 绑定完成，目标库仍是 `hzy_console`。

先应用运行时缓存表：

```bash
mysql -h <mysql-origin-host> -u cf_app -p hzy_console < console/deploy/cloudflare/001_runtime_cache.sql
```

生产 Worker 固定使用 DB cache。基础 scope 统一为 `managed-cloud-console`：

```env
HZY_PLATFORM_BUNDLE_CACHE_BACKEND=db
HZY_PLATFORM_BUNDLE_CACHE_SCOPE=managed-cloud-console
HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK=false
HZY_CONSOLE_TRUST_TENANT_GATEWAY=false
HZY_CONSOLE_ACTIVATION_MODE=managed-cloud-multitenant
```

共享 Worker 的实际缓存 key 会扩展为 `managed-cloud-console:<environment>:<tenantCode>`。`HZY_CONSOLE_TRUST_TENANT_GATEWAY` 是旧的无 token 信任开关，必须保持 `false`；`managed-cloud-multitenant` 只接受携带 `x-hzy-gateway-token` 且与 Worker secret 匹配的 Tenant Gateway 请求头。

配置生成器会拒绝 `HZY_PLATFORM_BUNDLE_CACHE_BACKEND=file`，因为 Worker 不能使用文件 cache 保存持久 Platform runtime 状态；也会拒绝 `HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK=true`、`HZY_CONSOLE_TRUST_TENANT_GATEWAY=true`、非生产域名、非 `managed-cloud-multitenant` 激活模式、非 `hzy_console` DB、embedded Collab、以及 OIDC signing key 自动生成 / 自动轮换，避免共享库运行态读取旧无 scope key，或把测试 / 本地配置发布成生产 Worker。上线前从仓库根目录运行：

```bash
pnpm run validate:console-cloudflare -- --env-file console/.env.cloudflare
```

该校验会生成临时 wrangler 配置并确认：

- `HZY_PLATFORM_BUNDLE_CACHE_BACKEND=db`
- `HZY_PLATFORM_BUNDLE_CACHE_SCOPE` 已设置
- `HZY_DEPLOYMENT_PUBLIC_URL=https://console.huizhi.yun`
- `HZY_PLATFORM_URL=https://huizhi.yun`
- `HZY_CONSOLE_ACTIVATION_MODE=managed-cloud-multitenant`
- `HZY_PLATFORM_ENVIRONMENT=prod`
- `HZY_PLATFORM_BUNDLE_CACHE_SCOPE=managed-cloud-console`
- `HZY_CONSOLE_TRUST_TENANT_GATEWAY=false`
- `HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE=upsert`
- `CONSOLE_COLLAB_MODE=disabled`
- `CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE=false`
- `CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE=false`
- `HZY_RUNTIME_APP_CONTROL_ENABLED=false`
- `DB_NAME=hzy_console`
- tenant runtime token、license token、Platform service token、Tenant Gateway token、vault master key、diagnostics token、私钥等敏感值不写入 wrangler vars

最终上线门禁会追加 `--strict-env`，要求 `.env.cloudflare` 中的 `HZY_CONSOLE_HYPERDRIVE_ID`、Worker 名称、Platform signing kid/pubkey 等非 secret 值已填充且不是占位值，并确认 Platform signing pubkey 是可解析的 Ed25519 public PEM；Platform service token、Tenant Gateway token、Vault、diagnostics 和 Console signing 私钥仍通过 `wrangler secret put` 注入。Cloudflare 共享 Console 不再配置 `HZY_PLATFORM_TENANT_CODE`、`HZY_PLATFORM_DEPLOYMENT_CODE`、`HZY_PLATFORM_RUNTIME_TOKEN` 或 `HZY_PLATFORM_LICENSE_TOKEN`。

部署并完成首次 bundle refresh 后，运行共享 DB cache 校验：

```bash
pnpm run verify:console-runtime-cache -- \
  --db hzy_console \
  --user root \
  --password-env CONSOLE_DB_PASSWORD \
  --require-prod-cache
```

该校验默认拒绝旧无 scope `policy_bundle` / `activation_status`。如迁移期必须临时读取旧 key，需显式设置 `HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK=true`，但生产 / 测试共库稳定运行前必须关闭并清理旧 key。

`cf_app` 至少需要：

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON `hzy_console`.* TO `cf_app`@`%`;
```

## OIDC Signing Key

Workers 不能在运行时写本地私钥文件。共享 `hzy_console` 时，`auth_signing_keys` 也是共享 auth runtime 状态，不能让 Worker、`console-test` 或本地 `console-dev` 自动生成 / 自动轮换 current key。先生成一组 EdDSA key，把私钥放 Worker secret，公钥写入 `auth_signing_keys`：

```bash
pnpm --dir console run cloudflare:oidc-key > /tmp/console-oidc-key.json
```

执行输出里的 SQL；再把 `privateJwk` 写入 Worker secret：

从仓库根目录执行时，`--config` 要传 `console/.wrangler.generated.jsonc`：

```bash
pnpm dlx wrangler@4 secret put CONSOLE_AUTH_SIGNING_PRIVATE_JWK --config console/.wrangler.generated.jsonc
```

或先进入 Console 目录：

```bash
cd console
pnpm dlx wrangler@4 secret put CONSOLE_AUTH_SIGNING_PRIVATE_JWK --config .wrangler.generated.jsonc
```

`auth_signing_keys.private_key_ref` 必须是：

```text
env:CONSOLE_AUTH_SIGNING_PRIVATE_JWK
```

`CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE` 和 `CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE` 必须保持 `false`。如果 `console-test` 也需要签发 OIDC token，需要给 `console-test` PM2 env 配置同一把 `CONSOLE_AUTH_SIGNING_PRIVATE_JWK`；不要让测试实例自动轮换共享表里的 current key。

## Secrets

这些值不要写入 `wrangler` vars，用 `wrangler secret put`。共享 Cloudflare Console 使用：

```bash
pnpm dlx wrangler@4 secret put HZY_CLOUDFLARE_INTERNAL_TOKEN --config console/.wrangler.generated.jsonc
pnpm dlx wrangler@4 secret put HZY_CONSOLE_VAULT_MASTER_KEY --config console/.wrangler.generated.jsonc
pnpm dlx wrangler@4 secret put HZY_CONSOLE_DIAGNOSTICS_TOKEN --config console/.wrangler.generated.jsonc
pnpm dlx wrangler@4 secret put CONSOLE_AUTH_SIGNING_PRIVATE_JWK --config console/.wrangler.generated.jsonc
```

`HZY_CLOUDFLARE_INTERNAL_TOKEN` 必须同时设置在 `https://huizhi.yun` Platform、Console Worker 和 Tenant Gateway Worker 上；旧 `HZY_CONSOLE_PLATFORM_SERVICE_TOKEN` / `HZY_TENANT_GATEWAY_INTERNAL_TOKEN` 只作为兼容变量。`HZY_PLATFORM_RUNTIME_TOKEN` 与 `HZY_PLATFORM_LICENSE_TOKEN` 只用于 PM2 / 私有单租户 Console，不用于共享 Cloudflare Console。
上游员工登录配置（OIDC/CAS/企业微信）在 Platform 部署管理页维护，生成 policy bundle 后由 Console runtime 拉取并验签消费，不再写入 Worker vars 或 Worker secrets。

## 生成配置

需要先创建 `hzy_console` 的 Hyperdrive config：

```bash
printf "DB password: "
stty -echo
IFS= read -r DB_PASS
stty echo
printf "\n"

pnpm dlx wrangler@4 hyperdrive create hzy-console \
  --origin-scheme mysql \
  --origin-host <mysql-origin-host> \
  --origin-port 3306 \
  --database hzy_console \
  --origin-user cf_app \
  --origin-password "$DB_PASS" \
  --sslmode REQUIRED \
  --caching-disabled \
  --origin-connection-limit 5

cp console/.env.cloudflare.example console/.env.cloudflare

# Fill these non-secret values in console/.env.cloudflare:
# HZY_CONSOLE_HYPERDRIVE_ID=<hyperdrive-id>
# HZY_PLATFORM_SIGNING_KID=<platform-signing-kid>
# HZY_PLATFORM_SIGNING_PUBKEY=<platform-ed25519-public-pem>

pnpm --dir console run cloudflare:config
```

部署 Console 之前，`https://huizhi.yun` 上的 Platform 必须已部署并配置 Platform internal service token，否则 Worker 无法按租户请求刷新 policy bundle。在 Platform 租户部署管理页配置 Console 登录入口，并生成包含 `consoleLogin` 的 policy bundle。上游 OIDC client 需要允许回调：

```text
https://console.huizhi.yun/api/auth/oidc-callback
```

`--origin-password` 传原始密码，例如 `Wiztek@2026`；不要把 `@` 写成 `%40`。只有使用 `--connection-string="mysql://..."` 时才需要 URL encode。

生成文件：`console/.wrangler.generated.jsonc`。

## 构建与部署

```bash
pnpm --dir console run build:cloudflare
pnpm dlx wrangler@4 deploy --config console/.wrangler.generated.jsonc
```

或：

```bash
pnpm --dir console run deploy:cloudflare
```

部署后，把租户网关的 Console origin 指向 Console Worker 的自定义域名，例如：

```text
HZY_CONSOLE_ORIGIN=https://console.huizhi.yun
HZY_CLOUDFLARE_INTERNAL_TOKEN=<same-secret-as-console-worker>
```

业务应用继续通过租户域名访问：

```text
https://<tenant>.huizhi.yun/
https://<tenant>.huizhi.yun/finance/
https://<tenant>.huizhi.yun/altoc/
```

## 验证

```bash
curl -I https://console.huizhi.yun/
curl -I https://console.huizhi.yun/api/auth/me
```

预期：

- Console 首页返回 `200` 或登录跳转。
- 登录后不再跳回旧 Console 域名或本地开发地址。
- 浏览器控制台不再出现 Vite HMR `localhost` WebSocket 报错。
- `/api/v1/console/runtime/apps/*/action` 在 Cloudflare 上不会执行 PM2。
