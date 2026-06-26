# Huizhi-Yun Cloudflare 部署指南

> 目标读者：负责汇智云 managed cloud 发布的研发 / 运维人员。本文是独立部署手册，覆盖 Platform、Tenant Gateway、Console、业务应用 Worker，以及部署中涉及的 token 从哪里生成、从哪里获取、设置到哪里。

## 1. 总体形态

当前 Cloudflare 主线是：

```text
Browser
  -> https://<tenant>.huizhi.yun              Tenant Gateway Worker
  -> https://console.huizhi.yun               Console Worker
  -> https://finance.huizhi.yun 等应用 origin  业务应用 Worker
  -> https://huizhi.yun                       Platform 控制面
  -> https://<tenant>-data-runtime...         客户侧 Data Runtime Agent
```

职责拆分：

| 组件 | 推荐运行位置 | 关键职责 |
| --- | --- | --- |
| Platform | `https://huizhi.yun`，可 PM2/Nginx 或明确例外的 Cloudflare Worker | 租户、deployment、Agent endpoint、OIDC 登录配置、签名 policy bundle、内部 registry API |
| Tenant Gateway | Cloudflare Worker，`*.huizhi.yun/*` | 按租户域名解析 tenant/deployment/environment，注入内部请求头，路由到 Console 和应用 Worker |
| Console | Cloudflare Worker，`console.huizhi.yun` | 共享多租户 Console，按请求从 Platform 拉取签名 policy bundle，提供员工入口、OIDC、目录、Vault |
| 业务应用 | Cloudflare Workers，`finance.huizhi.yun` 等 origin | 租户中立应用运行时，默认 `managed-cloud-agent`，通过 Tenant Gateway 注入的 Agent endpoint/token 访问客户数据 |
| Data Runtime Agent | 客户侧或企业专属网络 | 贴近客户数据库，校验 Platform 生成的 static token，执行业务数据访问 |

重要边界：

- 共享 Cloudflare Console 使用 `HZY_CONSOLE_ACTIVATION_MODE=managed-cloud-multitenant`。
- 共享 Cloudflare Console 不配置 `HZY_PLATFORM_TENANT_CODE`、`HZY_PLATFORM_DEPLOYMENT_CODE`、`HZY_PLATFORM_RUNTIME_TOKEN`、`HZY_PLATFORM_LICENSE_TOKEN`。
- Aims / Altoc / Assets / Codocs / Finance / People / Workflow 的 Cloudflare profile 固定为 `managed-cloud-agent`，不得生成 `DB_*` vars 或 Hyperdrive 绑定。
- `hzy.wiztek.cn` 是私有部署域名，不是共享 Cloudflare Console 域名；共享 Console 使用 `https://console.huizhi.yun`。

## 2. Token 与 Secret 总表

| 名称 | 生成 / 获取位置 | 设置位置 | 用途 | 是否写入 wrangler vars |
| --- | --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard 创建 API Token | 本地 shell / CI secret | 允许 wrangler 创建 Hyperdrive、写 Worker secret、部署 Worker | 否 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard Account ID | 本地 shell / CI secret | wrangler 账号定位 | 否 |
| `HZY_PLATFORM_SIGNING_PRIVATE_KEY` | `pnpm --dir platform run signing:key -- --label prod` | Platform env 或 Platform Worker secret | Platform 签发 license / policy bundle | 否 |
| `HZY_PLATFORM_SIGNING_KID` | 同上，或当前 Platform active signing key | `console/.env.cloudflare` | Console 验签 policy bundle | 是，非 secret |
| `HZY_PLATFORM_SIGNING_PUBKEY` | 同上，或当前 Platform active signing key public PEM | `console/.env.cloudflare` | Console 验签 policy bundle | 是，非 secret |
| `HZY_CLOUDFLARE_INTERNAL_TOKEN` | 运维生成随机串 | Platform env / secret、Console Worker secret、Tenant Gateway Worker secret | 统一的一方 Cloudflare 内部调用 token；覆盖 Gateway -> Platform、Console -> Platform、Gateway -> Console | 否 |
| `PLATFORM_INTERNAL_SERVICE_TOKENS` | 兼容旧配置；可留空 | Platform env / secret | Platform 内部 API 旧 allowlist | 否 |
| `HZY_PLATFORM_INTERNAL_TOKEN` | 兼容旧配置；可留空 | Tenant Gateway Worker secret | Gateway 调 Platform registry resolve API 的旧变量 | 否 |
| `HZY_CONSOLE_PLATFORM_SERVICE_TOKEN` | 兼容旧配置；可留空 | Console Worker secret | Console 调 Platform internal bundle API 的旧变量 | 否 |
| `HZY_TENANT_GATEWAY_INTERNAL_TOKEN` | 兼容旧配置；可留空 | Tenant Gateway Worker secret + Console Worker secret | Console 校验 Tenant Gateway 请求头的旧变量 | 否 |
| `HZY_DATA_RUNTIME_STATIC_TOKEN` | Platform 部署管理页生成 / 轮换 | 客户侧 Data Runtime Agent env；Platform bootstrap secret 保存 hash/密文 | Gateway 转发给 Agent，Agent 校验调用来源 | 否 |
| `HZY_CONSOLE_VAULT_MASTER_KEY` | 新环境由 Platform onboarding 生成，或 `openssl rand -base64 32`；已有环境必须复用旧值 | Console Worker secret | Console Vault 加解密 master key | 否 |
| `CONSOLE_AUTH_SIGNING_PRIVATE_JWK` | `pnpm --dir console run cloudflare:oidc-key` | Console Worker secret | Console 作为 OIDC Provider 签发 token | 否 |
| 企业上游 OIDC `client_secret` | 企业 SSO / Keycloak / IdP 后台生成 | Platform 部署管理页 `consoleLogin` 配置 | Console 员工登录上游配置，进入签名 policy bundle | 否，不放 Worker |
| `HZY_CONSOLE_DIAGNOSTICS_TOKEN` | 运维生成随机串 | Console Worker secret | 公网 diagnostics Bearer token | 否 |
| `HZY_OBSERVABILITY_ADMIN_TOKEN` | 运维生成随机串 | Observability Worker secret | 观测配置管理接口 | 否 |
| WebDev `HZY_WEBDEV_DEV_AGENT_TOKEN` | Dev Agent 配置生成 | WebDev Worker secret + Dev Agent env | WebDev 远程开发 Agent 鉴权 | 否 |
| WebDev `HZY_WEBDEV_DATA_RUNTIME_TOKEN` | Platform / Data Runtime 配置生成 | WebDev Worker secret，仅 WebDev PoC | WebDev 访问专用 Data Runtime | 否 |

