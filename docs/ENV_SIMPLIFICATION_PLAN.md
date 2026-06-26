# 平台环境变量收敛方案

状态：Implemented checkpoint
日期：2026-05-16

## 目标

Console 是企业端核心运行模块，负责对接 Platform，并向业务应用提供平台级参数、目录、认证、系统设置、集成配置和凭证解析能力。业务应用的本地环境变量应尽量少，避免每个应用重复配置同一批平台地址、第三方密钥和跨模块服务凭证。

目标形态：

- Console 消费 Platform 生成的 `console.env`；其中直接包含 `HZY_PLATFORM_LICENSE_TOKEN`。
- 业务应用本地只保留业务数据库、应用身份、部署 base path；不再下发或读取 app 级 `license.lic`。
- 业务应用启动时通过 Foundation `consoleRuntime.ts` 从 Console 获取 app runtime config，不再读取 app license 派生 Console 地址、appCode 或 Platform runtime 参数。
- 业务应用通过 Console runtime token / app identity 获取短期 service token；特殊离线部署才显式配置 service client。
- Console 统一提供 `system-settings`、`integration-config`、`credential-vault`、`directory-runtime`、`auth-runtime`。
- 业务应用不再在 `.env` 保存 OSS、GitLab、企业微信、AI Provider、Workflow 地址、Account API Key 等平台级配置。

统一网关模式下的本地端口约定：

| 路径 | 服务 | 本地端口 |
| --- | --- | --- |
| `/` | Console | 3000 |
| `/codocs/` | Codocs | 3001 |
| `/aims/` | Aims | 3002 |
| `/altoc/` | Altoc | 3003 |
| `/assets/` | Assets | 3004 |
| `/finance/` | Finance | 3006 |
| `/workflow/` | Workflow | 3020 |
| `/codocs/ws`、`/collab/` | Collab Runtime（默认 Console 内嵌） | 3021 |

## 配置分层

### Platform

Platform 只面向运营侧和 Console onboarding，负责生成 Console 激活材料：

- `HZY_PLATFORM_URL`
- `HZY_PLATFORM_TENANT_CODE`
- `HZY_PLATFORM_DEPLOYMENT_CODE`
- `HZY_PLATFORM_RUNTIME_TOKEN`
- `HZY_PLATFORM_SIGNING_KID`
- `HZY_PLATFORM_SIGNING_PUBKEY`
- `HZY_PLATFORM_LICENSE_TOKEN`

这些变量只应出现在 Console 部署环境中。业务应用不应逐个配置 Platform runtime token，也不再通过 Foundation startup activation 直连 Platform；需要的运行时参数由 Console runtime config 提供。

### Console

Console 保留企业端基础运行配置：

- Console 自身数据库：`DB_*`
- Platform 激活材料：`HZY_PLATFORM_*`
- Console vault master key：`HZY_CONSOLE_VAULT_MASTER_KEY`
- Console-managed Collab Runtime：`CONSOLE_COLLAB_MODE`、`HZY_TENANT_RUNTIME_URL` / `COLLAB_CODOCS_RUNTIME_URL`、迁移期 `COLLAB_REDIS_*`、`COLLABORATION_AUTH_SECRET`；OSS 持久化默认从 Console `oss.default` 集成配置和 vault secret 注入，standalone/迁移期才使用 `COLLAB_OSS_*`
- 迁移期上游认证源：`CAS_*`、LDAP、企业微信/钉钉集成初始化材料

第三方集成和 secret 进入 Console 后，应通过 Console 管理页写入 `integrations + vault`，不再分发到业务应用 env。

### 业务应用

业务应用建议保留：

- `DB_*`
- `HZY_APP_CODE`
- `HZY_APP_BASE_PATH` / `NUXT_APP_BASE_URL`
- `HZY_DEPLOYMENT_PUBLIC_URL`
- `HZY_DEPLOYMENT_PROFILE`
- 本应用专有迁移源配置，例如 Finance 的 `HZY_WIZBIZDB_*`
- 本地开发临时开关，例如 `HZY_AUTH_MODE=legacy`、`HZY_*_DEV_PERMISSIONS`

说明：当前不把业务数据库密码放入 Console runtime config。runtime config 是非 secret 启动配置，不能下发 DB password；DB 参数迁入 Console 需要先建立专门的数据库凭证模型、vault secret、app identity/service token 校验和异步 DB pool 初始化，否则会形成“应用需要 DB 才能启动，启动又要先访问 Console 取 DB secret”的不稳定链路。

Cloudflare 托管部署下，业务应用使用 profile 区分数据库访问模式：

