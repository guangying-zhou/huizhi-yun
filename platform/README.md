# platform

`platform` 是汇智云新一代平台控制面应用，承接：

- Identity Plane
- Authorization / Role Template / Scope
- App Registry / Manifest
- Deployment / License / Bundle / Heartbeat

当前阶段用于搭建绿地骨架，并作为 `AIMS` 首个接入目标平台。

## 当前说明

- `platform` 已不再依赖 `@hzy/foundation` Nuxt layer。
- 控制台导航、路由认证、页面标题、权限菜单和租户上下文均由本模块维护，避免控制面反向依赖旧共享层。
- 后续 `foundation` 应作为业务应用共享层消费 platform SDK / adapter，而不是 platform 的上游依赖。

## GitLab manifest 导入

- `platform_applications.repo_url` 记录应用代码仓库地址。
- 应用发布后，Platform 可按 version/ref 解析到 GitLab commit SHA，并读取该 commit 下的 `app.manifest.json` 注册 manifest。
- 运行时配置：`GITLAB_BASE_URL`、`GITLAB_BOT_TOKEN`、`GITLAB_DEFAULT_APP_MANIFEST_PATH`、`GITLAB_REQUEST_TIMEOUT_MS`。

## 例外：发布到 Cloudflare

`wiztek` 的 `platform-prod` / `platform-dev` 不走 Cloudflare。Platform 需要支持企业微信登录，生产和共享测试控制面必须部署到国内服务器，以 PM2 + Nginx 方式运行，并通过固定服务器 IP 对外提供服务。Cloudflare 发布路径只保留给历史环境或明确不依赖固定 IP 的非 `wiztek` 例外场景。

为了避免误发布，`pnpm run deploy:cloudflare` 默认会失败。确实要执行例外发布时，必须显式设置：

在仓库根目录执行：

```bash
HZY_ALLOW_PLATFORM_CLOUDFLARE_DEPLOY=true pnpm --filter platform deploy:cloudflare
```

或进入 `platform` 目录后执行：

```bash
HZY_ALLOW_PLATFORM_CLOUDFLARE_DEPLOY=true pnpm run deploy:cloudflare
```

该脚本会先执行 `nuxt build --preset=cloudflare_module`，再通过 `wrangler@4` 按 `platform/wrangler.jsonc` 发布。

首次发布或换机器时，先确认 Cloudflare 凭证已配置：

```bash
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...
```

Worker 名称和路由以 `platform/wrangler.jsonc` 为准；当前配置为历史 Worker `hzy-platform`，不得作为 `platform.wiztek.cn` 或 `platform-dev.wiztek.cn` 的生产发布入口。真实 `platform/.env.cloudflare` 只能保留在例外部署机器本地，默认被 `.gitignore` 忽略；仓库只跟踪 `platform/.env.cloudflare.example`。根目录 `pnpm run validate:platform-cloudflare-guard` 会检查 Platform Cloudflare 配置中不能出现这两个 wiztek Platform 域名，并确认真实 `.env.cloudflare` 没有被 git 跟踪。

生产环境需要提供 Platform 根签名私钥。该私钥用于签发 license、policy bundle 与 revocation；如果缺失，保存租户应用订阅、生成测试环境 bundle 或重新签发 license 时会返回 503。

### 生成 Platform 根签名私钥

Platform 根签名私钥使用 Ed25519 PKCS#8 PEM。`openssl genpkey -algorithm Ed25519` 输出的私钥头应为 `-----BEGIN PRIVATE KEY-----`，不是 `BEGIN OPENSSH PRIVATE KEY`。

推荐直接使用仓库脚本生成一组不落盘的 Platform / Console env 片段：

```bash
pnpm --dir platform run signing:key -- --label prod
pnpm --dir platform run signing:key -- --label dev
```

输出中的 `HZY_PLATFORM_SIGNING_PRIVATE_KEY` 只放到对应的 Platform env 或 secret manager；`HZY_PLATFORM_SIGNING_KID` 和 `HZY_PLATFORM_SIGNING_PUBKEY` 放到匹配的 Console env。生产 Console 使用 prod 的 public values，`console-test` 使用 dev 的 public values。prod/dev 必须生成两组不同 key。

