# 控制端 ↔ 应用端 MVP 打通方案

状态：Implementation Review
日期：2026-04-28
范围：把 `platform` 控制面与 `console` 客户侧基础运行服务跑通，形成"开通 → 部署 → 鉴权 → 心跳 → 治理"闭环

> 口径收敛说明（2026-06-15）：本文是 Platform ↔ Console MVP 打通的历史实施复盘，仍可用于追溯关键决策和已完成链路，但不再作为当前业务闭环排期的主计划。当前模块状态、端口和跨模块契约以 `CLAUDE.md`、`docs/Huizhi-yun-Architecture.md`、`docs/MODULE_CONTRACTS.md` 和 `docs/Huizhi-yun-Integrated-Operations-Roadmap.md` 为准。

配套文档：
- `docs/Huizhi-yun-Platform-Target-Architecture.md`
- `docs/Huizhi-yun-Architecture.md`
- `docs/Console-Functional-Design-v1.md`
- `docs/Console-Directory-Runtime-Integration-Plan.md`
- `docs/Control-Plane-API-Contract.md`

---

## 0. 关键决策（已拍板）

| ID | 决策 | 理由 |
|----|------|------|
| **D-1** | runtime token 形态：**静态 long-lived token** | MVP 复杂度可控，未来再迭代为短时签名/mTLS |
| **D-2** | bundle 签名算法：**Ed25519** | 性能与安全平衡，离线验签所需公钥小 |
| **D-3** | API 合同收敛：**`/api/v1/...` 作为唯一对外合同路径**，platform 实现向合同收敛；`/api/platform/...` 仅短期兼容并进入退役窗口 | 避免“双协议”长期并存，保证 SDK/调用方可稳定按合同接入 |
| **D-4** | subject 桥接：目标态为 **platform 下发 `subject_sync` 任务，console 定时拉取并读取企业目录最小投影后回传 platform**；MVP 当前采用 **Console 启动时一次性推送最小投影** | 避免平台直连企业内网；先满足首次 subject gate，后续补任务队列、周期 worker 与手动补偿 |
| **D-5** | 部署级签名密钥：**只在客户侧（console）存在，平台完全不持有 deployment 公钥/私钥**；平台仅在 `deployments` 表存治理摘要（`current_kid` / `current_pubkey_fingerprint` / `last_key_rotated_at`） | 把 ADR-001"部署级信任根"做到极致；私有化交付时 platform-core 不携带 deployment 密钥材料；公钥由 console 本地分发给同部署内服务，不出客户机房 |
| **D-6** | OAuth 边界：**`/oauth/token` 由 console 处理**；platform 仅治理登录入口展示策略与角色授权，不存 OIDC client secret | 保持“客户侧身份运行时、平台侧治理控制面”的清晰边界 |
| **D-7** | 企业目录终态：**`directory-runtime` 作为逻辑域收敛到 console 内，account 仅作为迁移期事实源、兼容 facade 和 fallback** | 简化企业私有化部署，把企业端基础运行链路集中到 console，避免业务应用长期同时依赖 console 与 account |

> D-1 ~ D-7 是 MVP 内的有效决策。每条决策都允许在波次三结束后重新评估升级路径。  
> D-3 约束：`/api/v1/internal` 不作为合同路径；`internal` 仅保留在 `/api/platform/internal/**` 私有接口中。
> D-4 过渡口径：短期 `subject_sync` 可由 console 从 account 读取最小实体；目标改为 console 从本地 `directory_subject_exports` 读取，account 不再是运行时依赖。

### 0.1 实现核对摘要（2026-04-28）

当前代码已经跑通 MVP 主链路：

- Platform 已具备 `/api/v1` runtime 合同鉴权、租户级 runtime token hash 校验、Ed25519 平台根签名、policy bundle 生成/下载、license 签发、onboarding 向导、console 内置应用 seed、heartbeat 接收与 deployment 摘要更新。
- Console 已具备启动激活：读取 `HZY_PLATFORM_*`、验签 `license.lic`、拉取租户 profile、拉取并验签/cache policy bundle、进入 `/activation` 待激活模式、成功后向 Platform heartbeat。
- Console 权限读取已切到本地已验签 policy bundle：`/api/auth/permissions` 与服务端 `checkPermission/requirePermission` 不再代理 Account。
- Directory Runtime 已在 Console 本地落地核心表、目录页面、同步 job、`directory_subject_exports` 最小投影生成能力。
- Subject 同步的当前实现口径已经从"Platform 创建任务 + Console 定时 pull/push"调整为"Console 启动时重建本地最小投影，并调用 `POST /api/v1/runtime/subjects/sync` 推送到 Platform"。该实现满足首次打通与 subject gate；已支持 `committee` 类型过滤与源目录硬删除后的 stale export 失效化，但尚未覆盖周期性 worker、Platform 任务队列和手动补偿重试。
- Platform heartbeat 已能返回 `download_bundle` action，Console heartbeat loop 收到后会刷新本地 policy bundle cache。
- 旧 `console/server/api/heartbeat.post.ts` 与 Console 默认布局中的 Foundation `useHeartbeat()` 调用已移除，不再保留 Account 心跳兼容入口；Dashboard 角色管理默认 appCode 已从 `tenant_console` 清理为 `console`。