生成随机 secret 推荐：

```bash
openssl rand -base64 48 | tr -d '\n'
```

生成 Console Vault master key 推荐：

```bash
openssl rand -base64 32 | tr -d '\n'
```

已有生产环境不要重新生成 `HZY_CONSOLE_VAULT_MASTER_KEY`。它变更后，旧 `vault_secrets` 密文无法解开。

两阶段简化策略：

1. 迁移期可以先生成一个随机值，同时写入旧的 `PLATFORM_INTERNAL_SERVICE_TOKENS`、`HZY_PLATFORM_INTERNAL_TOKEN`、`HZY_CONSOLE_PLATFORM_SERVICE_TOKEN` 和 `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`，确认现网调用正常。
2. 当前代码已支持统一别名；新部署直接只维护 `HZY_CLOUDFLARE_INTERNAL_TOKEN`。旧变量保留兼容，不再作为新部署的推荐配置。

## 3. Cloudflare 前置准备

1. 确认 `huizhi.yun` zone 在目标 Cloudflare account 中。
2. 创建 Cloudflare API Token，至少需要 Workers、Workers Routes、自定义域名、Hyperdrive 相关写权限。
3. 在部署 shell 或 CI 中设置：

```bash
export CLOUDFLARE_ACCOUNT_ID=<cloudflare-account-id>
export CLOUDFLARE_API_TOKEN=<cloudflare-api-token>
pnpm dlx wrangler@4 whoami
```

4. 确保依赖安装完成：

```bash
corepack enable
corepack prepare pnpm@10.32.1 --activate
pnpm install
```

## 4. Platform 配置与部署

### 4.1 推荐形态

Platform 是控制面，必须先可访问。当前共享 Cloudflare 链路默认要求：

```text
PLATFORM_SERVICE_URL=https://huizhi.yun
```

对于需要固定国内出口 IP 的企业微信/微信登录场景，Platform 推荐跑 PM2/Nginx，不强制部署到 Cloudflare。只要 `https://huizhi.yun` 可达，Tenant Gateway 和 Console Worker 就可以通过 Platform internal API 拉取 registry 和 bundle。

### 4.2 Platform 签名 key

首次生产部署生成 Platform 根签名 key：

```bash
pnpm --dir platform run signing:key -- --label prod > /tmp/hzy-platform-prod-signing.env
```

输出中：

- `HZY_PLATFORM_SIGNING_PRIVATE_KEY` 只放 Platform env / secret。
- `HZY_PLATFORM_SIGNING_KID` 和 `HZY_PLATFORM_SIGNING_PUBKEY` 放 Console `.env.cloudflare`。

PM2/Nginx Platform 示例：

```env
# platform/.env.prod
HZY_PLATFORM_SIGNING_PRIVATE_KEY=base64:<prod-ed25519-pkcs8-private-pem>
HZY_CLOUDFLARE_INTERNAL_TOKEN=<shared-cloudflare-internal-token>
PLATFORM_SERVICE_URL=https://huizhi.yun
```

不要把 private key 提交到 git。

### 4.3 Cloudflare internal token

Platform、Tenant Gateway 和共享 Console 使用同一个 `HZY_CLOUDFLARE_INTERNAL_TOKEN` 处理一方内部调用。它只用于受控 Worker/Platform 之间，不是租户 Runtime Token，也不是 Data Runtime Agent token。

生成：

```bash
export HZY_CLOUDFLARE_INTERNAL_TOKEN="$(openssl rand -base64 48 | tr -d '\n')"
```

Platform env：

```env
HZY_CLOUDFLARE_INTERNAL_TOKEN=<shared-cloudflare-internal-token>
```

后续同一个值还要写到：

- Console Worker secret `HZY_CLOUDFLARE_INTERNAL_TOKEN`。
- Tenant Gateway Worker secret `HZY_CLOUDFLARE_INTERNAL_TOKEN`。

旧变量 `PLATFORM_INTERNAL_SERVICE_TOKENS`、`HZY_PLATFORM_INTERNAL_TOKEN`、`HZY_CONSOLE_PLATFORM_SERVICE_TOKEN`、`HZY_TENANT_GATEWAY_INTERNAL_TOKEN` 仍可兼容读取。新部署不要再拆分使用。

批量处理脚本：

```bash
# 默认 dry-run，不会写入 Cloudflare 或 env 文件。
pnpm run token:cloudflare-internal -- --token-env HZY_CLOUDFLARE_INTERNAL_TOKEN --platform-env-file platform/.env.prod

# 稳定新部署：只写统一 token 到 Platform env、Console Worker、Tenant Gateway Worker。
pnpm run token:cloudflare-internal -- --apply --token-env HZY_CLOUDFLARE_INTERNAL_TOKEN --platform-env-file platform/.env.prod

# 迁移期：同一个 token 同时写入旧拆分变量，便于旧 Worker 版本平滑过渡。
pnpm run token:cloudflare-internal -- --apply --legacy-aliases --token-env HZY_CLOUDFLARE_INTERNAL_TOKEN --platform-env-file platform/.env.prod
```