```bash
mkdir -p ~/.huizhi-yun/platform-keys
chmod 700 ~/.huizhi-yun/platform-keys

openssl genpkey -algorithm Ed25519 \
  -out ~/.huizhi-yun/platform-keys/platform-signing-private.pem

chmod 600 ~/.huizhi-yun/platform-keys/platform-signing-private.pem

openssl pkey \
  -in ~/.huizhi-yun/platform-keys/platform-signing-private.pem \
  -pubout \
  -out ~/.huizhi-yun/platform-keys/platform-signing-public.pem
```

本地 PM2 / `.env` 部署建议把 PEM 转成 base64 单行，避免多行环境变量被 shell、PM2 或 dotenv 解析错：

```bash
openssl base64 -A \
  -in ~/.huizhi-yun/platform-keys/platform-signing-private.pem
```

写入 `platform/.env`：

```bash
HZY_PLATFORM_SIGNING_PRIVATE_KEY=base64:<上一步输出>
```

然后重启 Platform：

```bash
pnpm --dir platform pm2:start
```

Cloudflare Worker 使用同一把私钥作为 secret：

```bash
printf 'base64:%s' "$(openssl base64 -A -in ~/.huizhi-yun/platform-keys/platform-signing-private.pem)" \
  | pnpm dlx wrangler@4 secret put HZY_PLATFORM_SIGNING_PRIVATE_KEY --config platform/wrangler.jsonc
```

不要把 `platform-signing-private.pem`、base64 后的私钥或 `.env` 提交到 git。Platform 启动后会优先复用 `platform_signing_keys` 中可解析私钥的 active key；若生产库还没有 active key，会用该 secret 派生公钥并自动登记一条 `private_key_ref=env:HZY_PLATFORM_SIGNING_PRIVATE_KEY` 的 active key。若 active key 指向的本地 PEM 文件在换机器后不可读，Worker 会在存在该 secret 时自动激活 secret 对应的新 key。本地非 production 开发进程可以自动生成临时本地 key；共享 `platform-dev` PM2 以 `NODE_ENV=production` 运行，必须显式配置不同于 prod 的 `HZY_PLATFORM_SIGNING_PRIVATE_KEY`。

### 同步共享 Console Cloudflare 参数

生产 Cloudflare Console 是 `managed-cloud-multitenant` 共享 Worker，不再绑定单个租户 deployment，也不消费租户 Runtime Token 或 license token。Platform 负责保存每个租户的 Console deployment settings，生成包含 `consoleLogin` 的签名 policy bundle；Console Worker 在收到 Tenant Gateway 请求后，用统一 Cloudflare internal token 按租户拉取 bundle。

不同字段的处理方式：

| 字段 | 类型 | Cloudflare 同步方式 | 何时需要更新 |
| --- | --- | --- | --- |
| `HZY_PLATFORM_SIGNING_KID` | 公开配置 | 写入 Wrangler vars，重新生成配置并部署 | 平台根签名密钥轮换 |
| `HZY_PLATFORM_SIGNING_PUBKEY` | 公开配置 | 写入 Wrangler vars，重新生成配置并部署 | 平台根签名密钥轮换 |
| `HZY_CLOUDFLARE_INTERNAL_TOKEN` | 敏感值 | Platform env / secret、Console Worker secret、Tenant Gateway Worker secret | 一方内部调用 token 首次配置或轮换 |

`HZY_CLOUDFLARE_INTERNAL_TOKEN` 同时用于 Gateway -> Platform registry、Console -> Platform bundle 和 Gateway -> Console 租户上下文证明。它不是租户 Runtime Token，也不是 Data Runtime Agent token。旧 `PLATFORM_INTERNAL_SERVICE_TOKENS`、`HZY_CONSOLE_PLATFORM_SERVICE_TOKEN`、`HZY_TENANT_GATEWAY_INTERNAL_TOKEN` 仍兼容读取，但新部署不再推荐拆分。

#### Console Worker 同步步骤

先确认 Platform 生产实例 `https://huizhi.yun` 已部署、可访问，并且配置了 Platform internal service token。然后在 Platform Dashboard 中进入部署管理，维护企业子域名、默认 Data Runtime Agent endpoint、Console 登录入口，并为对应租户生成包含 `consoleLogin` 的 policy bundle。