仍需补齐：

- 周期性/手动的 Platform subject 投影同步 worker（当前只有启动时一次）。
- Foundation `platformClient.ts` 雏形尚未落地；Console 已本地消费 bundle，其它业务应用权限消费仍未统一切到本地 bundle。
- Revocation 写入、UI 与自动滚动仍未形成闭环；bundle 自动刷新已由 heartbeat action 覆盖。

---

## 1. 历史现状快照（2026-04-27，端口/状态已按 2026-06-15 口径校正）

### 1.1 platform（端口 3011，开发中）

| 维度 | 状态 |
|------|------|
| Schema | ✅ v2.4，`platform_*` / boundary / `tenant_*` 三域已就位 |
| Runtime API | ✅ `/api/v1/runtime/**`、`/api/v1/policy/**`、`/api/v1/revocations/**`、`/api/v1/registry/**` 已作为合同路径；旧 `/api/platform/runtime/**` 保留兼容并返回退役头 |
| Internal API | ✅ `/api/platform/internal/identity/resolve-subject` |
| Ops 控制台 | ✅ 应用列表/详情、租户、订阅、部署、License、Plans、系统角色、开通向导已落地 |
| Bundle 生成 | ✅ `platform/server/utils/policyBundle.ts` 可生成、签名、落库并经 runtime/policy 接口下载 |
| Revocation 写入 | ⚠️ 查询/下载合同已有，写入 UI 与生成器仍缺 |
| Onboarding 流程 | ✅ `/admin/onboarding` 与 ops API 已落地，输出 `console.env` / `license.lic` |
| 静态 runtime token | ✅ 已有 `tenant_runtime_credentials`、token 签发/吊销 API 与 runtime 路由校验链路 |
| API 合同路径 | ✅ 已新增 `/api/v1/...` 初版合同路径；`/api/platform/runtime/**` 保留兼容并返回 `Deprecation` / `Sunset` |
| Subject 最小投影接收 | ✅ `POST /api/v1/runtime/subjects/sync` 已接收 Console 启动推送，幂等 upsert `tenant_subjects` |

### 1.2 console（端口 3000，基础运行服务已落地并持续建设）

| 维度 | 状态 |
|------|------|
| 基础 | ✅ 基于 `@hzy/foundation` Layer，端口 3000，库 `hzy_console`，承接企业配置、目录、认证、凭证保险箱、集成配置、员工入口与本地授权消费 |
| Pages | ✅ `org-profile / system-settings / integrations / vault / service-clients` 与 Directory Runtime 管理页已建 |
| Heartbeat | ✅ 启动激活链路已调用 Platform `/api/v1/runtime/heartbeat`，并按 heartbeat action 刷新 bundle；旧 `server/api/heartbeat.post.ts` 已移除 |
| Permissions | ✅ `server/api/auth/permissions.get.ts` 与 `server/utils/checkPermission.ts` 已切到本地已验签 policy bundle |
| 登录 | ✅ CAS / 企业微信走 Foundation；登录态以 `auth_user` Cookie 为准 |
| Deployment 概念 | ✅ 通过 `HZY_PLATFORM_DEPLOYMENT_CODE` / `HZY_PLATFORM_RUNTIME_TOKEN` / `HZY_PLATFORM_SIGNING_PUBKEY` 激活 |
| Bundle 缓存 | ✅ `.data/platform-runtime` 本地缓存与 activation status 已落地 |
| Directory Runtime | ✅ 本地 `directory_*` 表、sync jobs、subject exports 与目录 API 已落地；account 仅保留迁移期兼容 |
| Subject 同步 | ✅ 启动时执行一次 `directory_subject_exports` 重建并推送 Platform；已支持 `committee` 独立类型与 stale source export 失效化；⚠️ 周期性 worker 未落地 |

### 1.3 foundation

| 维度 | 状态 |
|------|------|
| `server/utils/accountApi.ts` | ✅ 旧的 account 桥接 |
| `server/utils/platformClient.ts` | ❌ 不存在；新控制面调用没有统一入口 |
| `usePermissions` | ⚠️ 旧能力仍基于 Account 权限树；`useAuthorization` 读取模块本地 `/api/auth/permissions`，Console 已由该接口转向本地 bundle |
| Directory Adapter | 🎯 目标优先读 console directory-runtime，迁移期 fallback account |

### 1.4 account（迁移期）