如果 Platform 也作为例外部署到 Cloudflare Worker，再把 `platform-worker` 加到目标：

```bash
pnpm run token:cloudflare-internal -- --apply --target console,tenant-gateway,platform-worker --token-env HZY_CLOUDFLARE_INTERNAL_TOKEN
```

只更新 Platform PM2/Nginx env 文件、不写 Worker secret 时使用：

```bash
pnpm run token:cloudflare-internal -- --apply --target none --token-env HZY_CLOUDFLARE_INTERNAL_TOKEN --platform-env-file platform/.env.prod
```

没有预先生成 token 时，脚本会自动生成。为了后续可轮换和审计，建议显式保存到本机受限权限文件：

```bash
pnpm run token:cloudflare-internal -- --apply --write-token-file ~/.huizhi-yun/cloudflare-internal.token --platform-env-file platform/.env.prod
```

脚本默认不打印完整 token，只显示长度和 last4。只有排障时才使用 `--print-token`。

### 4.4 Platform 部署

PM2/Nginx 部署按 `platform/README.md` 的生产部署执行。关键结果是：

- `https://huizhi.yun` 可访问。
- `HZY_CLOUDFLARE_INTERNAL_TOKEN` 已生效。
- active Platform signing key 可用。
- Platform DB 已应用 deployment environment、policy bundle、tenant gateway registry 相关 migration。

如果明确要把 Platform 作为例外发布到 Cloudflare，先确认 `platform/wrangler.jsonc` 中：

- route 是 `huizhi.yun` / `www.huizhi.yun`。
- Hyperdrive `HYPERDRIVE` 指向 `hzy_platform`。
- secrets 已通过 `wrangler secret put` 设置。

Platform Cloudflare secrets 示例：

```bash
pnpm dlx wrangler@4 secret put HZY_PLATFORM_SIGNING_PRIVATE_KEY --config platform/wrangler.jsonc
pnpm dlx wrangler@4 secret put HZY_CLOUDFLARE_INTERNAL_TOKEN --config platform/wrangler.jsonc
pnpm dlx wrangler@4 secret put GITLAB_BOT_TOKEN --config platform/wrangler.jsonc
pnpm dlx wrangler@4 secret put HZY_PLATFORM_DIAGNOSTICS_TOKEN --config platform/wrangler.jsonc
```

按需再设置 `RESEND_API_KEY`、`GOOGLE_OAUTH_CLIENT_SECRET`、`WECOM_CORPSECRET` 等。

部署命令：

```bash
HZY_ALLOW_PLATFORM_CLOUDFLARE_DEPLOY=true pnpm --dir platform run deploy:cloudflare
```

## 5. Data Runtime Agent 与租户 registry

业务应用 Worker 不直连客户数据库。客户数据访问链路是：

```text
App Worker -> Tenant Gateway 注入 headers -> Data Runtime Agent -> 客户数据库
```

在 Platform 部署管理页为租户设置：

- 企业子域名：如 `wiztek` -> `https://wiztek.huizhi.yun`
- 默认 Data Runtime Agent endpoint：如 `https://wiztek-data-runtime.wiztek.yun`
- environment：生产为 `prod`
- 每个应用的 deployment override，如需要可单独设置

Data Runtime static token 从 Platform 部署管理页生成/轮换。生成后：

- Agent 服务器 env 使用 `HZY_DATA_RUNTIME_STATIC_TOKEN=<platform-generated-token>`。
- Platform 保存该 token 的受控材料，Tenant Gateway 通过 `/api/platform/internal/tenant-gateway/resolve` 读取并按请求注入。
- 不要把 `HZY_DATA_RUNTIME_TOKEN` 作为所有业务应用 Worker 的全局 secret。

Agent 安装命令由 Platform 部署管理页生成，通常会包含：

```env
HZY_DATA_RUNTIME_TENANT=<tenantCode>
HZY_DATA_RUNTIME_DEPLOYMENT=<deploymentCode>
HZY_DATA_RUNTIME_STATIC_TOKEN=<platform-generated-token>
```

如果 token 轮换，必须同时更新 Platform 中保存的 token 和客户侧 Agent env。

### 5.1 Data Runtime 发布物

`data-runtime` 当前按 `hzy-data-runtime` 名称发布。它是 tenant-runtime 迁移期的实现基座，不是通用 SQL proxy。发布物放在 R2，并通过下面的公开下载前缀分发：

```text
https://downloads.huizhi.yun/packages/hzy-data-runtime/
```

标准发布物包括：

- `install.sh`：客户侧一键安装 / 升级脚本。
- `<version>/hzy-data-runtime_<version>_linux_amd64.tar.gz`
- `<version>/hzy-data-runtime_<version>_linux_arm64.tar.gz`
- `<version>/*.sha256`
- `<version>/manifest.json`
- `latest/version.txt`
- `latest/manifest.json`
- `latest/hzy-data-runtime_linux_<arch>.tar.gz`

默认 R2 参数由 `data-runtime/scripts/upload-r2.sh` 读取：

```env
HZY_R2_BUCKET=huizhiyun
HZY_R2_PREFIX=packages/hzy-data-runtime
HZY_R2_PUBLIC_BASE_URL=https://downloads.huizhi.yun
HZY_R2_CACHE_CONTROL=no-cache, max-age=0
```