Console Worker 的公开配置只保留共享运行时参数：

```bash
export HZY_PLATFORM_URL=https://huizhi.yun
export HZY_CONSOLE_ACTIVATION_MODE=managed-cloud-multitenant
export HZY_PLATFORM_ENVIRONMENT=prod
export HZY_PLATFORM_SIGNING_KID=<platform-signing-kid>
export HZY_PLATFORM_SIGNING_PUBKEY='<platform-ed25519-public-pem>'
export HZY_DEPLOYMENT_PUBLIC_URL=https://console.huizhi.yun
export HZY_PLATFORM_BUNDLE_CACHE_SCOPE=managed-cloud-console
export HZY_CONSOLE_HYPERDRIVE_ID=<hzy-console-hyperdrive-id>
```

当前 Cloudflare 生产 Console 独占 `console.huizhi.yun`，因此需要设置 `HZY_CONSOLE_ROUTE_PATTERN=console.huizhi.yun`、`HZY_CONSOLE_ZONE_NAME=huizhi.yun` 和 `HZY_CONSOLE_CUSTOM_DOMAIN=true`。租户业务入口仍由 `<tenant>.huizhi.yun` 这类 Tenant Gateway 域名承接，不要把业务聚合域名写成 Console Worker 的独占 route。

```bash
pnpm --dir console run cloudflare:config
pnpm --dir console run build:cloudflare
pnpm dlx wrangler@4 deploy --config console/.wrangler.generated.jsonc
```

再写入共享 Worker secret：

```bash
pnpm dlx wrangler@4 secret put HZY_CLOUDFLARE_INTERNAL_TOKEN --config console/.wrangler.generated.jsonc
pnpm dlx wrangler@4 secret put HZY_CONSOLE_VAULT_MASTER_KEY --config console/.wrangler.generated.jsonc
pnpm dlx wrangler@4 secret put HZY_CONSOLE_DIAGNOSTICS_TOKEN --config console/.wrangler.generated.jsonc
pnpm dlx wrangler@4 secret put CONSOLE_AUTH_SIGNING_PRIVATE_JWK --config console/.wrangler.generated.jsonc
```

Tenant Gateway Worker 也必须配置同一个内部 token，并把 Console origin 指向共享 Console Worker：

```bash
pnpm dlx wrangler@4 secret put HZY_CLOUDFLARE_INTERNAL_TOKEN --config deploy/cloudflare/tenant-gateway/wrangler.jsonc
```

```text
HZY_CONSOLE_ORIGIN=https://console.huizhi.yun
```

#### 常见错误

如果 Console 激活页显示：

```text
console activation env missing: HZY_CLOUDFLARE_INTERNAL_TOKEN or HZY_CONSOLE_PLATFORM_SERVICE_TOKEN
```

说明缺的是共享 Worker secret，或 Platform 没有配置同值 token。分别在 Platform、Console Worker 和 Tenant Gateway Worker 上写入 `HZY_CLOUDFLARE_INTERNAL_TOKEN`，再重新发起租户域名请求。

如果报错缺少 `HZY_PLATFORM_SIGNING_KID` 或 `HZY_PLATFORM_SIGNING_PUBKEY`，说明缺的是 Console Worker 的公开 vars。按上面的步骤导出当前 Platform active signing key 的 public values，执行 `pnpm --dir console run cloudflare:config`，然后重新部署 Console Worker。

`HZY_PLATFORM_RUNTIME_TOKEN` 与 `HZY_PLATFORM_LICENSE_TOKEN` 只用于 PM2 / 私有单租户 Console。共享 Cloudflare Console 不配置 `HZY_PLATFORM_TENANT_CODE`、`HZY_PLATFORM_DEPLOYMENT_CODE`、`HZY_PLATFORM_RUNTIME_TOKEN` 或 `HZY_PLATFORM_LICENSE_TOKEN`；租户上下文来自带内部 token 的 Tenant Gateway 请求头。

### 服务器安装依赖

服务器首次安装建议使用仓库锁定的 pnpm 版本：

