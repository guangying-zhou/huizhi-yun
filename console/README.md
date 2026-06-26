# Console

客户侧基础运行服务，基于 `@hzy/foundation` Nuxt Layer，默认端口 `3000`，数据库 `hzy_console`。

## 职责

- `org-profile`：企业基础资料、业务域、区域
- `system-settings`：系统参数、参数值、基础字典
- `integration-config`：GitLab / AI / 企业微信 / OIDC / OSS 等外部集成配置
- `credential-vault`：secret 元数据、版本、轮换、受控 reveal / resolve
- `service clients`：本地服务凭证签发、轮换和授权

## 开发

```bash
pnpm install
cp .env.dev.example .env.dev
pnpm dev
pnpm typecheck
pnpm lint
```

根目录可用：

```bash
pnpm dev:console
```

访问：http://localhost:3000

## 生产 / 测试 / 本地开发

Console 当前按三类实例运行：

| 实例 | 作用 | 默认端口 | Platform |
| --- | --- | --- | --- |
| `console-prod` | 生产 runtime | `3030` | `platform-prod` |
| `console-test` | 共享集成和端到端测试 runtime | `3031` | `platform-dev` |
| `console-dev` | 开发人员本地实例 | 本地 Nuxt 端口 | 默认不注册 Platform runtime |

命名约定：共享集成环境统一叫 `console-test`；开发人员本地实例统一叫 `console-dev`，不再使用 `local-dev` 作为正式实例名。

环境样例：

- `.env.prod.example`：生产 PM2 或 Cloudflare Worker。
- `.env.test.example`：共享测试 PM2，连接 `https://platform-dev.wiztek.cn`。
- `.env.dev.example`：本地开发，默认关闭 Platform runtime、heartbeat、启动 bundle refresh、auth client 物化、后台 job 和 embedded Collab runtime。
- `.env.example`：保留给 `console-dev` 的安全本地默认值；不要作为生产或共享测试 env 使用。
- `.env.cloudflare.example`：生产 Console on Cloudflare Worker 的非 secret 配置样例；真实 `.env.cloudflare` 只保留在部署机。

本地 `console-dev` 不需要 Platform license。`HZY_CONSOLE_DEV_POLICY_BYPASS=true`
且 `HZY_PLATFORM_RUNTIME_ENABLED=false` 时，工作台的“我的应用”和左侧 AppRail 会使用 Foundation 提供的本地开发默认入口：
Codocs `3001`、Aims `3002`、Altoc `3003`、Assets `3004`、Finance `3006`、
Workflow `3020`、Insights `3009`。业务应用本地开发时也复用同一套清单；如需覆盖，设置 `HZY_DEV_APPLICATIONS`
为 JSON 数组。`HZY_CONSOLE_DEV_APPLICATIONS` 仍作为旧别名兼容，例如：

```env
HZY_DEV_APPLICATIONS='[{"appCode":"codocs","appName":"汇智云文档","icon":"i-lucide-files","homeUrl":"http://localhost:3001/codocs/"}]'
```

PM2 部署：

```bash
cp .env.prod.example .env.prod
pnpm run build:prod
pnpm run pm2:start:prod

cp .env.test.example .env.test
pnpm run build:test
pnpm run pm2:start:test
```

服务器部署时建议 `console-prod` 与 `console-test` 使用独立 release/workdir。即使在同一个 checkout 中临时验证，也不要并发运行 `build:prod`、`build:test` 或本地 `build:dev`，Nuxt / Nitro 会复用本地 cache，可能出现构建产物竞态。

从仓库根目录可先校验 prod/test/dev 隔离 env：

```bash
pnpm run validate:env-tracking
pnpm run validate:console-runtime-disabled
pnpm run smoke:console-dev-runtime-disabled
pnpm run validate:runtime-isolation-docs
pnpm run validate:runtime-acceptance-strict
pnpm run validate:runtime-probe-guardrails
pnpm run validate:runtime-isolation
```