上传脚本会同时写入固定版本目录和 `latest` 目录。生产 bucket 上执行上传即表示把该版本发布给默认自动更新通道，客户侧 `hzy-data-runtime-update.timer` 会在默认 5 分钟周期内发现 `latest` 变化并更新。

### 5.2 打包与上传

发布前确认本地 Go toolchain 可用，并在 `data-runtime` 目录执行测试和打包：

```bash
cd data-runtime
go test ./...
./scripts/package-release.sh <version>
```

版本号推荐显式传入，例如：

```bash
./scripts/package-release.sh 0.3.20
```

如果没有传入参数，脚本会依次读取 `HZY_DATA_RUNTIME_VERSION`、`data-runtime/VERSION`，最后才回退到 UTC 时间戳。生产发布不要依赖时间戳版本。

打包产物位于：

```text
data-runtime/build/packages/hzy-data-runtime/
```

本地校验：

```bash
cat build/packages/hzy-data-runtime/latest/version.txt
cat build/packages/hzy-data-runtime/latest/manifest.json
(cd build/packages/hzy-data-runtime/<version> && shasum -a 256 -c *.sha256)
```

确认 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN` 已在 shell / CI secret 中设置后上传：

```bash
./scripts/upload-r2.sh <version>
```

上传后校验公开下载路径：

```bash
curl -fsS https://downloads.huizhi.yun/packages/hzy-data-runtime/latest/version.txt
curl -fsS https://downloads.huizhi.yun/packages/hzy-data-runtime/<version>/manifest.json
curl -fI https://downloads.huizhi.yun/packages/hzy-data-runtime/<version>/hzy-data-runtime_<version>_linux_amd64.tar.gz
curl -fI https://downloads.huizhi.yun/packages/hzy-data-runtime/<version>/hzy-data-runtime_<version>_linux_arm64.tar.gz
```

灰度发布不要直接覆盖生产 `latest`。可以使用临时 bucket / prefix 上传，然后在少量客户侧安装时指定 `--base-url` 和 `--version`：

```bash
HZY_R2_PREFIX=packages/hzy-data-runtime-staging ./scripts/upload-r2.sh <version>

curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime-staging/install.sh \
  | sudo bash -s -- --base-url https://downloads.huizhi.yun/packages/hzy-data-runtime-staging --version <version>
```

### 5.3 客户侧安装与升级

客户侧安装命令应从 Platform 部署管理页生成，至少包含租户、deployment、static token 和数据库连接参数：

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | \
  sudo env \
    HZY_DATA_RUNTIME_PORT=18080 \
    HZY_DATA_RUNTIME_TENANT=<tenantCode> \
    HZY_DATA_RUNTIME_DEPLOYMENT=<deploymentCode> \
    HZY_DATA_RUNTIME_STATIC_TOKEN=<platform-generated-token> \
    HZY_DATA_RUNTIME_DB_HOST=<customer-db-host> \
    HZY_DATA_RUNTIME_DB_USER=<customer-db-user> \
    HZY_DATA_RUNTIME_DB_PASSWORD=<customer-db-password> \
    HZY_FINANCE_AGENT_ENABLED=true \
    HZY_FINANCE_DB_NAME=hzy_finance \
    HZY_AIMS_AGENT_ENABLED=false \
    HZY_ALTOC_AGENT_ENABLED=false \
    HZY_ASSETS_AGENT_ENABLED=false \
    HZY_CODOCS_AGENT_ENABLED=false \
    HZY_WORKFLOW_AGENT_ENABLED=false \
    bash
```

按租户订阅和迁移状态开启对应 adapter。首次安装会先做数据库连通性检查，再写入 `/etc/hzy-data-runtime/.env` 并启动 `hzy-data-runtime.service`。

普通升级保留已有数据库配置。安装脚本检测到 `/etc/hzy-data-runtime/.env` 已存在时，只同步 Platform 激活类变量：

- `HZY_DATA_RUNTIME_TENANT`
- `HZY_DATA_RUNTIME_DEPLOYMENT`
- `HZY_DATA_RUNTIME_STATIC_TOKEN`
- `HZY_<APP>_AGENT_ENABLED`

需要修改数据库 host、账号、密码或数据库名时，显式使用：

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash -s -- --reconfigure
```

安装脚本默认启用：

```text
hzy-data-runtime-update.timer
```

该 timer 每 5 分钟执行：

```bash
/opt/hzy-data-runtime/hzy-data-runtime update --version latest
```

手动升级到 latest：

```bash
sudo /opt/hzy-data-runtime/hzy-data-runtime update
```

手动钉住指定版本：

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash -s -- --version <version>
```

不希望客户侧自动跟随 `latest` 时，安装时加 `--no-auto-update`，或把 timer 的 `--update-version` 固定为目标版本。

### 5.4 发布后验证与回滚

客户侧验证：

```bash
sudo systemctl status hzy-data-runtime --no-pager
sudo /opt/hzy-data-runtime/hzy-data-runtime --version
curl -fsS http://127.0.0.1:18080/runtime/health
curl -fsS -H "Authorization: Bearer ${HZY_DATA_RUNTIME_STATIC_TOKEN}" \
  http://127.0.0.1:18080/runtime/enrollment
curl -fsS -H "Authorization: Bearer ${HZY_DATA_RUNTIME_STATIC_TOKEN}" \
  "http://127.0.0.1:18080/runtime/schema/status?app=finance"
```

如果启用了 Aims / Altoc / Assets / Codocs / Workflow adapter，逐个检查对应 schema status：

```bash
curl -fsS -H "Authorization: Bearer ${HZY_DATA_RUNTIME_STATIC_TOKEN}" \
  "http://127.0.0.1:18080/runtime/schema/status?app=aims"
```