| 维度 | 状态 |
|------|------|
| 用户/部门/项目主数据 | ✅ 已上线 |
| 企业管理员入口 | ✅ 有 `/admin` 类页面 |
| Subject 最小实体读取接口 | ⚠️ 现有 `users/departments` 可用，但缺面向 console 的统一最小实体快照接口 |
| Subject 同步审计 | ⚠️ 有通用审计能力，缺与 `subject_sync` 任务对齐的结果记录 |
| 长期定位 | 🎯 不再作为企业端必选独立基础服务；目录能力迁入 console 后仅保留兼容 facade / 迁移源 |

---

## 2. 波次一目标

> **一句话目标：在 platform ops 控制台跑完一个开通流程，得到一份能直接交给 console `.env` 启动的部署凭证；Console 启动时从企业目录最小投影同步 subject 到 platform。**

完成波次一后达到的可演示状态：
1. 平台运营在 ops 后台依次：建租户 → 选套餐 → 建 console 部署 → 签 license → 生成首个签名 bundle
2. 操作完成后，运营可下载或复制一份 `console.env`：包含 `HZY_PLATFORM_URL` / `HZY_PLATFORM_DEPLOYMENT_CODE` / `HZY_PLATFORM_RUNTIME_TOKEN` / `HZY_PLATFORM_SIGNING_PUBKEY`
3. Console 启动时从本地 `directory_subject_exports` 重建最小 subject 投影并回传 Platform，Platform 可看到同步后的 `tenant_subjects`

> 2026-04-27 实现已包含：console 启动 heartbeat、bundle 拉取/验签/cache、activation 待激活模式。bundle 自动滚动与 revocation 自动滚动仍放在后续波次。

---

## 3. 波次一任务清单

### 任务编号约定

- `P-*` = platform 内任务
- `A-*` = account 内任务
- `C-*` = console 内任务
- `F-*` = foundation 内任务
- `D-*` = 文档与脚本

### 3.1 Platform：API 合同收敛（实现迁就合同）

| ID | 内容 | 文件路径 | 备注 |
|----|------|----------|------|
| P-01 | 新增 `/api/v1` 合同命名空间，按合同暴露 `auth/policy/revocations/runtime/registry`；`/api/v1/internal` 不定义 | `platform/server/api/v1/auth/**`、`platform/server/api/v1/policy/**`、`platform/server/api/v1/revocations/**`、`platform/server/api/v1/runtime/**`、`platform/server/api/v1/registry/**` | 可短期复用现有 handler，但新能力必须优先落在合同路径 |
| P-02 | `platform-access` 中间件按合同路径分流，并禁止把 `internal` 暴露到 `/api/v1` | `platform/server/middleware/platform-access.ts` | `/api/v1/runtime` / `/api/v1/policy` / `/api/v1/revocations` / `/api/v1/registry` 归 runtime 认证域；`/api/platform/internal/**` 继续走内部认证域 |
| P-02b | internal 统一鉴权：`/api/platform/internal/**` 必须校验 service token（后续可升级 mTLS） | `platform/server/middleware/platform-access.ts` + 相关 `runtimeConfig.security` 说明 | 约定 `x-hzy-internal-token`（或 Bearer）为唯一准入凭证；无 token / 弱 token 一律 403 |
| P-03 | 兼容退役机制 + 文档同步 | `platform/server/middleware/platform-access.ts` + `docs/Control-Plane-API-Contract.md` | `/api/platform` 对外接口仅保留兼容期并返回 `Deprecation/Sunset` 响应头；合同文档明确“`/api/v1` 唯一对外路径” |

### 3.2 Platform：静态 runtime token 与 deployment 凭证

| ID | 内容 | 文件路径 | 备注 |
|----|------|----------|------|
| P-04 | 新建 `tenant_runtime_credentials`（`tenant_code` 主键）并落 `runtime_token_hash` / `runtime_token_last4` / `status` / `revoked_at` | `docs/HZY-Platform-SQL-Migration-v2.4-runtime-token.sql`（新建迁移） + `docs/HZY-Platform-SQL-DDL-Draft-v2.sql` 同步 | token 仅存 hash（sha256），明文一次性返回；不复用 `tenant_app_credentials` |
| P-05 | 新增工具函数 `issueRuntimeToken / verifyRuntimeToken` | `platform/server/utils/runtimeToken.ts`（新） | `crypto.randomBytes(32).toString('base64url')`，前缀 `hzy_rt_` |
| P-06 | runtime 路由鉴权改造：从 `Authorization: Bearer hzy_rt_xxx` 解析 token，按 `deployment -> tenant -> tenant_runtime_credentials` 校验并注入 `deployment` 上下文 | `platform/server/utils/runtimeAuth.ts`（新）+ `platform/server/middleware/platform-access.ts` 调用 | runtime 路由在中间件里完成鉴权，handler 直接拿 `event.context.deployment` |
| P-07 | ops API：签发/吊销租户级 runtime token（入口可挂 deployment） | `platform/server/api/platform/_handlers/ops/deployments/[deploymentCode]/runtime-token.post.ts`、`runtime-token.delete.ts` | 仅 ops 角色可调；明文 token 仅返回一次 |