`validate:env-tracking` 会确认真实 `.env` / `.env.prod` / `.env.test` / `.env.cloudflare` 不被 git 跟踪，只允许提交 `.env.dev` 开发默认配置和 `*.example` 模板。`validate:console-runtime-disabled` 会确认 `console-dev` / runtime-disabled 模式下 activation status、admin bundle refresh 和启动 bootstrap 都会先短路，不会先读取 Platform runtime 配置并返回 503。`smoke:console-dev-runtime-disabled` 会临时启动一个本地 Nuxt `console-dev`，访问 activation status 和 diagnostics，确认 runtime-disabled 场景实际返回 HTTP 200 且 Platform runtime、heartbeat、bundle refresh、auth client 物化、后台 job 与 Collab 都处于关闭状态。`validate:runtime-isolation-docs` 会确认部署文档里 `console-test` / `console-dev` 命名、默认端口和 strict 验收入口没有退回旧口径。`validate:runtime-acceptance-strict` 会确认最终 `accept:runtime-isolation -- --strict` 不会接受缺失真实运行态、PM2 fixture、跳过公网 HTTP、Platform Cloudflare override 或 legacy unscoped cache 等捷径。`validate:runtime-probe-guardrails` 会用本地 diagnostics fixture 跑真实 probe，确认部署后 probe 仍会拒绝 prod/test/dev DB、PM2、端口、Platform URL、Platform signing kid、cache 和 bundle hash 串环境，并覆盖 `console-dev` runtime-disabled probe。`validate:runtime-isolation` 会检查 Platform URL、deploymentCode、cache dir / scope、legacy cache fallback、Tenant Gateway trust、Collab mode 和本地开发副作用开关，并额外确认 `console/.env.example` 仍是安全 `console-dev` 默认值。`console-test` 不允许因为空配置隐式启动 embedded Collab；如果显式打开 embedded，必须使用独立 `COLLAB_PORT` 和显式 `COLLAB_DB_NAME`，且不得把 Collab DB 指向 `hzy_console`。

从仓库根目录可先静态校验 PM2 模板，不启动进程：

```bash
pnpm run validate:pm2-runtime -- \
  --console-prod-env console/.env.prod \
  --console-test-env console/.env.test
```

启动后可校验真实 PM2 进程和 release 目录：

```bash
pnpm run verify:pm2-live -- \
  --console-prod-env console/.env.prod \
  --console-test-env console/.env.test
```

如果生产 Console 在 Cloudflare，追加 `--console-prod-cloudflare`，只校验服务器上的 `console-test`、`platform-prod` 和 `platform-dev` PM2 进程，并拒绝遗留的本机 `hzy-console-prod` 或指向 `huizhi-console` 的 prod PM2 进程。
同一参数也适用于 `validate:pm2-runtime`，此时静态 PM2 模板校验会跳过不存在的 `console-prod` PM2 app，但仍校验 `platform-prod`、`platform-dev` 和 `console-test`。

PM2 静态和 live 校验都会检查 Console prod/test 的 runtime 副作用开关，确保 prod/test 开启 runtime、heartbeat、bundle refresh、auth client materialization、background jobs，并关闭 `HZY_CONSOLE_DEV_POLICY_BYPASS`、`HZY_CONSOLE_TRUST_TENANT_GATEWAY` 和 legacy cache fallback。共用 `hzy_console` 时，`console-prod` 使用 `HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE=upsert`，`console-test` 使用 `append`，只给已有 OIDC client 追加测试回调 URI，不创建新的 active client，也不 prune 或覆盖生产 `auth_clients`。

PM2 默认样例让 `console-prod` 启动 embedded Collab runtime，固定 `COLLAB_PORT=3021` 且使用 `COLLAB_DB_NAME=hzy_codocs`；`console-test` 默认 `CONSOLE_COLLAB_MODE=disabled`，避免同机第二个 Console 实例争用 embedded Collab 端口。需要对 Collab 做共享测试时，先改为外部 Collab 服务，或给测试实例显式配置独立 `COLLAB_PORT` / `COLLAB_DB_*` 后再打开 embedded。

`probe:console-runtime` 会通过运行中的 diagnostics endpoint 复核 DB 名、public URL、Platform URL、deploymentCode、cache backend / scope、activation / bundle ready 状态、prod/test bundle hash 差异、Collab mode / status、auth client materialize mode、OIDC signing key 自动化开关，以及 prod/test 当前 OIDC signing private key 是否可用，避免部署后的 PM2 / Worker runtime env 与静态 env 文件不一致。

共用 `hzy_console` 也意味着 `auth_signing_keys` 是共享 auth runtime 状态。prod/test/dev 默认必须设置 `CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE=false` 和 `CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE=false`，避免测试或本地实例因为读不到私钥而自动轮换生产 OIDC signing key。首次初始化或计划轮换时运行 `pnpm run cloudflare:oidc-key`，执行输出 SQL，并把 private JWK 配置到需要签发 OIDC token 的 PM2 env 或 Worker secret。