Platform 侧确认租户 registry 中的 Agent endpoint、static token 和 deployment 信息已经更新，并重新生成 policy bundle。Tenant Gateway 之后会按请求注入最新 Agent endpoint/token。

回滚优先使用固定版本重新安装：

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash -s -- --version <previous-version>
```

紧急情况下，如果当前服务器存在上一版二进制备份，也可以在客户侧恢复并重启：

```bash
sudo cp /opt/hzy-data-runtime/hzy-data-runtime.previous /opt/hzy-data-runtime/hzy-data-runtime
sudo systemctl restart hzy-data-runtime
```

回滚后必须重新执行 health、enrollment、schema status 检查。若回滚涉及 adapter 能力或数据库 schema 差异，先确认业务应用 Worker 版本和 policy bundle 没有依赖新 runtime capability。

## 6. Console Worker 部署

### 6.1 创建 Console Hyperdrive

Console 当前仍通过 Hyperdrive 访问共享 `hzy_console`。先创建 Hyperdrive：

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
```

记录输出中的 32 位 Hyperdrive config id，写入 `console/.env.cloudflare`：

```env
HZY_CONSOLE_HYPERDRIVE_ID=<32-char-hyperdrive-id>
```

### 6.2 Console 非 secret 配置

复制模板：

```bash
cp console/.env.cloudflare.example console/.env.cloudflare
```

关键值：

```env
HZY_CONSOLE_WORKER_NAME=hzy-console-prod
HZY_CONSOLE_ROUTE_PATTERN=console.huizhi.yun
HZY_CONSOLE_ZONE_NAME=huizhi.yun
HZY_CONSOLE_CUSTOM_DOMAIN=true
HZY_CONSOLE_WORKERS_DEV=false

HZY_DEPLOYMENT_PUBLIC_URL=https://console.huizhi.yun
HZY_PLATFORM_URL=https://huizhi.yun
HZY_CONSOLE_ACTIVATION_MODE=managed-cloud-multitenant
HZY_PLATFORM_ENVIRONMENT=prod
HZY_PLATFORM_SIGNING_KID=<prod-platform-signing-kid>
HZY_PLATFORM_SIGNING_PUBKEY=<prod-platform-ed25519-public-pem>

HZY_PLATFORM_BUNDLE_CACHE_BACKEND=db
HZY_PLATFORM_BUNDLE_CACHE_SCOPE=managed-cloud-console
HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK=false
```

`HZY_PLATFORM_SIGNING_PUBKEY` 使用完整 Ed25519 public PEM；写入 dotenv 时可用双引号并保留 `\n` 转义。

不要配置：

```env
HZY_PLATFORM_TENANT_CODE=
HZY_PLATFORM_DEPLOYMENT_CODE=
HZY_PLATFORM_RUNTIME_TOKEN=
HZY_PLATFORM_LICENSE_TOKEN=
```

### 6.3 Console OIDC signing key

Console 自己作为 OIDC Provider，需要 `auth_signing_keys` 表里有 current key，私钥放 Worker secret。

生成：

```bash
pnpm --dir console run cloudflare:oidc-key > /tmp/console-oidc-key.json
```

执行输出 JSON 里的 `sql` 到 `hzy_console`：

```bash
jq -r .sql /tmp/console-oidc-key.json | mysql -h <mysql-origin-host> -u <user> -p hzy_console
```

生成 wrangler 配置后，把 `privateJwk` 写入 Worker secret：

```bash
pnpm --dir console run cloudflare:config
jq -r .privateJwk /tmp/console-oidc-key.json \
  | pnpm dlx wrangler@4 secret put CONSOLE_AUTH_SIGNING_PRIVATE_JWK --config console/.wrangler.generated.jsonc
```

如果是已有生产环境，不要随意重新生成；应复用当前 `auth_signing_keys.private_key_ref` 指向的私钥。

### 6.4 Console Worker secrets

```bash
printf '%s' "$HZY_CLOUDFLARE_INTERNAL_TOKEN" \
  | pnpm dlx wrangler@4 secret put HZY_CLOUDFLARE_INTERNAL_TOKEN --config console/.wrangler.generated.jsonc

printf '%s' "$HZY_CONSOLE_VAULT_MASTER_KEY" \
  | pnpm dlx wrangler@4 secret put HZY_CONSOLE_VAULT_MASTER_KEY --config console/.wrangler.generated.jsonc

printf '%s' "$HZY_CONSOLE_DIAGNOSTICS_TOKEN" \
  | pnpm dlx wrangler@4 secret put HZY_CONSOLE_DIAGNOSTICS_TOKEN --config console/.wrangler.generated.jsonc
```

`HZY_CLOUDFLARE_INTERNAL_TOKEN` 必须稍后写入 Tenant Gateway Worker 同名 secret。旧的 `HZY_CONSOLE_PLATFORM_SERVICE_TOKEN` 和 `HZY_TENANT_GATEWAY_INTERNAL_TOKEN` 只用于兼容迁移。

### 6.5 Console 登录配置

企业员工登录的上游 OIDC/CAS/企业微信参数维护在 Platform 部署管理页，不写 Console Worker env。

OIDC 典型字段：

- provider code：如 `sso_oidc`
- client id
- client secret
- scope：如 `openid profile email`
- issuer
- authorization endpoint
- token endpoint

保存后生成包含 `consoleLogin` 的 policy bundle。Console Worker 会从签名 bundle 读取登录配置。

上游 IdP 回调 URI 必须允许：

```text
https://console.huizhi.yun/api/auth/oidc-callback
```

### 6.6 生成、校验、部署 Console