```bash
corepack enable
corepack prepare pnpm@10.32.1 --activate
pnpm install
```

pnpm 10 默认会拦截部分依赖的 postinstall 构建脚本。如果看到：

```text
ERR_PNPM_IGNORED_BUILDS
Ignored build scripts: @parcel/watcher, esbuild, unrs-resolver, vue-demi
```

需要拉取最新代码后重新执行 `pnpm install`。仓库已在 `package.json` 中显式允许这些 Nuxt/Vite 构建依赖执行安装脚本，避免服务器非交互环境必须运行 `pnpm approve-builds`。

### PM2 单独部署

`platform/ecosystem.config.cjs` 用于单独部署 Platform，不依赖仓库根目录的 `deploy/dev-stack`。默认读取 `platform/.env`，并监听 `127.0.0.1:3010`。`platform/.env.example` 只适合本地 greenfield / 临时单实例；`wiztek` 的生产 / 开发双实例必须使用 `.env.prod` / `.env.dev`，并配合 `platform/deploy/nginx/platform-wiztek.conf` 与 `platform/deploy/nginx/platform-wiztek.ssl.conf`。

本地临时单实例启动：

```bash
cd platform
cp .env.example .env
vim .env
pnpm install
pnpm run build
pnpm run pm2:start
pm2 save
```

常用命令：

```bash
pnpm run pm2:status
pnpm run pm2:logs
pnpm run pm2:start
pnpm run pm2:delete
```

如果需要临时改监听地址或端口：

```bash
HZY_PLATFORM_HOST=127.0.0.1 HZY_PLATFORM_PORT=3010 pnpm run pm2:start
```

#### 生产 / 测试双实例

长期形态下应使用两个 Platform 实例和两套 Platform DB：

| 实例 | DB | 端口 | env 示例 |
| --- | --- | --- | --- |
| `platform-prod` | `hzy_platform` | `3010` | `.env.prod.example` |
| `platform-dev` | `hzy_platform_dev` | `3011` | `.env.dev.example` |

生产 DB 保持 `hzy_platform`，只给开发控制面 DB 加 `_dev` 后缀。两套实例必须使用不同 `HZY_PLATFORM_SIGNING_PRIVATE_KEY`，且 strict 隔离门禁会静态解析 prod/dev 私钥为 Ed25519 并确认 Console prod/test 配置的 `HZY_PLATFORM_SIGNING_PUBKEY` 分别匹配对应 Platform 实例；不得复制生产 runtime token、license token 或 bootstrap secret 到开发库。

为了避免测试发布覆盖生产 `.output`，推荐在服务器上使用两个独立工作目录或 release 目录，例如：

```text
/srv/hzy/platform-prod
/srv/hzy/platform-dev
```

分别构建并启动：

```bash
cd /srv/hzy/platform-prod
cp .env.prod.example .env.prod
vim .env.prod
pnpm install
pnpm run build:prod
pnpm run pm2:start:prod

cd /srv/hzy/platform-dev
cp .env.dev.example .env.dev
vim .env.dev
pnpm install
pnpm run build:dev
pnpm run pm2:start:dev
```

即使在同一个 checkout 中临时验证，也不要并发运行 `build:prod` 和 `build:dev`，Nuxt / Nitro 会复用本地 cache，可能出现构建产物竞态。

`ecosystem.config.cjs` 会从 env 文件读取 `HZY_PLATFORM_PM2_NAME`、`HOST` 和 `PORT`，因此两个实例可以在同一台机器上同时运行。查看日志时使用具体 PM2 名称：

```bash
pnpm run pm2:logs:prod
pnpm run pm2:logs:dev
```

从仓库根目录可先静态校验 PM2 模板，不启动进程：

```bash
pnpm run validate:pm2-runtime -- \
  --platform-prod-env platform/.env.prod \
  --platform-dev-env platform/.env.dev
```

Cloudflare 发布门禁也纳入仓库侧预检查：