- `managed-cloud-agent`：目标主推模式，Cloudflare 应用通过客户侧 Data Runtime Agent 访问企业自管数据库。
- `managed-cloud-direct-db`：过渡模式，Cloudflare 应用通过 Hyperdrive 直连客户数据库；当前 CF 生成脚本默认采用该模式，仍需要本应用的 `HZY_<APP>_HYPERDRIVE_ID`。
- `managed-cloud-d1`：后续面向轻量和海外场景的 D1 托管模式。
- `self-hosted` / `dev`：不属于 Cloudflare 托管生成脚本的目标输出，分别用于企业完整自部署和本地开发。

Platform 是平台控制面，不纳入 Data Runtime Agent 覆盖范围；Platform 侧用 `platform-cloud-db`、`platform-self-hosted-db`、`platform-d1` 表达自身数据库部署模式。

业务应用应删除或逐步删除：

- `HZY_CONSOLE_API_URL` / `HZY_CONSOLE_URL`：默认由模板和 `consoleRuntime.ts` 使用本地 `localhost:3000` / 统一网关推导；生产特殊拓扑才显式配置。
- `HZY_WORKFLOW_API_URL`：通过 Console `system-settings` 的 `workflow.apiUrl` 读取。
- `HZY_ACCOUNT_API_URL` / `HZY_ACCOUNT_API_KEY` / `HZY_ACCOUNT_API_SECRET`：迁移期 only；新目录能力走 Console Directory Runtime。
- `ALIYUN_OSS_*`、`GITLAB_*`、`WECOM_*`、`DINGTALK_*`、`AI_*`：进入 Console `integration-config + vault`，业务应用只配置 `integrationCode` 或使用默认 code。
- `HZY_SERVICE_CLIENT_ID` / `HZY_SERVICE_CLIENT_SECRET`：优先由 Console runtime token / app identity 提供；只有特殊离线部署才显式配置。
- `HZY_PLATFORM_URL` / `HZY_PLATFORM_RUNTIME_TOKEN` / `HZY_PLATFORM_SIGNING_*`：业务应用不直接持有，也不从 Console runtime config 下发；Platform 只由 Console 对接。

## 当前代码现状

已具备的基础能力：

- Foundation `consoleRuntime.ts` 可在业务应用启动时从 Console 拉取 app runtime config，包括 Console API 端点、应用元数据、Workflow 地址与非 secret 运行时信息。
- Foundation `licenseBootstrap.ts` 仅保留为 legacy 诊断 helper，不再参与 `serviceOidc.ts` 的默认服务令牌路径。
- Foundation `serviceOidc.ts` 在缺少本地 service client secret 时会直接报配置错误，不再回退读取 `license.lic`。
- Foundation `runtimeSettings.ts` 可从 Console 读取 `system-settings`。
- Foundation `workflowRuntime.ts` 已支持从 Console `workflow.apiUrl` 解析 Workflow 地址。
- Foundation `integrationConfig.ts` 已支持从 Console 读取 integration 配置并按授权 resolve vault secret。
- Foundation `platformActivationRuntime.ts` 已对业务应用默认关闭；Platform activation、bundle 刷新和 heartbeat 只由 Console 执行。

已落地调整：

- `deploy/cloudflare/render-nuxt-worker-config.mjs` 已抽出业务应用 Cloudflare Worker 配置生成器，统一写入 `HZY_DEPLOYMENT_PROFILE` / `NUXT_PUBLIC_DEPLOYMENT_PROFILE`，并按 profile 决定是否要求 Hyperdrive 绑定。
- Finance、Assets、Altoc、Aims、Workflow、Codocs 的 CF 生成脚本已收敛到 profile + public URL + app base path + DB 连接模式参数；默认不再输出 `HZY_PLATFORM_URL`、`HZY_CONSOLE_URL`、`HZY_CONSOLE_API_URL`、`NUXT_PUBLIC_CONSOLE_URL`、`NUXT_PUBLIC_ACCOUNT_URL`、`HZY_AUTH_MODE`、`HZY_LEGACY_AUTH_BRIDGE`、`HZY_CONSOLE_RUNTIME_ENABLED`、`HZY_DIRECTORY_PROVIDER`、`HZY_WORKFLOW_API_URL`。
- Console 的 CF 生成脚本保留 `HZY_PLATFORM_*` 与 Console 自身 URL/认证参数，因为 Console 仍负责对接 Platform 并向业务应用提供运行配置；Platform 的 CF profile 独立设为 `platform-cloud-db`。
- `nuxt-template`、`finance`、`assets`、`altoc`、`aims`、`workflow`、`codocs` 已不再从 app license 派生启动期 `appCode` / `consoleUrl` / `tokenUrl`；Console 地址由 env 或开发默认值提供，运行期配置由 `consoleRuntime.ts` 拉取。
- `nuxt-template`、`finance`、`assets`、`altoc`、`aims`、`workflow`、`codocs` 的 Nuxt runtime config 已移除旧 Account API key、Workflow URL、CAS、OSS、GitLab、企业微信、`HZY_PLATFORM_LICENSE_PATH` 等平台级 env 槽位；业务应用本地 env 收敛到 app identity/base path、业务 DB 和少量专属迁移源配置。
- `assets`、`altoc` 的审批动作同步已改用 Foundation 的 Console service token 机制，不再依赖本地 Workflow API key/secret。
- `codocs` 的 Nuxt 服务端 OSS、GitLab、企业微信集成已迁到 Console `integration-config + credential-vault`；OSS 默认、项目文档、图片 bucket 分别由 `bucketName/projectsBucketName/imagesBucketName` 等字段承接；Aims 与 Altoc 调用 Codocs v1 文档 API 已改用 Console service token。
- `assets`、`altoc`、`aims`、`nuxt-template` 已移除本地 CAS callback/login 路由，默认通过 Foundation/Console OIDC 登录入口；`workflow`、`codocs` 不再暴露业务应用级 CAS runtime env。
- `aims`、`workflow`、`codocs` 的权限接口已去掉业务应用直连 Platform runtime authorizations 的 fallback；本地 bundle 缺失时返回空权限，后续由 Console runtime/app identity 机制补齐。