本地维护验收脚本时可在仓库根目录运行 `pnpm run verify:pm2-live:fixture` 回归 PM2 校验逻辑；最终严格验收必须读取服务器真实 `pm2 jlist`。
最终 `accept:runtime-isolation -- --strict` 不允许 `--allow-shared-pm2-cwd`、`--public-routing-skip-http`、`--allow-platform-cloudflare` 或 `--console-db-allow-legacy-unscoped`，避免把临时排查路径当成正式上线通过。

Nginx 模板位于 `deploy/nginx/console-wiztek.conf` 和 `deploy/nginx/console-wiztek.ssl.conf`，默认将 `hzy.wiztek.cn` 代理到 `127.0.0.1:3030`，将 `hzy-test.wiztek.cn` 代理到 `127.0.0.1:3031`。如果生产 Console 部署在 Cloudflare，使用 `deploy/nginx/console-test-only.conf` 和 `deploy/nginx/console-test-only.ssl.conf`，只代理 `hzy-test.wiztek.cn`。
复制到服务器后，可用 `pnpm run validate:nginx-routing -- --console-conf /etc/nginx/conf.d/console-wiztek.conf` 校验实际文件；Console prod on Cloudflare 时改用 `--console-test-only-conf`。

如果生产 Console 部署在 Cloudflare，从仓库根目录运行：

```bash
cp console/.env.cloudflare.example console/.env.cloudflare
pnpm run validate:console-cloudflare -- --env-file console/.env.cloudflare
```

最终上线门禁会追加 `--strict-env`，要求 `.env.cloudflare` 中的非 secret Cloudflare / Platform public activation values 已填充且不是占位值，其中 `HZY_PLATFORM_SIGNING_PUBKEY` 必须是可解析的 Ed25519 public PEM；统一 Cloudflare internal token、vault master key、diagnostics token 和私钥必须走 Worker secrets。上游员工登录配置由 Platform deployment settings 写入签名 policy bundle。
该校验会确认 Worker 配置生成器强制 `console.huizhi.yun -> huizhi.yun -> managed-cloud-console -> hzy_console`、`HZY_CONSOLE_ACTIVATION_MODE=managed-cloud-multitenant`、DB cache scoped key，拒绝 legacy unscoped cache fallback / 旧 Tenant Gateway 无 token 信任 / dev 或 test runtime flags / embedded Collab / signing key 自动化，并且不会把 tenant runtime token、license token、统一 Cloudflare internal token、legacy Platform service token、legacy Tenant Gateway token、vault master key、diagnostics token 或私钥写入 wrangler vars。
隔离门禁使用 `validate:runtime-isolation -- --console-prod-cloudflare` 或 `accept:runtime-isolation -- --console-prod-cloudflare` 时，都会按 Cloudflare 语义校验生产 Console env：未显式传生产 Console env 时静态门禁默认使用 `.env.cloudflare.example`；严格上线验收应传真实 `.env.cloudflare`。Cloudflare 共享 Console 不配置 `HZY_PLATFORM_TENANT_CODE`、`HZY_PLATFORM_DEPLOYMENT_CODE`、`HZY_PLATFORM_RUNTIME_TOKEN` 或 `HZY_PLATFORM_LICENSE_TOKEN`，租户上下文来自携带内部 token 的 Tenant Gateway 请求头。
prod/test/dev 默认设置 `HZY_CONSOLE_TRUST_TENANT_GATEWAY=false`；共享 Cloudflare Console 只信任 `HZY_CLOUDFLARE_INTERNAL_TOKEN` 或兼容 `HZY_TENANT_GATEWAY_INTERNAL_TOKEN` 校验通过后的 Tenant Gateway 请求头。

多个开发人员可以各自运行 `console-dev`。标准本地模式使用 `.env.dev`，不会注册 Platform deployment、不会 heartbeat、不会写共享 Platform runtime cache，并且 `CONSOLE_COLLAB_MODE=disabled` 避免启动 embedded Collab runtime；需要联调 Collab 或 Platform runtime 时，应使用共享 `console-test`，或临时创建个人 deployment / cache scope 后再显式打开相关开关。

注意：`console-dev` 默认隔离的是 Platform runtime 副作用，不隔离共享业务数据。它连接 `hzy_console` 时，登录态、普通页面保存、管理配置、目录 / 集成 / 凭证相关手工操作仍会写共享 DB。日常页面和接口开发可以共库；破坏性 migration、批量写入、目录同步、凭证轮换、auth-runtime 协议和稳定端到端测试应使用个人本地 DB 或共享 `console-test`。

如果生产或测试使用 DB runtime cache，上线后再做共享 DB cache 校验：

```bash
pnpm run verify:console-runtime-cache -- \
  --db hzy_console \
  --user root \
  --password-env CONSOLE_DB_PASSWORD
```