实现进度（2026-04-26）：P-04 已补齐迁移文件；P-05/P-06/P-07 已落地。`/api/v1/runtime|policy|revocations|registry/**` 与旧 `/api/platform/runtime/**` 均要求 `Authorization: Bearer hzy_rt_...`，middleware 校验后注入 `event.context.platformRuntime` / `event.context.deployment`。

### 3.3 Platform：Ed25519 签名密钥

| ID | 内容 | 文件路径 | 备注 |
|----|------|----------|------|
| P-08 | 新增 `platform_signing_keys`（**平台根密钥，签 bundle/license/revocation**）：`kid / alg='Ed25519' / public_key / private_key_ref / status / activated_at` | DDL + 迁移 | 私钥以文件路径或 KMS ref 形式落库，env 注入；与 deployment 密钥**完全无关**，平台不持有 deployment 任何密钥材料（D-5） |
| P-09 | 工具函数：`getActivePlatformKey / sign / exportPubkey` | `platform/server/utils/platformSigning.ts`（新） | 用 Node `crypto.sign('Ed25519', ...)` |
| P-10 | 启动检查：dev 模式下若无 active key，自动 ed25519 generate 写入 `private_key_ref` 指向本地路径 | `platform/server/plugins/ensureSigningKey.ts`（新） | 仅 dev 自动；生产必须运维显式初始化 |
| P-10b | `deployments` 表增加治理摘要字段：`current_kid VARCHAR(64) / current_pubkey_fingerprint VARCHAR(64) / last_kid_reported_at DATETIME / last_key_rotated_at DATETIME` | DDL + 迁移 + `docs/HZY-Platform-SQL-DDL-Draft-v2.sql` 同步 | **不新增 platform_deployment_pubkeys 表**；平台只通过心跳收集 deployment 当前 kid + 公钥指纹做治理，永远不持有完整公钥；指纹突变可触发告警 |
| P-10c | 心跳接口接收并写入 `current_kid / current_pubkey_fingerprint` | `platform/server/api/platform/runtime/deployments/[deploymentCode]/heartbeat.post.ts` | 心跳 body 增加 `signingKey: { kid, fingerprint }`；指纹按 sha256(public_key) 前 16 字节计算 |
| P-10d | 删除 `deployment_signing_keys` 模型与迁移残留（DDL + 代码引用） | `docs/HZY-Platform-SQL-Migration-v2.4-drop-deployment-signing-keys.sql`（新）+ `docs/HZY-Platform-SQL-DDL-Draft-v2.sql` + `docs/Huizhi-yun-Platform-Target-Architecture.md` | 旧表执行 `DROP TABLE IF EXISTS deployment_signing_keys`；所有逻辑统一改读 `deployments.current_kid/current_pubkey_fingerprint` |

实现进度（2026-04-26）：P-08/P-09/P-10 已落地；P-10b/P-10d 已通过 DDL 与迁移表达；P-10c 已同时覆盖 `/api/v1/runtime/heartbeat` 与旧 `/api/platform/runtime/deployments/{deploymentCode}/heartbeat`。平台根密钥只用于签 bundle/license/revocation；deployment 密钥仍只在客户侧 console 存在，platform 仅记录 `kid + fingerprint` 摘要。

### 3.4 Platform：Policy Bundle 生成器

| ID | 内容 | 文件路径 | 备注 |
|----|------|----------|------|
| P-11 | bundle 序列化器：把 `tenant_subjects / tenant_subject_roles / tenant_template_bindings / tenant_template_overrides / tenant_roles / tenant_role_permissions / tenant_role_scopes / tenant_permission_templates / platform_system_roles / platform_app_manifest_resource_actions / capabilities` 拼成 JSON | `platform/server/utils/policyBundle.ts`（新） | 字段以 `Control-Plane-API-Contract` §6 为参考；`tenant_account_roles` 仅用于 dashboard/admin，不进入 runtime bundle |
| P-12 | 签名 + 落库：调用 P-09 签名，写 `policy_bundles`（version 自增、bundle_hash、signature、signed_at） | 同上 | bundle_uri 先以本地路径或 inline payload 表达，OSS 上传放波次三 |
| P-13 | ops API：触发某个 tenant 的 bundle 生成 | `platform/server/api/platform/_handlers/ops/tenants/[tenantCode]/bundles.post.ts` | 同步生成、同步返回 version；性能问题留给波次三 |
| P-14 | 现有 `/runtime/deployments/[code]/bundle` 增加签名信息字段透出（`signature / kid / alg`） | `platform/server/api/platform/runtime/deployments/[deploymentCode]/bundle.get.ts` | 不破坏现有 schema，只补字段 |
| P-14b | bundle 接口支持 `If-None-Match`（基于 `bundle_hash`）/ `version` 查询；版本一致返回 304，未指定则返回 latest 全量 | `platform/server/api/platform/runtime/deployments/[deploymentCode]/bundle.get.ts`、`bundle-meta.get.ts` | 减少首次以外的重复带宽；同步在 `/api/v1` 合同路径开放 |