```bash
pnpm --dir console run cloudflare:config
pnpm run validate:console-cloudflare -- --env-file console/.env.cloudflare --strict-env
pnpm --dir console run build:cloudflare
pnpm dlx wrangler@4 deploy --config console/.wrangler.generated.jsonc
```

或：

```bash
pnpm --dir console run deploy:cloudflare
```

## 7. Tenant Gateway 部署

Tenant Gateway 配置文件：

```text
deploy/cloudflare/tenant-gateway/wrangler.jsonc
```

关键 vars：

```json
{
  "HZY_TENANT_GATEWAY_REGISTRY_URL": "https://huizhi.yun/api/platform/internal/tenant-gateway/resolve",
  "HZY_TENANT_DOMAIN_SUFFIX": "huizhi.yun",
  "HZY_CONSOLE_ORIGIN": "https://console.huizhi.yun",
  "HZY_FINANCE_ORIGIN": "https://finance.huizhi.yun",
  "HZY_ALTOC_ORIGIN": "https://altoc.huizhi.yun",
  "HZY_AIMS_ORIGIN": "https://aims.huizhi.yun",
  "HZY_ASSETS_ORIGIN": "https://assets.huizhi.yun",
  "HZY_CODOCS_ORIGIN": "https://codocs.huizhi.yun",
  "HZY_PEOPLE_ORIGIN": "https://people.huizhi.yun",
  "HZY_WORKFLOW_ORIGIN": "https://workflow.huizhi.yun",
  "HZY_WEBDEV_ORIGIN": "https://webdev.huizhi.yun"
}
```

设置 secrets：

```bash
printf '%s' "$HZY_CLOUDFLARE_INTERNAL_TOKEN" \
  | pnpm dlx wrangler@4 secret put HZY_CLOUDFLARE_INTERNAL_TOKEN --config deploy/cloudflare/tenant-gateway/wrangler.jsonc
```

部署：

```bash
pnpm dlx wrangler@4 deploy --config deploy/cloudflare/tenant-gateway/wrangler.jsonc
```

DNS 要求：

- `*.huizhi.yun/*` route 指向 Tenant Gateway Worker。
- `console.huizhi.yun`、`finance.huizhi.yun`、`people.huizhi.yun` 等应用 origin 域名必须是 Cloudflare 可路由域名。
- Tenant Gateway reserved subdomain 列表必须包含 `console`、各应用 code、`platform`、`www` 等，避免业务入口和 Worker origin 互相递归。

Gateway 会注入：

```text
x-hzy-gateway: tenant-gateway
x-hzy-gateway-token: <HZY_CLOUDFLARE_INTERNAL_TOKEN>
x-hzy-tenant: <tenantCode>
x-hzy-deployment: <deploymentCode>
x-hzy-environment: prod
x-hzy-data-runtime-url: <Agent endpoint>
x-hzy-data-runtime-token: <Platform generated static token>
```

不要在日志或 curl 输出里打印 `x-hzy-gateway-token`、`x-hzy-data-runtime-token`。

## 8. 业务应用 Worker 部署

### 8.1 通用规则

当前纳入通用 Cloudflare 校验的业务模块：

```text
aims
altoc
assets
codocs
finance
people
workflow
```

这些模块的 Cloudflare 配置生成器强制：

```env
HZY_DEPLOYMENT_PROFILE=managed-cloud-agent
NUXT_PUBLIC_DEPLOYMENT_PROFILE=managed-cloud-agent
```

并禁止：

```env
DB_NAME=
DB_HOST=
DB_USER=
DB_PASSWORD=
HZY_<APP>_HYPERDRIVE_ID=
HZY_PLATFORM_RUNTIME_TOKEN=
HZY_PLATFORM_LICENSE_TOKEN=
```

业务应用不直接保存 Platform token、Console OIDC client secret 或客户数据库密码。它们依赖：

- Tenant Gateway 请求头获取 tenant/deployment/environment。
- Tenant Gateway 请求头获取 Data Runtime Agent endpoint/static token。
- Console OIDC / Console JWKS 做员工登录与 service token 验证。
- Platform policy bundle 决定应用入口和授权。

### 8.2 应用 Worker origin 配置

每个应用可在 `<app>/.env.cloudflare` 设置本应用 origin。示例：

```env
HZY_DEPLOYMENT_PROFILE=managed-cloud-agent
HZY_<APP>_WORKER_NAME=hzy-<app>
HZY_<APP>_ROUTE_PATTERN=<app>.huizhi.yun/*
HZY_<APP>_ZONE_NAME=huizhi.yun
HZY_APP_BASE_PATH=/<app>/
HZY_CONSOLE_URL=https://console.huizhi.yun
```

这里的 `<APP>` 是大写 env prefix，例如 `FINANCE`、`PEOPLE`、`AIMS`、`ALTOC`、`ASSETS`、`CODOCS`、`WORKFLOW`。

共享多租户应用不要把 `HZY_DEPLOYMENT_PUBLIC_URL` 设置成 `https://wiztek.huizhi.yun` 这类租户域名。租户访问 URL 由 Tenant Gateway 的 incoming host 决定：

```text
https://<tenant>.huizhi.yun/finance/
https://<tenant>.huizhi.yun/people/
https://<tenant>.huizhi.yun/aims/
```

Worker origin 是：

```text
https://finance.huizhi.yun/
https://people.huizhi.yun/
https://aims.huizhi.yun/
```

### 8.3 通用部署命令

先做配置污染校验：

```bash
pnpm run validate:business-cloudflare
```

逐个部署：

```bash
pnpm --dir aims run deploy:cloudflare
pnpm --dir altoc run deploy:cloudflare
pnpm --dir assets run deploy:cloudflare
pnpm --dir finance run deploy:cloudflare
pnpm --dir people run deploy:cloudflare
pnpm --dir workflow run deploy:cloudflare
```