```bash
pnpm run validate:env-tracking
pnpm run validate:platform-env-isolation
pnpm run validate:platform-signing-readiness
pnpm run validate:console-runtime-disabled
pnpm run smoke:console-dev-runtime-disabled
pnpm run validate:console-runtime-cache-guardrails
pnpm run validate:runtime-isolation-docs
pnpm run validate:runtime-acceptance-strict
pnpm run validate:runtime-probe-guardrails
pnpm run validate:platform-cloudflare-guard
```

`validate:env-tracking` 会确认 `platform` / `console` 的真实运行 env 文件不被 git 跟踪，只保留 `*.example` 模板；`validate:platform-env-isolation` 会确认部署管理页在 `NUXT_PUBLIC_PLATFORM_STAGE=test` 时默认进入测试环境，tenant-admin 与 ops 两个 Policy Bundle 生成入口都会显式传递当前 environment，并确认 Tenant Gateway 的 Data Runtime static token 读取路径按 deployment environment 隔离；`validate:platform-signing-readiness` 会确认生产 Platform 启动和 runtime probe 仍要求 active Ed25519 signing private key 可用，避免等到测试 bundle 生成时才暴露 503；`validate:console-runtime-disabled` 会确认 `console-dev` / runtime-disabled 模式不会在 activation status、admin bundle refresh 或启动 bootstrap 中先读取 Platform 配置并返回 503；`smoke:console-dev-runtime-disabled` 会临时启动本地 Nuxt `console-dev` 并探测 activation status / diagnostics，证明实际 HTTP 200 且 Platform runtime 副作用关闭；`validate:console-runtime-cache-guardrails` 会用离线 fixture 回归 DB cache verifier，确认传错 DB、legacy unscoped key、payload deploymentCode 串环境和 prod/test bundle hash 碰撞都会被拒绝；`validate:runtime-isolation-docs` 会确认部署文档仍使用 `console-test` / `console-dev` 新命名、默认端口和 strict 验收入口；`validate:runtime-acceptance-strict` 会确认最终 strict 门禁不会接受缺失真实运行态、PM2 fixture、跳过公网 HTTP、Platform Cloudflare override 或 legacy unscoped cache 等捷径；`validate:runtime-probe-guardrails` 会用本地 diagnostics fixture 跑真实 probe，确认部署后 probe 仍会拒绝 prod/test/dev DB、PM2、端口、Platform URL、Platform signing kid、cache 和 bundle hash 串环境，并覆盖 `console-dev` runtime-disabled probe；`validate:platform-cloudflare-guard` 负责阻断 wiztek Platform 误发 Cloudflare。

本地维护验收脚本时可运行 `pnpm run verify:pm2-live:fixture` 回归 PM2 隔离校验；最终严格验收必须读取服务器真实 `pm2 jlist`。

部署后从服务器本机探测运行态，证明两个进程没有串库、串 URL、复用签名 key，且 active signing key 的私钥可读并能匹配公钥：

```bash
pnpm run probe:platform-runtime -- \
  --prod-url http://127.0.0.1:3010 \
  --dev-url http://127.0.0.1:3011
```

如果需要从非本机地址探测，先在 `.env.prod` / `.env.dev` 中配置不同的 `HZY_PLATFORM_DIAGNOSTICS_TOKEN`，再分别传入 token。诊断端点只返回非密钥字段，不返回私钥原文。

完整上线验收建议使用根目录统一入口，把 Platform runtime、Console runtime、env 隔离、PM2 / Nginx 模板、Platform Cloudflare 发布门禁、Console Cloudflare 配置、Console runtime cache DB 和 dev DB ready 校验串起来：