实现进度（2026-04-26）：P-11/P-12 已落地 `platform/server/utils/policyBundle.ts`，bundle 来源限定为 runtime 授权与治理表（`tenant_subject_roles` / template bindings / capabilities / manifest actions 等），明确不读取 `tenant_account_roles`。P-13 已新增 `POST /api/platform/ops/tenants/{tenantCode}/bundles` 同步生成并签名；P-14/P-14b 已覆盖旧 `/api/platform/runtime/**` 与 `/api/v1/runtime|policy/**`，响应透出 `signature / kid / alg / signedAt`，并支持基于 `bundle_hash` 的 ETag 与 `version|bundleVersion` 查询。DDL 增补 `policy_bundles.signed_at`，迁移见 `docs/HZY-Platform-SQL-Migration-v2.4-policy-bundles.sql`。

### 3.5 Platform：Onboarding 向导（一站式开通）

| ID | 内容 | 文件路径 | 备注 |
|----|------|----------|------|
| P-15 | Onboarding 编排器：`createTenant → ensureConsoleApp → createSubscription → createDeployment(console) → issueLicense → issueRuntimeToken → triggerBundleGen` 单事务/分步事务 | `platform/server/utils/onboardingFlow.ts`（新） | 失败时记录 `tenant_onboarding_steps` |
| P-16 | ops API：开通向导 | `platform/server/api/platform/_handlers/ops/onboarding/start.post.ts`、`step.post.ts`、`finalize.post.ts` | step 接口可分步调用；MVP 也允许 start 一把梭 |
| P-17 | ops UI 页：开通向导 | `platform/app/pages/admin/onboarding/index.vue`、`platform/app/pages/admin/onboarding/[tenantCode].vue` | 用 UStepper / UForm；最后一屏展示 console.env 文本块和 "复制 .env" 按钮 |
| P-17b | 向导步骤强约束：subject_sync 至少完成一次（含企业管理员 subject）才允许进入"生成首版 bundle"步骤；finalize 屏提供 `console.env` 与 `license.lic` 下载入口 | `platform/server/utils/onboardingFlow.ts` + `platform/app/pages/admin/onboarding/[tenantCode].vue` | 避免 console 启动时 bundle 内无管理员 subject 的死锁；下载文件名固定为 `<tenantCode>.console.env` / `<tenantCode>.license.lic` |
| P-18 | seed：把 `console` 注册为 `service_role='supporting_service'` 的内置应用，附带初始 manifest | `platform/server/utils/seedConsoleApp.ts`（新）+ 启动 plugin 调用一次 | 让开通流程能直接选 console 作为 deployment 目标 app |

实现进度（2026-04-26）：P-15/P-16 已落地 `platform/server/utils/onboardingFlow.ts` 与 `/api/platform/ops/onboarding/{start,step,finalize,status}`。`start` 会创建/更新租户、确认内置 `console` 应用、创建租户主订阅与 per-app entitlement、创建 `console` deployment、签发带 Ed25519 签名 token 的 `license.lic`、签发一次性 runtime token，并输出 `console.env`。P-17/P-17b 已新增 `/admin/onboarding` 与 `/admin/onboarding/{tenantCode}`；bundle 生成默认受 subject gate 约束，未同步 active user subject 时将 `subject_sync` / `bundle` 步骤置为 blocked，可显式 `forceBundle` 跳过。P-18 已新增启动种子 `platform/server/plugins/ensureConsoleApp.ts`，注册 app_code=`console`、`service_role='supporting_service'` 并同步初始 manifest。

### 3.6 Platform + Console Directory Runtime：subject 最小实体同步（启动一次同步 + 后续任务驱动）