生成配置后可人工检查：

```bash
node -e "const {readFileSync}=require('node:fs'); const c=JSON.parse(readFileSync('./aims/.wrangler.generated.jsonc','utf8')); console.log(c.vars.HZY_DEPLOYMENT_PROFILE, c.hyperdrive)"
```

预期：

```text
managed-cloud-agent undefined
```

如果看到 `DB_NAME` 或 `hyperdrive`，停止部署，先修配置。

### 8.4 Codocs 特殊项

Codocs 当前适合灰度，不建议未经验证直接替换生产。除了通用 `managed-cloud-agent` 配置，还要确认：

- 文档元数据路径走 tenant-runtime。
- 上传、预览、下载、内容转换路径能在 Worker 上跑通。
- 对象存储 provider 设置为 `HZY_OBJECT_STORAGE_PROVIDER=aliyun-oss-s3` 或目标 provider。
- 协同编辑 `HZY_COLLAB_ORIGIN` / `NUXT_PUBLIC_COLLABORATION_URL` 路由可用。

部署：

```bash
HZY_OBJECT_STORAGE_PROVIDER=aliyun-oss-s3 \
pnpm --dir codocs run deploy:cloudflare
```

对象存储密钥目标上应进入 Console integration + vault，由 Foundation adapter 消费。迁移期如果 Codocs/Collab 仍使用 standalone OSS secret，必须用 Worker secret 或受控服务配置，不要提交 `.env`。

### 8.5 WebDev 特殊项

WebDev 是远程开发能力，除 Data Runtime 外还依赖 Dev Agent。配置示例见 `webdev/.env.cloudflare.example`。

关键非 secret：

```env
HZY_WEBDEV_DEV_AGENT_URL=https://dev-agent-1.huizhi.yun
HZY_WEBDEV_DATA_RUNTIME_URL=https://wiztek-data-runtime.huizhi.yun
HZY_WEBDEV_REQUIRE_APP_GRANT=true
```

secrets：

```bash
pnpm --dir webdev run cloudflare:config
pnpm dlx wrangler@4 secret put HZY_WEBDEV_DEV_AGENT_TOKEN --config webdev/.wrangler.generated.jsonc
pnpm dlx wrangler@4 secret put HZY_WEBDEV_DATA_RUNTIME_TOKEN --config webdev/.wrangler.generated.jsonc
```

WebDev 的 token 来源：

- `HZY_WEBDEV_DEV_AGENT_TOKEN` 来自 Dev Agent 安装/配置。
- `HZY_WEBDEV_DATA_RUNTIME_TOKEN` 来自 Platform / Data Runtime 专用配置。

### 8.6 暂不建议直接 Cloudflare 发布的模块

`align`、`insights` 当前没有完整 Cloudflare 部署骨架，仍有直连 DB 或外部服务依赖。部署前应先迁移到 tenant-runtime/data-runtime 或外部后端代理模式。

## 9. Platform 中的租户和 bundle 配置

每次修改下面任意项后，都要在 Platform 中重新生成 policy bundle：

- Console 登录入口 `consoleLogin`
- 企业子域名
- 默认 Data Runtime Agent endpoint
- Data Runtime static token
- 应用 deployment public URL / base path / status
- 角色、模板、权限、主体授权

Console 共享 Worker 会通过：

```text
GET https://huizhi.yun/api/platform/internal/console/tenants/{tenantCode}/bundle?environment=prod
Authorization: Bearer HZY_CLOUDFLARE_INTERNAL_TOKEN
```

按租户拉取 bundle 并验签。

Tenant Gateway 会通过：

```text
GET https://huizhi.yun/api/platform/internal/tenant-gateway/resolve?host=<tenant>.huizhi.yun
Authorization: Bearer HZY_CLOUDFLARE_INTERNAL_TOKEN
```

解析租户 registry 和 Agent token。

## 10. 验证清单

静态校验：

```bash
pnpm run validate:console-cloudflare -- --env-file console/.env.cloudflare --strict-env
pnpm run validate:business-cloudflare
pnpm run validate:runtime-isolation -- --console-prod-cloudflare
pnpm run validate:runtime-isolation-docs
```

构建校验：

```bash
pnpm --dir console run build:cloudflare
pnpm --dir aims run build:cloudflare
pnpm --dir altoc run build:cloudflare
pnpm --dir assets run build:cloudflare
NODE_OPTIONS='--max-old-space-size=4096' pnpm --dir codocs run build:cloudflare
pnpm --dir finance run build:cloudflare
pnpm --dir people run build:cloudflare
pnpm --dir workflow run build:cloudflare
```

Data Runtime 发布包校验：

```bash
cd data-runtime
go test ./...
./scripts/package-release.sh <version>
(cd build/packages/hzy-data-runtime/<version> && shasum -a 256 -c *.sha256)
curl -fsS https://downloads.huizhi.yun/packages/hzy-data-runtime/latest/version.txt
```

运行态探测：

```bash
curl -I https://console.huizhi.yun/
curl -I https://wiztek.huizhi.yun/
curl -I https://wiztek.huizhi.yun/finance/
curl -I https://wiztek.huizhi.yun/aims/
curl -I https://wiztek.huizhi.yun/assets/
curl -I https://wiztek.huizhi.yun/codocs/
curl -I https://wiztek.huizhi.yun/people/
curl -I https://wiztek.huizhi.yun/workflow/
```

Data Runtime Agent 探测在客户侧或能访问 Agent 内网地址的机器上执行：