```bash
pnpm run accept:runtime-isolation -- --strict \
  --platform-prod-env platform/.env.prod \
  --platform-dev-env platform/.env.dev \
  --console-prod-env console/.env.prod \
  --console-test-env console/.env.test \
  --console-dev-env console/.env.dev \
  --platform-prod-url http://127.0.0.1:3010 \
  --platform-dev-url http://127.0.0.1:3011 \
  --console-prod-url http://127.0.0.1:3030 \
  --console-test-url http://127.0.0.1:3031 \
  --platform-prod-token-env PLATFORM_PROD_DIAGNOSTICS_TOKEN \
  --platform-dev-token-env PLATFORM_DEV_DIAGNOSTICS_TOKEN \
  --console-prod-token-env CONSOLE_PROD_DIAGNOSTICS_TOKEN \
  --console-test-token-env CONSOLE_TEST_DIAGNOSTICS_TOKEN \
  --console-db-host 127.0.0.1 \
  --console-db-user root \
  --console-db-password-env CONSOLE_DB_PASSWORD \
  --console-db hzy_console \
  --platform-dev-db-host 127.0.0.1 \
  --platform-dev-db-user root \
  --platform-dev-db-password-env PLATFORM_DEV_DB_PASSWORD \
  --platform-dev-db hzy_platform_dev \
  --platform-dev-db-mode ready \
  --platform-dev-db-expected-test-public-url https://hzy-test.wiztek.cn \
  --expected-test-deployment-code wiztek-test-console \
  --pm2-live \
  --public-routing \
  --public-routing-expected-server-ip 8.130.81.31 \
  --public-routing-platform-prod-url https://platform.wiztek.cn \
  --public-routing-platform-dev-url https://platform-dev.wiztek.cn \
  --public-routing-console-prod-url https://hzy.wiztek.cn \
  --public-routing-console-test-url https://hzy-test.wiztek.cn \
  --nginx-platform-conf /etc/nginx/conf.d/platform-wiztek.conf \
  --nginx-console-conf /etc/nginx/conf.d/console-wiztek.conf
```

`--strict` 会要求显式传入真实 env 文件，拒绝 tracked `*.example` env 文件，并要求真实运行态 URL、live PM2 校验、服务器实际 Nginx config 文件、公共 DNS / HTTP 路由校验、共享 Console DB 校验参数和 `hzy_platform_dev` ready 校验参数齐全；只做静态预检查时使用 `--static-only`，并且 `--strict` 与 `--static-only` 互斥。如果 Console prod 在 Cloudflare，追加 `--console-prod-cloudflare`，并把 `--nginx-console-conf` 换成 `--nginx-console-test-only-conf`；env 隔离校验会要求生产 Console 使用 `managed-cloud-multitenant`，且 `HZY_PLATFORM_TENANT_CODE`、`HZY_PLATFORM_DEPLOYMENT_CODE`、`HZY_PLATFORM_RUNTIME_TOKEN`、`HZY_PLATFORM_LICENSE_TOKEN` 都为空，由 Worker secrets 中的 `HZY_CLOUDFLARE_INTERNAL_TOKEN` 承接共享运行时信任，旧拆分 token 仅兼容。静态 PM2 校验会跳过不存在的生产 Console PM2 app，live PM2 校验会拒绝遗留的本机 `hzy-console-prod` 或指向 `huizhi-console` 的 prod PM2 进程，并保留 `--public-routing-expected-server-ip` 校验 Platform 与 `console-test` 固定国内服务器 IP；也可用 `--public-routing-expected-server-ip-env HZY_SERVER_PUBLIC_IP` 从环境变量读取 IP。如果真实 env 显示 Console prod/test 使用 DB runtime cache，`--strict` 会强制要求追加 `--console-db-require-prod-cache` 或 `--console-db-require-test-cache`，证明对应 scoped cache 行已落库。最终 `--strict` 不允许 fixture PM2、共享 release workdir、跳过公网 HTTP、允许 Platform Cloudflare 或允许 legacy unscoped Console runtime cache。

`plan:public-routing` 输出会包含 DNS A 记录、Nginx 模板选择、PM2 / 监听端口 upstream 检查、certbot 命令、证书 SAN 检查命令和后续 probe 命令；如果 `probe:public-routing` 输出 `ERR_TLS_CERT_ALTNAME_INVALID`，说明服务器当前证书没有覆盖该 hostname，需要重新签发 / 安装证书并 reload Nginx；如果输出 `502` / `503` / `504`，按提示检查对应 PM2 进程、监听端口、Nginx upstream 和下一步 `probe:server-upstreams` 命令。
在 PM2/Nginx 服务器上可直接运行 `pnpm run probe:server-upstreams`，一次性检查 `hzy-platform-prod` / `hzy-platform-dev` / `hzy-console-prod` / `hzy-console-test` 的 PM2 状态和 `127.0.0.1` upstream 可达性；如果生产 Console 在 Cloudflare，追加 `--console-prod-cloudflare`，跳过不存在的本机 `hzy-console-prod`。upstream 全部可达后，脚本会打印服务器实际 Nginx 配置校验、`nginx -t`、reload 和公网 probe 的下一步命令。
`pnpm run validate:public-routing-plan` 会在不访问公网的情况下校验公网路由参数语义和可打印 DNS / Nginx 切换计划，并用本地 TLS / HTTP fixture 回归证书 SAN 错误和 502 upstream 错误提示：`--expected-server-ip` 只约束 `platform-prod`、`platform-dev` 和 `console-test`，不约束 Cloudflare 上的 `console-prod`；`--expected-ip` 才约束全部四个域名。