| ID | 内容 | 文件路径 | 备注 |
|----|------|----------|------|
| P-19 | 新增 `subject_sync` 任务模型与 ops 触发 API（创建任务） | `platform/server/api/platform/_handlers/ops/tenants/[tenantCode]/subject-sync/start.post.ts` + 迁移脚本 | 任务至少含：`task_id / tenant_code / target_deployment / cursor / status / requested_by / requested_at` |
| P-20 | 新增 runtime 侧任务拉取/结果回传 API：`pull` + `push`，`push` 幂等 upsert `tenant_subjects` | `platform/server/api/platform/runtime/deployments/[deploymentCode]/subject-sync/pull.get.ts`、`push.post.ts` | `push` 入参只允许最小实体：`subjectType / subjectCode / externalRef / status`；禁止传姓名/邮箱/手机等 PII 字段，`displayName` 在 subject_sync 路径强制置空或脱敏 |
| P-20a | MVP 直接接收 Console 启动时推送的最小 subject 投影 | `platform/server/api/v1/runtime/subjects/sync.post.ts` | 已实现。按 runtime token 鉴权，允许 `user / department / committee / job`，过滤不支持类型，用户 `display_name=NULL`，写 `tenant_subjects` 与 deployment directory sync 摘要；`committee` 仅作目录容器，不进入授权 UI |
| C-01 | console 增加 `subject_sync` worker（定时任务） | `console/server/plugins/subjectSync.worker.ts`（新） | 默认每 5 分钟执行：`pull task -> read directory_subject_exports -> push result`；迁移期可配置 fallback account |
| C-02 | console 提供手动执行入口（便于验收） | `console/server/api/subject-sync/run.post.ts`（新） | 手动 run 与定时 run 复用同一执行器 |
| C-03 | console 生成最小 subject 投影 | `console/server/utils/directorySubjectExport.ts`（新）+ console 目录表/缓存 | 输出最小字段（`subjectType/subjectCode/externalRef/status`），禁止返回敏感 PII；支持分页/游标 |
| C-03a | Console 启动时执行一次本地 subject 投影重建并推送 Platform | `console/server/utils/platformSubjectSync.ts` + `console/server/plugins/bootstrap.ts` | 已实现。复用 `startDirectorySyncJob({ objectScope: 'subjects' })` 与 `listSubjectExports()`，只推送 Platform 支持的 subject type |
| A-01 | account 提供迁移期最小实体读取接口（给 console fallback 调用） | `account/server/api/v1/directory/subjects/minimal.get.ts`（新） | 仅作为迁移期 fallback；稳定后由 console directory-runtime 直接生成投影 |
| A-02 | account 记录同步读取审计 | `account/server/utils/*` + 必要文档更新 | 至少记录调用方、时间、返回条数；用于迁移期问题追踪 |

实现进度（2026-04-28）：P-20a/C-03a 已落地，满足 Console 首次启动时把本地 `directory_subject_exports` 的最小投影同步到 Platform。当前实现已补充 `committee` 独立 subject type、Platform UI 过滤委员会容器，以及 Console 源目录硬删除后将旧 subject export 标记为 `inactive` 的清理逻辑，避免 Platform 长期保留 active 旧主体。原 P-19/P-20/C-01/C-02 的任务队列、pull worker、手动补偿入口尚未落地，应作为后续增强保留；A-01/A-02 暂未实施，因为当前实现已优先使用 Console 本地目录投影。

### 3.7 Foundation：platformClient 雏形

| ID | 内容 | 文件路径 | 备注 |
|----|------|----------|------|
| F-01 | 新增 `platformClient.ts`：封装 `runtime token` Bearer + base url；提供 `fetchBundle / postHeartbeat / pullSubjectSyncTask / pushSubjects / checkPermission` | `foundation/server/utils/platformClient.ts`（新） | 不依赖 Nuxt runtime 的 ofetch 即可，便于以后剥离成独立包 |
| F-02 | 在 foundation 文档中登记新能力 | `docs/FOUNDATION_CAPABILITIES.md` 新增 "Platform Client" 段落 | 给 console 调用方背书；account 仅迁移期 fallback |

> 波次一未动 console 的 `heartbeat.post.ts` / `permissions.get.ts`；当前 `heartbeat.post.ts` 已在波次二清理，`permissions.get.ts` 已切到本地 bundle。

实现进度（2026-04-27）：F-01/F-02 尚未落地。Console 当前通过本模块内的 `console/server/utils/platformRuntime.ts` 直接调用 Platform；Foundation 仍未提供统一 `platformClient`。

### 3.8 Console：首次启动激活与 Bundle 引导