```bash
sudo /opt/hzy-data-runtime/hzy-data-runtime --version
curl -fsS http://127.0.0.1:18080/runtime/health
curl -fsS -H "Authorization: Bearer ${HZY_DATA_RUNTIME_STATIC_TOKEN}" \
  http://127.0.0.1:18080/runtime/enrollment
```

Console diagnostics：

```bash
curl -H "Authorization: Bearer ${HZY_CONSOLE_DIAGNOSTICS_TOKEN}" \
  https://console.huizhi.yun/api/activation/diagnostics
```

租户域名请求预期响应头：

```text
x-hzy-gateway: tenant-gateway
```

## 11. 常见错误

### Console 报缺少 `HZY_PLATFORM_RUNTIME_TOKEN` 或 `HZY_PLATFORM_LICENSE_TOKEN`

说明 Worker 不是 `managed-cloud-multitenant`，或者旧 env 污染了配置。检查：

```bash
pnpm run validate:console-cloudflare -- --env-file console/.env.cloudflare --strict-env
```

共享 Cloudflare Console 不应设置 runtime/license token。

### Console 报缺少 `HZY_CLOUDFLARE_INTERNAL_TOKEN`

Console Worker secret 未设置，或设置的 token 与 Platform / Tenant Gateway 不一致。

修复：

```bash
printf '%s' "$HZY_CLOUDFLARE_INTERNAL_TOKEN" \
  | pnpm dlx wrangler@4 secret put HZY_CLOUDFLARE_INTERNAL_TOKEN --config console/.wrangler.generated.jsonc
```

### Console 报缺少 `HZY_CLOUDFLARE_INTERNAL_TOKEN or HZY_TENANT_GATEWAY_INTERNAL_TOKEN`

Console Worker 或 Tenant Gateway Worker 没有配置统一内部 token。该 token 必须同时设置到 Console Worker 和 Tenant Gateway Worker：

```bash
printf '%s' "$HZY_CLOUDFLARE_INTERNAL_TOKEN" \
  | pnpm dlx wrangler@4 secret put HZY_CLOUDFLARE_INTERNAL_TOKEN --config console/.wrangler.generated.jsonc

printf '%s' "$HZY_CLOUDFLARE_INTERNAL_TOKEN" \
  | pnpm dlx wrangler@4 secret put HZY_CLOUDFLARE_INTERNAL_TOKEN --config deploy/cloudflare/tenant-gateway/wrangler.jsonc
```

### Tenant Gateway 返回 `Tenant registry unavailable`

通常是 Tenant Gateway 缺少 `HZY_CLOUDFLARE_INTERNAL_TOKEN`、Platform 未配置同值 token，或 `https://huizhi.yun/api/platform/internal/tenant-gateway/resolve` 不可达。

### 业务应用 Worker 访问数据库失败

共享 Cloudflare 业务应用不应该直连 DB。检查 `.wrangler.generated.jsonc`：

```bash
rg -n '"DB_|hyperdrive|managed-cloud-direct-db' aims/.wrangler.generated.jsonc altoc/.wrangler.generated.jsonc assets/.wrangler.generated.jsonc codocs/.wrangler.generated.jsonc finance/.wrangler.generated.jsonc people/.wrangler.generated.jsonc workflow/.wrangler.generated.jsonc
```

如有命中，停止部署并运行：

```bash
pnpm run validate:business-cloudflare
```

### Hyperdrive 部署错误

Console 需要 Hyperdrive；业务应用 `managed-cloud-agent` 不需要。若 `pnpm --dir console run deploy:cloudflare` 报 Hyperdrive binding 错误，先确认：

```bash
pnpm dlx wrangler@4 hyperdrive list
```

`HZY_CONSOLE_HYPERDRIVE_ID` 必须是 32 位 config id，不是名称或 UUID。

## 12. 推荐部署顺序

1. 配置 Cloudflare API token 和 account id。
2. 部署或确认 Platform `https://huizhi.yun` 可用。
3. 生成/确认 Platform signing key。
4. 生成 Platform internal tokens，并写入 Platform env。
5. 打包、测试并上传 `hzy-data-runtime` 发布物到 R2，确认下载路径可用。
6. 在 Platform 配置租户、Data Runtime Agent endpoint、Data Runtime static token、Console 登录入口。
7. 用 Platform 生成的安装命令安装或升级客户侧 Data Runtime Agent，并验证 health / enrollment / schema status。
8. 创建 Console Hyperdrive，配置 `console/.env.cloudflare`。
9. 生成或确认 Console OIDC signing private JWK。
10. 设置 Console Worker secrets。
11. 部署 Console Worker。
12. 设置 Tenant Gateway secrets，部署 Tenant Gateway。
13. 部署业务应用 Workers。
14. 在 Platform 重新生成 policy bundle。
15. 用租户域名、Data Runtime Agent health 和 Console diagnostics 验证运行态。

## 13. 不应提交到 git 的内容

不要提交：

- `.env.cloudflare`
- `HZY_PLATFORM_SIGNING_PRIVATE_KEY`
- `HZY_CLOUDFLARE_INTERNAL_TOKEN`
- `PLATFORM_INTERNAL_SERVICE_TOKENS`
- `HZY_PLATFORM_INTERNAL_TOKEN`
- `HZY_CONSOLE_PLATFORM_SERVICE_TOKEN`
- `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`
- `HZY_DATA_RUNTIME_STATIC_TOKEN`
- `HZY_CONSOLE_VAULT_MASTER_KEY`
- `CONSOLE_AUTH_SIGNING_PRIVATE_JWK`
- 企业上游 OIDC `client_secret`
- OSS / GitLab / WeCom / Google OAuth secrets

可以提交：

- `*.env.cloudflare.example`
- 非 secret 的 route、zone、public URL、worker name、Platform signing kid/pubkey
- 文档和校验脚本