Nginx 模板复制到服务器后，可额外校验实际文件：

```bash
pnpm run validate:nginx-routing -- --platform-conf /etc/nginx/conf.d/platform-wiztek.conf
sudo nginx -t
```

#### 初始化 `hzy_platform_dev`

`platform-dev` 可以从 `hzy_platform` 复制配置形状，但必须清理生产运行态材料。仓库提供 dry-run 默认的初始化工具：

```bash
export PLATFORM_PROD_DB_PASSWORD='生产库密码'
export PLATFORM_DEV_DB_PASSWORD='开发库密码'

pnpm --dir platform run db:init-dev:wiztek
```

该包装脚本默认从 `hzy_platform` 创建 / 迁移到 `hzy_platform_dev`，并把生产 `C000001-console` deployment 改写为 `wiztek-test-console` / `https://hzy-test.wiztek.cn`。默认只打印 dry-run 计划，不会创建、删除或导入数据库。

确认计划无误后再执行：

```bash
pnpm --dir platform run db:init-dev:wiztek -- --execute --drop-target
```

执行模式会调用底层 `db:init-dev` 完成建库、`mysqldump` 导入和敏感运行态清洗，并自动运行 `db:verify-dev -- --mode sanitized`。需要自定义主机、账号或 deployment code 时，可对包装脚本追加 `--source-host`、`--target-host`、`--source-user`、`--target-user`、`--source-deployment-code`、`--target-deployment-code`、`--target-public-url` 等参数。

底层工具也可以直接使用：

```bash
pnpm --dir platform run db:init-dev -- \
  --source-host oa.wiztek.cn \
  --source-user root \
  --source-password-env PLATFORM_PROD_DB_PASSWORD \
  --source-db hzy_platform \
  --target-host oa.wiztek.cn \
  --target-user root \
  --target-password-env PLATFORM_DEV_DB_PASSWORD \
  --target-db hzy_platform_dev
```

确认计划无误后再执行：

```bash
pnpm --dir platform run db:init-dev -- \
  --source-host oa.wiztek.cn \
  --source-user root \
  --source-password-env PLATFORM_PROD_DB_PASSWORD \
  --source-db hzy_platform \
  --target-host oa.wiztek.cn \
  --target-user root \
  --target-password-env PLATFORM_DEV_DB_PASSWORD \
  --target-db hzy_platform_dev \
  --drop-target \
  --execute
```

脚本会先复制数据库，再清理以下生产运行态：

- Platform signing keys
- runtime token hash
- licenses / license deployments
- policy bundles / revocation snapshots
- deployment bootstrap secrets
- heartbeat / connectivity check
- Platform sessions、activation tokens、API keys、webhooks、audit logs

初始化后先运行清洗态只读校验，确认从生产复制来的 signing key、runtime token、license、bundle、bootstrap secret、heartbeat 和 session 材料已经清空：

```bash
pnpm --dir platform run db:verify-dev -- \
  --host oa.wiztek.cn \
  --user root \
  --password-env PLATFORM_DEV_DB_PASSWORD \
  --db hzy_platform_dev \
  --mode sanitized
```

如果已经 seed 了 `console-test` deployment，可同时校验它存在，但此时仍属于清洗态校验：

```bash
pnpm --dir platform run db:verify-dev -- \
  --host oa.wiztek.cn \
  --user root \
  --password-env PLATFORM_DEV_DB_PASSWORD \
  --db hzy_platform_dev \
  --mode sanitized \
  --expected-test-deployment-code wiztek-test-console
```