仍需保留或后续处理的存量项：

- Platform 不再为业务应用生成 `license.lic`；Console 的签名 license 以 `HZY_PLATFORM_LICENSE_TOKEN` 写入 Console env，业务应用服务调用统一走 Console service token。
- Collab Runtime 已从 Codocs 模块拆出为可复用 `collab` runtime 包，并由 Console 默认内嵌启动，仍监听 3021 供统一网关转发；standalone 模式保留用于独立扩容或迁移期并行部署。当前默认 provider 为 hocuspocus，内嵌模式已从 Console `oss.default` resolve 服务端 OSS 配置并按文档类型选择默认 bucket 或项目文档 bucket；Redis 与协作 WebSocket secret 后续继续迁到 Console managed secret。
- Altoc 文档创建、已有文档校验与预览已统一切到 Codocs v1 service-token API；前端打开编辑器仍使用 Console runtime/统一网关推导出的 Codocs home URL。
- Insights Python 后端中心配置已去掉生产形态的默认数据库地址、默认数据库密码和默认平台密钥；但 Insights 仍是较独立的 legacy 形态，Nuxt 前端、FastAPI 后端、采集脚本和 GitLab/Account 配置需要单独迁移到 Foundation/Console runtime。
- 业务数据库凭证如需迁入 Console，应新增 `database_runtime` 或 `integrationCode=database.{appCode}` 口径：Console vault 保存 DB password，业务应用通过稳定 app identity 换取仅本应用可用的 DB credential，并把各模块 `server/utils/db.ts` 改为异步初始化和带缓存/轮换的连接池。

本轮复核结论：

| 存量项 | 当前处理 | 后续前置条件 |
| --- | --- | --- |
| Altoc→Codocs 文档接口 | 已迁到 Codocs v1 service-token API，移除旧 Cookie 透传调用 | 无 |
| Collab Runtime | `collab` 包默认由 Console 内嵌启动；Codocs 上下文通过 tenant-runtime 获取；OSS 配置已与 Codocs Nuxt 服务共用 Console `oss.default` resolved secret，standalone/迁移期保留 `COLLAB_OSS_*`；暂保留 `CONSOLE_COLLAB_MODE`、`COLLAB_REDIS_*`、协作鉴权 secret | Redis 与协作鉴权 secret 仍需要 Console managed-secret/bootstrap 收口 |
| Insights | 先去掉 Python 后端中心配置中的敏感默认值；暂不迁 Nuxt/FastAPI/脚本入口 | 需要把 Insights 纳入 app manifest/Foundation 层，定义 GitLab integration code、Account/Directory 替代 API 和采集脚本的服务身份 |
| 业务数据库凭证 | 暂保留各应用 `DB_*` | 需要 Console `database_runtime`/vault 模型和应用侧异步连接池初始化 |

## 推荐迁移顺序

1. **新模块基线**：所有新模块从 `nuxt-template` 开始，只配置 DB、app identity、base path；跨模块服务调用统一走 Console service token。
2. **Finance**：保持当前轻量 env；后续接入 Workflow、钉钉/企业微信、OSS 时一律经 Console integration。
3. **Assets / Altoc**：审批动作同步和 Altoc→Codocs 文档接口已改用 Console service token；继续清理仅 legacy Account bridge 需要的配置。
4. **Codocs / Collab**：Codocs 的 OSS、GitLab、企业微信通知迁到 Console integration/vault；Collab Runtime 默认由 Console 内嵌启动，OSS 持久化使用同一份 `oss.default`，继续收口 Redis 与协作鉴权 secret。
5. **认证收口**：业务应用移除 `CAS_*` 和 legacy callback，默认走 Console OIDC。
6. **App license 清理**：已停止生成业务应用 `license.lic`；后续只清理存量部署文件和旧文档引用。