| ID | 内容 | 文件路径 | 备注 |
|----|------|----------|------|
| C-10 | 启动 plugin：读 `.env` → 校验 license（Ed25519 验签）→ 按 `TENANT_CODE` 调 `GET /api/v1/runtime/tenants/{tenantCode}/profile` 初始化 `org_profiles` → 检查本地 bundle 缓存 → 若无则调 `GET /api/v1/runtime/deployments/{code}/bundle` 拉取并验签 → 落地到本地缓存（文件或 SQLite） | `console/server/plugins/bootstrap.ts`（新）+ `console/server/utils/bundleCache.ts`（新） | License 验签失败 = 启动失败；bundle 拉取失败不 crash，进入"待激活"模式 |
| C-11 | "待激活"模式：全局中间件拦截业务页面，仅放行 `/activation` 与登录；activation 页面显示当前状态、最近一次错误、"重试拉取" 按钮 | `console/app/middleware/activation.global.ts`（新）+ `console/app/pages/activation.vue`（新） | 拉取失败时每 30s 自动重试；管理员可手动触发；激活成功后自动跳回首页 |
| C-12 | env 校验：启动时校验 `HZY_PLATFORM_URL / HZY_PLATFORM_DEPLOYMENT_CODE / HZY_PLATFORM_TENANT_CODE / HZY_PLATFORM_RUNTIME_TOKEN / HZY_PLATFORM_SIGNING_KID / HZY_PLATFORM_SIGNING_PUBKEY / HZY_PLATFORM_LICENSE_PATH` 必填，缺失则启动失败并打印缺失字段清单 | `console/server/plugins/bootstrap.ts` | 失败语义清晰，不要在运行时才发现缺配置 |
| C-13 | `.env.dev.example` 增补激活相关字段及注释（指向 platform onboarding 向导最后一屏） | `console/.env.dev.example` | 与 D-03 合并执行 |

实现进度（2026-04-28）：C-10/C-12 已落地 `console/server/plugins/bootstrap.ts`、`console/server/utils/platformRuntime.ts`、`console/server/utils/bundleCache.ts`，启动时校验 `console.env` 必填字段并验签 `license.lic`；验签通过后按 `TENANT_CODE` 调 `/api/v1/runtime/tenants/{tenantCode}/profile` 拉取非敏感企业资料并 upsert `org_profiles`，若 Platform 暂不可达但本地已有 profile 可离线继续，首次无 profile 时启动失败；无本地 bundle 缓存时调用 `/api/v1/runtime/deployments/{deploymentCode}/bundle` 拉取、验签、校验 hash 后写入 `.data/platform-runtime`。bundle 拉取失败不 crash，记录激活状态并进入待激活模式；license 验签失败或 env 缺失会启动失败。C-11 已新增 `/activation`、`app/middleware/activation.global.ts`、`/api/activation/{status,retry}`，支持状态展示、最近错误、手动重试和 30s 自动重试；激活成功后自动回原页面。C-13 已新增 `console/.env.dev.example`，并同步 `console/.env.example` 激活字段。当前实现还会在激活成功后向 `/api/v1/runtime/heartbeat` 上报 deployment 心跳，在启动阶段触发一次 subject projection sync，并在 heartbeat 返回 `download_bundle` action 时刷新本地 bundle cache。

### 3.9 文档与脚本

| ID | 内容 | 文件路径 | 备注 |
|----|------|----------|------|
| D-01 | 本方案文档 | `docs/Platform-Console-MVP-Integration-Plan.md`（即本文件） | 后续按波次推进时同步更新 |
| D-02 | DDL 同步 | `docs/HZY-Platform-SQL-DDL-Draft-v2.sql` + `docs/HZY-Platform-Schema-Addendum-v2.4.md` | 把 P-04、P-08、P-10b、P-10d 的结构变更并入 |
| D-03 | env 模板 | `console/.env.dev.example` 补 `HZY_PLATFORM_URL` / `HZY_PLATFORM_TENANT_CODE` / `HZY_PLATFORM_DEPLOYMENT_CODE` / `HZY_PLATFORM_RUNTIME_TOKEN` / `HZY_PLATFORM_SIGNING_*`；`account/.env.dev.example` 仅迁移期如需 fallback 再补 | 注释说明从平台 onboarding 屏幕复制 |
| D-04 | 控制面 API 合同更新 | `docs/Control-Plane-API-Contract.md` 明确“`/api/v1` 唯一对外路径”、`/api/platform` 兼容退役窗口、`internal` 私有边界；补 `POST /api/v1/runtime/subjects/sync` 接口说明 | 与 P-03、P-20a 同步 |
| D-05 | internal 安全说明补充 | `docs/Platform-Console-MVP-Integration-Plan.md` + `platform/CLAUDE.md`（如需） | 明确 internal 接口统一鉴权机制（service token，后续可升级 mTLS），禁止匿名访问 |

---

## 4. 验收标准

波次一完工的可验证项：