如需把生产 `C000001-console` deployment 直接改写成共享测试 `console-test` deployment，可加显式参数：

```bash
pnpm --dir platform run db:init-dev -- \
  --source-host oa.wiztek.cn \
  --source-user root \
  --source-password-env PLATFORM_PROD_DB_PASSWORD \
  --source-db hzy_platform \
  --target-host oa.wiztek.cn \
  --target-user root \
  --target-password-env PLATFORM_DEV_DB_PASSWORD \
  --target-db hzy_platform_dev \
  --drop-target \
  --execute \
  --seed-console-test \
  --source-deployment-code C000001-console \
  --target-deployment-code wiztek-test-console \
  --target-site-code wiztek-test \
  --target-public-url https://hzy-test.wiztek.cn
```

初始化完成后，还必须在 `platform-dev` 内执行开发侧激活材料生成流程：确认 dev signing key、轮换租户 runtime token、重新签发 `console-test` license、重新生成 test policy bundle。不要从生产库复制 token 或 license 明文。

测试激活材料生成完成后，运行 ready 校验。该校验会确认 `console-test` deployment、active dev signing key、test runtime token、test license 和 test policy bundle 已存在，并用 active dev public key 验证 license / bundle 签名：

```bash
pnpm --dir platform run db:verify-dev -- \
  --host oa.wiztek.cn \
  --user root \
  --password-env PLATFORM_DEV_DB_PASSWORD \
  --db hzy_platform_dev \
  --mode ready \
  --expected-test-deployment-code wiztek-test-console \
  --expected-test-public-url https://hzy-test.wiztek.cn
```

如果 `console-test` 已启动并完成首次 heartbeat，可追加 `--require-heartbeat`，把 heartbeat 写入 `hzy_platform_dev` 也纳入门禁。

Nginx 80 端口配置：

```bash
sudo mkdir -p /var/www/certbot
sudo cp deploy/nginx/platform-wiztek.conf /etc/nginx/conf.d/platform-wiztek.conf
sudo nginx -t
sudo systemctl restart nginx.service
```

生成证书：

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d platform.wiztek.cn
sudo certbot certonly --webroot -w /var/www/certbot -d platform-dev.wiztek.cn
```

证书生成后，再把 Nginx 配置切换为 HTTPS 版本：

```bash
sudo cp deploy/nginx/platform-wiztek.ssl.conf /etc/nginx/conf.d/platform-wiztek.conf
sudo nginx -t
sudo systemctl reload nginx
```

### Cloudflare Workers Assets 上传错误

如果发布时报错：

```text
assets-upload-session failed
entitlements.not_available [code: 10007]
```

说明构建已经完成，失败发生在 Wrangler 上传 `.output/public` 静态资源阶段。当前 `wrangler.jsonc` 使用 Workers Static Assets：

```json
"assets": {
  "directory": ".output/public",
  "binding": "ASSETS"
}
```

Cloudflare 会把 Worker 代码和静态资源作为一次部署上传；这一步依赖 Cloudflare Dashboard / API 写接口。`entitlements.not_available [code: 10007]` 通常需要按下面顺序判断：

处理方式：

- 先查看 Cloudflare System Status。如果 Dashboard / API 正在故障、降级或影响创建/修改服务，等待恢复后再按例外发布流程重新执行 `HZY_ALLOW_PLATFORM_CLOUDFLARE_DEPLOY=true pnpm --filter platform deploy:cloudflare`。
- 如果 Cloudflare 状态已恢复但仍稳定复现，再检查当前账号是否支持 Workers Static Assets，必要时在 Cloudflare 账号侧开通或切换到支持该能力的账号。
- 不要直接删除 `wrangler.jsonc` 中的 `assets` 配置；这样即使 Worker 上传成功，Nuxt 的 `/_nuxt/*` 静态 JS/CSS 也无法正常服务。
- 如果账号暂时无法使用 Workers Static Assets，可改用 Cloudflare Pages 路线：`nuxt build --preset=cloudflare-pages` 后发布 `platform/dist`。这属于另一套部署形态，Hyperdrive、变量、域名需要在 Pages 项目中重新配置。