该命令只读检查 `console_runtime_cache` scoped key，默认拒绝旧无 scope 的 `policy_bundle` / `activation_status`。
如果 prod/test 使用 DB cache 且要求对应 scoped key 已落库，再追加 `--require-prod-cache` 或 `--require-test-cache`；最终 `accept:runtime-isolation -- --strict` 会根据 env 自动强制要求这些参数。该校验还会确认传入的 `--db` 与 prod/test env 的 `DB_NAME` 一致，并拒绝 prod/test scoped cache rows 复用同一个 bundle hash。
本地维护该 verifier 时可运行 `pnpm run validate:console-runtime-cache-guardrails`，用离线 fixture 回归正常 scoped cache、传错 DB、legacy unscoped key、payload deploymentCode 串环境和 prod/test bundle hash 碰撞。
运行时 DB cache 也会拒绝无 scope 配置：必须设置 `HZY_PLATFORM_BUNDLE_CACHE_SCOPE` 或 `HZY_PLATFORM_DEPLOYMENT_CODE`，否则不会读写 legacy unscoped `policy_bundle` / `activation_status` key。

部署后从仓库根目录运行：

```bash
pnpm run probe:console-runtime -- \
  --prod-url http://127.0.0.1:3030 \
  --test-url http://127.0.0.1:3031
```

公网探测时，生产和测试应使用不同诊断 token：

```bash
pnpm run probe:console-runtime -- \
  --prod-url https://hzy.wiztek.cn \
  --test-url https://hzy-test.wiztek.cn \
  --prod-token-env CONSOLE_PROD_DIAGNOSTICS_TOKEN \
  --test-token-env CONSOLE_TEST_DIAGNOSTICS_TOKEN
```

上线后还应校验公网 DNS / HTTP 路由：

```bash
pnpm run plan:public-routing -- --server-ip-env HZY_SERVER_PUBLIC_IP
pnpm run probe:public-routing -- --expected-server-ip 8.130.81.31
```

如果生产 Console 在 Cloudflare，生成计划时追加 `--console-prod-cloudflare`。
`plan:public-routing` 输出会包含 DNS A 记录、Nginx 模板选择、PM2 / 监听端口 upstream 检查、certbot 命令、证书 SAN 检查命令和后续 probe 命令；如果 `probe:public-routing` 输出 `ERR_TLS_CERT_ALTNAME_INVALID`，说明服务器当前证书没有覆盖该 hostname，需要重新签发 / 安装证书并 reload Nginx；如果输出 `502` / `503` / `504`，按提示检查对应 PM2 进程、监听端口、Nginx upstream 和下一步 `probe:server-upstreams` 命令。
在 PM2/Nginx 服务器上可直接运行 `pnpm run probe:server-upstreams`，一次性检查 `hzy-platform-prod` / `hzy-platform-dev` / `hzy-console-prod` / `hzy-console-test` 的 PM2 状态和 `127.0.0.1` upstream 可达性；如果生产 Console 在 Cloudflare，追加 `--console-prod-cloudflare`，跳过不存在的本机 `hzy-console-prod`。upstream 全部可达后，脚本会打印服务器实际 Nginx 配置校验、`nginx -t`、reload 和公网 probe 的下一步命令。
`--expected-server-ip` 校验必须落到国内服务器的 `platform-prod`、`platform-dev` 和 `console-test`。如果生产 Console 也在同一台 PM2/Nginx 服务器上，可改用 `--expected-ip` 校验全部四个域名。
也可以使用 `--expected-server-ip-env HZY_SERVER_PUBLIC_IP` 从环境变量读取固定 IP。
`pnpm run validate:public-routing-plan` 会在不访问公网的情况下证明这个参数语义和可打印 DNS / Nginx 切换计划没有退化，并用本地 TLS / HTTP fixture 回归证书 SAN 错误和 502 upstream 错误提示，避免 Console prod on Cloudflare 时误把 `console.huizhi.yun` 也要求解析到国内服务器。

## App Manifest

- `app.manifest.json` 是 Console 的平台注册声明。
- manifest 文件不声明版本；Platform 使用 GitLab release/tag 作为注册版本。
- `app/config/permissions.ts` 从该文件派生 `appCode` 和资源清单，避免应用自身权限定义与 Platform 注册声明不一致。

## 文档

- `docs/hzy_console_schema.sql`
- `../docs/Console-Functional-Design-v1.md`
- `../docs/Console-API-Contract-v1.md`
- `../docs/Console-Bootstrap-and-Rotation-Sequence-v1.md`
