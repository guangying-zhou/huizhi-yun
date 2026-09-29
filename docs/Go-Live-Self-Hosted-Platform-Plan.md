# wiztek 生产 Platform 自托管方案（G-6 / G-9，草案，2026-09-29）

状态：**草案，待用户审阅**。本文只基于仓库阅读和一次生产库只读元数据查询，不授权任何数据库、Platform、Console、Runtime、nginx、DNS 或云端写入。执行时每个写入步骤都要单独批准。

上游文档：[自托管拓扑方案](Go-Live-Self-Hosted-Topology-Plan.md) §1–§4 及 §3a；[Platform/Console 隔离方案](Platform-Console-Prod-Dev-Isolation-Plan.md)；[策略验证合同](Console-Enterprise-Policy-Verification-Contract.md)；[本机上线执行单 N9](Go-Live-Local-C000001-Rollout-Runbook.md#n9开发-platform-正式-release-与-c000001-策略同步)。

证据标记：**[已核实]** 表示读过代码或只读查询过数据；**[推断]** 表示由证据推出，执行前还要回读确认。

## 0. 结论摘要

| # | 问题 | 建议 |
| --- | --- | --- |
| 1 | 新 Platform 数据库从哪里来 | 选 **(a′)**：克隆生产 `hzy_platform`，清理后补齐 schema，再登记新站点。不选全新空库 (b)，也不克隆开发库 (c)。签名密钥**必须新生成**，所有运行态凭据都要清空或轮换 |
| 2 | 环境编码 | 用 **`prod`**。签名策略、调度登记和 Runtime 注册都只接受 `prod/test/dev` 这几个值，新起一个环境编码会让整条链失败 |
| 2 | 部署编码 | 沿用 `C000001-console/-workflow/-aims/-codocs`，新增 Enterprise 部署（代码默认生成 `C000001-prod-enterprise`）；Finance、People、Webdev 改为 inactive |
| 3 | 信任链 | Console、Enterprise、Runtime、Gateway 的 Platform URL、kid/公钥、内部凭据、Runtime 控制凭据全部改为指向新 Platform；OIDC issuer 改为 `https://aidcp.wiztek.cn/console` |
| 4 | G-7 授权 | 生产 `hzy_console` 里没有 `enterprise.runtime`，Workflow 和 Aims 调度也缺精确 grant；现有 seed 全都写死测试部署编码，需要新写一份按参数生成的 prod seed/verify，再跑 13 项签发探测 |
| 5 | 进程 | 使用 G-4 的 `hzy-platform.service`（systemd）。现有草稿有 4 处必须修正（§6.2）；`platform.wiztek.cn` 还缺一个经 Tailscale 的入口（§6.3） |

## 1. 现状证据（2026-09-29 只读）

只读会话的 `@@hostname=vultr.guest`、MySQL 8.0.45。该实例上同时有 `hzy_platform` 和一份 9/23 之前的 `hzy_platform_dev` 旧副本，与“oa.wiztek.cn 原开发库已迁出”的记录一致（`deploy/test-env/platform-dev-db-localize.mjs:1-6`）[推断]。查询只取编码、状态、计数和时间，没有读取私钥、哈希、密文或 `scope_json`。

| 项 | 生产 `hzy_platform` 实况 [已核实] | 影响 |
| --- | --- | --- |
| schema | 85 张表。与仓库对比，缺 `platform/docs/sql/migrations/` 的全部 10 个迁移（`tenant_scheduler_ownership*`、`tenant_enterprise_entitlement*`、`enterprise_*` 审批/恢复路由、`console_service_keys`、`platform_gateway_*`），另缺 v2.16 `tenant_reserved_subdomains` 和 v2.22 `tenant_role_catalog_metadata`。同名表的列与开发旧副本一致 | 克隆后必须先补迁移，再启动新代码 |
| 租户 | C000001（active，`customer-hosted`）；C000002（active，`managed-control-plane`，onboarding `draft`） | C000002 的去留要决定（§9） |
| 站点 | `C000001-main` → `https://wiztek.huizhi.yun`（prod，root=console）；`C000001-test` → `wiztekdev.huizhi.yun`（test）；C000002 → `https://localhost:3180`（prod，active） | 新库里要改指向，或置为 inactive |
| 部署 | prod：aims、altoc、assets、codocs、console、finance、people、webdev、workflow 共 9 个，**没有 enterprise**；`C000001-aims` 与 `C000001-workflow` 的 `site_id/base_path/api_base` 为 NULL；test 有 8 个 | 需要修正路由字段并新增 Enterprise |
| Runtime 实例 | `c000001-prod-tenant-runtime`，ready，端点 `https://wiztek-data-runtime.huizhi.yun`，9 个应用 `schema_ready`；报告版本 0.3.219，期望版本 0.3.198 | 日本 Runtime 的控制凭据哈希会随克隆带过来，必须清除 |
| 签名密钥 | 21 行。自 5/28 起在两个公钥指纹 `…bcg-wYg1hzX-` 和 `…6p7VAvuT2aHR` 之间来回切换，最后一次在 08-22，当前 active 为 `psk_20260822_6p7VAvuT2aHR`。`bcg` 指纹也出现在开发旧副本的历史中（`psk_20260531_bcg-wYg1hzX-`） | 见 §2.2 |
| 应用与 release | 11 个应用，没有 `enterprise`；51 个 release 全部是 `draft`，所有应用的 `latest_release_id` 都是 NULL；49 个 manifest，55 条注册记录 | Enterprise 的应用、release 和派生 manifest 都要在新库重新登记 |
| 策略 | C000001 prod 有 96 个 bundle（最新 `pv_prod_20260910052144_0096`，历史上用过 10 个 kid），修订 30；test 有 2 个 bundle | 旧 bundle 不能再签发给新站点 |
| 授权 | `tenant_roles` 32 行，`tenant_subjects` 196 行，`tenant_role_permissions` 196 行，全部属于 C000001 | 这是员工权限的权威数据，(b) 方案会丢失它 |
| 74 对孤儿门禁（B3） | 用 [只读清单 §02](Go-Live-Prod-Read-Only-Checklist.md) 的 SQL 原样执行，三张表**均 0 行**（对照：`tenant_role_permissions` 按应用计数非 0，说明查询有效） | 克隆当天通过；发布前在新库上还要再跑一次 |
| 账号 | staff 3 个（`gavin`、`zhouguangying`、`gavin,zhouguangying`），tenant_admin 1 个；全部 `mfa_enabled=0` | 其中带逗号的 uid 是异常数据 |
| 许可 | C000001 有 9 行 license，全部 `active`，但其中 6 行在 2026-06-14 已到期 | 与订阅期间不一致，权益转换会被标为待核对 |
| Vault 标记 | `deployment_bootstrap_secrets`：C000001-console 的 `console.vault.master_key` 状态为 `migrated`；两行 `data-runtime.static_token` 仍为 active（部署 4 与 15） | `migrated` 这行要保留（§2.3）；静态 token 要吊销 |

Console 库 `hzy_console` [已核实]：共 13 个 service client，**没有 `enterprise.runtime`**；没有 `auth_clients.enterprise`；`auth_client_redirect_uris` 共 130 条，来源为 `bundle` 的回调指向 `wiztek.huizhi.yun`、`wiztekdev.huizhi.yun`、`console.huizhi.yun` 和 `localhost:3180`（均为 active）。

## 2. 问题 1：新 Platform 数据库的来源

### 2.1 三个方案对比

| 维度 | (a′) 克隆生产 + 清理 | (b) 全新 schema + 最小种子 | (c) 克隆开发库 |
| --- | --- | --- | --- |
| C000001 员工授权（角色、主体、分配、模板、修订号） | 原样保留（§1） | 要重建或逐表抽取，出错即越权或缺权 | 带入测试环境的修改，不是生产权威数据 |
| 应用注册与 `manifest_path/release_tag_prefix` | 保留 11 个应用 | 需要重建 | 有 enterprise，但 release 与测试修订绑定 |
| schema 差距 | 缺 12 张表，逐个补迁移 | 用 DDL + 迁移直接建成最新 | 较新（103 张表） |
| 签名/凭据清理 | 需要清理（§2.4） | 天然干净 | 需要清理，而且开发密钥历史里出现过 `bcg` 指纹 |
| 数据卫生 | 需要处理 §2.5 列出的问题 | 最干净 | 混入 test 站点和 test 部署 |
| 已有工具 | `platform/scripts/init-platform-dev-db.mjs` 的克隆和清理骨架可以参考 | `HZY-Platform-SQL-DDL-Draft-v2.sql`、迁移、Seed | 同 (a′) |

**建议选 (a′)**。原因：员工授权是新站点上线后唯一不能重建错的数据，而 (a′) 保留的正是生产当前在用的这一份；schema 差距可以通过补迁移精确补齐。(c) 会把测试修改带进生产，(b) 需要手工重建授权，两者风险都更高。

### 2.2 签名密钥：必须新生成

1. 有哪些东西信任旧密钥 [已核实]：
   - Console 按 `kid` 精确匹配 license，并用 `HZY_PLATFORM_SIGNING_PUBKEY` 验签（`console/server/api/v1/console/bootstrap/token.post.ts:70,93`）。
   - Runtime 在注册时写入 `platformSigningKeyId` 和 `platform-signing-key.json`（`deploy/test-env/enroll-runtime.mjs:46-49,88,112`）。
   - Enterprise 使用 `HZY_ENTERPRISE_POLICY_ISSUER/KEY_ID/PUBLIC_KEY`（`enterprise/nuxt.config.ts:157-160`）。
   - 生成的 env 制品里带 `HZY_PLATFORM_SIGNING_KID/PUBKEY`（`platform/server/utils/licenseArtifacts.ts:112-113`）。
   - 旧 kid 的公钥还会继续通过 `/api/platform/internal/signing-keys/[kid]` 对外提供。
2. 为什么不能复用：计划中部署编码不变（§3.2）。如果密钥也不变，旧云端世界签发的 license 和信封在新 Console/Runtime 上会同样验签通过，新旧两个世界之间就没有隔离。license 里没有 issuer 字段，只能靠 kid 区分（token.post.ts:64-99）。
3. 旧密钥状态本身也有问题：生产库在两个指纹之间来回切换。这符合“两个 Platform 进程（Cloudflare `huizhi.yun` 与 PM2 `hzy-platform-prod`）共用一个库，但各自持有不同私钥”时的行为：`ensurePlatformSigningKey` 发现 active 行的公钥和自己的私钥对不上，就会激活自己的密钥，并把其他行置为 `rotated`（`platform/server/utils/platformSigning.ts:431-455,499-531`）[推断]。`bcg` 私钥还曾被开发实例加载过。
4. 做法：用 `pnpm --dir platform run signing:key -- --label prod-selfhosted` 在新服务器本机生成密钥，私钥只放 `/etc/hzy/platform-signing/`（0600），并单独做离线备份。**克隆后清空 `platform_signing_keys`**，避免 `signing-keys/[kid]` 继续发布旧公钥。首次启动时，服务会从 env 激活新 kid（platformSigning.ts:526-531）。生产环境不会自动生成开发密钥（:233）。

### 2.3 清理清单（克隆后、首次启动前，在同一个受审事务脚本里完成）

现有 `init-platform-dev-db.mjs:6-27` 的 `SENSITIVE_TABLES` 只覆盖旧 schema，而且会删掉审计和许可数据。这里需要一份生产专用版本 [推断，需编写并审查]：

- **清空**：`platform_signing_keys`、`platform_sessions`、`platform_email_activation_tokens`、`platform_api_keys`、`platform_webhooks`、`tenant_sessions`、`deployment_heartbeats`、`deployment_connectivity_checks`、`tenant_runtime_heartbeats`、`tenant_runtime_enrollments`、`policy_bundle_targets`、`policy_bundles`、`revocation_*`。新建的迁移表保持为空。
- **失效但保留行**：
  - `tenant_runtime_credentials`：两个租户都置为 revoked，之后通过 `POST /api/platform/ops/tenants/{code}/runtime-token` 重新签发。
  - `tenant_runtime_instances`：清空 runtime/control token 哈希，改写 `runtime_endpoint`，并把状态置为非 ready，等重新注册。
  - `deployment_bootstrap_secrets` 中的 `data-runtime.static_token`：置为 revoked（生产不允许使用静态 Runtime token）。
- **必须保留**：`deployment_bootstrap_secrets` 中 C000001-console 的 `migrated` 标记行。`ensureConsoleVaultMasterKey` 仍以 409 拒绝由 Platform 重新生成主密钥；license 签发与企业开通的 custody helper 则识别该标记，签发不带 `vault` 字段的 license。如果是全新库，或者删掉了这一行，签发流程仍会生成 Platform 持有的主密钥，并把指纹写进 license。
- **保留**：`tenant_policy_revisions`（修订号从 31 起递增）、全部授权表、`platform_audit_logs`、`tenant_audit_logs`、`platform_runtime_releases/_release_channels`、manifest 及注册记录。
- **license 行**：先保留，作为权益转换的来源（`enterpriseEntitlementRepository.ts:16` 的来源类型包含 license）。转换完成后，走正式流程把它们标为过期或撤销。用旧 kid 签的 license 本来也会被新 Console 拒绝（token.post.ts:70）。

### 2.4 员工账号

- 克隆会带过去密码哈希。建议新 Platform 只开放企业微信登录（`WECOM_OAUTH_ALLOWED_USERIDS` 写成白名单，`PLATFORM_AUTH_DEV_MOCK=false`），并在首次登录后重置密码或启用 MFA。
- uid 为 `gavin,zhouguangying` 的 staff 行看起来是把 CSV 当成一个 uid 写进去的，建议停用（§9）。
- `PLATFORM_OPS_UIDS` 和 `PLATFORM_BOOTSTRAP_OPS_UIDS` 显式写成单个 uid 的列表，`PLATFORM_ALLOW_OPS_UID_FALLBACK=false`。

### 2.5 其他租户和数据卫生

- C000002：只有 onboarding 草稿和一个 `localhost:3180` 站点，没有任何部署。建议保留租户行，但把站点置为 inactive。生产 `hzy_console` 里那些 `localhost:3180` 回调也应随 G-5 在新库中停用 [推断]。
- C000001 test 站点和 8 个 test 部署都指向云端测试链，在新库中全部置为 inactive；它们的测试职责仍由 `hzy.wiztek.cn` 开发 Platform 承担。
- 旧的 96 个 prod bundle 已按 §2.3 清空。当前信封接口会用新签名器给“最新一行”重新签名（`currentPolicyEnvelope.ts:48-50`），如果不清空，旧站点的 URL 和部署事实就会被重新签出去。

## 3. 问题 2：在新 Platform 上登记 C000001

### 3.1 环境编码：`prod`（不新增编码）

[已核实] 以下几处都只接受固定取值：

- 信封 issuer 与验证器：TS 在 `platform/packages/authz-core/src/policy-envelope.ts:26,93`，Go 在 `data-runtime/internal/policyenvelope/envelope.go:158`，都只接受 `prod/test/dev`。
- Aims 调度登记只接受 `test/prod`（`platform/server/utils/tenantSchedulerOwnership.ts:9,26`）。
- G-4 的构建和 env 草稿都写死 `prod`（`deploy/self-hosted/build.mjs:55`，`env/*.env.example`）。

Gateway README 建议“新站点使用独立环境编码”（`deploy/self-hosted/gateway/README.md` “依赖其他工作”一节），前提是新旧站点共用一个 Platform 库。改为独立库之后，这个前提不存在了：新库里的 C000001/prod 只有 aidcp 这一个站点，旧的 `huizhi.yun` 世界仍在旧库中运行。**建议同步修订该句。**

注意：Runtime 的 `enterprise_schema_registry` 会把 `(tenant, environment, runtime_deployment, generation)` 固化进统一库（`data-runtime/internal/enterprise/compatibility_views.go:103-106`）。环境编码必须在 G-5 安装统一 schema 之前定下来，装好后不能再改。生产库目前还没有这张表 [已核实]。

### 3.2 部署登记（新库，逐项求批）

| 应用 | 部署编码 | 处理 | 依据 |
| --- | --- | --- | --- |
| console | `C000001-console`（沿用） | 改 `base_path=/console/`、`api_base`；site 指向 aidcp | 生产 service client 的编码里直接带着部署编码（`connector-runtime.C000001-console`、`directory-connector.C000001-console`）[已核实]；Vault 键 `bootstrap.<deploymentCode>.access_key`（`data-runtime/internal/apps/console/auth_service_tokens.go:235`）；G-4 的 Console 挂在 `/console/`（`release-lib.mjs:7`） |
| enterprise | `C000001-prod-enterprise`（新增） | 由企业开通流程创建 | 编码规则为 `${tenant}-${env}-${app}`（`enterpriseProvisioning.ts:74`）；与测试的 `C000001-test-enterprise` 对应 |
| workflow | `C000001-workflow`（沿用） | 补 `site_id`、`base_path=/workflow/`、`api_base` | 生产这些字段为 NULL [已核实] |
| aims | `C000001-aims`（沿用） | 同上；进程只跑调度 | 调度登记要求恰好只有一个 active 的 aims 部署（tenantSchedulerOwnership.ts:64-65） |
| codocs | `C000001-codocs`（沿用） | 编辑器外壳 | — |
| assets / altoc | 沿用 | active 还是 inactive 待定（§9） | Host 负责它们的页面；Runtime 的 Assets 调度需要 `DeploymentBindings["assets"]`（`data-runtime/internal/config/enterprise.go`）[推断] |
| finance / people / webdev | 沿用编码 | **置为 inactive** | 拓扑 §4 第 1 条：不迁移；避免出现在应用目录和 bundle 目标里 |
| collab | 部署码 `C000001-collab`（`${tenant}-collab`）：**2026-09-29 用户决定：在新生产 Platform 登记为正式部署记录**，与其它组件一致管理。`platform_applications.collab` 已由 v2.32 指向 `collab/app.manifest.json`（tag 前缀 `collab/`），不新造 manifest 资源；部署行走 `platform/scripts/g9-collab-deployment.mjs`（站点 `C000001-main`、`base_path=/collab/`、`api_base=/api/v1/collab`、`route_source=platform_override`，均取自 manifest `entry`；`deployment_mode/region` 沿用 `C000001-console`；不签 license、不写 runtime endpoint 与凭据）。Runtime `deploymentBindings.collab`、`collab.runtime` grant 与 Gateway `apps.collab.deploymentCode` 均须等于该登记值，漂移用 `deploy/self-hosted/check-collab-deployment.mjs` 检出 | 协作 V2 关闭时可不执行该步；启用协作前必须完成 | 候选制品，仅在合成 MySQL 演练（plan→apply→verify→rollback，含更新已有行、外来编码/漂移拒绝），**未连接任何 Platform**；模板默认 `HZY_ENTERPRISE_CODOCS_*_V2=false`（`env/enterprise.env.example`）；启用清单见 `deploy/self-hosted/README.md` “独立 Collab”。生产注册用 `collab-prod-registration.mjs`，不复用 hzy0 的 `collab-registration.mjs` |

站点：把 `C000001-main` 改成 `public_url=https://aidcp.wiztek.cn`，并按 G-4 路由确定 `root_app_code`。开发旧副本的测试站点为 `root_app_code=enterprise`、Enterprise 挂 `/`、Console 挂 `/console`；G-4 却把 Enterprise 构建在 `/enterprise/`。两者不一致，**执行前要以开发权威库和 Worker 路由为准定下来**（§9）。

修改入口：`ensureDeploymentSite` 在同一环境已有 active 站点时会直接改写 `public_url`（`platform/server/utils/deploymentSites.ts:85-110`），新库中可以直接用；部署字段用 ops `deployments/[id].patch`。页面上做不到的，改用受审 SQL。

### 3.3 Runtime 实例与注册

1. 规范端点要换一个新的 HTTPS 名字，例如 `https://aidcp-runtime.wiztek.cn`，**不能继续用** `wiztek-data-runtime.huizhi.yun`。一旦某处回落到公网，就会写进日本 Runtime。这个名字最好不对外解析，回落时就会直接失败而不会误连（§9）。
   - 解析接口会把回环地址直接剔除（`resolve.get.ts:85-97`）。
   - 应用通过 G-10 的 `HZY_SELF_HOSTED_RUNTIME_ENDPOINT → DIAL_ORIGIN` 映射拨到本机回环。
2. 由租户管理员在 `install-command` 签发注册码（`tenant-admin/deployment-settings/install-command.post.ts:120`）。runtimeCode 固定为 `c000001-prod-tenant-runtime`（`tenantRuntimeEnrollment.ts:61`）。`desiredVersion` 必须等于 stable channel 里的版本，`releaseSigningKeyId` 必须匹配，端点必须一致（:209-216）。
3. 新 Runtime 执行 `hzy-data-runtime enroll`，拿到新的 `hzy_ctl_` 控制 token 和 Platform 公钥。可以参照 `enroll-runtime.mjs`：浏览器端只传 RSA-OAEP 加密后的注册码，脚本有主机和配置守卫；但要写一个生产版脚本，不能直接复用。
4. 实例进入 ready、各应用绑定为 `schema_ready/active` 之后，解析接口才会返回 Runtime 端点（resolve.get.ts:151-183）。

### 3.4 Gateway 解析输入

`HZY_TENANT_GATEWAY_EXPECTED_BINDINGS_JSON` 由 gateway.json 生成，内容为：`tenantCode=C000001`、`environment=prod`、apps 取 §3.2 中的 console、enterprise、workflow、aims、codocs 五项、`dataRuntime.endpoint` 等于新规范端点、`runtimeCode=c000001-prod-tenant-runtime`。比对逻辑只检查配置里列出的应用，并要求 Console 的 Runtime 端点完全一致（`deploy/cloudflare/tenant-gateway/src/index.js:1608-1632`）[已核实]。

`platformRegistryToken` 必须在 Platform 内部凭据集合里（`platform/server/middleware/platform-access.ts:198-218`），而且要与 Gateway 和各应用之间的 token 不同。

### 3.5 调度登记与策略

- **Aims**：用 `POST /api/platform/ops/deployments/scheduler-ownership`，参数为 `storage=unified, environment=prod, runtimeCode, workerDeployment=C000001-aims, workerClient=aims.runtime, generation=N`。N 必须与 Runtime 配置 `enterprise.generation` 和 `enterprise_schema_registry.generation` 相等（`data-runtime/internal/server/enterprise_scheduler_context.go:17-24`）。建议 N=1，因为新库和新 registry 都从零开始。这一步必须等 Runtime ready 之后再做（tenantSchedulerOwnership.ts:63-65）。
- **Workflow**：Platform 里没有 owner 表，只需要把 `scheduler.drain.apps` 配成包含 workflow，并配好 grant（§5）。
- **权益**：先用 `convertEnterpriseEntitlement` 做只读预览（`enterpriseEntitlementRepository.ts:256`）。由于 license 到期日和订阅对不上，预计会被标为“待核对”，期间需要用户裁定（§9），然后再应用。之后通过企业开通流程生成 `C000001-prod-enterprise` 和 license（enterpriseProvisioning.ts）。开通前要求 Enterprise manifest 已登记，而且各组合模块的 manifest 哈希一致（:23-40）。
- **Release**：先在新库上跑 74 对门禁（必须为 0）→ 配置 `GITLAB_*` → 按“注册 tag/manifest → 审核 ready → 发布 latest”的顺序操作，同时检查 aims、assets、codocs 派生 manifest 的资源删除情况。Tag 建议从同一个受审提交另打一个正式 tag，不要用带 `-test` 的 `enterprise/v0.3.279-test.c000001-rollout.5`（§9）。
- **策略**：调用 `POST /api/platform/ops/tenants/C000001/bundles {"environment":"prod"}` 一次，然后核对：新修订 ≥31、kid 为新 kid、部署目标只有 §3.2 中 active 的部署、homeUrl 和回调都是 aidcp、payload 中没有那 74 对资源。

## 4. 问题 3：Console / Runtime 信任链切换

| 使用方 | 配置项（以 G-4 env 草稿为准） | 新值从哪里来 |
| --- | --- | --- |
| Console | `NUXT_PLATFORM_BASE_URL/HZY_PLATFORM_URL=https://platform.wiztek.cn`；`NUXT_PLATFORM_SIGNING_KID/PUBKEY` | 新 Platform 的 `exportPubkey` 或 env 制品（licenseArtifacts.ts:93-120） |
| Console | `HZY_CONSOLE_PLATFORM_SERVICE_TOKEN` | Platform 内部凭据 CSV 中专门给 Console 的一项，与 Gateway 分开 |
| Console | Runtime token（`hzy_rt_`）、license（只在走 bootstrap/token 路径时需要） | ops `runtime-token.post`；`licenses.post` 或企业开通 |
| Console | `HZY_CONSOLE_SERVICE_KEY`（R1 稳态身份） | 在新服务器本机生成；同步时自动登记到新库的 `console_service_keys`（合同 §15） |
| Enterprise | `HZY_ENTERPRISE_POLICY_ISSUER` 与 `NUXT_VERIFIED_POLICY_ISSUER=https://platform.wiztek.cn`；`KEY_ID/PUBLIC_KEY`；环境 `prod` | 必须和 Platform 的 `HZY_PLATFORM_POLICY_ENVELOPE_ISSUER` 字面完全相同（合同 §8） |
| Runtime | `control.platformUrl`、`platformSigningKeyId/PublicKey`、控制 token；`auth.jwt.issuer=https://aidcp.wiztek.cn/console` 及 JWKS；`apps.console.policyEnvelope.environment=prod` | §3.3 的注册；OIDC 私钥在 Vault 中，随 G-5 成对迁移 |
| Gateway | `platform.origin`、`platformRegistryToken`、`runtime.*`、`apps.*.deploymentCode` | §3.4 |
| Platform 自身 | `PLATFORM_SERVICE_URL`：Runtime bootstrap token 的 issuer（`runtimeBootstrapIssuer.ts`）；`HZY_PLATFORM_POLICY_ENVELOPE_ISSUER` | 两者都填 `https://platform.wiztek.cn` |

OIDC：

- Console issuer 改为 `https://aidcp.wiztek.cn/console`（`env/console.env.example:28,50`）。员工需要重新登录。旧站点的 token 因为 iss 不同，会被新 Runtime 拒绝 [推断，G-5 要验证 Runtime 的 issuer 严格匹配]。
- G-4 把 `HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE` 设为 false，所以 bundle **不会**自动写入回调地址。Console、Enterprise（新客户端 `enterprise`）、Workflow、Codocs 的 aidcp 回调和登出地址，要按 `deploy/test-env/enterprise-registration.mjs` 的 plan/verify/apply 模式显式登记。
- 上游身份源（SSO 或企业微信）也要登记 `https://aidcp.wiztek.cn/console/api/auth/oidc-callback`。这属于外部操作。
- 新 `hzy_console` 中 `console.huizhi.yun` 和 `localhost:3180` 的回调在 G-5 中停用。

## 5. 问题 4：G-7 授权核验

G-7 参数化候选已写入 `console/docs/G7-Production-Service-Grants.md`，含 v2.33 seed/repair/verify/rollback、逐 ID reviewHash 工具与参数化签发探测；目前仅在隔离 MySQL 演练，尚未连接目标库、登记凭据或签发真实令牌。本节的生产现状仍须在执行窗口重新只读核对。

生产 `hzy_console` 实况 [已核实]：

- `enterprise.runtime` 不存在。
- `workflow.runtime` 只有旧的复数形式 `integration_operations execute`，没有 v2.29 的单数 `workflow:integration_operation`。
- `aims.runtime` 有两个 audience 的单数 `integration_operation`（`data-runtime` 那条有使用记录），另外还有旧的复数形式；没有 `milestone-rollover`，也没有 `notifications-due`。这些行是否绑定到 tenant/deployment 无法确认，因为没有读 `scope_json`。
- `console.runtime` 有 `console:policy-bundle read/write`。

签发时 Runtime 要求所选 grant 的 `(tenantCode, deploymentCode)` 绑定一致（`auth_service_tokens.go:343-373`）。**仓库里现有的 seed 全都写死了测试部署编码，不能直接用于生产**：v2.26、v2.27、v2.29、v2.31 分别写死 `C000001-test-enterprise/-workflow-local/-aims`；v2.32 还写死了 hzy0 的行 ID。

需要在新 `hzy_console`（即 G-5 迁移后的库）中具备的授权：

| client | 凭据 | scope（audience） | 绑定 | 制品 |
| --- | --- | --- | --- | --- |
| `enterprise.runtime`（新建，另建 OIDC 客户端 `enterprise`） | 新签发 | `{aims,assets,codocs,altoc,console}:enterprise-host:execute`（data-runtime），共 5 条 | C000001 / `C000001-prod-enterprise` | 参考 v2.27，写 prod 参数化版本 |
| 同上 | 同上 | `console:policy-bundle:read`；`workflow:proxy`；`notifications:publish` | 同上 | 参考 `Seed-enterprise-policy-reader`、`v2.12`、`FE2-Followup-…-Publish` |
| 同上 | 同上 | 外部服务：aims 6 条、codocs 2 条、console 3 条 | 同上 | `deploy/test-env/enterprise-readiness.template.json` 的 `externalServicePolicies` |
| `workflow.runtime` | 沿用 | `workflow:integration_operation:execute`（data-runtime 与 tenant-runtime） | `C000001-workflow` | 参考 v2.29 写 prod 版本 |
| `aims.runtime` | 沿用 | `aims:integration_operation`、`aims:milestone-rollover`，两个 audience；**每个 audience 只能有一条匹配**（否则 403）；`notifications-due` 不授予（D4） | `C000001-aims` | 参考 v2.31/v2.32 的语义写一份 prod repair，不能沿用 v2.32 的行 ID |
| `console.runtime` | 沿用 | 策略存储读写 | `C000001-console` | 现有 `Seed-policy-bundle-grants` 与 verify |
| `collab.runtime`（新建，无凭据） | **启用共享个人文档协作（2026-09-29 用户决定）时必需** | `codocs:collaboration-snapshots:read`、`codocs:collaboration-snapshots:publish`（各一条，仅 `data-runtime` audience；物理 `data-runtime:codocs:collaboration-snapshots`） | C000001 / `C000001-collab` | `console/scripts/collab-prod-registration.mjs`（独立 plan/reviewHash/apply/verify/rollback）或 G-7 目录可选 `bindings.deployments.collab`；两者同一清单，先跑者生效、后跑者无操作。候选，尚未连接目标库 |
| `aims.runtime` | 沿用 | `codocs:company-weekly-summary:publish`（aud=`codocs`） | C000001 / `C000001-aims` | G-7 v2.33 参数化 plan/verify |
| `codocs.runtime` | 沿用 | 既有 `codocs.write`（aud=`data-runtime`，物理 `data-runtime:codocs/write`） | C000001 / `C000001-codocs` | G-7 v2.33 校准 v1.54 行并 verify |

**不要安装**的 seed：v2.13–v2.26 的 Enterprise 精确 data-runtime scope，以及 D2 的 `directory-self`。它们都在 v2.28 吊销清单的 172 项里（`console/docs/sql/Console-v2.28-enterprise-host-precise-scopes.json`）。新站点从一开始就只用收敛后的模型。

**`collab.runtime`（协作启用）补充：** 仅 2 条精确 grant，`aud=data-runtime`，tenant/deployment 绑定 `C000001` / `C000001-collab`；Collab 不持有 `tenant-runtime` audience（它不是调度 worker，只调用 Codocs 协作快照路由，代码只请求 `data-runtime`），签发探测把 `tenant-runtime`、`console` audience 列为反例，若后续 Runtime 实测要求双 audience 须补 grant 并同步改探测。凭据不在 SQL 中：client 记录无 `current_credential_id`，秘密经正式凭据流程写入 `/etc/hzy/collab.env`。探测矩阵新增 2 正例 + 15 反例（错 audience、错来源、错租户、错部署、缺能力、Host 委托能力被拒、公司周报能力被拒、Enterprise 持有 Collab scope 被拒），合计 23 个成功项。

核验步骤（在目标库执行，不能以“行存在”代替）：

1. 执行前，从本机 hzy0 的 `hzy_console` 只读导出 `enterprise.runtime` 当前 active 的 (resource, action, audience) 集合。以它为基准核对上表，差异交用户裁定。
2. 按 plan → 审查 → apply 执行 prod seed，每一步前做加密备份；运行对应的 Verify SQL（要把 v2.27、v2.29、v2.31/32 的 verify 参数化成 prod 编码），要求逐行计数正确、状态为 active、绑定正确。
3. 签发探测：把 `deploy/test-env/probe-c000001-rollout-service-tokens.mjs` 的 13 项矩阵参数化，把部署编码改成 prod 值，对全部组合真实签发。期望 12 个 200、`notifications-due` 为 403，并断言 `aud`、`scope`、`source_app`、`tenant`、`deployment`。
4. 按根 `CLAUDE.md` 做反例：缺 capability、错 audience、错 source_app、错 tenant/deployment、token 过期；另外确认 v2.28 列表中的旧 scope 签发会被拒绝。

## 6. 问题 5：Platform 进程、env 与备份

### 6.1 进程

采用 G-4 的 `deploy/self-hosted/systemd/hzy-platform.service`，监听 `127.0.0.1:31006`，运行用户为 `hzy-platform`，启用 `ProtectSystem=strict`；不用 `platform/ecosystem.config.cjs` 的 PM2 方式。这样与其他进程保持一致，也不和旧主机上的 `hzy-platform-prod` 重名。同一台主机上只能运行**一个** Platform 写入者（原因见 §2.2 的来回切换）。

### 6.2 G-4 草稿需要修正的地方（`deploy/self-hosted/env/platform.env.example` 与 unit；目前未提交）

1. **数据库配置在运行时不会生效**。构建使用 `--dotenv /dev/null`（`build.mjs:76`），`runtimeConfig.db` 固化为 `user=root`、密码为空（`platform/nuxt.config.ts:35-41`），而 `db.ts:34` 只读 `useRuntimeConfig()`。所以必须改用 `NUXT_DB_HOST/PORT/USER/PASSWORD/NAME`；开发环境的进程确实就是用 `NUXT_DB_NAME`（`switch-platform-domain.mjs:71`）。同理：
   - 安全开关用 `NUXT_SECURITY_ALLOW_OPS_UID_FALLBACK=false`（构建默认值是 `'true'`，:59）和 `NUXT_SECURITY_OPS_UIDS`；
   - `NUXT_PUBLIC_SERVICE_URL` 和 GitLab 配置也要用 `NUXT_*` 形式。
2. **签名私钥**：只配 `PLATFORM_SIGNING_KEY_DIR` 不会生效，这个目录只在生成开发密钥时使用。需要配置 `HZY_PLATFORM_SIGNING_PRIVATE_KEY=/etc/hzy/platform-signing/<kid>.pem`：代码支持路径形式（platformSigning.ts:185-203），并且直接读 `process.env`。
3. **缺少的项**：
   - `HZY_CLOUDFLARE_INTERNAL_TOKEN` 或 `PLATFORM_INTERNAL_SERVICE_TOKENS`：Gateway 和 Console 各用一个值，逗号分隔；它们直接从 `process.env` 读（platform-access.ts:52）。
   - `PLATFORM_AUTH_ACTIVATION_BASE_URL`、`WECOM_OAUTH_ALLOWED_USERIDS`、`HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_PEM`、`HZY_PLATFORM_DIAGNOSTICS_TOKEN`（可选）。
4. unit 中的 `Requires=hzy-data-runtime.service` 会让 Runtime 故障连带停掉控制面，而控制面恰恰是给 Runtime 重新注册用的。建议改成 `After=`/`Wants=`。

### 6.3 `platform.wiztek.cn` 入口（缺口）

Platform 只监听回环地址，而 Gateway 只服务 `aidcp.wiztek.cn` 一个 Host（Gateway README “有意不支持”一节），所以 nginx 经 Tailscale 过来的请求到不了 Platform。建议在内网服务器上加一个本机反代：监听 `100.64.72.59` 上一个独立端口，只放行 `100.98.120.65`，原样传递 `Host`，转发到 `127.0.0.1:31006`；firewalld 规则与 Gateway 使用同一个 zone。另一种做法是让 Gateway 支持第二个站点，改动更大。

`/api/platform/diagnostics` 的本地判断要求 Host 为回环地址（`diagnostics.get.ts:113-124`），反代必须保留公网 Host，这样就不会被误判为本机请求。

企业微信扫码登录的“可信 IP”要填新服务器的出口 `39.78.255.170`；公司出口 IP 变化会导致登录失败（§8）。

### 6.4 备份

- **每日**：`mysqldump --single-transaction` 导出 `hzy_platform` → gzip → `openssl enc -aes-256-cbc -pbkdf2`（沿用 N9 的命令模板），并做解密自检，文件放 `/home/hzy/backups/platform/`（0700）。
- **异地**：复制到 gitlab 主机或其他介质，加密口令与备份文件分开存放。
- **签名私钥**：单独离线备份，不放在数据库备份里。丢失私钥就意味着所有信任锚都要重发。
- **写操作前**：每次写入（迁移、清理、登记、release、bundle、grant）前都做一次加密备份并记录 sha256。回滚时优先走“正式流程回切”，不直接全库覆盖（N9 原则）。

## 7. 建议执行顺序（每一步单独批准）

G-9 的本地待审制品见 [克隆与信任链执行模板](../deploy/self-hosted/platform-bootstrap/README.md)。模板把 P1 的只读 dump/空库恢复、P2 的 **12 个迁移文件（合成旧库上新增 18 张表）**、瞬态清理、逐行 reviewHash 数据整理、受保护回执回滚，以及正式签发/Runtime 注册步骤分开。`g9-platform-data` 只整理克隆事实；权益转换、Enterprise 部署、签名键激活、license/runtime token 签发和 Aims owner 登记仍走各自正式受审 API。实库行数、表结构和签名 kid 要在批准时重新核对，不能把合成演练结果当生产事实。`root_app_code=NULL` 与 `/enterprise/` 是待审路由输入，正式开通前须确认根路径由 G-12 承接。

**Collab 部署登记（2026-09-29 用户决定，候选制品）：** `platform/scripts/g9-collab-deployment.mjs`（`--plan/--apply <reviewHash> <receipt>/--verify/--rollback`，同一 `db.json` 加 `{"collab":{"tenant":"C000001"}}`）在 `g9-platform-data` 之后执行：要求 `platform_applications.collab` 的 `manifest_path=collab/app.manifest.json`、`release_tag_prefix=collab/`（v2.32；缺失即停止，不由本工具补建）、`C000001-main` 站点与唯一 active 父订阅、`C000001-console` 部署（借其 `deployment_mode/region`）；缺 collab 子订阅则插入 `G9-COLLAB-C000001`，缺部署则插入 `C000001-collab`（`license_status/connectivity_status=pending`），已存在同码行则只校正路由字段；外来编码、编码被占用、`/collab/` 路径冲突、非目标行摘要漂移均停止并回滚事务。回执保存插入 ID 与被改字段原值，回滚要求目标与非目标行未漂移。漂移检查：`node deploy/self-hosted/check-collab-deployment.mjs --tenant C000001 --platform <verify 读回编码> --gateway <gateway.json> --g7 <g7 配置> --collab-registration <配置> --runtime-binding <Runtime 配置>`；`collab-prod-registration` 的 `bindings.deployments.collab` 缺省即为登记值，Gateway 若填 `apps.collab.deploymentCode` 必须等于 `<site.tenantCode>-collab`（Gateway 随后把它纳入注册表精确比对，不一致失败关闭）。合成演练已覆盖；真实 Platform 的表结构、订阅行与站点须在批准时重新核对。

| 步 | 内容 | 退出条件 |
| --- | --- | --- |
| P0 | 修正 §6.2 和 §6.3 的代码/配置草稿；编写生产清理脚本、prod 参数化 seed/verify 和探测脚本；全部本地测试 | 审查通过 |
| P1 | 生产 `hzy_platform` 只读 dump（一致性快照）→ 在新服务器恢复为 `hzy_platform` | 行数和 checksum 与源库一致 |
| P2 | 补 12 张表的迁移 → 执行清理 → 生成新签名密钥 → 启动 Platform（此时还没有入口） | 本机诊断显示新 kid 和指纹，旧密钥表为空 |
| P3 | 打通 nginx + 本机反代 + 证书 → 员工通过企业微信登录 | 登录成功，诊断显示独立的库和 URL |
| P4 | 站点和部署修正（§3.2）→ Enterprise 应用/release（门禁 B3）→ 权益转换 → 企业开通 | 回读所有记录 |
| P5 | Runtime 注册（依赖 G-5 的 Runtime 已就位）→ 调度登记 → 生成 prod bundle | 解析接口输出与 expected bindings 完全一致 |
| P6 | G-7：客户端和凭据、prod seed、verify、13 项探测和反例 | 全部符合预期 |
| P7 | 按 G-5 的切换窗口启站 | 拓扑 §5 S4 |

## 8. 主要风险

1. **新旧两个世界串线**：
   - 部署编码保持不变，隔离完全依赖新签名密钥、新 Runtime 端点、新 OIDC issuer 和清空的凭据哈希。漏掉任何一项，旧云端的凭据就能在新世界生效。
   - 如果规范端点沿用旧名，一旦回落到公网，就会写进日本 Runtime。
2. **schema 差距**：生产库在旧 schema 上积累了数据，补迁移时可能遇到约束冲突或默认值问题。要先在 P1 恢复出的副本上演练整套迁移。
3. **Vault 主密钥被误重发**：一旦删掉了 `migrated` 标记，或企业开通挂到了新的 console 部署 id 上，Platform 就会生成一把不会被使用的主密钥并写进 license。
4. **旧版 license 签发被卡住**：旧版签发路径对 `migrated` 主密钥返回 409。C2 代码已改为客户侧持钥时照常签发且不带 `vault` 字段；生产 Platform 在该代码部署前仍有此阻点。
5. **企业微信登录**依赖公司出口 IP 固定。
6. **G-4 草稿**如果不改 `NUXT_DB_*`，Platform 会以 root、空密码连接数据库，启动失败或连错库。

## 8a. 用户决定（2026-09-29，“按建议”）

- 库来源：**克隆生产 `hzy_platform`**，补齐缺失的 12 张表后再登记新站点；保留 `console.vault.master_key` 的 `migrated` 标记。
- 签名密钥：**新生成**；旧密钥不进入新 Platform 的活动集合。
- 环境编码：**`prod`**；部署编码沿用原编码 `C000001-<app>`（Runtime 为 `c000001-prod-tenant-runtime`，与迁移 runbook §9a 第 3 条一致），Enterprise 新增 `C000001-prod-enterprise`，Finance/People/Webdev 置为不活跃。
- Enterprise 挂载：**`/enterprise/`**。
- 版本：从同一受审提交**另打正式 tag**，不用带 `test` 的 tag。
- C000002 与异常账号 `gavin,zhouguangying`：**在新 Platform 中停用**。MFA 另议。
- 企业权益：**以订阅为准，到期日改为 2027-12-31**。新 Platform 克隆后，经批准写入订阅与权益，再据此重新签发 license。
- license 签发 409（§8 第 4 条）：**改代码**。部署的 Vault 主密钥为客户侧持有（`migrated`）时，签发 license 和企业开通照常进行，但不带 Vault 字段，也绝不重新生成主密钥。该项由 Codex 实现、Claude 审查。

## 9. 待用户确认

1. 是否接受方案 (a′) 和“新签名密钥 + 环境 `prod` + 沿用部署编码”这一组合？
2. Enterprise 部署编码用 `C000001-prod-enterprise`（代码默认）还是 `C000001-enterprise`？
3. Runtime 规范端点叫什么（例如 `aidcp-runtime.wiztek.cn`）？是否不做对外解析？
4. 站点根路径由谁承接：Enterprise 挂 `/` 还是 `/enterprise/`（G-4 和测试站点目前不一致）？`root_app_code` 填什么？
5. Assets 和 Altoc 部署保持 active 还是置为 inactive？协作 V2 在 10/8 是否启用？
6. C000002 是否只保留租户行、站点置为 inactive？staff 账号 `gavin,zhouguangying` 是否停用？是否强制 MFA 或只允许企业微信登录？
7. 企业权益的起止时间：license 在 06-14 到期，与订阅不一致，以哪个为准？
8. Release tag 是否另打一个正式 tag，而不用带 `-test` 的那个？
9. 旧 license 的签发 409 问题（§8 第 4 条）按哪种方式处理：改代码，还是在执行单里另走专门流程？
10. 本机反代用哪个组件（nginx 或 Caddy）、哪个端口，还是改为扩展 Gateway 支持第二个站点？

## 附录：本次只读查询

- 目标：`hzy_platform`、`hzy_console`、`hzy_platform_dev`（旧副本）。会话设置为 `SET SESSION TRANSACTION READ ONLY`。
- 查询内容：只查了 `information_schema`、`COUNT(*)`、编码、状态、时间，`private_key_ref` 只取前 4 个字符判断类型。
- 74 对门禁：用只读清单 §02 的 SQL 原样执行，结果为 0 行。
- 没有读取任何私钥、token 哈希、密文、`scope_json` 或 `signed_token`。