1. ✅ 平台 ops 走完 onboarding 向导，得到一份 `console.env` 内容（含明文 runtime token、公钥、deployment_code、tenant_code）
2. ✅ 数据库可见：`tenants` / `tenant_subscriptions` / `subscriptions` / `deployments` / `licenses` / `tenant_runtime_credentials` / `policy_bundles` / `platform_signing_keys` 各有一条 demo 数据
3. ✅ 调 `GET /api/v1/runtime/deployments/{code}/bundle` 带 token 能拿到带签名的 bundle，去掉签名 verify pass
4. ✅ Console 启动时执行一次 subject projection sync 后，platform 数据库 `tenant_subjects` 出现至少一条来自企业目录最小投影的 subject 记录；周期性任务/手动补偿入口后续补齐
5. ✅ ops 后台 deployments 页能看到 demo 部署的 license 状态、bundle 版本
6. ✅ `POST /api/platform/internal/identity/resolve-subject` 在无 internal service token 时返回 403；带合法 token 才可访问
7. ✅ console 启动 plugin：缺 `.env` 字段时启动失败并打印缺失清单；license 验签失败时启动失败；初次启动能从平台拉到首版 bundle 并完成本地验签与缓存
8. ✅ 模拟平台不可达场景：console 进入"待激活"模式，UI 拦截业务页面，重试按钮可恢复

> 当前实现已覆盖 Console 启动 heartbeat、旧 UI heartbeat Account 入口退场、bundle 拉取/验签/cache 与 Console 本地 bundle 鉴权。波次二重点转为：业务应用权限消费切到本地 bundle、subject 周期性补偿同步与 revocation 闭环。

---

## 5. 进度跟踪

建议用 GitHub issue / Linear ticket 一一对应任务编号；本文件保留任务清单原文，状态字段在合并 PR 时回写。

| 任务 | 状态 | PR | 完成日期 |
|------|------|----|----------|
| P-01 ~ P-14b（含 P-10b/c/d） | 已完成 | — | 2026-04-26 |
| P-15 ~ P-18（含 P-17b） | 已完成 | — | 2026-04-26 |
| P-20a / C-03a（启动一次 subject projection sync） | 已完成 | — | 2026-04-27 |
| Console 本地 bundle 权限消费（`/api/auth/permissions` + 服务端 `checkPermission`） | 已完成 | — | 2026-04-28 |
| Console 旧 UI heartbeat Account 入口退场 + dashboard roles `tenant_console` 默认值清理 | 已完成 | — | 2026-04-28 |
| P-19 ~ P-20 / C-01 ~ C-02（任务驱动 subject_sync） | TODO（后续增强） | — | — |
| C-10 ~ C-13（启动激活） | 已完成 | — | 2026-04-26 |
| A-01 ~ A-02 | 暂缓（Console 本地投影优先） | — | — |
| F-01 ~ F-02 | TODO | — | — |
| D-01 ~ D-05 | 持续更新；本轮完成实现状态核对 | — | 2026-04-28 |

---

## 6. 风险与回退

| 风险 | 缓解 |
|------|------|
| 静态 runtime token 泄漏 | token 仅 hash 落库；ops 后台支持随时吊销并重新签发；onboarding 屏幕只展示一次明文并支持复制 |
| Ed25519 私钥误入 git | dev 模式自动生成在仓库外（默认 `~/.huizhi-yun/platform-keys/`）；生产由运维注入路径或 KMS ref；`.gitignore` 兜底 |
| Onboarding 中途失败留下半成品数据 | `tenant_onboarding_steps` 记录每步状态；提供"清理 demo 租户"运维 API（仅 dev/staging） |
| subject 同步仅在启动时执行一次，运行期目录变更不会自动到达 Platform | 后续补 P-19/P-20/C-01/C-02；短期可通过重启 Console 触发一次同步。Console 已能把源表硬删除后的旧投影标记为 inactive，但仍依赖下一次 subject sync 推送到 Platform |
| console directory 投影 / account fallback 与 platform 字段不一致 | 当前 `POST /api/v1/runtime/subjects/sync` 在 Platform 侧白名单过滤 `user/department/committee/job` 并禁止用户 PII；后续任务队列版需补 schema 校验、任务日志与可重试状态 |
| internal 接口弱鉴权或外网暴露 | P-02b 落地 service token 校验，默认拒绝匿名；网关侧对 `/api/platform/internal/**` 做来源网段/入口限制 |
| /api/v1 与 /api/platform 双轨增加维护成本 | 以 `/api/v1` 作为唯一新增入口；`/api/platform` 仅兼容并记录调用，波次二下线对外 runtime/policy/revocations/registry 入口；CI 禁止新增 `/api/platform` 对外路由 |

---

## 7. 后续波次预告

- **波次二**：console 深度消费 platform（业务应用 bundle 本地鉴权、subject 周期性补偿同步、revocation 闭环）
  - 含：console 接管 deployment 签名密钥生命周期——本地 Ed25519 生成、私钥落 console `vault_secrets`、心跳上报 kid + 指纹、提供 `GET /api/v1/console/signing-keys` 让同部署业务 app 拉公钥
- **波次三**：心跳应答驱动 bundle 与 revocation 自动滚动；License 软过期 / 宽限期 / 硬过期降级 UI；ops 心跳监控页（含 deployment 密钥指纹突变告警、长期未轮换告警）
