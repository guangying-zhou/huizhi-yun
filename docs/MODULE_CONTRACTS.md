# 模块交互契约

> 本文档定义汇智云各模块间的 API 调用关系、共享标识和集成规则。
> 更新日期：2026-07-25

> 说明：本文档描述**当前有效契约与目标主路径**。新能力默认走 `platform` 策略治理、`console` 企业基础运行服务、Console Directory API、Console OIDC、Console service token 与 Foundation adapter；`account` 仅作为 legacy 目录/身份/项目注册表迁移源与兼容 facade。存量未迁移调用关系继续有效，但不得为新能力新增 `account` 权限治理、目录扩展或静态跨模块密钥依赖。详见 `Directory-Runtime-Contract.md`、`Account-Directory-Runtime-Refactor-Plan.md`、`console/docs/Console-Directory-Runtime-Integration-Plan.md`、`console/docs/Console-Functional-Design-v1.md`、`console/docs/sql/Console-SQL-DDL-Draft-v1.sql` 与 `console/docs/Console-API-Contract-v1.md`。

## 核心原则

策略包持久存储：Console → Foundation `consolePolicyStore` → Data Runtime `GET/PUT /v1/console/policy-bundle` → `hzy_console.policy_bundle_snapshots`。精确 capability 为 `console:policy-bundle:read|write`，来源固定 Console，audience 为 Runtime；完整 JWT、credential/grant 撤销及租户/部署校验先于读写。这两个 scope 的 Token 签发不读包摘要。PUT 内容 ETag + expectedEtag CAS 幂等，禁止旧同步覆盖新同步；GET 缺包为 null。协议及上线核验见 [持久包说明](../console/deploy/cloudflare/POLICY_BUNDLE_STORAGE.md)。

1. **禁止跨模块数据库直连** — 所有集成通过 HTTP API + 回调完成
2. **单一事实源** — 每类数据只有一个权威模块（见下表）
3. **稳定标识** — 跨模块引用使用业务键，不使用内部自增 ID
4. **统一服务认证** — 跨模块服务端 API 调用、回调、同步和写操作统一使用 Console 签发的 `token_use=service` JWT；业务应用通过 Console runtime/app identity 获取运行时配置与短期 token，本地 env 不新增跨模块 client secret，也不再依赖 app 级 `license.lic` bootstrap。目标模块验证 Console JWKS、`aud`、`scope`、`token_use=service` 和来源应用，不新增共享 webhook secret 或静态 API key。

Console 委托 Runtime 签发其他应用的服务令牌时，部署必须匹配 Runtime 已登记的 `deploymentBindings[appCode]`，并同时匹配 `<app>.runtime` client/subject 与 `source_app`。存在显式绑定表时，未登记应用或旧生产形状 `<tenant>-<app>` 不得作为 fallback；只有未配置绑定表的 legacy 部署保留旧命名规则。测试部署名不能因包含环境后缀而被拒绝，也不能删除精确绑定检查来放行。

## 企业应用 Shell 导航契约

- Console 是企业应用 Shell 的 UI 宿主，入口为 `/shell/{appCode}?target=...`；Tenant Gateway 未命中业务应用 base path 时按既有默认规则把该路径路由到 Console，不新增特殊服务端代理。
- Tenant Gateway 的默认 Console 转发在存在 `HZY_CONSOLE_SERVICE` 时直接使用该 Binding，保留统一头清理及 Console app/deployment/prefix 上下文；无 Binding 的私有部署仍使用显式 origin。仅本地多 Worker 启动器强制要求本地 Console/People Binding，不修改生产部署配置，方案见 `deploy/test-env/LOCAL_WORKERS_PLAN.md`。
- Foundation AppRail/AppLauncher 把当前用户应用目录中同源、非 Console 原生入口的业务应用转换为 Shell URL；Console、工作台和跨源部署继续使用直接 URL。
- Shell 只使用 `/api/user/applications` 返回的当前用户授权应用目录，并把 `target` 限制在该应用 `homeUrl/basePath` 内。该检查只约束导航，不能替代目标应用自身 OIDC、路由权限和服务端对象范围授权。
- 子应用 iframe 使用 `hzy_embed=1` 激活 Foundation 嵌入布局。嵌入布局隐藏父 Shell 已提供的全局应用入口、通知、用户菜单和反馈入口，保留应用自己的业务侧边栏、页面标题、操作和内容。
- 子应用只向同源父窗口发送 `hzy:shell:navigation` v1 消息；Shell 同时校验 `event.origin`、`event.source`、`appCode`、消息版本和目标 home path，随后同步父 URL 与标题。不得信任任意 postMessage 数据拼接 iframe URL。
- Shell 最多保留最近两个业务 iframe，使用 LRU 淘汰；pointer/focus 导航意图可预热下一个业务应用。同源业务 URL 顶层刷新默认恢复 Console Shell，只有显式 `standalone=1` 才进入独立应用模式；跨源应用保持直接访问。独立模式用于新窗口、开发测试和 Shell 故障降级，不得由普通刷新隐式触发。

## 数据归属

Codocs 组织资产管理员快速发布和查看记录由 Codocs BFF 与 tenant-runtime 专用合同承载，文档元数据、幂等发布计划及访问审计均归 Codocs runtime。快速发布不触发 Workflow 或企业微信通知；Directory 提供界面及 CSV 导出时查看人的当前姓名，审计用户取签名 actor。已发布资产短链接映射同样归 Codocs runtime，BFF 生成和解析时沿用原预览权限，短码不授权额外读取。权限、接口及部署依赖见 [runtime 合同 9.3.1–9.3.2](./Tenant-Runtime-API-Contract-v1.md#931-组织资产管理员发布与查看记录)。

| 数据类型               | 权威模块   | 标识键         | 其他模块如何获取         |
| ---------------------- | ---------- | -------------- | ----------------------- |
| 用户、部门、角色、权限 | Console directory-runtime（新主路径）/ Account（legacy 兼容） | `uid`, `dept_code` | 新接入使用 Console Directory API / Foundation adapter；存量 legacy 可继续 Account REST API |
| 平台项目注册表         | Console directory-runtime（新主路径）/ Account（legacy 兼容） | `project_code` | 新接入使用 Console Directory API / Foundation adapter；存量 legacy 可继续 Account REST API |
| 文档内容与元数据       | Codocs     | `uuid`         | Codocs REST API         |
| 研发执行（迭代/任务）  | Aims       | `work_item_id` | Aims REST API           |
| 产品版本、版本特性与版本目标进度 | Aims | `product_code`, `version_code`, `version_id` | Aims service REST API |
| 客户/商机/合同/经营回款计划 | Altoc      | `code`         | Altoc REST API          |
| 发票/到账/核销/支出/项目财务核算/人力成本参数 | Finance | `code` | Finance REST API |
| 资产/采购/环境/产品主档 | Assets     | `asset_code`, `product_code` | Assets REST API         |
| 人员事实、任职、离职交接任务、成本快照、项目贡献快照、个人绩效周期与确认结果 | People | `employee_uid`, `assignment_code`, `offboarding case_code/task_code`, `cycle_code` | People REST / service API |
| 轻量待办/通知/协同入口 | Console employee-portal | `uid`, `appCode`, `biz_id` | Console REST API / Foundation adapter |
| 深度组织协同/借调/协助 | Align（可选增强） | `request_code` | Align REST API          |
| 审批流程/实例/待办     | Workflow   | `instance_id`  | Workflow REST API       |

## 目标/新路径权威源

| 数据类型 | 目标权威模块 | 标识键 | 其他模块如何获取 |
| -------- | ------------ | ------ | ---------------- |
| 企业基础资料、系统参数、节假日/工作日历、集成配置、凭证引用 | 客户侧 Tenant Runtime Console/Vault adapter；Console 为薄 BFF | `tenant_code`, `setting_key`, `calendar_code + year_month`, `integration_code`, `secret_ref` | Console REST API → Foundation Console Runtime client → 客户 Runtime；不得直连 Console DB |
| 用户、部门、岗位、项目注册表、外部目录同步 | Console directory-runtime（已落地核心表与 API，持续迁移） | `uid`, `dept_code`, `project_code` | Console Directory API / Foundation adapter；新 adapter 不提供 Account fallback |
| 人员运营事实、任职、职级、月度人员成本、项目贡献快照和个人绩效周期 | People（端口 3007） | `employee_uid`, `assignment_code`, `cycle_code`, `contribution_code` | People REST / service API；来源事实保留 `source_app/source_biz_type/source_biz_id/source_refs` |
| 租户企业角色、主体授权、policy bundle | Platform（端口 3011） | `role_code`, `subject_code`, `bundle_version` | Platform Dashboard 治理；应用角色仅作为企业角色的权限聚合来源；Console / 企业应用运行时拉取签名 bundle 后本地鉴权 |
| 租户订阅、deployment、license、policy bundle、revocation | Platform（端口 3011） | `tenant_code`, `deployment_code`, `bundle_version` | Platform `/api/v1/runtime/**` / `/api/v1/policy/**` |
| 前端访问观测配置与摘要 | Observability Worker（Cloudflare） | `tenant_code`, `app_code` | Platform tenant-admin dashboard 通过 `/api/platform/tenant-admin/observability/**` 代理读取；明细存 Analytics Engine，摘要和配置存 D1 |

## Platform ↔ Console 运行时契约

ADR-017 新增的客户数据面契约：

| 调用方 | 被调用方 | 方式 | 用途 |
| ------ | -------- | ---- | ---- |
| Tenant Gateway 独立分钟调度 | Console | `POST /api/internal/policy-bundle/sync` 经 Console Binding | 固定空请求，无客户端可选 tenant/URL；使用 Gateway token + 60 秒时间窗的 path/tenant/deployment/app/environment/runtime/host HMAC。公网入口返回 404。成功 `{code:0,data:{ready:true}}`，不可用 503；重复同步可重试，Runtime CAS 不允许旧同步覆盖新同步 |
| Console BFF（Cloudflare / PM2 / Self-hosted） | 客户侧 Tenant Runtime Console adapter | Foundation `callConsoleTenantRuntime()`；已接入 profile、settings、business domains、regions、work calendar、audit read/append 和 current-user notification state 的 `/v1/console/**` 语义 API | Runtime 校验 service token tenant/deployment/exact source app/capability 和签名用户 actor，并在 SQL 前/返回前校验 enrollment tenant。Mutation 要求 Idempotency-Key，版本化写入要求 expectedRevision，业务写、receipt、审计同事务；notification recipient 固定为当前签名用户。Runtime 不可用时 503，不回退 Console DB |
| data-runtime Console adapter | 客户侧 `hzy_console` | `HZY_CONSOLE_DB_*`；与 Directory 同时启用时强制配置一致并共享一个连接池 | 作为 Console 租户数据唯一数据库入口；Console/Platform/Gateway 不接收 DSN 或凭证 |

已实现的 MVP 调用方向：

| 调用方 | 被调用方 | 方式 | 用途 |
| ------ | -------- | ---- | ---- |
| Console（PM2 / 私有单租户） | Platform | `GET /api/v1/runtime/deployments/{deploymentCode}/bundle` + `Authorization: Bearer HZY_PLATFORM_RUNTIME_TOKEN` | 首次启动、缓存启动刷新、heartbeat `download_bundle` action 触发时拉取签名 policy bundle |
| Console（PM2 / 私有单租户） | Platform | `GET /api/platform/runtime/applications?tenantCode={tenantCode}&deploymentCode={deploymentCode}` + `Authorization: Bearer HZY_PLATFORM_RUNTIME_TOKEN` | `/api/user/applications` 可按需获取当前 deployment 环境的租户订阅应用入口；用户可见性由本地已验签 policy bundle 的角色授权过滤 |
| Console（PM2 / 私有单租户） | Platform | `POST /api/v1/runtime/subjects/sync` + `Authorization: Bearer HZY_PLATFORM_RUNTIME_TOKEN` | 启动时重建 `directory_subject_exports`，并把最小 subject 投影同步到 `tenant_subjects`；同时同步 `directory_user_departments` 的多归属 membership 到 `tenant_subject_memberships`；不包含姓名、邮箱、手机等目录 PII |
| Console（PM2 / 私有单租户） | Platform | `POST /api/v1/runtime/heartbeat` + `Authorization: Bearer HZY_PLATFORM_RUNTIME_TOKEN` | 上报 Console deployment 心跳、bundle 版本、auth-runtime 健康状态与签名 key 指纹 |
| Console（Cloudflare 共享） | Platform | `GET /api/platform/internal/console/tenants/{tenantCode}/bundle?environment={environment}&deploymentCode={deploymentCode}` + `Authorization: Bearer HZY_CLOUDFLARE_INTERNAL_TOKEN` | runtime 模式由独立同步拉取并验签保存；普通鉴权 cache-miss 不再拉取。旧 memory 模式、显式管理刷新和既有高风险 fresh-policy 路径保留原语义。旧 `HZY_CONSOLE_PLATFORM_SERVICE_TOKEN` 仅作兼容；不使用租户 Runtime Token 或 deployment license token |
| Console（Cloudflare 共享） | Platform | `POST /api/platform/internal/console/tenants/{tenantCode}/subjects/sync?environment={environment}&deploymentCode={deploymentCode}` + `Authorization: Bearer HZY_CLOUDFLARE_INTERNAL_TOKEN` + `x-hzy-internal-principal: console-managed-cloud-worker` | LDAP/Account/企业微信/钉钉/GitLab 或手工 subject 同步完成后，把最小 subject 与 membership 投影写入 Platform；tenant/deployment/environment 只取可信 Tenant Gateway 上下文并由 Platform 绑定 active Console deployment，body 不能覆盖租户边界；不包含目录 PII |
| Platform tenant-admin | tenant Console BFF → Tenant Runtime | 复制安装命令内的 `directory-connector-enrollment.v1` 单次签名 token → Console `POST /api/v1/console/directory-connectors/enroll` → Runtime `POST /v1/console/directory-connectors/enroll` | Platform 同时把固定 Ed25519 `kid/public key` 写入受保护 Runtime 安装配置；Runtime 验原始 payload 签名、有效期、tenant、Console deployment 和单次 `jti`，在同一事务登记 RSA-3072 Connector 公钥与审计，只返回 Connector identity，不签发 Console OAuth credential |
| Directory Connector（独立 systemd/Linux 用户） | 本机 data-runtime Directory adapter | RSA-PSS 签名 loopback `POST /runtime/internal/directory-connector/{configuration,commands/lease,sync,commands/{id}/complete}` | Runtime 从客户侧 Vault resolve LDAP Secret 后只返回 Connector RSA-OAEP 密文；在客户服务器内 lease/fencing 执行创建用户、改密码、显式立即同步和连接认证测试。LDAP 全量同步只响应目录同步页提交的 `sync-now` 命令，启动和周期 tick 不自动扫描；data-runtime 通过 `directory_connectors.public_key_pem` 验签、校验 tenant/deployment、时间戳与 nonce 防重放；Connector 不持有数据库账号、Console OAuth credential 或 Vault 明文 |
| Console Directory BFF | data-runtime Directory adapter | `GET /v1/console/directory/{provisioning,me/password-capability,operations/{id}}`；`POST /v1/console/directory/{connector-operations/users,connector-operations/ldap-sync,me/password,sources/ldap/test}` + `console:directory-connector:{view,execute}` + 签名用户委托 | Runtime 排队 LDAP 创建用户、本人改密、立即同步和连接测试；命令、幂等 Receipt 与审计同事务，operation 状态仅原发起人可读；Console 不直连 `integration_operation` |
| data-runtime Directory adapter | 客户侧 `hzy_console` | 复用 data-runtime 受保护数据库配置，默认 `HZY_DIRECTORY_DB_NAME=hzy_console` | 本地事务写 `directory_users`、`directory_identities`、membership、sync job、operation attempt 和最小 subject export；LDAP 明细与数据库逐行处理不经过 Cloudflare |
| data-runtime Directory adapter | Platform | 分块 `POST /api/v1/runtime/subjects/sync` + enrollment 返回的租户 Runtime Token | 每次本地同步成功后以最多 10 条/请求提交脱敏 subject/membership、snapshot hash 与 Console deployment 绑定；tenant-runtime enrollment 必须把同环境 active Console deployment 纳入 `tenant_runtime_instance_apps`，Platform 继续按精确 deployment 绑定校验 Runtime Token；Console 记录仅作为控制面绑定，固定 `schema_ready/not_applicable`，不生成 adapter enable flag，也不参与 Agent schema 心跳更新；首块重置 runtime membership、末块才提交健康游标，失败可从首块幂等重试；不提交姓名、邮箱、手机号、LDAP DN 或密码 |
| Console Directory lifecycle operation | Platform | `console.platform.employment-sync.v1` / `console.platform.offboarding-revoke.v1` → authorization employment/offboarding internal API | Console 在 Directory mutation/receipt 同事务冻结 caller-owned operation；默认关闭的 bounded drain 使用 lease/fencing/attempt 投递。HMAC 绑定 Console source deployment、固定 Platform target deployment、tenant、path、capability、hash、original actor 与时间；Platform 在授权 mutation、水位和 receipt 同事务提交后才返回 succeeded |
| Console 授权运行时 | Platform | `POST /api/platform/internal/authorization/instance-conflict-explain` + `Authorization: Bearer HZY_CLOUDFLARE_INTERNAL_TOKEN`（或兼容 `HZY_CONSOLE_PLATFORM_SERVICE_TOKEN`） | 只读解释当前用户在具体业务对象上的自审批、同人经办审批和职责冲突风险；供 Console current-user API 与 Foundation helper 消费，业务应用不得直连 Platform tenant-admin 诊断接口 |
| 企业应用（经 Foundation） | Console | `GET /api/v1/console/runtime/apps/{appCode}/config` | 启动时拉取 app runtime config，包括 Console API 端点、应用元数据、Workflow 地址和非 secret 运行参数；不直接读取 app license 派生启动配置 |
| 企业应用浏览器（经本应用 Foundation BFF） | Console | `POST /api/heartbeat` → Console `POST /api/v1/heartbeat` + 当前已验证 Console 用户会话 | 每 2 分钟写入 Console tenant-runtime 在线状态；BFF 以服务端 `public.appCode` 固定来源应用且不接受浏览器 uid/sourceApp。Console 自身直接调用 `/api/v1/heartbeat`，业务应用不得保留只返回成功但不写 Runtime 的本地空壳接口 |

约束：

- PM2 / 私有单租户 Console 的 `HZY_PLATFORM_RUNTIME_TOKEN` 来自 platform 开通/订阅页面生成的 env artifact，platform 仅保存 hash。Cloudflare 共享 Console 不配置该 token。
- Tenant Gateway 调用 Platform internal `runtime-bootstrap-token` 时，90 秒 `data-runtime-bootstrap` JWT 的 `iss` 必须来自部署配置：优先可信 Worker bindings / 进程环境中的 `NUXT_PUBLIC_SERVICE_URL` 或 `PLATFORM_SERVICE_URL`，再回退 `runtimeConfig.public.serviceUrl`，不得固定为生产域名或使用请求 Host。开发控制面与生产控制面分别使用自身 URL 和签名密钥；缺少合法配置返回 503。Runtime 按受保护 `control.platformUrl` 精确验签发方，并继续校验 Console scope、tenant/deployment/app/runtime 绑定。Wiztek 2026-09-05 开发控制面规范 URL 已改为 `https://hzy.wiztek.cn`，生产仍为 `https://huizhi.yun`；旧开发域名的 HTTP 跳转不改变 JWT issuer 校验规则，新增测试 binding 必须使用新的规范 URL。
- 本地 C000001/test 联调由 `deploy/test-env/local-gateway.mjs` 复用 Gateway 头清理与精确 source-binding，固定回环 Console/People 后端和 SSH Runtime transport。Platform bootstrap 仍由正式接口签发，仅通过 SSH helper 在内存中刷新，内部服务凭证不下发本机。Console 仅在网关已认证、显式 `HZY_LOCAL_TEST_GATEWAY_ENABLED=true`、Node development/profile dev/environment test、配置 issuer 为 loopback HTTP 且与 forwarded host/proto/prefix 完全一致时保留本地 OIDC issuer；生产和共享托管规则不变。People 独立端口使用既有 standalone UI 模式，不改变 JWT、角色或数据范围授权。
- Tenant Runtime 的 Vault master key 由客户侧 KMS/受保护 Runtime 配置生成和持有；Platform、Console、Cloudflare Worker 和业务应用均不接收该值。Platform 如保留历史 bootstrap secret，只能用于一次性迁移到客户侧 Runtime，不能继续下发给 Console。
- PM2 / 私有单租户 Console 的 `HZY_PLATFORM_LICENSE_TOKEN` 和所有 Console policy bundle 必须用 `HZY_PLATFORM_SIGNING_PUBKEY` 验签；Cloudflare 共享 Console 不配置 `HZY_PLATFORM_LICENSE_TOKEN`，按请求从 Platform 内部 bundle 接口获取并验签。Platform 不再向业务应用下发 app 级 `license.lic`。
- Console 只缓存运行时授权包，不持有 platform 私钥，也不修改 platform 授权治理数据。
- Console `/api/auth/permissions` 与服务端 `checkPermission/requirePermission` 只读取本地已验签 policy bundle，不再代理 Account 权限 API；授权快照返回 `availableRoles` 与 `activeRoleCode`，其中 `availableRoles` 只包含平台企业角色。普通运行默认按用户全部有效企业角色合并计算 `roles/resources` 与 `/api/user/applications` / AppRail / AppLauncher 应用可见性，`activeRoleCode` 仅作为展示/显式模拟提示；只有服务端显式允许的 `role_simulation` 才按指定企业角色收窄，且无效模拟角色不得回退到其他角色；bundle 缺失、过期、未激活时生产环境按失败关闭。
- Policy bundle 的 `applications` 投影包含 `appCode/appName/description/icon/homeUrl/callbackUrl/logoutUrl/basePath/apiBase/appType/runtimeMode/serviceRole/authMode/bundleEnabled/status`，并按 `environment` 生成，可支撑 Console 离线应用入口展示和 OIDC client 物化；bundle 还包含 Platform deployment settings 的 `consoleLogin`，供 Console 运行时消费上游员工登录配置。Cloudflare 共享 Console 的 `/api/user/applications` 只读取本地已验签 bundle，不再用租户 Runtime Token 调用 Platform runtime applications。
- Policy bundle 主 `schemaVersion` 已切换为 `policy-bundle.v2`。新生成 bundle 不再输出已被 v2 替代的 `subjectRoles`、`subjectRoleScopes`、`roleScopes`、`baselinePermissions` 冗余字段，并新增 v2 `rolePermissionGrants` 作为角色权限事实；`rolePermissions` 仅作为历史兼容字段保留。Foundation/Console 对历史 bundle 仍保留 v1 fallback。Foundation 的 `buildScopedAuthorizationGrantsFromPolicyBundle()` / `evaluatePolicyBundleScopedAuthorization()` 优先读取 v2 `roleAssignments`、`rolePermissionGrants`、`assignmentScopes`、`roleDefaultScopes`、`baselineGrants`，缺失时回退 v1 `subjectRoles.assignmentId`、`rolePermissions`、`subjectRoleScopes`、`roleScopes`、`baselinePermissions`，并将用户 direct 角色、active 部门/职位 membership 继承角色和 assignment scope 转换为同一授权关系内的 grant 调用范围 evaluator；`baselineGrants` 由 Platform 全局治理表 `platform_baseline_permissions` 管理并投影到每个租户 bundle，当前不是 tenant-scoped 配置。租户差异继续通过角色授权、模板绑定和 `templateOverrides` 表达，override 不得改写或借用 baseline grant 的权限/范围；全局排除表投影的 `excludedSubjectCodes` 会同时被 Console 普通权限快照、Console scoped authorization 和 Foundation helper 过滤，使指定 uid/subjectCode 不获得默认登录权限。历史静态 baseline 清单仅作为未迁移 fallback。Foundation scoped evaluator、Console 扁平权限检查和 scoped authorization 会消费 v2 `actionImplications` 构造 `@hzy/authz-core` action policy，缺失时保持 core 默认保守蕴含；应用 manifest 可用资源级 `actionImplications[{resourceCode,action,implies}]` 声明自定义蕴含，Platform 合并到 bundle，Console 以 `actionPolicies[resourceCode]` 随普通/scoped 快照下发，Foundation 白名单归一化后透传给业务 helper。业务模块不得自行维护 `view/edit/admin` 层级或应用专属蕴含表。Console 权限快照同样优先读取 v2 `roleAssignments` / `rolePermissionGrants` / `baselineGrants`，并按 active 部门/职位 membership 继承主体授权；Console 普通权限快照、scoped authorization 快照和 Foundation 业务应用授权 helper 会透传 v2 `policyRevision`。`policyRevision` 由 Platform `tenant_policy_revisions` 单调状态表生成，并在 `policy_bundles.policy_revision/policy_hash` 中快照；Console/Foundation/业务应用不得自行递增或改写。Console current-user 实例冲突解释会在已验签 bundle 含 active v2 `conflictRules` 时优先通过 Foundation `explainPolicyBundleInstanceConflicts()` 本地计算，旧 bundle 或本地解释不可用时才回退 Platform internal API。Platform 提供 `buildDbAuthorizationGrants()` / `evaluateDbAuthorization()` / `DbGrantSource` 从 DB 形态构建同一授权单元并调用 `@hzy/authz-core`。Platform tenant-admin 还提供 `/api/platform/tenant-admin/authorization-explain` 和 `/api/platform/tenant-admin/instance-conflict-explain`，用于管理员诊断授权命中、范围拒绝以及实例级自审批/同人经办审批风险；运行时业务消费必须经 Console `/api/auth/instance-conflict-explain` 或 `/api/v1/console/user/instance-conflict-explain`，并由 Foundation `loadInstanceConflictExplanationFromConsoleRuntime()` 调用。现有 Console 与业务应用扁平 `checkPermission` 路径不得直接把 assignment scopes 合并进全局 scope，业务 API 需要对象上下文时应显式调用 scoped helper 或实例冲突解释 helper。
- Cloudflare 共享 Console 启动时不执行 subject sync、heartbeat 或 license token 校验；subject sync 改为在带可信 Tenant Gateway 租户上下文的目录同步请求中执行，并可由目录同步页“同步到 Platform”重试。PM2 / 私有单租户仍可执行 heartbeat 与 license token 校验，但所有部署都不再由 Console 从 Platform 拉取并直写 `org_profiles`；企业资料由 Tenant Runtime schema/init 和 `/v1/console/profile` 唯一管理。
- `applications.homeUrl/callbackUrl` 的运行态值由 Platform 生成 bundle 时解析：`homeUrl` 使用当前环境的 `deployment_sites.public_url + deployments.base_path`，为空时才回退到 `platform_applications.home_url`；`callbackUrl` 优先使用应用默认 `callback_url`，为空时按最终 `homeUrl + /api/auth/oidc-callback` 自动生成。manifest 的 `entry.web` 只作为源码声明，不作为客户最终访问地址。
- Foundation 的业务应用 startup activation 默认关闭：Platform activation、bundle 刷新和 heartbeat 只由 Console 执行。Foundation `consoleRuntime.ts` 在业务应用启动时向 Console 拉取 app runtime config；legacy `/api/platform-activation/*` 仅保留为迁移期诊断入口。
- Foundation 默认通过 Console OIDC 门面接入客户侧 Auth Runtime：前端 `useAuth` 消费 `hzy_*` token/session Cookie，服务端通过 Console JWKS 验证 access token 并注入 `event.context.consoleAuth`。OIDC private key、Session、Refresh family 和 token state 只由 Tenant Runtime 持有。`HZY_AUTH_MODE=legacy` 或 `HZY_LEGACY_AUTH_BRIDGE=true` 时才回退旧 CAS/Account bridge。
- Foundation 默认启用轻量 RUM client，向当前租户域 `/api/rum` 上报页面加载、Web Vital、同源 API 耗时与 JS 错误；tenant gateway 会转发到 Observability Worker。RUM 明细不进入业务数据库，不采集 Cookie、Authorization、请求体、用户输入或 URL query/hash。
- 企业应用之间的服务调用使用 Console service-token 门面：调用方通过 Foundation `requestServiceAccessToken()` 获取短期 `token_use=service` JWT，实际 client/credential/grant 校验、签名和 introspection 均由 Tenant Runtime Auth adapter 完成。业务应用和 Console env 不保存跨模块 client secret 或 signing private key。目标应用先验证 Console JWKS、`aud`、`token_use` 与 exact `scope`，再通过 Console `/oauth/introspect` 门面确认 token 仍绑定 current credential、active service client 和完整 active grants。托管云目标 Worker 的 introspection 必须使用 `HZY_CONSOLE_SERVICE` Cloudflare Service Binding 直达 Console；不得由后台 Worker 公网 fetch `console.huizhi.yun` 或租户 Console 域名，否则无浏览器国家上下文的子请求可能在到达 Console 前被 zone WAF 拒绝。托管云业务 Worker 对 Console 的 request-bound service API（包括运行参数读取和通知发布）同样必须通过 Foundation `fetchConsoleServiceJson(event, ...)` 使用 `HZY_CONSOLE_SERVICE`，并用 `trustedServiceRequestHeaders(event)` 仅转发已验证的 Tenant Gateway 与 Data Runtime bootstrap 上下文；不得只携带 `Authorization` 重新进入 Console 公网入口，否则 Console 无法建立 tenant-runtime 绑定。Console 自身仍使用 Nitro local fetch 避免 Worker 自调用环。明确 inactive 返回 401；Runtime/introspection 网络、超时或 5xx 失败关闭并返回可重试 503。可靠投递遇到目标 401 时淘汰缓存 token、强制刷新且只重试一次。Tenant Runtime 的 JWKS 缓存遇到未知 `kid` 必须在带冷却保护的前提下主动刷新一次，使 Console 密钥轮换立即生效且不开放无界刷新。签发时 `tenant/deployment/source_app/target_app` 必须来自已验证 Gateway/Runtime enrollment，多个兼容 claim 冲突必须拒绝；禁止 `credentialId=0`、通用管理员 scope 或 Console DB fallback。
- Codocs 文档共享用户选择器、批量协作者名称补全、部门名称补全与当前用户兼容视图统一通过 Codocs BFF 调 Console `GET /api/v1/console/service/directory/users`，使用 `aud=console`、精确 capability `console:directory-users:read`、`token_use=service`、`target_app=console` 与 tenant 绑定。批量读取用服务端生成的 `uids` 查询，部门投影只返回编码、名称和父子关系；Console 的用户投影只返回 `uid`、姓名、头像、部门和岗位等共享识别字段，不返回手机号、邮箱或目录管理字段；浏览器 Cookie、普通员工的 `directory_users:view` 和 Codocs 自身高权限身份均不能替代该服务授权。
- People 员工页的共享部门树沿用同一个受限投影：People BFF 必须先建立已验证用户会话，再由 People runtime 使用 `aud=console`、精确 capability `console:directory-users:read` 调用 `GET /api/v1/console/service/directory/users?projection=departments`。该 service grant 只允许读取最小共享字段，不形成 Console 应用 entitlement，也不能用 `console:directory_operator` 等人类 UI 角色替代；初始化 grant 由 `console/docs/sql/Console-SQL-Seed-v1.79-people-directory-sharing-read-grant.sql` 提供。
- Aims 项目协作页的用户列表也沿用该受限投影：Aims BFF 必须先建立已验证用户会话，再由 Aims runtime 使用 `aud=console`、精确 capability `console:directory-users:read` 调用 `GET /api/v1/console/service/directory/users`。Console 共享端点必须透传 `page` / `pageSize`（runtime 单页上限 100），Foundation BFF 对业务页面请求的较大姓名映射窗口自动分页合并；响应仅含 `uid`、姓名、头像、部门和岗位等共享识别字段，不返回手机号、邮箱或目录管理字段；`project_member` 等人类角色不获得任何 Console 应用权限，初始化 grant 由 `console/docs/sql/Console-SQL-Seed-v1.80-aims-directory-sharing-read-grant.sql` 提供。
- Aims 项目仓库关联选择器先通过 self-bound Directory 用户项目合同验证当前 UID 对 `parentId` / `parent_id` 指定 Git 群组的精确访问权；不得改回全局项目注册表，也不得由浏览器自报 UID 或其他群组扩大范围。授权通过后，Aims 使用 Console tenant-runtime 受控 `gitlab.group-projects` fixed operation 实时、稳定排序并自动分页读取该群组全部直属仓库，并在 GitLab 上游查询中排除归档仓库，不以可能滞后的 Directory 仓库注册表作为候选清单。Directory Runtime 的父群组过滤与直属子项目权限继承仍作为通用合同保留。
- Aims 项目表单所需的租户业务领域字典不得借用 Console `org_profile:view` 人类权限。Aims BFF 必须先建立已验证用户会话，再由 `aims.runtime` 使用 `aud=console`、精确 capability `console:business-domain:view` 调用 `GET /api/v1/console/service/business-domains`；Console 在校验 active credential、exact grant、target app 和 tenant binding 后，才以自身 Runtime 身份读取 `/v1/console/business-domains`。初始化 grant 由 `console/docs/sql/Console-SQL-Seed-v1.85-aims-business-domain-read-grant.sql` 提供，不产生 Console 菜单 entitlement。
- Altoc 页面按 UID 展示负责人、经办人和审计操作者时同样使用该受限投影：Foundation 将业务侧 `GET /api/directory/users/{uid}` 收敛为 Altoc runtime 持有 `aud=console`、精确 capability `console:directory-users:read` 的 `uids` 查询，并把最小共享数组还原为单用户响应。销售、商务等人类角色不获得 Console UI 目录权限；初始化 grant 由 `console/docs/sql/Console-SQL-Seed-v1.81-altoc-directory-sharing-read-grant.sql` 提供。
- Workflow 在创建、预检、重新提交审批实例和校验任务委托人时也沿用该受限投影：Workflow BFF 必须把当前 `H3Event` 传给 Foundation，由 `workflow.runtime` 使用 `aud=console`、精确 capability `console:directory-users:read` 读取发起人、部门及上级部门的最小共享字段，用于冻结审批人上下文。目录认证、授权或依赖故障必须失败关闭，不得返回空用户/部门并伪装成“未解析到审批人”；该 service grant 不产生 Workflow 操作者或审批人的 Console UI 权限，初始化与发布前核验分别使用 `console/docs/sql/Console-SQL-Seed-v1.96-workflow-directory-sharing-read-grant.sql` 和 `console/docs/sql/Console-SQL-Verify-v1.96-workflow-directory-sharing-read-grant.sql`。
- Codocs Issue 项目范围解析通过 `GET /api/v1/console/service/directory/project-access`，使用精确 capability `console:directory-project-access:read`。Codocs 先从已验证浏览器会话派生 `actor_uid`，Console 只返回指定项目的负责人、部门祖先编码和该 actor 是否为项目成员，不返回项目列表或成员清单。两项初始化 grant 均由 `console/docs/sql/Console-SQL-Seed-v1.56-codocs-directory-user-read-grant.sql` 提供。
- Console 零直连切换门禁的历史投递/同步阻断项只允许通过 Tenant Runtime 的受控处置接口处理：`GET /v1/console/cutover/dispositions` 要求 `aud=data-runtime`、`source_app=console` 与精确 capability `console:cutover-disposition:view`；`POST` 要求独立的 `console:cutover-disposition:manage`、`Idempotency-Key`、变更单号、逐条 `expectedSourceFingerprint` 和状态限定的 reason code。Runtime 在同一事务中锁定仍处于阻断状态的源记录，核对覆盖状态、尝试次数和更新时间的 SHA-256 指纹，追加 `console_cutover_dispositions`、操作日志和 mutation receipt；不得删除或改写原失败记录。门禁仅忽略 `status=active` 且指纹仍与当前源状态完全相等的处置；任何相关源字段变化都会使处置失效并自动恢复阻断。重复评审只把旧处置标记为 `superseded`，历史证据必须保留。活动 service client 的凭证完整性禁止豁免；重复的无凭证 legacy identity 只能通过 `POST /v1/console/cutover/service-clients/{id}/retire` 和独立 capability `console:cutover-service-client:retire` 受控停用。该操作必须先锁定源记录并核对覆盖关联凭证/Vault 指针的指纹，再验证同 app 已存在 active、凭证/Vault 完整且拥有 legacy 全部 active grants 的替代 identity；原行只改为 `inactive` 并保留 receipt 与操作日志。
- 企业应用之间的服务端调用不得使用浏览器入口 `homeUrl`，也不得要求租户在 Console 中配置目标应用服务地址。`homeUrl` 只用于浏览器导航。Tenant Gateway 从已解析的租户注册表生成不含 secret 的 `x-hzy-service-routes`（目标 Worker origin、目标 deployment、base path），覆盖浏览器同名头并与 Gateway token 一起建立可信边界；托管云 request-bound BFF 必须通过 Foundation `serviceAppFetch(event, appCode, url, options)` 使用渲染配置中同名的 `HZY_<APP>_SERVICE` Cloudflare Service Binding 直达目标 Worker，URL 可由 `resolveServiceAppBaseUrl(event, appCode, { directTarget: true })` 解析，并用 `trustedServiceRequestHeaders(event, appCode)` 将 app/deployment/prefix 原子改写为目标应用。没有 route catalog 的可靠后台回调可以由 `serviceAppFetch(null, ...)` 回到受信 tenant host，但 Tenant Gateway 必须对已绑定的目标应用使用 Cloudflare Service Binding 直达 Worker，不得再 fetch 同样被通配 Gateway route 覆盖的目标公网域名形成二次 Gateway 跳转。这样不得在 Gateway 同步等待来源 Worker 时重新请求同一 tenant host，也不得沿用来源 deployment。缺少可信目标路由时失败关闭；本地开发仍可由运营级 service URL 或端口表解析。
- Console session 每次鉴权仍实时读取 active session 与 active Directory 用户，撤销语义不做长缓存；`last_seen_at` 仅用于活动时间展示，最多每 5 分钟写回一次，不得让同一页面的每条 API 请求都产生一次 Hyperdrive UPDATE。
- Directory Runtime 向 Platform 分块投影 subject 前先携带完整、排序稳定的 `snapshotHash`；Platform 对当前 deployment 已为 `healthy` 且 hash 完全相同的首块返回 `unchanged`，data-runtime 必须立即停止后续块，不得每 5 分钟对未变化的 LDAP 全量快照重复执行 Platform 事务写入。hash 变化、首次同步或上次同步非健康时仍执行完整投影并在 finalize 后更新 reported hash。
- Console Directory 与 Platform 控制面统一使用项目主体类型 `project`，不得映射为表示岗位的
  `job`。项目父子关系同步为 `project → project`，用户项目成员关系同步为
  `user → project`，角色映射固定为
  `owner → leader`、`admin → manager`、`viewer → observer`、其他为 `member`。
  Platform 仅保存授权所需的脱敏最小投影，不在通用主体目录 UI 展示项目，也不把项目 membership
  当成部门/岗位角色继承；项目授权优先使用 `project:member|owner` 动态关系。Platform 不得将该投影
  反向作为 Console Directory 事实源，GitLab 项目注册信息也不得因进入最小投影自动获得企业角色。
- Console vault 凭证按 `integration / service / bootstrap / custody` 分类管理。Nuxt 业务模块不得直接依赖 `integration_credentials`、内部 credential id 或 `/vault/resolve`；外部集成能力必须通过 Foundation adapter 按 `integrationCode` 消费。程序化 resolve 只接受 service caller 的 `integrationCode`，服务端以当前 active `integrations → integration_credentials → 固定 vault version` 绑定解析；调用方不得传 `secretRef`、version 或 purpose。`service_client_grants.scope_json.integrationCodes` 是实际执行的精确 allowlist：必须同时匹配已验证 client ID、source app、`credential_vault:resolve` grant 和 `usage_type=integration / owner_type=integration / owner_key=integrationCode`，缺失或通配 scope 均失败关闭。服务身份读取 integration 配置也使用相同 allowlist。`connector-runtime` 是由 Console enrollment 创建、绑定到该 Console deployment 的单租户 supporting service，不在 Platform 创建伪应用 deployment；业务应用调用 Connector 时，Runtime 必须验证签名、introspection、tenant、audience、exact scope 和 body `sourceAppCode` 与令牌来源一致，并保留令牌中受信的来源 deployment 用于 ledger/audit，但不得要求该来源 deployment 等于登记 Connector 的 Console deployment，否则 Aims/People 等同租户业务部署无法使用共享 Connector。Connector 直达 Tenant Runtime 时仍保留 `source_app=connector-runtime`，Data Runtime 只在没有更精确显式绑定时使用已注册的 Console deployment 校验其 token，tenant、audience、service credential、grant 与 exact scope 校验均不放宽。`custody` 托管凭证默认只能授权 reveal，不能被程序化 resolve。
- Env 收敛规则：Console 是唯一直接消费 `HZY_PLATFORM_*` 与企业级集成 secret 的企业端基础运行模块；业务应用优先只保留自身数据库、应用身份和 base path，不再新增 app 级 `license.lic`。`HZY_CONSOLE_API_URL`、`HZY_WORKFLOW_API_URL`、`HZY_ACCOUNT_API_*`、`ALIYUN_OSS_*`、`GITLAB_*`、`WECOM_*` 等平台级配置不得在新业务模块中新增，迁移期存量项按 [`ENV_SIMPLIFICATION_PLAN.md`](ENV_SIMPLIFICATION_PLAN.md) 逐步清理。

### 项目治理唯一角色持有人契约

- Platform 企业角色 `project_director` 与 `qa` 均固定为 `max_active_assignments=1`、`subject_type_constraint=user`。约束同时物化到 `tenant_roles`；通用授权写入必须在锁定角色行后检查任期重叠，不能以直接授予绕过。
- 系统管理员更换持有人使用 Platform `PUT /api/platform/tenant-admin/role-holders/{roleCode}`。该命令要求租户 owner、可选 `expectedRevision`，在一个事务内撤销旧有效授权、写入新用户授权并递增 `tenant_role_holder_revisions`；不授予系统管理员任何 Aims 审阅、QA、发布或审批业务动作。
- Platform policy bundle 输出 `roleHolderRevisions[{roleCode,revision,updatedAt}]`，并继续用当前有效 `roleAssignments` 输出持有人事实。角色授权变化会改变 bundle hash 和全局 `policyRevision`。
- Aims 与 Workflow 通过 Console `GET /api/v1/console/service/authorization/role-holders?roleCodes=project_director,qa` 读取当前持有人。调用令牌要求 `aud=console`、精确 capability `console:authorization-role-holders:read`、`token_use=service`、current credential/grant 及 tenant/deployment/target app 绑定；接口只允许这两个 role code，`Cache-Control=no-store`，忽略角色/用户模拟。
- 每个角色返回 `revision/policyRevision/status/errorCode/holders`；`holders[].uid` 必须是用户主体 `subjectCode`（即 Console 会话和业务应用使用的稳定 UID），不得使用仅标识上游目录同步记录的 `externalRef`。只有 `status=resolved` 且恰好一个 holder 时调用方可以执行敏感业务动作。0 人返回 `role_holder_missing`，多人脏数据返回 `role_holder_ambiguous`；调用方不得回退管理员、历史人员或数组第一项。初始化授权见 Console v1.87 seed/verify。

### Aims 项目责任与周报周期契约

- Aims 项目创建的 `leader_uid` 为业务必填项；浏览器创建和 Altoc 合同激活创建均不得以 `created_by`、系统管理员或第一个成员兜底。expand 阶段 runtime 先拒绝空值，待 preflight 的空负责人项目全部人工修复后再执行数据库 `NOT NULL` contract。
- `project_lifecycle_events` 是项目周报应报口径的追加式事实。项目创建与状态更新必须和项目主记录在同一事务写入事件；v5.6 迁移只为既有项目写一条按 `created_at` 生效的基线，不回算无法证明的历史周期。
- 代理项目经理使用 `project_manager_delegations` 保存不可变任期。只有当前唯一 `project_director` 可任命或撤销；代理必须是该项目 active 成员，同一项目有效任期不得重叠。周报操作时以“有效代理优先，否则正式 `leader_uid`”解析责任人，系统管理员和普通 `role=manager` 成员均不能代填。
- `weekly_reporting_settings` 每公司一条，配置 timezone、截止时间、汇总目标、提醒、RAG 参数、rollout mode 和单调 `config_version`。只有 `weekly_reports:configure` 可修改；该权限不隐含审阅、代理任命或发布。
- `weekly_reporting_periods` 保存自然周起止、截止和当时配置快照；`weekly_report_obligations` 对每周期/项目唯一，并保存正式/代理责任人、责任类型和项目状态快照。`pilot` 只纳入有效试点项目，`company` 纳入周期内曾 active 的项目；截止后义务进入 `deadline_frozen`，后续负责人或状态变化不得改写。
- Aims BFF 必须删除客户端传入的 `current_user_is_project_director`、`current_user_can_configure_weekly_reports` 和 `current_user_can_submit_weekly_report`，再以 normal-merged 当前授权重建；data-runtime 在数据库访问前检查这些受信上下文，并继续叠加项目关系、代理任期和对象状态。

### Console 统一员工入口展示契约

SSO 落地后，企业员工统一入口由 `console` 承接。入口展示契约如下：

- Console 前端通过 `/api/user/applications` 获取当前用户可见应用。
- `/api/user/applications` 的权威过滤依据是 Console 本地已验签 policy bundle 中的角色、模板、覆盖与 `applications` 投影。
- Console 可按需调用 Platform runtime applications 做实时应用入口刷新，但不得绕过本地授权过滤。
- 业务应用通过 Foundation 接入 Console OIDC；应用卡片跳转到 bundle 下发的 `homeUrl`，目标应用本地无 session 时再发起 OIDC authorize redirect。
- Console 会话桥接走与 OIDC 相同的 Binding 路径，不再从业务 Worker 通过公网域名读取 Console auth/me 或 session API。请求内 OIDC 校验可以按相同身份及网关上下文合并，但不得把会话有效结果复用到另一个 HTTP 请求。
- 当前用户文档水印的手机号尾号通过 Console `/api/v1/console/auth/me` → Foundation `/api/directory/me` 的本人会话链路读取：仅返回验证过的 `mobileTail4` 四位数字或 `null`，不暴露完整手机号，不扩展跨应用共享用户投影，不依赖登录时 Cookie 中的旧资料。
- OIDC 后端换票、刷新、userinfo 和 JWKS 在具有 `HZY_CONSOLE_SERVICE` 时走 Binding，不因绑定失败重试公网。换票保留来源部署上下文；userinfo/JWKS 通过受信 route helper 原子切换到 Console 的 app/deployment/prefix。authorize 的浏览器跳转保持公网地址。JWT issuer/audience、会话撤销校验不变；JWKS 缓存隔离 issuer、endpoint、传输类型和网关上下文，容量上限 64，不跨请求缓存会话有效性。
- Console 只做应用级可见性过滤；业务应用必须继续做自身页面级和资源级权限校验。

详细方案见 `console/docs/Console-Unified-Employee-Portal-Plan.md`。

## API 调用矩阵

说明：矩阵中的 `Account` 列/行仅代表迁移期 legacy 兼容路径；新服务端调用应优先使用 Console service token、Console Directory API、Foundation adapter 和目标应用 service API。

```
             Account  Codocs  Aims  Altoc  Assets  Finance  Workflow  Align
Account        —        ×      ×      ×      ×       ×        ×         ×
Codocs         ✓        —      ×      ×      ×       ×        ✓         ×
Aims           ✓        ✓*     —      ✓**    ✓       ✓        ✓         ✓*****
Altoc          ✓        ✓      ×      —      ×       ✓        ✓***      ×
Assets         ✓        ×      ✓      ✓****  —       ✓        ✓***      ×
Finance        ✓        ×      ✓      ✓      ✓       —        ✓         ×
Workflow       ✓        ×      ×      ×      ×       ×        —         ×
Align          ✓        ✓****** ✓***** ✓******* ×      ×        ✓         —
Insights       ✓        ×      ×      ×      ×       ×        ×         ×

✓  = 已实现    ✓* = iframe 嵌入    ✓** = 计划中（API 桥接）
✓*** = 计划中  ✓**** = 计划中（客户/合同引用）
✓***** = 计划中（项目/任务协同关联）    ✓****** = 计划中（纪要/公告文档引用）
✓******* = 计划中（客户/合同上下文引用）
```

## Account API 契约（迁移期）

**Base URL**: `{HZY_ACCOUNT_API_URL}/api/v1`
**认证**: `Authorization: Bearer {api_key}:{api_secret}`

定位：

- 当前已实现目录读取与部分登录/审计能力仍由 Account 提供。
- 目标架构下，新增目录能力优先落到 `console.directory-runtime`。
- Foundation 的新目录 adapter 只支持 `console` provider，不提供 Account fallback；未迁移的旧 `/api/account/**` 兼容路由可继续直连 Account。
- Console 自身已不再要求 `HZY_ACCOUNT_API_*` 配置；登录审计写入本地 `auth_login_events`，启动资源同步也不再上报 Account。

尚未迁移的 legacy 模块通过以下环境变量配置：
- `HZY_ACCOUNT_API_URL` — 不含 `/api/v1` 后缀
- `HZY_ACCOUNT_API_KEY` / `HZY_ACCOUNT_API_SECRET` — 在 Account 管理后台创建

常用端点：
- `GET /users` — 用户列表
- `GET /users/{uid}` — 用户详情
- `GET /departments` — 部门树
- `GET /projects` — 项目注册表

详细接口定义：`account/docs/ACCOUNT_API_SPEC.md` 或 `http://localhost:3000/openapi.json`

## Workflow API 契约

**Base URL**: Console 运行时参数 `workflow.apiUrl` 对应服务的 `/api/v1`
**认证**: 业务前端经 Foundation `/api/workflow-proxy/**` 转发用户请求；服务端同步与回调使用 Console service token。
**业务应用 → Workflow**: Foundation proxy 必须先在本应用内验证浏览器用户身份，再以本应用 runtime service client 请求 `audience=workflow`、`scope=workflow:proxy` 的短期 token，通过租户中立 Workflow service origin 调用目标 Worker，并通过 `x-hzy-actor-uid` 传递已验证用户 UID。Foundation 用服务端 `public.appCode` 覆盖 query `request_app_code`，同时写入 `x-hzy-request-app-code`；缺 appCode 失败关闭。Workflow 只在服务令牌校验通过、精确包含 `workflow:proxy`、且 token 的 `source_app`（`hzy.appCode`）与该受信 header 完全一致时接受代理 actor；`workflow:invoice-request:create` 只能走 Finance receipt-only service endpoint，不能作为通用代理 actor scope。Workflow 再以 `service-client-policy` 获取自身精确 `<tenant>-workflow` deployment 的 data-runtime token，重签并绑定 source app、tenant、deployment、HTTP request target 与时效；来源应用 deployment 只保留在来源身份中，不能成为 Workflow runtime token deployment。Workflow runtime 的用户关系读取和 `/instances/prepare|instances` 写入只接受该签名 actor，忽略浏览器 body/query 的 `current_user`。审批 GET 只读取任务/实例，不得触发全局 actionable lifecycle outbox 排空；outbox 只作为写命令成功后的后续动作。

**Codocs 发布申请 → Workflow**：`POST /api/reviews/publish-requests/{id}/workflow-instance` 不是浏览器 Workflow proxy。Codocs 只可在已验证发起人和 `reviews:submit` 后，以锁定的 `document_publish_requests + documents` 重新构造固定命令；`source_app=codocs`、`target_app=workflow`、`aud=workflow`、capability=`workflow:document-publish:create`、`operation_code=codocs.publish-request.workflow-submit.v1`、`documents/publish`、相对 callback `/api/reviews/workflow-callback` 及 `publish-request:{id}` 业务键均不得由浏览器覆盖。请求 ID 派生稳定 operation/idempotency identity；Workflow 在同一事务写实例和 `service_command_receipt`，同键同 hash 恢复、异 hash 409；重试由 receipt 已固定的 `instance_no` 恢复该 Workflow 实例 ID，而不接受调用方提交实例 identity。Codocs 仅在已验证 receipt 的实例 identity 与固定命令一致后回写本地 binding。终态 callback 仅接受 `aud=codocs`、`scope=workflow:callback`、来源 `workflow` 的 service token；在读 body 前必须将 token tenant/deployment 与可信 `x-hzy-tenant`/`x-hzy-deployment` 精确绑定，并只把已绑定 instance 的 `approved/rejected/cancelled` 状态写入 runtime；不接受 callback 的任意业务字段覆盖。 托管云提交必须用 `resolveServiceAppBaseUrl(event, 'workflow', { directTarget: true })`、`serviceAppFetch` 与 `HZY_WORKFLOW_SERVICE -> hzy-workflow` 直连，`trustedServiceRequestHeaders(event, 'workflow')` 传递可信 tenant/runtime 上下文并将 app/deployment/prefix 原子绑定到 Workflow；创建申请的部门目录查询必须显式传入同一 `event`，使用 Console Service Binding。禁止普通 `$fetch` 经租户公网入口重新进入 Gateway。

该 capability 的初始化/核验文件为 `console/docs/sql/Console-SQL-Seed-v1.51-codocs-workflow-publish-grant.sql` 与 `console/docs/sql/Console-SQL-Verify-v1.51-codocs-workflow-publish-grant.sql`；两者仅作为待批准环境变更输入，不创建 credential，也不得由代码自动执行。

Finance 入站 Service API 只接受各端点登记的精确 capability；`finance:*`、`finance:admin` 或写入宽 scope 不蕴含 `finance:invoice-request:create`。已有调用方使用 Console v2.1 grant seed/verify 核对精确授权，发布前重新签发实际组合 scope；本次不新增 capability 或调用方。

**Finance BFF → Finance tenant-runtime**：Finance 普通用户读写统一要求 Foundation runtime actor delegation；actor、部门、`current_user_*_access` 与项目/部门范围必须由 Finance BFF 先基于 Console scoped authorization 求值，再随完整 request target 进入 HMAC 绑定。Finance runtime 验证失败时不得使用 bearer service client、query 或 body 派生用户 actor/范围，并须在 SQL 前返回 403。`/v1/finance/service/**`、Workflow callback 与 Finance scheduled notification 是显式 actorless 服务合同，继续依各自 capability/来源/worker 约束执行，但必须清除同名浏览器 actor/范围字段；不得把 service client identity 提升为用户数据范围。三条 due-notification worker route 更进一步仅接受 `sub=client:finance.runtime` 的短期 JWT、`data-runtime:finance:notifications_due:execute` 精确 grant、tenant/deployment enrollment 与 request-target HMAC purpose `finance-due-notification-worker`；`finance.write`、static token 或任意其他 Finance caller 不能扫描或 ack checkpoint，且每条 route 只接受其固定 body 字段。

**Aims / Altoc / Assets / People scheduled due worker → tenant-runtime**：四模块的通知 checkpoint scan、ack 与 closure-ack 同样不是通用 `*.write` 服务路径。它们仅接受各自短期 JWT `sub=client:{aims|altoc|assets|people}.runtime`、精确 `data-runtime:<app>:notifications_due:execute` grant、tenant/deployment enrollment 和绑定完整 request target 的固定 HMAC purpose（`aims-due-notification-worker`、`altoc-receivable-due-notification-worker`、`assets-due-notification-worker`、`people-offboarding-due-notification-worker`）。static/disabled auth、普通模块 write token、任意其他 service client、未签名或错 purpose 的 actor assertion，以及 browser 注入 actor/tenant/lifecycle body 字段都必须在 adapter/SQL 前失败；Cloudflare cron 仍默认关闭，专用 client ID 仅在显式启用时要求为 `<app>.runtime`。初始化/核验脚本为 `console/docs/sql/Console-SQL-Seed-v1.49-due-notification-worker-grants.sql` / `console/docs/sql/Console-SQL-Verify-v1.49-due-notification-worker-grants.sql`，均未在任何环境执行。

**Aims / Altoc / Assets / Finance / People integration-operation worker → tenant-runtime**：可靠集成 operation 的 claim、drain、ack、fail 和受控恢复使用调用方自己的运行身份，并要求精确 `<app>:integration_operation:execute`；该单数 worker capability 与管理界面的复数 `<app>:integration_operations:view/replay` 完全独立，`<app>.write` 也不蕴含 execute。所有 worker grant 必须同时安装 `data-runtime` 与 `tenant-runtime` audience 版本。Aims、Altoc、Assets 使用 `console/docs/sql/Console-SQL-Seed-v1.92-integration-operation-worker-grants.sql` / `console/docs/sql/Console-SQL-Verify-v1.92-integration-operation-worker-grants.sql`，Finance 使用 v1.61 runtime grants，People 使用 v1.86 worker grant；启用 cron 前必须在目标租户执行相应 verify 和真实多 scope token 签发探测。

**业务应用 → Console tenant-runtime fixed integration operations**：GitLab/WeCom 固定操作使用复数 `integration_operations:execute`，与上述业务 operation worker 的单数 capability 不同。Console service token 签发必须同时存在 `data-runtime:integration_operations:execute` 与 `tenant-runtime:integration_operations:execute` audience grant；Runtime 收到 token 后还会按未加 audience 的 `integration_operations:execute` semantic grant 精确重验 `integrationCodes + operations`。Aims/Codocs 的 semantic policy 必须合并 GitLab 与 WeCom allow-list，后续 seed 不得用单一 integration policy 覆盖已有集合；Altoc/Assets/Workflow 仅保留 WeCom allow-list。存量 v1.82/v1.83 租户用 `console/docs/sql/Console-SQL-Seed-v1.93-fixed-integration-runtime-token-grants.sql` 修复，并以对应 v1.93 verify 确认两条 audience grant 齐全、Aims/Codocs GitLab policy 未被覆盖。Aims 实时群组仓库目录另要求 semantic grant 精确包含 `gitlab.group-projects`，存量租户使用 `console/docs/sql/Console-SQL-Seed-v1.98-aims-gitlab-group-projects.sql` 只追加该 operation，不覆盖已有 allow-list。

**Workflow → data-runtime**: Workflow 服务端访问 data-runtime 时使用 Console service token，`audience` 必须与 data-runtime 的 `HZY_DATA_RUNTIME_JWT_AUDIENCE` / `HZY_TENANT_RUNTIME_AUDIENCE` 一致。跨应用代理链路必须用 `source_binding=service-client-policy` 签发 `appCode=workflow`、`deployment=<tenant>-workflow` 的目标 token，不得复用来源业务应用的 gateway runtime token。若 audience 为 `data-runtime`，scope 使用 `data-runtime:workflow:read` / `data-runtime:workflow:write`；若 audience 为 `tenant-runtime`，scope 使用 `tenant-runtime:workflow:read` / `tenant-runtime:workflow:write`。data-runtime 将这些 audience-scoped scope 映射为内部 `workflow.read` / `workflow.write` 语义。

### 业务模块接入流程

1. **启动时同步动作定义**：`POST /action-defs/sync`
   ```json
   {
     "appCode": "aims",
     "actions": [{
       "resourceCode": "projects",
       "actionCode": "initiation",
       "name": "项目立项",
       "embedUrlPattern": "{app_base_url}/embed/{resource}/{biz_id}"
     }]
   }
   ```

2. **发起审批**：`POST /instances/prepare` → `POST /instances`

3. **接收回调**：Workflow 审批完成后携带 Console service token 回调业务模块；业务模块校验 `token_use=service`、`aud`、`scope=workflow:callback` 与来源应用 `workflow`

### Actionable notification 合同

Workflow tenant-runtime 产生的待办、通过、驳回、撤回、委派和重提通知必须携带 `metadata.targetAppCode/businessTargetAppCode`（均来自 `flow_instances.app_code`）、`bizKey={app_code}:{resource_code}:{biz_id}`、`workflowInstanceId/workflowInstanceKey` 和 `actionableKey`；涉及任务时还必须携带 `workflowTaskIds`，结果事件保留 action ID 及 task/instance identity，供后续关闭对应待办。顶层 `bizType/bizId` 使用原业务 `resource_code/biz_id`，不能退化为标题、URL 或时间派生键。

`flow_instances.biz_url` 只接受 `http/https` 绝对 URL 或单斜杠开头的站内路径。tenant-runtime 的语法校验不是导航授权：Workflow BFF 在调用统一通知入口前，必须用 Console runtime 下发的已验签 policy bundle `applications[].appCode/homeUrl/basePath/status` 和 Foundation shared resolver 将 URL 绑定到 `actionTargetAppCode`，生成 exact origin + home path 内的 canonical absolute URL；协议相对、凭据 URL、危险协议、反斜杠/控制字符、编码路径逃逸、未注册/inactive 应用、错 origin 或错应用 base path 一律拒绝。业务目标不匹配时必须改用 `/workflow/tasks/{taskId}` 或 `/workflow/instances/{instanceId}`，保持 `targetAppCode/businessTargetAppCode=flow_instances.app_code`，仅设置 `urlFallback=true`、`actionTargetAppCode=workflow`；若可信 catalog 中连 Workflow 自身也不可解析，则发布失败并保留 lifecycle/outbox 待重试。Console 对 `sourceAppCode=workflow` 的 publish 在入库和计算 canonical idempotency hash 前使用本地已验签 bundle再次复核；catalog 不可用稳定返回 `503 action_target_catalog_unavailable`，目标不匹配返回 `400 invalid_action_target`。本地开发只允许显式 dev application catalog，不按 appCode 合成浏览器目标。外部企业微信与站内通知必须复用同一 canonical URL，不能发送未绑定的原始 `biz_url`。

所有 Workflow 调用通过 Foundation 代理（`/api/workflow-proxy/`），自动注入 `request_app_code`。

详细接入指南：`foundation/docs/Workflow-Integration-Guide.md`

## Data Runtime 管理契约

**Base URL**: Console 运行时参数 `dataRuntime.runtimeApiUrl` 对应租户 data-runtime 服务根地址；Cloudflare / Tenant Gateway 可通过 `x-hzy-data-runtime-url` 或 `x-hzy-tenant-runtime-url` 注入当前租户运行时地址，并通过 `x-hzy-data-runtime-code` 注入 Platform 注册表中的 runtime instance code。业务应用只有在 `x-hzy-gateway-token` 与 `HZY_CLOUDFLARE_INTERNAL_TOKEN`（兼容 `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`）匹配时才可信任这些注入头；Gateway 必须剥离浏览器自报的 runtime code。
**OSS 包地址**: Console 运行时参数 `dataRuntime.packageBaseUrl`，默认 `https://downloads.huizhi.yun/packages/hzy-data-runtime`。Console 读取 `{baseUrl}/latest/manifest.json` 获取最新版本、构建/发布时间和平台包信息；manifest 不可用时回退 `{baseUrl}/latest/version.txt`。
**服务认证**: 更新操作使用 Console service token，默认 `audience=data-runtime`、`scope=data-runtime:runtime:update`；配置为新 tenant-runtime audience 时使用 `audience=tenant-runtime`、`scope=tenant-runtime:runtime:update`。data-runtime 将 audience-scoped scope 映射为内部 `runtime.update` 语义，并要求来源应用为 `console`。对尚未支持 audience scope 映射、且 enrollment 中缺少 Console deployment binding 的历史 Agent，Console 可在正式 grant 校验通过后重试一次兼容令牌：`deployment` 必须精确等于可信 Gateway 注入的 `x-hzy-data-runtime-code`，scope 只能为 `runtime.update`；不得接受浏览器或请求体覆盖。静态 runtime token 只作为显式离线/兼容部署兜底。

核心端点：

- `GET /runtime/healthz` — Console 管理页探活主路径，返回 `status/version/commit/builtAt/tenant/deployment/apps`。
- `GET /runtime/health` — 兼容探活路径，响应结构同 `/runtime/healthz`。
- `POST /runtime/update` — 触发租户端更新，要求 Console service token。HTTP 请求体只允许精确语义版本 `{ "targetVersion": "X.Y.Z" }`（兼容同值 `version`）；禁止通过 HTTP 覆盖 package base URL、install dir、systemd service、force 或 no-restart。下载源必须来自服务器可信配置且是官方默认源或显式 HTTPS allowlist。无论 runtime 进程 UID，生产路径统一返回带 `operationId` 的 `queued`，原子写最小 `/etc/hzy-data-runtime/update-request.env`，由 root-owned external oneshot 在共享 execution lock 内执行。
- `GET /runtime/update/status` — 从 `0600` 持久 update journal 查询跨进程/重启后的 queued/running/succeeded/failed/partial_or_unknown、phase、前后版本/二进制 SHA、制品/manifest SHA 和脱敏 error code，要求 Console service token；损坏或过期 running journal 不得伪装为 idle。
- timer、API update、manual update、installer 和 rollback 共用 `/run/lock/hzy-data-runtime-update.lock`。自动更新策略由 `/etc/hzy-data-runtime/auto-update-policy.json` 持久表达 tracking/pinned/disabled；发布/回滚前 pin，rollback 不自动 unpin，恢复 tracking 必须使用 change ID 和精确确认。
- installer 必须预创建或修正 `/etc/hzy-data-runtime/update-journal.json` 为主 Agent 运行用户所有、`0600`；root update oneshot 后续原子替换时保持既有 owner，避免主进程因 root-only journal 无法触发下一次更新。无法解析的历史 journal 必须先隔离保留证据，不能由 API 静默覆盖。
- data-runtime release manifest、架构 archive 和 installer 使用 detached Ed25519 signature；签名私钥只存在于离线发布环境，服务器通过非 R2 渠道预置 public key。updater/installer 必须同时校验签名、manifest artifact SHA 和 public-key SHA-256 key ID，生产路径不提供 unsigned/skip-signature fallback。

## Console 统一消息中心契约

**Base URL**: Console API 根地址。业务应用通过 Foundation 本地 `/api/notifications/**` 代理当前用户请求；服务端发布通过 Foundation `publishNotification()` helper 调用 Console。
**用户认证**: 当前用户 Console access token 或 Console 本地 session。
**服务认证**: 调用方通过 Console OAuth2 `client_credentials` 获取 `audience=notifications`、`scope=notifications:publish` 的 service token。

核心端点：

- `GET /api/v1/console/notifications` — 当前用户消息安全信封列表，支持 `status/category/sourceAppCode/limit/cursor`；只返回 Console 生成的通用标签、来源/类别/严重级别、时间和本人阅读状态，不返回来源 title/summary/body/actionUrl/biz/metadata/createdBy/idempotencyKey。
- `GET /api/v1/console/notifications/summary` — 当前用户未读数、类别聚合和最近消息安全信封，`latest` 遵守与列表相同的最小字段约束。
- `GET /api/v1/console/notifications/{notificationId}/detail` — 当前收件人详情；Console 必须先按 `uid + notificationId` 绑定收件事实，再向来源应用实时重验对象权限，只有明确授权后才返回白名单详情。
- `GET /api/v1/console/notifications/todos/summary` — 当前用户实时待办投影计数；只统计 `pending`，与通知已读/归档正交。
- `POST /api/v1/console/notifications/{notificationId}/read` — 标记当前用户单条消息已读。
- `POST /api/v1/console/notifications/read-all` — 批量标记当前用户消息已读。
- `POST /api/v1/console/notifications/{notificationId}/archive` — 归档当前用户单条消息。
- `POST /api/v1/console/notifications/publish` — service-only，业务应用或 Workflow 发布站内消息。
- `POST /api/v1/console/notifications/actionable-lifecycle` — service-only，来源应用以 `expectedVersion -> nextVersion` CAS 将既有 generation 关闭为 `resolved/cancelled`；服务身份必须与 `sourceAppCode` 一致。

发布请求：

```json
{
  "sourceAppCode": "workflow",
  "eventType": "workflow.notification",
  "category": "approval",
  "severity": "info",
  "title": "您有新的审批待办",
  "summary": "项目立项 - 部门负责人审批，请审批",
  "actionUrl": "https://example.com/workflow/tasks/123",
  "bizType": "workflow",
  "bizId": "123",
  "idempotencyKey": "workflow:task:123:created",
  "recipients": ["zhangsan", "lisi"],
  "channels": ["in_app"]
}
```

Console 保存站内消息事实与阅读/归档状态；外部通道继续走 Notification Runtime。普通业务通知统一通过 Foundation `sendNotification()` 编排：必须先成功写入 Console `in_app` 耐久事实，再外发 WeCom；站内失败时不得外发，外部失败则返回保留站内成功结果的部分交付错误。列表与 summary.latest 只能返回不含来源业务文案的安全信封。详情读取由 Console 调来源应用 `POST /api/v1/service/notification-details/authorize` 实时重验：使用 `aud=<sourceAppCode>`、`scope=<sourceAppCode>:notification-details:authorize` 的 Console service token，请求体 `{notificationId,descriptor,subject:{uid},tenantId,deploymentId}` 全部来自收件事实、当前认证会话及可信 Gateway/服务端运行配置，客户端不能提交 subject、descriptor 或 challenge。Workflow descriptor 为 `workflow_task + instance:{instanceId}:tasks:{去重升序 taskIds}`（无 task 时为 `workflow_instance + instanceId`），Aims 为 `work_item + 规范化数字 ID`；Assets metadata descriptor 固定为 `authorizationDescriptor:{resource:'asset_item'|'ip_asset'|'customer_delivery_asset'|'offboarding_recovery_case',id:objectCode}`，People 固定为 `authorizationDescriptor:{resource:'offboarding_task',id:taskCode}`；两者都必须与 `bizType/bizId` 精确一致且不得带额外字段，并仅接受来源直接精确 tuple，不在 Console 执行 scoped challenge。来源直接放行必须 `code=0,data.authorized=true` 且精确回显 `resource/id`；拒绝/权限撤销/对象不存在返回 403，无 verifier、超时、429、5xx、畸形响应或来源授权运行时不可用返回 503。禁止最终授权缓存和陈旧详情回退。授权后也只返回 title/summary/body/actionUrl/actionTargetAppCode/bizType/bizId/时间等 UI 白名单，不返回 raw metadata、bizKey、createdBy 或 idempotencyKey。

在调用任意非 Console 来源 verifier 之前，Console 必须先执行 notification-detail fresh eligibility：Directory 中 subject 必须仍为 `active`，再用 fresh normal-merged policy（忽略 role/user simulation、禁止 privileged、绕过 snapshot cache；managed-cloud 先刷新并核验当前 tenant/deployment bundle）判定由 Console 静态 registry 固定的最低 `resource:view`。固定映射为 Workflow `workflow_task→workflow_tasks`、`workflow_instance→workflow_instances`；Aims `work_item→work_items`、`integration_operation→integration_operations`；Assets `asset_item→asset_items`、`ip_asset→ip_assets`、`customer_delivery_asset→deliveries`、`offboarding_recovery_case→offboarding_recoveries`、`integration_operation→integration_operations`；People `offboarding_task→offboarding_tasks`、`integration_operation→integration_operations`；Finance `invoice_request→invoices`、`finance_receipt→receipts`、`integration_operation→integration_operations`；Altoc `receivable_plan→receivable`、`integration_operation→integration_operations`。registry 不接受请求体或来源回调覆盖 resource/action；Directory inactive 或 permission deny 返回 restricted，Directory/policy/bundle 不可用返回 unavailable，二者都不得调用 source verifier。Console lifecycle `people_lifecycle_authorization` 继续使用其现有双权限实时边界，不能用这条通用最低 view 检查替代或弱化。

Assets 客户交付资产 `expiry / warranty / support` 到期通知以 `customer_delivery_assets.responsible_uid` 为唯一收件事实；`responsible_dept_code` 仅供用户目标页的数据范围，不得展开为部门群发。两者由 Assets 内显式维护，不从 Altoc 合同负责人、Aims 项目成员或交付视图负责人隐式推导。通知使用 `delivery_expiry / delivery_warranty / delivery_support` 三条流和 `customer_delivery_asset + delivery_asset_code` descriptor；详情重验要求当前 active 生命周期对象的责任人仍精确等于 subject。目标页 `/customer-delivery-assets/{deliveryAssetCode}` 经普通 Assets 用户认证、`deliveries` permission 和 runtime owner/department scope 重新读取；责任撤销后不得依赖通知中的旧正文或 URL 获得对象内容。

People 离职事项独立保存 `people_offboarding_cases` 与 `people_offboarding_tasks`，只允许已生效或无需审批的离职任职事实创建事项；`handover` 表达工作交接，`asset_recovery_coordination` 仅表达资产回收协调确认，不能声明 Assets 中的实物已经归还。Console Directory 继续独占账号停用、session 撤销和 Platform 授权来源回收事实，人员状态变为 `left/inactive` 或 Directory 生命周期成功不得自动生成 People 离职任务。到期通知使用 `offboarding_handover_due / offboarding_asset_recovery_due` 两条流，唯一收件人是任务当前 `responsible_uid` 且必须为 active Directory 用户，不允许经理、部门、管理员、配置或 `@all` 回退。通知详情重验只允许当前直接责任人查看精确 task，管理员不作为通知关系回退；普通事项目标页仍按 People 自身用户权限重新授权。任务确认与取消采用 `expectedVersion=vN` CAS，并分别受 `offboarding_tasks:confirm` 与 `offboarding_tasks:cancel` 控制，`edit/admin` 不隐式获得确认或取消能力。

People 是员工离职生命周期的唯一事实源；Console Directory `inactive` 可能来自管理员停用或目录同步，Assets 不得反向扫描 Directory 推断离职。People 只为已提交且已生效的 `left/inactive` 员工事实，或查询时点最新已生效且 `approval_status in (none,approved)` 的 `change_type=leave` 任职事实，创建 caller-owned 耐久 operation；未来日期、draft/pending/rejected/cancelled leave 均不得提前投影。scheduled drain 使用 `aud=assets`、精确 `assets:offboarding-recovery:sync`、`Idempotency-Key` 与标准签名 service-command envelope 调 `POST /api/v1/service/offboarding-recoveries:upsert`，只有 Assets 在领域 mutation 与 succeeded receipt 同事务提交后，People 才确认 source operation 成功。功能开关 `HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED` 默认关闭，且在 runtime binding、token 与网络前短路。

Assets 的 `asset_offboarding_recovery_cases` 只保存来源事件键、离职 UID/生效时间、Assets 自定回收期限和显式回收责任，不复制 People `asset_recovery_coordination` task/case 状态或静态资产清单。case `status=active` 只表示离职投影有效；未归还事实每次仅按 Assets 当前 canonical `asset_items.user_uid=departed_employee_uid` 重算。责任人初始可为空，后续只能由 Assets `offboarding_recoveries:edit` 显式分配且不得等于离职员工；无责任时保留工作清单但不通知，不使用 owner/custodian/经理/部门/管理员/配置或 `@all` fallback。可靠流固定为 `offboarding_unrecovered`，holdings 排序指纹进入 source version，资产集合或责任变化会 supersede 旧证据，全部归还关闭为 resolved；descriptor 固定 `{resource:'offboarding_recovery_case',id:caseCode}`，详情只允许当前显式责任人且仍有未归还资产时查看。

Assets 用户目标读取对 `asset_item / ip_asset / offboarding_recovery_case` 使用 BFF 从 Console normal-merged grant 派生的 trusted `all / relation / none` 和有界 grant-unit 对象范围；grant 内跨维度 AND、grant 间 OR，unknown/不可解析范围失败关闭。资源资产 direct relation 为当前 owner/custodian/user，并支持自身 `dept_code/project_code`；知识产权 direct relation 为当前 IP owner 或关联产品 business/technical owner，并支持关联产品 `project_code`；离职回收只支持 active case 当前 recovery responsible，因无部门/项目字段不匹配相应 unit。责任变化后旧 UID 的 direct relation 分支立即失效，但独立对象 owner、部门/项目、tenant-global 或同 resource admin grant 仍可保留访问。浏览器不能提交 actor、all 或 scope units。view/通知关系绝不蕴含 edit/approve/admin；PATCH 必须重新满足 action-specific scoped grant 和 runtime 对象谓词。

Assets 普通资产使用人以 `assignments:request` 发起自助操作，不持有 `assignments:edit`。runtime 只接受 `claim / return / release`，强制 claim 目标为当前用户，并分别校验资产可领用、本人当前实物使用关系或本人当前资源使用关系；流程实例、操作编号、生效/结束时间、审批人、终态和他人 target 均不可由浏览器指定。`assets:employee` 的 dashboard、asset item、assignment、alert 默认 scope 为精确 `asset:user`，不得把 user 合并为 owner/custodian；`assets:requester` assignment scope 为 `subject:self`。工作台汇总、列表、详情和 alert action 必须消费 BFF 派生的 action-specific trusted scope；assignment 可见性是“本人发起/本人目标/资产关系”与同 grant 部门、项目范围的有界组合，管理侧分配、转移、续费、维修、密钥轮换、权限回收和报废仍要求 `assignments:edit`，审批终态仍要求 `assignments:approve`。

Console 提供 `POST /api/v1/console/service/authorization/subject-eligibility` 与 Foundation `checkSubjectEligibility()`，用于按服务端固定 purpose 检查指定用户的精确权限。调用方使用目标应用 `aud=console` 与精确 `console:authorization:subject-eligibility` capability，只能以自身双 claim service identity 查询 registry 登记的 purpose；body 只有 `subjectUid/purpose`，resource/action/app/tenant/deployment/object/simulation 均不可由调用方声明。Console 要求 Directory 显式 active，并按 fresh normal-merged、无 simulation、无 snapshot cache 的 policy snapshot 判定 registry 固定的 `resource:action`；响应仅 active/allowed/reason/policyRevision 且 no-store，基础设施不可用失败关闭。Aims、Assets、People、Finance、Altoc drain 在旧 UID closure 后、publish/ack 前检查真实 stream purpose；negative/503 不发布、不确认 checkpoint。v1.42 seed/verify 用于初始 capability，v1.97 seed/verify 用于幂等恢复 `workflow.runtime` 的精确 grant 及审批动作 purpose；两者都不创建 credential，实际权限元组始终以 Console registry 代码为唯一事实，不得由应用自动执行 seed。
Registry 与 Aims、Assets、People、Finance、Altoc 的真实 due/offboarding stream union 及各应用 manifest `resource:view` 由跨模块静态合同锁定。Workflow 通知 purpose 只由可信 event allowlist 与 task/instance 身份派生：单 task 使用 `task_actionable` 和 task URL，并行 task 使用 `instance_actionable` 和 instance URL，终态使用 `instance_status` 和 instance URL。Workflow 跨应用代理操作只能按服务端路由派生 `task_approve/task_reject/task_delegate/instance_cancel/instance_resubmit`，并分别固定到 `workflow_tasks:approve|reject|delegate` 或 `workflow_instances:cancel|resubmit`；通过 Console 用户权限后，tenant-runtime 仍必须校验当前 task assignee 或 instance initiator 关系。业务 target、biz type、URL 和调用方输入均不能选择 eligibility permission。

Finance 将 Workflow 审批通过与正式开票拆成两个事实：审批回调只把 `invoice_request` 置为 `approved`，正式发票只能由显式 `invoices:issue` 动作创建，审批人和 `admin` 不因动作蕴含自动获得开票能力。已批未开票以 `issuance_responsible_uid / issuance_due_at` 为唯一责任与时限事实；到账未核销以 `reconciliation_responsible_uid / reconciliation_due_at` 为唯一责任与时限事实，`requested_by`、`handler_user_id`、经理、部门、管理员、配置和 `@all` 均不得作为通知收件回退。通知使用 `invoice_issuance_due / receipt_reconciliation_due` 两条流，descriptor 分别固定为 `invoice_request + request code` 与 `finance_receipt + receipt code`，并与 `bizType/bizId` 精确一致。来源详情每次只对仍处于可办理状态的当前直接责任人放行；正式开票、足额核销、取消、责任或时限变化必须通过可靠 checkpoint 关闭或推进旧 generation。

Altoc 应收计划的普通 `owner_user_id` 可能由合同负责人自动派生，不得作为催收通知责任关系。临期生产者只使用显式维护、历史不回填的 `receivable_plan.collection_responsible_uid`；计划负责人、合同负责人、客户经理、部门、管理员、配置和 `@all` 均不得 fallback。`receivable_plan_due` 只覆盖 `to_receive / partially_received / overdue` 且 `amount - received_amount > 0`、计划回款日在 30 天窗口内的对象；`pending / to_invoice / received / bad_debt` 排除，其中 `to_invoice` 由 Finance 开票事项覆盖。descriptor 固定为 `receivable_plan + plan code`，详情重验只允许对象仍可催收时的当前直接催收责任人。旧 `scan-overdue` 仅保留状态与逾期天数更新，不再聚合发布 `receivable_overdue_scan` 或回退合同负责人；通知统一由可靠 checkpoint、owner move、publish/closure ack 恢复的 scheduled producer 产生。

Altoc 应收目标页使用通知 descriptor 的 exact plan code 跳转 `/payments/{code}`。普通列表与详情读取保持既有 `receivable_plan.owner_user_id`、合同 owner 和合同部门范围，并显式 OR 当前 `collection_responsible_uid`，不以新责任字段替换或重解释存量 owner。编辑、确认到账和手工逾期扫描仍只使用原 owner/合同对象范围及显式 admin 旁路，不能仅凭催收责任关系写入。反向的通知详情授权不复用该 OR 读取范围：即使是计划 owner、合同 owner、部门成员或管理员，只要不是当前直接催收责任人就不得读取通知正文；责任切换后旧 UID 的详情关系与目标页责任分支都实时失效。

Aims 非成员的 scoped-admin 分支采用同一 Console → Aims capability 的两阶段闭环。phase-1 只在 Aims 用受控 runtime actor delegation 证明当前 subject 既非 active member 也非 leader 后，返回固定 tuple `aims/projects/admin`、`objectRevision`、绑定 notification/descriptor/subject/tenant/deployment/最小对象事实的 `factsHash`，以及只含 `projectCode/projectId?/departmentCode?/confidentialityLevel` 的 challenge。Console 不接受来源提供 actor、owner/member 数组、departmentTree 或任意 relation；actor 固定为当前 uid，非成员数组固定为 sentinel，departmentTree 由本地 active Directory 逐父构造。managed-cloud 每次求值前必须强制刷新并验证 tenant/deployment 绑定的 policy bundle，刷新失败不得使用旧 allow；求值固定 normal merged、忽略 simulation、绕过进程快照缓存。允许后 Console 调 `POST /api/v1/service/notification-details/authorize/finalize`，Aims 必须按 revision 重读事实并重施领域规则（包括 L3 不允许 department scope），最后精确回显 `factsHash/objectRevision/policyRevision/policyBundleHash/scopeBasis` evidence；Console 逐项相等且 evidence 无额外键时才释放详情。任何 tuple/字段漂移、未知 scope、目录/策略不可用、revision 或 evidence 不匹配都 fail closed。

通知发布、actionable lifecycle 和 integration dead-letter 写入口在读取 body 前必须验证现代 service token 的 `hzy.appCode` 与 `source_app` 均非空且精确一致，并把 app/tenant/deployment 与当前可信 runtime binding 精确比较；发布 canonicalization 仍再次要求 body `sourceAppCode` 与服务身份一致。禁止回退 actorId、单个历史 JWT claim 或 body 自报 source。

Console publish 以 `sourceAppCode + idempotencyKey` 作为站内通知唯一身份，并保存 canonical SHA-256 request hash。hash 绑定排序去重后的 recipients/channels、递归按 key 规范化的 metadata，以及 eventType/category/severity/title/summary/body/actionUrl/bizType/bizId 等完整投递语义。同键同 hash 只返回既有 `notificationId`，不得再次 INSERT/UPSERT recipient，不得解除归档、重置已读或改变 delivery state；同键异 hash 返回 HTTP 409 `idempotency_payload_mismatch`。并发首次发布发生 duplicate-key race 时，失败事务必须用锁定读回当前行并按 hash 作同样判定，不能把冲突当成功。历史行因未保存 channel 请求而无法可靠重建 canonical hash，迁移使用确定性 legacy sentinel，旧 key 重放保守返回 409。

`actionUrl` 在 publish 和授权后 detail 两个边界都必须 fail closed：只接受 `http/https` 绝对 URL 或单个 `/` 开头的应用内路径；拒绝 `javascript:`/`data:`、`//` protocol-relative、带 username/password 的 URL、CR/LF/控制字符和反斜杠。历史不安全值不得因详情已授权而返回。

Actionable 待办不复用 `portal_notification_recipients.delivery_state`。Console 以独立 `portal_actionable_projections` 保存 `(uid, source_app_code, actionable_key)` generation、当前 notification 引用、业务键、状态和 opaque object version。只有真正新建 notification 才能首次创建 projection；canonical replay 对 projection 零写。终态 generation 不得复活，重新打开必须使用新的 `actionableKey`。lifecycle API 只接受 `resolved/cancelled`，exact `(state,nextVersion)` 重放为幂等成功，版本不匹配或不同终态请求返回 409。所有显式 `metadata.actionableState='pending'` 的发布在 canonical hash 前必须由 Console 用已验签 application catalog 绑定 action URL 和受控 target app；Console 写入一致的 `actionTargetAppCode/targetAppCode` 与 `actionTargetCatalogBinding='catalog-v1'`，catalog 不可用失败关闭。Workflow 保持既有同一绑定规则，普通非 Workflow 通知与终态 lifecycle 不触发 catalog。历史 pending 无法从 source 或 URL 追溯为安全绑定，升级须按批准流程执行 Console fail-closed migration 关闭无 marker 的 projection，绝不猜测或自动执行。Workflow 是审批事实源；当前 pending 通知可创建 Console projection，但 Workflow 完成、转交、驳回和撤回后的关闭调用仍需后续在 Workflow 侧接线，接线前 Console 投影可能陈旧。

Console Directory→Platform 的 employment/offboarding operation 同样是 source-owned reliable projection：只有两条固定 Platform operation 在 `dead_letter` 时才由 `console_platform_lifecycle_actionables` 冻结 `operation_id + generation`、opaque actionable key/object version 和首批显式 active 收件 UID；发布失败或 notification/closure checkpoint 丢失由同一 Console task 重试。待办目标固定为已验签的 Console catalog 路由，descriptor 必须精确镜像 `people_lifecycle_authorization + directory uid`；通知正文、metadata 和 URL 均不得包含 operation key、命令、hash、原始失败摘要、token 或内部地址。原 operation 离开 `dead_letter` 后，成功以 `resolved`、其他受控重试终态以 `cancelled` 使用冻结 expected/next version CAS 关闭；详情仍每次实时同时要求 `console:authorization_lifecycle:view` 与 `console:audit_logs:view`。

## Notification Runtime 契约

方案 B（Enterprise Connector Runtime）已经批准。当前 Notification Runtime 是迁移兼容源；
`GET /runtime/capabilities` 在保留原有 `channels/messageTypes/scopes` 的同时返回
`hzy.connector-capabilities.v1` 类型化 provider/capability 注册表、目标 scope 映射和
`arbitraryHttpProxy=false`。只允许已实现能力被注册，Integration 配置不得覆盖编译期
provider HTTPS origin 策略。现有服务不会通过普通 updater 静默改名或切换 audience；
显式迁移、账本保留和回滚规则见 `connector-runtime/docs/Enterprise-Connector-Runtime-Migration.md`，可机读
事实源为 `notification-runtime/internal/migration/connector-runtime.v1.json`。

Phase 1 已落地独立产品 `hzy-connector-runtime`：共享 Runtime Core 但使用独立的
`HZY_CONNECTOR_RUNTIME_*` 配置空间、默认端口 `18082`、audience
`connector-runtime`、本机 SQLite `operations.db` 和 systemd service/timer。安装命令
只携 15 分钟、单次、tenant/deployment 绑定的 enrollment code；Console 只持久化其
SHA-256，Runtime 本机生成 RSA-3072 私钥，换取的长期 service credential 只经 RSA-OAEP
加密返回并落到客户服务器。enrollment code 不得写入 Runtime 配置、日志或 SQLite。

Connector Runtime 的企业微信通知能力继续使用兼容路径
`POST /v1/notifications/send`，但目标 token 必须为
`aud=connector-runtime`、精确 scope `connector-runtime:notifications:send`。Console 设置
`connector.notificationsEnabled` 默认 false；只有管理端验证 runtime product、类型化
capability schema、固定 provider origin、`arbitraryHttpProxy=false` 和精确 scope/path 后
才能显式启用。未启用时 Foundation 和 Console 均继续走 Notification Runtime；Connector
探测失败不得改变设置。显式迁移脚本只支持可验证的 SQLite ledger 复制，失败必须恢复旧
service；MySQL 迁移不得自动猜测源/目标数据库。

通知成功响应包含布尔字段 `replayed`。首次实际调用供应商时为 `false`；同一 tenant、deployment、
source app、idempotency key 且 canonical request hash 相同的成功重放必须从持久账本返回原脱敏结果并
标记 `replayed=true`，不得再次调用供应商。同键异 hash 继续返回 409
`idempotency_payload_mismatch`。Console 企业微信测试在 Connector 通道启用时必须用同一请求执行一次
成功重放，并且只有看到 `replayed=true` 才能报告幂等验收通过。

Phase 2 新增企业微信身份能力 `identity.wecom.exchange@v1`，固定接口为
`POST /v1/identity/wecom/exchange`，只注册在 `hzy-connector-runtime`，不在兼容
Notification Runtime 中暴露。调用令牌必须为 `aud=connector-runtime`、精确 scope
`connector-runtime:identity:exchange`，JWT 模式下来源应用固定为 Console；请求只允许
`integrationCode=wecom.default` 与一次性 `authorizationCode`。Runtime 只访问编译期
`https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo`，只返回规范化企业成员 subject，
不得返回 access token、OpenID 非成员身份、原始响应或用户详情。

Cloudflare 租户域名不再直接作为企业微信授权回调域。浏览器登录必须同时验证
`identity.wecom.browser-login@v1`，由 Console 调用
`POST /v1/identity/wecom/authorizations` 创建五分钟、tenant/deployment/state 绑定的授权，
企业微信只回调当前租户已登记 Connector 的 `GET /v1/identity/wecom/callback`。每个租户必须在
自己的企业微信应用中单独配置该 Connector 公网域名作为授权回调域，并单独维护本租户的
CorpID/AgentID/CorpSecret；不得把 wiztek 的 `wecom-api.wiztek.cn` 当作全平台租户的默认回调域。
Runtime 消费授权码后生成
不含 provider subject 的随机单次交接码，浏览器回到租户 Console 后再由 Console 以相同
`connector-runtime:identity:exchange` scope 调用
`POST /v1/identity/wecom/handoffs/redeem`。Runtime SQLite 只能保存 state/交接码 SHA-256；
授权码、access token、原始响应和明文交接码不得持久化或记录。

Console 企业微信登录 state 必须使用密码学随机值，并以 SHA-256 形式持久化，同时绑定
httpOnly 浏览器 cookie、tenant、deployment、目标应用和安全站内 redirect；有效期 5 分钟，
在调用 Runtime 前以事务和 CAS 单次消费。callback query 中的 target app/redirect 不可信。
外部身份和目录用户任一被禁用均失败关闭，已有禁用 identity 不得因再次登录自动恢复。
企业微信 CorpSecret 只保存在 Console `wecom.default` Vault；Platform 只保存并投影
CorpID/AgentID，Cloudflare 登录配置、policy bundle、页面和日志不得携带 CorpSecret。

Console 登录策略使用 `consoleLogin.mode` 表示默认登录方式，并使用
`consoleLogin.enabledProviders` 明确列出实际开放的 `oidc|cas|wecom|dingtalk` 入口；默认方式
必须包含在开放列表中。旧 policy bundle 缺少 `enabledProviders` 时只启用原 `mode`，不得因
其他 provider 恰好存在配置而隐式放开。Tenant Gateway 只在已验证租户上下文中注入默认方式、
开放列表和各开放 provider 的非秘密元数据。存在多个入口时 Console 登录页必须让用户选择，
其中默认方式优先展示；企业微信客户端在企业微信入口已开放时可直接进入企业微信授权。
直接访问 provider start/callback 时仍需实时验证该 provider 已开放，禁用后不得仅凭未过期 state
继续交换身份。OIDC 与企业微信并行启用不改变 OIDC 的默认方式，也不允许把 CorpSecret 投影到
Platform、policy bundle、Gateway header 或浏览器。

OIDC 登录入口的用户可见文案使用 `consoleLogin.oidc.displayName`，默认值为
`企业统一身份登录`，去除首尾空白后最多 10 个 Unicode 字符。Platform 部署管理负责在保存时
校验并把该非秘密字段写入环境级设置；Policy Bundle 必须将其置于签名载荷的 `consoleLogin`
中。Tenant Gateway 仅在可信租户上下文中通过 URI 百分号编码的
`x-hzy-sso-oidc-display-name` 转发，且必须先清除浏览器伪造的同名请求头。Console 必须在
可信读取后解码，登录配置接口和登录页必须消费该字段；旧 bundle、空值或越界值统一回退默认
文案。

Phase 3 新增钉钉类型化能力。身份交换固定为
`identity.dingtalk.exchange@v1` / `POST /v1/identity/dingtalk/exchange` / scope
`connector-runtime:identity:dingtalk:exchange`；工作通知复用
`notifications.send@v1`，但 `channel=dingtalk` 只允许 `integrationCode=dingtalk.default`。
Runtime 仅访问代码内固定的 `api.dingtalk.com`、`oapi.dingtalk.com` 官方 HTTPS 路径，
Integration 不能提交 URL、方法或请求头。AppSecret 只存在 Console Vault；Platform、Tenant
Gateway、登录配置与 policy bundle 只投影 AppKey/CorpID 等非秘密元数据。身份交换只返回
规范化 provider subject，不把 user access token、app access token 或原始供应商响应返回云端。
钉钉网页登录优先使用独立 `dingtalk.identity` 集成：非秘密配置保存 OAuth Client ID（旧版企业
内部应用通常显示为 AppKey）和可选 CorpID，对应 Client Secret 只存在该集成自己的 Console
Vault 绑定。`dingtalk.default` 继续承载机器人通知和 People；只有租户没有 active
`dingtalk.identity` 时，登录才兼容回退到其中的 `oauthClientId`/历史 AppKey。登录 start 选中的
integration code 必须写入一次性 OAuth transaction，callback 和 Runtime 授权码交换只能使用同一
集成，禁止在回调阶段重新选择或换用另一份 secret。机器人通知和 People 同步继续固定使用
`dingtalk.default`，不得被登录 Client ID 覆盖。钉钉 `AgentId` 与 `UnifiedAppId` 都不是本 OAuth
合同的 Client ID，Console/Platform 配置页必须明确阻止误填。钉钉后台回调修改只有在重新发布
应用版本后才视为生效。
Console 只显示一个“钉钉”集成入口，内部分为“通知与 People”和“登录”页签。登录默认复用
`dingtalk.default` 的 Client ID 和 Vault 凭证；只有管理员选择独立登录应用时才启用
`dingtalk.identity`。切回复用模式必须先规范化 `dingtalk.default` 的历史重复字段，再停用
`dingtalk.identity`，不得删除独立集成或其 Vault 历史。
管理员真实通知验收使用 Console 固定入口
`POST /api/v1/console/connector-runtime/dingtalk-test`，必须先校验 `integration_config:edit`，
只接受固定 `dingtalk.default`、收件人和幂等验收键，并由 Console 申请
`aud=connector-runtime` / `connector-runtime:notifications:send` 短期 service token。该入口不得
接收 AppSecret、provider URL、方法或请求头；只有实际投递后以完全相同请求命中持久账本且返回
`replayed=true`，才可报告验收成功。Connector 通知未显式启用时必须在供应商调用前失败关闭。

Phase 4 的钉钉组织/People 同步是显式异步任务，不存在默认 cron 或无条件周期全量。
People `设置 / 人事事实源` 通过 Console service API 提交任务；旧 Console 浏览器 API
`POST /api/v1/console/connector-runtime/people-sync-jobs` 已返回 410。Console service API 仅负责用
`connector-runtime:people:sync` 提交固定 `provider=dingtalk`、
`integrationCode=dingtalk.default` 和 `organization|people` scope；进度读取使用独立
`connector-runtime:jobs:view`。运行中任务取消使用独立 `connector-runtime:jobs:cancel`，只把
`pending|running` 原子转为 `cancelled` 并中止后续分页；已经成功写入的 data-runtime 幂等批次
不回滚。失败任务重试继续要求 `connector-runtime:people:sync`，生成带 `retryOfJobId` 的新任务、
沿用原 watermark/对象范围，并以来源 job 派生稳定幂等键；同一失败来源的确认丢失重放不得创建
第二个重试任务，非 `failed` 状态返回 409。Connector 在客户侧持久化 job、watermark、批次数和脱敏错误，
并以规范化请求 SHA-256 约束幂等键；同键不同 scope、watermark、actor 或 retry lineage 返回 409。
同一 provider/integration 只允许一个 `pending|running` 任务，watermark 必须为 RFC3339 且不得倒退；
升级时先把遗留运行中任务标记为 `runtime_restarted` 失败，再安装单活约束。取消动作另存原始管理员、
动作幂等键和请求 hash，同键不同 actor/任务不得重放。
分页读取固定钉钉通讯录 API；`people` scope 还必须读取钉钉 HR 离职清单与离职详情接口，
People HR 事实源只接受钉钉供应商根部门 `rootDeptId=1`；不得把子树配置伪装成完整组织快照，
否则会错误重挂父级并把范围外部门判为缺失。
用明确的 `status + lastWorkDay` 生成 `active|leaving|left` 事实。不得用“本次通讯录未返回”
推断离职，因为权限、可见范围和临时接口失败都可能造成缺失。Cloudflare 请求返回 202 后不等待
供应商拉取完成。

People 人事事实源入口只提交 `organization + people` 的 Connector People 任务，不复用旧
`directory.dingtalk` 配置，也不允许 Cloudflare 直接请求钉钉 API。Connector 固定读取
`dingtalk.default`，每个批次通过签名 data-runtime 边界落 People；姓名、主归属、在离职状态和
账号关闭都沿 People canonical uid 与 durable lifecycle 投影到 Console。该链路不得启用旧
`directory_profiles` 邮箱匹配回调，避免 provider identity 与唯一邮箱指向不同 uid 时跨人写入。
独立的 Console 目录资料同步能力保留给原有 Console 管理流程，不属于 People HR 事实源任务。

员工私密档案（身份证号、出生日期、学历、专业、毕业学校、毕业日期）不进入通用 Directory 或
`people_employees` 列表合同。Connector 可从钉钉成员响应的同名字段或 `extension` 自定义字段下发这些
可选事实；People 按字段分别保存 `dingtalk / manual / oa_archive` 来源，并按钉钉、人工、OA 顺序解析。
钉钉 absent 不清除回退值，显式空值只移除钉钉来源；钉钉有值时 People 管理页面与 runtime 都拒绝人工
覆盖。旧 OA CSV 只经 People `employees/admin` 浏览器边界上传、预检和导入，匹配歧义一律跳过，身份证
明文不得出现在普通员工 API、导入结果、日志或跨应用响应中。

Connector 到 data-runtime 只允许安装时固定的 origin 和精确路径
`POST /runtime/internal/connector-runtime/people-sync-batches`：分机部署必须使用 HTTPS，只有显式同机部署可使用 loopback HTTP；不跟随重定向。目标地址由 Console 已受信的 `dataRuntime.runtimeApiUrl` 写入单次安装指令，不接受 People job 请求动态覆盖。请求由 enrollment 生成的本机
RSA-3072 工作负载私钥以 RSA-PSS 签名，签名绑定 method、path、timestamp、nonce 和原始请求体
SHA-256。data-runtime 必须按 `hzy_console.connector_runtime_instances` 中当前 active 公钥验签，
执行 90 秒时间窗、nonce 防重放和 tenant 绑定；Connector 不接收任何业务数据库凭证。
data-runtime 在处理用户前先通过 `directory_department_identities`
把 `(provider_code=dingtalk, external_department_id)` 解析为稳定 canonical `dept_code`；
供应商 ID 不写入 `directory_departments` 的业务编码或旧 `external_ref` 字段，也不得直接作为
跨模块业务键。用户优先复用现有
`directory_identities(provider=dingtalk)`，其次复用唯一邮箱命中的 Directory uid；仍未命中的
当前/待离职员工生成确定性内部 uid，未知且从未被汇智云管理的历史离职人员计入 skipped，避免
为历史清单反向创建幽灵账号。人员批次在一个 People 事务中 upsert `people_employees`、当前任职
或明确的 `leave` assignment，并为已生效事实冻结单调 Directory lifecycle operation；未来
`lastWorkDay` 到期后由 `directory-lifecycle:prepare-due` 冻结。employment operation 创建/启用
Directory user、DingTalk identity 和部门 membership；offboarding operation 停用用户与外部身份
并撤销本地 session/refresh token。每个 `(job_id,batch_number)` 在
`people_connector_sync_receipts` 中保存 hash、状态和结果，同 hash 成功重放不重复写，异 hash
409，失败批次可按相同内容重试。

Phase 5 设备运维使用独立出站 scope `console:connector-runtime:heartbeat`。Connector 默认每 60 秒
向 Console `/api/v1/console/service/connector-runtime/heartbeat` 上报版本、能力、启动时间及
通知/People job 状态聚合；不得上报用户、provider subject、消息正文、URL、错误正文或凭证。
Console BFF 必须先校验 service actor 的 app、client code、tenant、deployment，再只把
服务端派生的 verified client code 转发至客户侧 Tenant Runtime；Runtime 再与 body
connectorId、enrollment binding 和本机 tenant/deployment 一致性校验后更新实例。
管理员 issue/revoke 必须携带签名用户委托和 `Idempotency-Key`；吊销在 Tenant Runtime
同一事务撤销 instance、公钥信任、未使用 enrollment、service credential、grants、
Receipt 与审计。心跳业务请求收到 401/403 时，Runtime 必须淘汰对应缓存 Token、重新执行一次
`client_credentials` 并只重试一次；新 Token 仍被拒绝，或 Token 端点直接拒绝当前 client
credential 时，才按身份撤销停止。轮换通过新的 15 分钟单次 enrollment 原子替换公钥和
credential，新 enrollment 兑换前不得提前停用旧实例。
`runtime.diagnostics.read@v1` 固定为 `GET /v1/diagnostics`、scope
`connector-runtime:diagnostics:view`，只允许 Console，响应仅含版本、绑定和 SQLite 聚合计数。

**Base URL**: Console 运行时参数 `notification.runtimeApiUrl` 对应服务根地址。
**认证**: 调用方通过 Console OAuth2 `client_credentials` 获取 `audience=notification-runtime` 的 service token。发送、投递查询、人工对账分别要求精确 scope：`notification-runtime:send`、`notification-runtime:deliveries:read`、`notification-runtime:deliveries:reconcile`，三者互不蕴含。

当前一期只支持企业微信通知：

- `GET /runtime/health` — 运行状态、版本、租户/部署信息。
- `GET /runtime/capabilities` — 当前支持的 channel 与 message type。
- `POST /v1/notifications/send` — 发送通知。
- `GET /v1/deliveries` — 仅返回 token 所属 tenant/deployment 的脱敏 ledger 记录；支持单状态过滤、1–100 limit 和稳定 opaque cursor。
- `POST /v1/deliveries/{deliveryId}/reconcile` — 仅允许持证据把当前 `partial_unknown` CAS 为 `succeeded|failed`，并在同一事务追加 reconciliation audit。

发送请求：

```json
{
  "channel": "wecom",
  "integrationCode": "wecom.default",
  "sourceAppCode": "workflow",
  "touser": "zhangsan|lisi",
  "title": "审批待处理",
  "description": "你有一个新的审批任务",
  "url": "https://example.com/workflow/tasks/1",
  "btntxt": "查看详情",
  "idempotencyKey": "workflow:task:1:created"
}
```

Foundation 会向 Notification Runtime 传递解析后的可信 `sourceAppCode` 和与 Console publish 相同的稳定 `idempotencyKey`。Runtime 必须先校验 Console JWT 的签名、issuer、audience、expiry、`token_use=service`、tenant、deployment、`hzy.appCode`、`client_id` 和精确 scope，再通过 Console `/oauth/introspect` 校验 current credential/grant；请求 `sourceAppCode` 必须与 JWT 来源应用一致。inactive 返回 401，Console/网络/5xx 无法确认撤销状态时返回 503，不得降级为本地 active。

外部发送由 Notification Runtime 自有 durable `notification_delivery_ledger` 持久化；单 systemd 实例默认使用本机 SQLite（`/opt/hzy/notification-runtime/data/delivery.db`，不得放在 NFS/共享盘），多实例部署才显式选择 MySQL。唯一投递身份为 `tenant + deployment + source_app + idempotency_key`，channel、integration、规范化收件人和消息内容进入不可变 SHA-256；同键异 payload 返回 409。发送前必须取得 processing lease/fencing token；succeeded 重放返回最小公开结果且不再次调用 provider，活跃或过期 processing/partial_unknown 不得盲目重发，只有明确 failed 才能取得新 fencing token 重试。Runtime 缺 store/schema 时启动或发送失败关闭，不允许内存 fallback；不得让多个 runtime 实例同时打开同一个 SQLite 文件。

企业微信没有供应商侧幂等能力，provider 成功到 ledger success checkpoint 之间仍存在崩溃窗口。因此该契约只保证持久去重、同键冲突和 `partial_unknown` 隔离，不保证 exactly-once；不确定投递必须人工确认或经后续对账后受控处理。

Delivery 查询不得返回完整消息、收件人、幂等键/request hash、token、URL、provider body/result 或错误摘要。对账必须携 `expectedStatus=partial_unknown`、`result=succeeded|failed`、人工 reason 与最小 evidence type/reference；运行时按 tenant/deployment + delivery ID 锁行并以当前状态/fencing CAS，拒绝对 processing/succeeded/failed 盲重置。审计表只追加 actor source/client/subject、reason、证据引用与最小公开结果，不持久化新敏感 payload。

`partial_unknown → failed` 后不会由管理 API 直接发送。原业务调用方必须使用原 `sourceAppCode + idempotencyKey + 相同 payload/hash` 重放 send，才能进入现有 failed Claim/fencing 重试；同键异 hash 仍返回 409。known failed 本来即可由此重试，因此不提供 reset/retry 端点。`partial_unknown → succeeded` 后原请求只返回最小 succeeded replay，不再调用 provider。

企业微信 `corpid`、`agentid`、`corpsecret` 由 Console `wecom.default` Integration/Vault 管理；Cloudflare 业务应用不得直接保存或调用企业微信 API。

Notification Runtime 读取 Integration/Vault 时必须使用独立 service client，且该 client 的 `client_code` 与 `app_code` 都固定为 `notification-runtime`。业务 service 使用自身短期 token 直达客户 Tenant Runtime 的 `/v1/console/service/integrations/**`；Runtime 必须同时校验 `integration_config:view` / `credential_vault:resolve` token capability、本地 active credential 以及按 `integrationCode` 收敛的 grant scope，才可读取 `wecom.default`。旧 Console service Integration/Vault API 返回 410，不再读取 grant 或 Secret。安装指令生成必须幂等修复该服务身份，配置检测必须将缺失或漂移的 `app_code` 判为失败，不得只检查 client/grant 行是否存在。

托管云租户的 Notification Runtime 安装指令必须区分两个来源地址：`HZY_CONSOLE_API_URL` 使用生成指令时经过认证的租户网关 origin（例如 `https://wiztek.huizhi.yun`），确保 Integration/Vault 请求保留租户上下文；`HZY_CONSOLE_TOKEN_URL` 与 `HZY_NOTIFICATION_RUNTIME_JWT_ISSUER` 使用规范 Console issuer（例如 `https://console.huizhi.yun`）。不得把规范 issuer 直接作为租户级 Integration API base。

## Codocs API 契约

**Base URL**: `{CODOCS_API_URL}/api/v1` 或 `/api/documents`
**认证**: Cookie 转发

- `POST /api/documents` — 创建文档
- `GET /api/documents/{uuid}` — 获取文档
- `POST /api/v1/documents/{uuid}/preview-access` — service-only，当前因缺少可验证的 AIMS 用户委托而 fail-closed；签名 service-command 合同落地前不会写入预览关系
- `POST /api/v1/service/project-documents/{uuid}/content` — 仅用于 Aims 已关联项目文档的正文读取。Aims 必须先以已验证浏览器 actor 证明 active member/leader/creator/scoped-admin 与 `project_documents.codocs_uuid` 或 `deliverables(document)` 的精确 UUID 关联；随后固定发送 `source_app=aims`、`client=aims.runtime`、`aud=codocs`、精确 capability `codocs:project-document:content:read`、tenant/deployment、actor UID、project code、UUID、`content:read` 动作和 one-shot service-command。Aims 用刚签发的短时目标 service token 对 method/path、tenant/deployment、source/target app+client、固定 operation/capability/idempotency/schema、command hash 与 request ID 做 60 秒 HMAC；Codocs 在读 runtime/OSS 前先验 token、绑定与首跳 HMAC，随后才用自身 runtime bearer 重签第二跳。runtime 只接受受签名 actor 和 `status=1` 文档，并再次执行 Codocs owner/share/relation 原 ACL；不把 Codocs 的物理 `doc_type` 或可空 `project_code` 当作 Aims 项目边界，因为历史项目关联可以指向部门文档等已有文档。Aims 项目关系不是 Codocs ACL 的替代；请求 body 的 project/role/OSS 字段均不被信任。响应只含 UUID、标题、类型、大小、更新时间与正文，绝不返回 OSS path、签名 URL、grant 或策略细节。Aims 项目文档预览必须复用该只读合同并在 Aims 内渲染正文，不得先调用 fail-closed 的 `preview-access` 写关系，也不得从 Worker 回环租户网关访问 Codocs。Aims 调用 Codocs `POST /v1/codocs/document-access/check` 时使用 `codocs.read`；该 POST 是结构化只读判定，不得因 HTTP 方法错误提升为 `codocs.write`。项目成员编码与项目角色只能由 Aims BFF 从权威 runtime 事实派生，通过完整 request-target HMAC 绑定的专用 query marker 传入；Codocs runtime 仅在签名 actor 委托有效且 `hzy_runtime_source_app=aims` 时接受，请求体中的同名 project/role 声明始终忽略。存量租户通过 `console/docs/sql/Console-SQL-Seed-v1.99-aims-codocs-runtime-read.sql` 为有凭据的 `aims.runtime` 补齐 `data-runtime:codocs:read` 与 `tenant-runtime:codocs:read`，并用同版本 verify 核验；生产环境无直连 SQL 时，仅 `service_clients:admin` 可通过 Console BFF 触发固定的 `POST /v1/console/admin/service-grant-repairs/aims-codocs-runtime-read`，Runtime 同时要求 `console:service-client:grant` 与已签名的真实管理员 actor。该入口不接受 client/resource/action/scope 参数，只能幂等补齐上述两条授权并写操作日志，不得扩大为 `codocs.write`。

Aims 工作项源章节读取按不同文档 UUID 去重，并以最多 4 个 worker 有界并发调用上述逐文档合同；同一文档的多个锚点复用一次请求结果。该优化不改变逐 UUID 的 Aims 关系证明、one-shot command 与 Codocs ACL 复核，不得为减少请求恢复已退役的通用 batch/content 合同。

Codocs 的文档分享、版本、批注/回复和问题评论只允许其文档、批注或问题嵌套路由调用；不存在跨模块或浏览器可用的 `/v1/codocs/document-shares|document-versions|annotations|annotation-replies|issue-comments/**` generic CRUD 合同。runtime 对这些直达路径返回 `503 scoped_resource_contract_required`，不得用 generic table mapping 绕过父对象 ACL。

Codocs 部门开放文档使用自身 BFF 到 tenant-runtime 的专用 `GET /v1/codocs/open-department-documents` 用户态合同。合同要求 Foundation 签名 actor，只返回显式开放部门目录、同部门后代目录及其中的有效未发布非周报文档；可选 UUID 只负责收窄，不能扩大集合。部门负责人设置开放状态时，BFF 先对请求部门执行负责人校验，再通过 `PATCH /v1/codocs/folders/{id}/open` 传递精确受信管理部门标记，runtime 必须复核目标目录部门后才写入。普通 folder/document ACL 不因开放文档能力而放宽。

`GET /api/v1/documents/search` 与 `POST /api/v1/documents/batch-summary`（及 `/api/v1/codocs/**` 兼容别名）不再是有效 service 合同：宽 `codocs:documents:read` 无法证明 project/document 范围，BFF 与 `/v1/codocs/documents/{search|batch-summary}` runtime 均返回 `503 scoped_document_service_contract_required` 且零 DB。保留摘要/正文/URL 或创建能力前，必须分别落地绑定 source/target、tenant/deployment、actor、文档 UUID、来源对象范围、动作和时限的专用 signed service-command；不得恢复通用 read/write scope 路径。

上述 Aims 单文档正文命令只恢复其精确路径；summary、URL、通用搜索、批量摘要、preview relation 与非 Aims 来源仍维持 fail-closed。Aims 新建项目的部门文档选择使用独立的 `POST /api/v1/service/department-documents/search`：Aims 与 Codocs 分别确认签名 actor 对精确部门的访问，首跳绑定 `source=aims/client=aims.runtime`、tenant/deployment、actor、dept、pageSize、action、60 秒 command MAC 与精确 `codocs:department-documents:list`；Runtime 从签名 command 重建筛选，只返回 exact department 下 active `department` 目录和文档的最小摘要。按产品规则，这些可读部门文档均可作为立项书候选，不要求预置 `project_proposal` 分类；候选资格不授予绑定后的正文读取，后续仍由项目关系与 Codocs 原 ACL 的专用正文合同共同校验。浏览器 UUID/query、通用 `codocs:documents:read` 和 Aims 直连 Codocs tenant-runtime 均不可替代。

Altoc 只通过两条精确命令访问已有 Codocs UUID：预览 `POST /api/v1/service/altoc-entity-documents/{uuid}/content` 和关联前授权 `.../{uuid}/attach`。F 中 Altoc 先以当前会话完成实体 `view` 数据范围和 `document_link(entity_type, entity_id, document_uuid)` 精确持久关联；H 中先完成实体 `edit` 数据范围和实体存在性读取。两者再以 `source_app/client=altoc`、精确 capability、actor、允许的实体类型、实体 ID、UUID、action、tenant/deployment、固定 envelope 与 60 秒首跳 HMAC 调 Codocs；Codocs 使用自身 runtime bearer 重签第二跳，runtime 对该 actor 重施原 owner/share/relation ACL。关联额外要求 active 文档且 owner 或显式 `document_shares.permission=write`，relation/read share、只读、归档均拒绝；预览只要求原 read ACL。`document_link` 以 `(entity_type, entity_id, document_uuid)` 重放返回既有 ID。实体权限从不替代 Codocs ACL，响应不返回 OSS path、签名 URL 或策略细节；不恢复 generic summary/search/batch/content。v1.53 seed/verify 仅为待批准输入，未执行。

Codocs Issues 是单项目 user-domain 合同，不提供 actorless service 或跨项目 generic CRUD：BFF 仅在 Console Directory 项目/成员/部门事实与 Foundation scoped `codocs/projects:view|edit` 在同一授权判断通过后，才写入 request-target HMAC 覆盖的 `codocs_trusted_issue_project_code`。Runtime 的列表、待办、详情、创建、更新、删除和评论均以该精确 marker 约束 SQL；浏览器 `project_code`、actor 或 marker 不是受信输入。创建或改关联的 `document_uuid` 仅可指向同项目 active `project|git-project` 文档；没有任何新 service grant、schema 或 migration。

Codocs 发文流程定义、路由和审批节点由 Workflow 唯一管理；Codocs 只保存 `document_publish_requests` 业务关联与审批终态投影。Workflow 回调写入 `approved` 后，用户态 `POST /api/reviews/{id}/archive|seal|send|receive` 由 Codocs BFF 校验会话权限并转成 `/v1/codocs/reviews/publish-requests/{id}/archive-plan|archive|seal|send|receive` 专用 runtime 命令。归档采用两阶段编排：runtime 先锁定申请并派生稳定发布 UUID、包含申请 ID 的唯一 OSS 路径和初始执行状态，BFF 只复制 OSS，随后 runtime 再锁定申请并在单事务中创建发布文档、更新源文档 `publish_info`、写执行状态及 `document_relations`。盖章、发送、接收分别只接受 `pending_seal`、`pending_send`、`pending_receive`，最终为 `received`；每次重放必须与既有记录完全一致，否则 409。`archive` 和 `send` 只允许申请发起人，`seal` 的 `reviews:admin` 与 `receive` 的指定发送人校验由 BFF 权限和 runtime 对象事实共同收敛。旧 `document_reviews` 只读兼容，不再接收这些写操作；OSS、通知、临时快照清理由 BFF 在事务提交后编排。

详细接口定义：`codocs/docs/CODOCS_API_SPEC.md`

## Altoc ↔ Aims 桥接契约（契约有效，首轮 service 端点与编排入口已落地）

采用**双数据库桥接模型**，不合并数据库：

| Altoc 实体      | Aims 字段         | 方向        |
| --------------- | ----------------- | ----------- |
| 商机 opp_id     | aims_projects.opp_id | Altoc → Aims |
| 合同 contract_id | aims_projects.contract_id | Altoc → Aims |
| 回款节点        | milestones.payment_term_id | Altoc → Aims |
| 客户 customer_code | aims_projects.customer_code | Altoc → Aims |

原则：Altoc 管经营/财务视角，Aims 管交付执行视角。里程碑 PIVR 阶段映射到合同回款节点。

当前状态：业务契约已接受。Phase 1 已落地 Altoc 合同生效交付编排入口、Aims 合同项目桥接、付款条款里程碑同步、Altoc 回款计划可开票 service endpoint、Altoc 发起 Finance 开票申请、Finance submit 审批提交、Altoc 合同 Finance 摘要展示，以及 Finance 核销后回传 Altoc 回款计划摘要的 service endpoint；Aims 验收完成后可自动按 `payment_term_id` 推进 Altoc 回款计划，Finance 核销完成后可自动刷新经营侧已收 / 未收 / 状态。实现时不得合并数据库或复制对方主档。

## 客户合同交付与回款闭环契约（Phase 0 冻结）

本节是 `docs/Huizhi-yun-Integrated-Operations-Roadmap.md` Phase 0 的跨模块执行合同，用于约束首条端到端闭环：“Altoc 合同 → Aims 交付项目 → Finance 开票/到账/核销 → Assets 交付视图”。

### 事实源与稳定业务键

| 业务对象 | 唯一事实源 | 稳定业务键 | 消费模块 | 约束 |
| --- | --- | --- | --- | --- |
| 客户 | Altoc `customer` | `customer_code` (`customer.code`) | Aims / Finance / Assets / Console | 其他模块只保存编码和名称快照 |
| 商机 | Altoc `opportunity` | `opp_id`，后续补 `opportunity_code` | Aims / Finance | Aims 只引用，不推进销售阶段 |
| 合同 | Altoc `contract` | `contract_code` (`contract.code`)，兼容 `contract_id` | Aims / Finance / Assets | 其他模块不复制合同主档 |
| 合同行项目归属 | Altoc `contract_project_line_rel` | `project_code + contract_line_code` | Finance / Aims / Assets | `contract_project_link.line_codes_json` 仅是兼容快照 / 回退，不是首选真值 |
| 合同行成本分摊 | Altoc `contract_line_cost_allocation` | `contract_line_code + project_code + allocation_type + effective period` | Finance / Aims | Goal 3 新增；合同利润重算前由 `contract_project_line_rel` 自动物化为核算归因快照，也支持手工显式规则；项目成本必须通过 `project_code` 和分摊规则进入合同行，不允许未配置规则的项目成本静默归属 |
| 合同行 / 客户毛利摘要 | Altoc `contract_line_profit_summary` / `service_cost_summary` | `contract_line_code + period + calculation_key` / `service_agreement_code + project_code + period + calculation_key` | Finance / Aims / Console | Goal 3 新增；均为可重算派生数据，保留 calculation key 和版本，不覆盖历史计算；合同行利润摘要可冻结，冻结后禁止普通重算和分摊改写 |
| 付款条款 | Altoc `contract_payment_term` | `payment_term_id` | Aims / Finance | Aims 里程碑只映射，不修改条款 |
| 回款计划 | Altoc `receivable_plan` | `receivable_plan_code` (`receivable_plan.code`) | Finance / Console | Finance 通过摘要或回调触发经营侧状态刷新 |
| 交付项目 | Aims `aims_projects` | `project_code` | Altoc / Finance / Assets | Altoc 不维护项目执行状态 |
| 项目成本摘要 | Aims `project_cost_summary` | `project_code + period_start + period_end + calculation_key` | Altoc / Finance | Goal 3 新增；Aims 只聚合 `time_entries` 和调用方提供的成本单价，不复制 Finance 明细账或 Altoc 合同主档 |
| PIVR 里程碑 | Aims `milestones` | `project_code + milestone_id`，映射 `payment_term_id` | Altoc / Finance | Aims 是里程碑状态事实源 |
| 项目文档 / 交付物 | Aims `project_documents` / `deliverables`，正文在 Codocs | `document_uuid` / `codocs_uuid` | Altoc / Assets / Finance | 其他模块只保存文档 UUID 和标题快照 |
| 开票申请 | Finance `invoice_request` | `invoice_request_code` (`invoice_request.code`) | Altoc / Workflow | Altoc 可发起，不生成发票事实 |
| 正式发票 | Finance `finance_invoice` | `invoice_code` (`finance_invoice.code`) | Altoc / Aims | Finance 是发票事实源 |
| 到账记录 | Finance `finance_receipt` | `receipt_code` (`finance_receipt.code`) | Altoc / Aims | Finance 是到账事实源 |
| 收款核销 | Finance `finance_reconciliation` | `reconciliation_code` | Altoc / Aims | Finance 是核销事实源 |
| 合同财务摘要 | Finance `finance_contract_summary` | `contract_code` | Altoc / Aims / Console | 摘要可读，计算事实仍在 Finance |
| 交付视图 / 环境 / 资产 | Assets `asset_delivery_views` / `asset_environments` / `customer_delivery_assets` / `customer_delivery_asset_environment_rel` / `asset_items` | `delivery_code` / `environment_code` / `delivery_asset_code` / `asset_code` | Aims / Altoc / Finance | Assets 不维护合同、项目、财务主档；`customer_delivery_assets.environment_code` 仅是主环境兼容快照，完整事实以关系表为准 |
| 审批实例 | Workflow `flow_instances` | `instance_no` + `app_code/resource_code/biz_id/action_code` | 全业务模块 | Workflow 只保存审批流转事实，不保存业务终态 |

### Goal 2 交付环境身份链路

对象主责关系：

```mermaid
flowchart LR
  AltocPlan["Altoc contract_delivery_asset_plan<br/>source_plan_code"]
  AssetsAsset["Assets customer_delivery_assets<br/>delivery_asset_code"]
  AssetsRel["Assets customer_delivery_asset_environment_rel"]
  AssetsEnv["Assets asset_environments<br/>environment_code"]
  AimsRel["Aims project_environments<br/>project_id + environment_code"]
  AltocCoverage["Altoc service_agreement_coverage"]

  AltocPlan -->|创建或同步正式资产| AssetsAsset
  AssetsAsset --> AssetsRel
  AssetsEnv --> AssetsRel
  AimsRel -->|只保存执行关系和版本快照| AssetsEnv
  AssetsRel -->|正式对象回写| AltocCoverage
  AltocPlan -->|pending source_plan_code| AltocCoverage
```

标准实施时序：

```mermaid
sequenceDiagram
  participant Altoc
  participant Assets
  participant Aims

  Altoc->>Assets: create customer_delivery_asset from source_plan_code
  Assets-->>Altoc: delivery_asset_code
  Aims->>Assets: environments/upsert with idempotency key
  Assets-->>Aims: environment_code
  Aims->>Aims: upsert project_environments as pending sync
  Aims->>Assets: bind delivery_asset_code to environment_code
  Aims->>Assets: lifecycle:sync when online or accepted
  Aims->>Aims: mark project_environments synced or failed
  Assets->>Altoc: status:sync sourcePlanCode + deliveryAssetCode + environmentCode + projectCode + occurredAt
  Altoc->>Altoc: resolve pending service_agreement_coverage
```

Assets 环境主状态以 `asset_environments.status` 表达 `planning / active / frozen / retired`；`online` 和 `accepted` 输入会归一为 `active`。验收完成事实以 `asset_environments.accepted_at` 或交付资产-环境关系 `deployment_status = accepted` 判断，不依赖 `asset_environments.status = accepted`。

### Service API 合同

以下 endpoint 是跨模块 service API 合同基线。标记为“待实现”的端点不得绕过 Console service token 或引入共享 secret；若先复用已有用户侧 API，必须补 service token 校验、scope 校验和幂等规则。状态截至 2026-06-22。

| 调用方 | 被调用方 | Endpoint / 事件 | 认证 | 幂等键 | 状态 |
| --- | --- | --- | --- | --- | --- |
| Altoc UI / Workflow / service | Altoc | `POST /api/v1/service/contracts/{contractCode}/activate-delivery` | 用户需 `contract:edit` 权限；service 调用 Console service token，`aud=altoc`，`scope=altoc:write` 或 `altoc:contract:edit`，来源仅允许 `altoc` / `workflow` | `altoc:contract:{contract_code}:activate-delivery:v1` | Phase 1 已实现 Nuxt 编排入口：先创建 Altoc 履约启动作业，激活合同并生成回款计划；仅当启动计划包含项目步骤时按 `project_plans` 调用 Aims 创建 / 复用多个项目和同步里程碑，并回写步骤状态 |
| Altoc | Aims | `POST /api/v1/service/projects/from-contract` | Console service token，`aud=aims`，`scope=aims:write`，来源 `altoc`；可靠链路使用标准 service-command envelope | 每次 activation + `plan_key` 一条 project operation | G3 可靠化：Altoc 在合同激活/回款计划事务中按 plan 冻结单目标 project operation；Aims 项目 mutation 与 receipt 同事务。同一 plan 使用 source 确定并显式下发的 `project_code`，不依赖前序 response 改写后续命令 |
| Altoc | Aims | `POST /api/v1/service/projects/from-opportunity` | Console service token，`aud=aims`，精确 `scope=aims:project:create-from-opportunity`，来源仅 `altoc`；强制标准 service-command envelope，并校验 tenant/deployment/target app/command hash | receipt 使用调用方冻结键；业务唯一键为 `opp_id + category`，同商机同 `presales` / `sales` 类型返回既有项目 | PIVR V1.1 B4：Aims 解析对应已发布模板并在 receipt 事务内创建项目、经理成员、里程碑/交付物；Altoc 继续拥有商机状态与主数据，Aims 不反向修改。Console v2.3 seed/verify 同时登记 Aims BFF、data-runtime 与 tenant-runtime audience 的精确 grant。 |
| Altoc / Aims | Aims | `GET /api/v1/service/projects/by-contract/{contractCode}` | Console service token，`aud=aims`，`scope=aims:read` | 读接口不要求；使用 `x-hzy-request-id` 追踪 | Phase 1 已实现；兼容旧单项目读取，P1 项目选择必须使用 `eligible-for-contract` 或 Altoc `project_plans` |
| Altoc / Aims | Aims | `GET /api/v1/service/projects/eligible-for-contract?contract_code=&customer_code=&search=` | Console service token，`aud=aims`，`scope=aims:read` | 读接口不要求；使用 `x-hzy-request-id` 追踪 | P1 已实现：返回同客户、未归档、未绑定合同或已绑定当前合同的项目候选，用于 Altoc 关联已有项目 |
| Altoc / Aims | Aims | `POST /api/v1/service/projects/{projectCode}/payment-milestones:sync` | Console service token，`aud=aims`，`scope=aims:write`；可靠链路使用标准 service-command envelope | 每次 activation + `plan_key` 一条 milestone operation，依赖同 plan project operation | G3 可靠化：每个 plan 的 milestone command 在 source 事务内独立冻结，不能把多项目网络调用塞入一个 receipt；Aims 按 `project_code + payment_term_id/template_key` mutation 并与 receipt 同事务，ack 丢失以原 hash 恢复 |
| Finance / Aims / Altoc | Altoc | `GET /api/v1/service/projects/{projectCode}/contract-lines` | Console service token，`aud=altoc`，`scope=altoc:read`，来源按调用方 | 读接口不要求；使用 `project_code` 作为跨应用键 | 新增：Altoc 按 `contract_project_line_rel` 返回 `contract_code`、`contract_line_code`、`relation_type`、`allocation_method/allocation_ratio/allocated_amount/planned_workdays`；包含 planned/active/closed 项目以支持历史成本归集，仅当结构化关系尚未回填时才回退 `line_codes_json` |
| Finance / People 编排 | Aims | `GET /api/v1/service/projects/{projectCode}/cost-summary` / `POST /api/v1/service/projects/{projectCode}/cost-summary:recalculate` | Console service token，`aud=aims`，读 `scope=aims:read`、写 `scope=aims:write` | `aims:project-cost:{project_code}:{period_start}:{period_end}:{calculation_key}` | Goal 3 新增：Aims 从 `time_entries` 聚合项目期间工时，使用调用方提供的 Finance/People 成本单价和外包/其他成本写入 `project_cost_summary`；同一 calculation key 重放返回既有 summary，不重复累加 |
| Finance / Aims / Altoc | Altoc | `GET/POST /api/v1/service/contract-lines/{contractLineCode}/cost-allocations` | Console service token，`aud=altoc`，读 `scope=altoc:read`、写 `scope=altoc:contract:edit` | `altoc:contract-line:{contract_line_code}:cost-allocation:{calculation_or_request_key}` | Goal 3 新增：维护或读取 `contract_line_cost_allocation` 归因快照，支持 direct/ratio/amount/workdays；来源可为手工规则或 `contract_project_line_rel` 自动物化；项目成本不得无规则归属合同行；若该合同行已有冻结利润摘要，普通分摊编辑返回 `profit_summary_frozen` |
| Finance / Altoc | Altoc | `POST /api/v1/service/contracts/{contractCode}/profit-summary:recalculate` | Console service token，`aud=altoc`，`scope=altoc:contract:edit` | `altoc:contract-profit:{contract_code}:{period_start}:{period_end}:{calculation_key}` | Goal 3 新增：收入来自 `contract_billing_schedule` 合同行节点；成本来自 Aims/Finance 提供的显式项目成本快照，先经 `contract_project_line_rel -> contract_line_cost_allocation` 归因快照再分摊，写入 `contract_line_profit_summary`；项目确实 0 成本也必须显式传 0；同 calculation key 幂等；多合同行未明确分摊返回 `cost_allocation_required`；冻结期间返回 `profit_summary_frozen` |
| Finance / Altoc | Altoc | `POST /api/v1/service/contract-lines/{contractLineCode}/profit-summary:freeze` | Console service token，`aud=altoc`，`scope=altoc:contract:edit` | `altoc:contract-line:{contract_line_code}:profit-freeze:{period_start}:{period_end}` | Goal 3 新增：冻结当前合同行期间利润摘要，写入 `frozen_at/frozen_by/freeze_key`；冻结后普通重算和分摊改写都必须失败 |
| Finance / Aims / Altoc | Altoc | `GET /api/v1/service/service-agreements/{serviceAgreementCode}/cost-summary` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/cost-summary:recalculate` | Console service token，`aud=altoc`，读 `scope=altoc:read`、写 `scope=altoc:contract:edit` | `altoc:service-cost:{service_agreement_code}:{project_code}:{period_start}:{period_end}:{calculation_key}` | Goal 3 新增：Altoc 统计服务工单数和 SLA 工单数，调用方传入 Aims/Finance 汇总后的服务项目工时与成本，按服务协议、项目、期间幂等写入 `service_cost_summary`，支持 `environment_code` 过滤 |
| Altoc / Finance / Console | Altoc | `GET /api/v1/altoc/analytics/contract/{contractCode}` / `GET /api/v1/altoc/analytics/customer/{customerCode}` | Console service token 或用户态 Altoc 权限，`aud=altoc`，`scope=altoc:read` | 读接口不要求 | Goal 3 新增：返回收入、合同行成本、服务成本、毛利和毛利率；breakdown 保留合同行摘要和服务成本摘要 |
| Aims | Altoc | Aims `review-approve` 事务写 operation → claim/drain → `POST /api/v1/service/payment-terms/{paymentTermId}/receivable-plan:mark-billable` → receipt 校验与 source checkpoint | Aims operation runtime 需 `aims:integration_operation:execute`；跨应用 Console service token `aud=altoc`、`scope=altoc:receivable:mark-billable`，来源 `aims`；目标只接受标准 service-command envelope | `aims:milestone:{project_code}:{milestone_id}:accepted:v1` | G3-2 可靠纵切：Aims 在锁定里程碑的事务内同时提交验收事实与冻结命令，目标只取 runtime `milestones.payment_term_id/project/contract`，浏览器 `receivablePlanCode/paymentTermId` 不参与选择。Altoc 校验 path/payment term、冻结合同、operation/capability/hash 后，把该付款条款的回款计划 mutation 与 succeeded receipt 同事务提交；同键同 hash 返回既有 receipt，异 hash 409。Aims 仅在精确 receipt checkpoint 后收口；5xx、timeout、ack 丢失保留原键恢复，并复用既有 drain、dead-letter、诊断和受控重放。 |
| Aims | Codocs | `POST /api/v1/project-cabinet/upload` / `GET /api/v1/project-cabinet/{uuid}/download-url?project_code=` / `GET /api/v1/project-cabinet/{uuid}/preview-url?project_code=` / `DELETE /api/v1/project-cabinet/{uuid}` | `aud=codocs`、`source app=aims`、`client=aims|aims.runtime`、tenant/deployment 精确绑定、精确 `codocs:project-cabinet:{read,upload,delete}`；不接受 wildcard/admin/通用 documents scope | Codocs 仅在 guard 成功后向 Runtime 写入 request-target HMAC 覆盖的 `codocs_trusted_project_cabinet_project_code`。Runtime GET/POST/DELETE SQL 固定该 marker；POST/DELETE OSS path 固定 `codocs/projects/{project_code}/cabinet/`；DELETE 要求 Aims 已验证索引 `project_code + expected_oss_path` 与 BFF 读取、Runtime 锁定行三方精确相等。 | Aims 仍在本地先完成项目成员/管理员、文档归属和访问策略校验，actor UID 只作审计字段。Console v1.50 seed/verify 仅为待授权文件，未执行，不授予浏览器权限或 user grant；PATCH/PUT 保持 `503 project_cabinet_mutation_contract_required`。 |
| Aims | Codocs | `POST /api/v1/service/project-documents/{uuid}/content` | `aud=codocs`、`source app=aims`、`client=aims.runtime`、tenant/deployment 精确绑定、精确 `codocs:project-document:content:read`；不接受 wildcard/admin/通用 `codocs:documents:read` | Aims 先以真实用户会话核验 member/leader/creator/scoped-admin 与精确 `project_documents.codocs_uuid` 或 document deliverable；固定 command actor/project/uuid/action，并以刚签发的短期 `aud=codocs` token 对首跳 command context 签名。Codocs 验签后，才以自身 runtime bearer 重签第二跳。runtime 接受任意物理类型的 active 文档，但必须重新执行 owner/share/relation ACL；Aims 项目关系不能授予 Codocs 读取权限，物理 `doc_type/project_code` 也不能替代该 ACL。 | 响应只有正文 DTO，不含 OSS path、signed URL 或授权细节。v1.67 将历史 v1.52 的无凭据 `aims` grant 校正到实际运行身份 `aims.runtime`；不恢复 generic search/summary/url/preview。 |
| Aims | Codocs | `POST /api/v1/service/department-documents/search` | `aud=codocs`、`source app=aims`、`client=aims.runtime`、tenant 精确绑定；token/source deployment 固定 Aims，可信服务路由/target deployment 固定 Codocs，两者分别进入 command HMAC；精确 `codocs:department-documents:list`，不接受 wildcard/admin/通用 documents 或 Runtime scope | Aims 与 Codocs 分别验证签名 actor 对 exact department 的 Directory 访问；Codocs 只在目标 gateway identity 为 `codocs` 且 target deployment 为 `<tenant>-codocs` 时使用自身 `codocs.runtime` 身份查询 Console Directory。command 固定 actor/dept/pageSize/action，Runtime 仅接受重签后的 service-command actor，从 command 重建 `type=department + dept_code`，以现有部门读取谓词返回 active 文档与目录。 | 产品规则为“该用户可读取的部门文档均可作为立项书候选”；不读取正文，不返回 OSS/策略，不恢复 UUID summary。Console v1.94 仅授权有凭据的 `aims.runtime`。 |
| Aims | Codocs | `POST /api/v1/service/project-documents/{uuid}/versions/{versionId}:resolve` / `POST /api/v1/service/project-document-review-grants` / `POST /api/v1/service/project-documents/{uuid}/versions/{versionId}/review-content` | `aud=codocs`、`source app=aims`、`client=aims.runtime`、tenant/deployment 精确绑定；分别使用 `codocs:project-document:version:resolve`、`codocs:project-document:review-grant:create`、`codocs:project-document:review-content:read` | Aims 先证明当前用户对确定 deliverable 与项目有关系；Codocs resolve 再以 actor 重施原文档 ACL并返回确定 version/hash。grant 精确绑定 Aims `submission_no + document_uuid + version_id + qa/project_director`，同一绑定幂等。review-content 只接受完全匹配的有效 grant，按 OSS version ID 读取并复算 SHA-256；不得读取后续版本。 | Aims 保存不可变 `deliverable_submission` 证据快照；QA 自提交固定走 PM 完整性确认后由项目总监质量审核。Console v1.88 只为有凭据的 `aims.runtime` 配置三项精确 grant，不授予浏览器或用户通用 Codocs 权限。 |
| Aims | Codocs | `POST /api/v1/service/company-weekly-summaries/{periodKey}:publish` | `aud=codocs`、来源 `aims`、客户端 `aims.runtime`、精确 `codocs:company-weekly-summary:publish`；标准 service-command envelope，tenant/deployment/operation/hash 全绑定 | `aims:company-weekly-summary:{periodKey}:r{revision}:publish:v1`；Aims operation 只冻结版本 ID、Markdown hash 和实际收件人，不在 command 中复制正文。Codocs 另行回读 Aims 不可变 Markdown，复算 hash 后创建/复用一个公司只读文档、追加不可变版本和精确 UID share，并在同一事务写 receipt。Aims 只在 receipt checkpoint 后发布汇总并确认项目经理职责工时；失败可重试，目标尚未开始时可取消，更正只追加新 revision。 | 已落地；Console v1.90 授权。抄送人员和部门在发布时解析为 active UID 快照，后续目录变化不改写历史版本。 |
| Altoc | Codocs | `POST /api/v1/service/altoc-entity-documents/{uuid}/{content\|attach}` | `aud=codocs`、`source app/client=altoc`、tenant/deployment 精确绑定，分别仅接受 `codocs:altoc-entity-document:content:read` 或 `codocs:altoc-entity-document:attach` | content 前 Altoc 重验实体 view 和精确已存 `document_link`；attach 前重验实体 edit 与实体存在。首跳绑定 actor/entity type+ID/UUID/action/HMAC；Codocs 重新执行原 ACL。attach 只允许 active owner/write-share，且 Altoc `(entity,uuid)` 重放幂等。 | 无 generic UUID、正文、摘要或 URL 路由；不返回 OSS/签名/ACL。v1.53 seed/verify 待批准，未执行。 |
| Altoc | Finance | Altoc `POST /api/v1/receivable-plans/{receivablePlanCode}/invoice-request` 编排 Finance `POST /api/v1/finance/invoice-requests` | Console service token，`aud=finance`，`scope=finance:write`，来源 `altoc` | `altoc:receivable:{receivable_plan_code}:invoice-request:v1` | Phase 1 已实现：Altoc UI 入口调用本地编排器，runtime 校验回款计划并组装 payload，Finance 按来源业务键幂等创建，Altoc runtime 写回款计划审计 |
| Altoc / Finance / Workflow | Finance / Workflow | Altoc operation → `POST /api/v1/finance/service/invoice-requests/create` → Finance operation → `POST /api/v1/service/finance-invoice-approval` → 两级 receipt/checkpoint | Altoc→Finance：`aud=finance`、`scope=finance:invoice-request:create`；Finance→Workflow：`aud=workflow`、`scope=workflow:invoice-request:create`；两级均要求来源 service token、标准 service-command envelope 和与冻结 command 相等的受信 actor delegation | `altoc:receivable:{receivable_plan_code}:invoice-request:v1` / `finance:invoice-request:{invoice_request_code}:workflow-submit:v1` | Altoc 在回款计划锁事务冻结 Finance command；Finance 的 invoice request mutation、target receipt 与 Workflow operation 同事务。Workflow instance mutation 与 target receipt 同事务；Finance 最终把 invoice `pending_approval`、external instance、attempt 和 source operation 同事务 checkpoint。5xx/timeout/ack-loss 保留原键恢复；同键同 hash 重放，异 hash 409。浏览器 Authorization/Cookie 不转发；合同级无稳定计划身份的旧入口返回 410。 |
| Console action / Finance 用户 | Finance | `GET /api/v1/finance/invoice-requests/{code}` → `/finance/invoices/requests/{code}`；`GET /api/v1/finance/receipts/{code}` → `/finance/receipts/{code}` | 普通 Finance 用户 permission；manifest 仅支持既有 `tenant:global` / `subject:self`，不自动建 grant | invoice request / receipt `code` | P1：列表和 exact-code 详情按当前 `issuance_responsible_uid` / `reconciliation_responsible_uid` 过滤，受信全局访问旁路；责任转移实时撤销旧责任人读取。issue、receipt confirm、reconciliation 各自要求独立 action + 当前责任，通知关系不扩写权限，浏览器伪造 actor/access 被剥离。 |
| Altoc | Finance | `GET /api/v1/finance/contracts/{contractCode}/summary` / `GET /api/v1/finance/contracts/summaries` | Console service token，`aud=finance`，`scope=finance:read`，来源 `altoc` | 读接口不要求；摘要版本用 `calculated_at` | Phase 1 已实现：Altoc 合同列表和合同详情发票页读取并展示 Finance 开票、到账、核销、未核销摘要 |
| Finance | Altoc | Finance 核销事务写 operation → `POST /api/v1/service/contracts/{contractCode}/finance-summary:sync` → receipt 校验与 source checkpoint（事件 `finance.contract.summary.updated` 保留后续总线语义） | Finance operation runtime 需 `finance:integration_operation:execute`；跨应用 Console service token `aud=altoc`、`scope=altoc:contract:finance-summary:sync`，来源 `finance` | `finance:reconciliation:{reconciliation_code}:altoc-summary:v1` | G3 可靠纵切：Finance 只从锁定的到账/发票关联与 runtime 重算摘要生成最小冻结命令，并与核销事实同事务；Altoc 回款计划更新与 succeeded receipt 同事务，同键同 hash 返回原合同摘要业务键，异 hash 409；Finance 精确校验 receipt 后 checkpoint，ack 丢失使用原幂等身份恢复。scheduled drain 默认关闭，migration 尚未执行。 |
| Aims / Altoc | Assets | `POST /api/v1/service/deliveries/upsert` | Console service token，`aud=assets`，`scope=assets:write`，来源 `aims` 或 `altoc` | `contract:{contract_code}:project:{project_code}:delivery-view:v1` | Phase 2 已实现；Assets BFF 在转发 tenant-runtime 前校验入站 service token；按 `delivery_code` 或 `contract_code + project_code` 幂等 upsert，返回交付资产包 |
| Aims / Assets | Assets | `POST /api/v1/service/deliveries/{deliveryCode}/documents` | Console service token，`aud=assets`，`scope=assets:write` | `delivery:{delivery_code}:document:{document_uuid}` | Phase 2 已实现；Assets BFF 在转发 tenant-runtime 前校验入站 service token；保存 Codocs UUID，支持 `artifact_type` 九类交付成果，并把 Aims `milestone_id/milestone_code` 等上下文写入 `asset_documents.source_context` |
| Altoc / Aims / Finance | Assets | `GET /api/v1/service/deliveries/package?customer_code=&contract_code=&project_code=` | Console service token，`aud=assets`，`scope=assets:read` | 读接口不要求 | Phase 2 已实现；Assets BFF 在转发 tenant-runtime 前校验入站 service token；按客户 / 合同 / 项目返回交付视图、产品、环境、文档包 |
| Altoc | Assets | `POST /api/v1/service/customer-delivery-assets/plans` | Console service token，`aud=assets`，`scope=assets:write`，来源 `altoc` | `altoc:contract:{contract_code}:customer-delivery-assets:v1` | P1 已实现：按 Altoc 合同计划资产 upsert Assets `customer_delivery_assets` 主档，`project_code` 可为空，返回 `delivery_asset_code` 供 Altoc 回填 |
| Altoc / Aims / Finance | Assets | `GET /api/v1/service/customer-delivery-assets/by-customer?customer_code=&contract_code=&project_code=` / `GET /api/v1/service/customer-delivery-assets/by-contract/{contractCode}` | Console service token，`aud=assets`，`scope=assets:read` | 读接口不要求 | P1 已实现：按客户、合同或项目读取客户交付资产主档 |
| Aims / Altoc | Assets | `POST /api/v1/service/environments/upsert` | Console service token，`aud=assets`，`scope=assets:write`，来源 `aims` 或 `altoc` | `environment:{customer_code}:{source_project_code}:{idempotency_key}` | Goal 2 新增：Assets 生成 / 复用正式 `environment_code`；显式 code 只能引用已有环境，幂等键重试返回同一对象，不按名称模糊复用 |
| Aims / Altoc | Assets | `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/environments:bind` / `GET /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/environments` / `GET /api/v1/service/environments/{environmentCode}/customer-delivery-assets` | Console service token，`aud=assets`，读 `scope=assets:read`、写 `scope=assets:write` | `delivery-asset:{delivery_asset_code}:environment:{environment_code}:{relation_type}` | Goal 2 新增：正式交付资产与正式环境的多对多部署关系；设置主环境时同步旧 `customer_delivery_assets.environment_code` 快照 |
| Aims / Altoc | Assets | `POST /api/v1/service/environments/{environmentCode}/lifecycle:sync` / `POST /api/v1/service/references:resolve` | Console service token，`aud=assets`，读 `scope=assets:read`、写 `scope=assets:write` | `environment:{environment_code}:status:{status}` | Goal 2 新增：同步环境 planning/active/frozen/retired 生命周期并批量解析正式对象和资产-环境 pair；`accepted` 输入只写验收时间并归一到 `active` |
| Aims / Assets / Altoc | Aims | `GET /api/v1/service/projects/{projectCode}/environments` / `POST /api/v1/service/projects/{projectCode}/environments` / `POST /api/v1/service/projects/{projectCode}/environments/{environmentCode}:status` / `POST /api/v1/service/projects/{projectCode}/environments/{environmentCode}:assets-sync` | Console service token，`aud=aims`，读 `scope=aims:read`、写 `scope=aims:write` | `aims:project:{project_code}:environment:{environment_code}:{delivery_asset_code}` | Goal 2 新增：Aims 保存项目对正式环境的执行关系、版本快照和 Assets 同步状态；Aims 不生成正式 `environment_code` |
| Altoc / Aims | Assets | `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/activate` | Console service token，`aud=assets`，`scope=assets:write` | `customer-delivery-asset:{delivery_asset_code}:status:{status}` | P1 已实现：推进客户交付资产 delivered/online/accepted 等状态；Assets BFF 会尽力回调 Altoc 状态同步，回调失败不回滚 Assets 状态，响应附带同步错误便于重放 |
| Assets | Altoc | Assets 状态事务写 operation → `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/status:sync` → receipt 校验与 source checkpoint | Assets operation runtime 需 `assets:integration_operation:execute`；跨应用 Console service token `aud=altoc`、`scope=altoc:contract:delivery-asset-status:sync`，来源 `assets` | `assets:delivery-asset:{delivery_asset_code}:altoc-status:revision:{source_revision}:v1` | G3 可靠纵切：Assets 仅在正式资产、环境、状态及目标相关事实变化时递增 revision，同事实重放复用 operation；状态 mutation 与 operation 同事务。Altoc mutation 与 receipt 同事务，并锁定 applied watermark：低 revision stale-skipped、同 revision 异 hash 409、更高 revision 才推进计划资产、服务覆盖、义务和结算。即时 pending 返回 202；scheduled drain 默认关闭且按 20条/45秒/剩余25秒有界。migration 尚未执行。 |
| Altoc / Assets / Aims / Finance | Altoc | `GET /api/v1/service/service-agreements/{serviceAgreementCode}/coverages` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/coverages` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/coverages/{coverageCode}:resolve|suspend|end|confirm-legacy` | Console service token，`aud=altoc`，读 `scope=altoc:read`、写 `scope=altoc:contract:edit` | `altoc:service-agreement:{service_agreement_code}:coverage:{coverage_code}` | Goal 2 新增：`service_agreement_coverage` 是正式覆盖事实源，区分 `source_plan_code`、`delivery_asset_code`、`environment_code` 和 `legacy_reference`；新读优先 coverage，旧 `service_agreement_asset` 只作未迁移回退 |
| Altoc / Assets / Aims / Finance | Altoc | `GET /api/v1/service/service-agreement-coverages/by-environment/{environmentCode}` / `GET /api/v1/service/service-agreement-coverages/by-delivery-asset/{deliveryAssetCode}` | Console service token，`aud=altoc`，`scope=altoc:read` | 读接口不要求 | Goal 2 新增：按正式环境或正式交付资产反查服务协议覆盖 |
| Finance | Assets | `GET /api/v1/service/projects/{projectCode}/cost-summary?period_month=` | Console service token，`aud=assets`，`scope=assets:read` | 读接口不要求 | Phase 2 已实现；Assets BFF 在转发 tenant-runtime 前校验入站 service token；输出资产采购、资源订阅、环境投入和月度归集成本分解，供 Finance 项目核算写入 `project_cost_allocation` |
| Aims / Altoc / Finance / Assets | Workflow | `POST /api/v1/action-defs/sync` | Console service token，`aud=workflow`，`scope=workflow:proxy` 或 app service grant | `workflow:action-defs:{app_code}:{manifest_hash}` | 通用能力已有；Assets Phase 2 已新增采购、领用、分配、退回、报废 action manifest |
| Workflow | Aims | `POST /api/v1/service/workflow/callback`（Aims BFF），内部写入 `POST /v1/aims/service/workflow/callback` | Console service token，`aud=aims`，`scope=workflow:callback`，来源仅 `workflow`；Aims BFF 用自身 tenant-runtime 身份写入 data-runtime | Workflow callback outbox 的 `instance_id + event + status` 稳定键 | 立项审批通过时，data-runtime 在串行化事务内锁定项目，将 `approval_pending → active`，把里程碑 `planning` 归一为 `todo` 并激活 `sort_order/start_date/id` 最前的里程碑；重放保留已激活里程碑，驳回将项目回退为 `draft`。里程碑完成回调继续复用同一受信入口。 |
| Workflow | Assets | `POST /api/v1/purchase-orders/{id}/workflow:sync` / `POST /api/v1/assignments/{id}/workflow:sync` | Console service token，`aud=assets`，`scope=workflow:callback` 或 `assets:write` 代理 | `workflow:{instance_no}:assets:{resource}:{id}:{status}` | Phase 2 已实现 runtime 同步入口；资产操作默认 pending，审批通过后才联动资产主档 |

### 事件口径

Phase 1 先以 service API + 幂等键 + 审计日志落地，不强制引入全局事件总线；后续如果进入事件汇总或消息队列，事件名和载荷语义保持不变。

| 事件名 | 事实源 | 触发条件 | 消费方 | 关键载荷 |
| --- | --- | --- | --- | --- |
| `altoc.contract.effective` | Altoc | 合同状态变为 `effective` | Aims / Assets / Workflow | `customer_code`, `contract_code`, `contract_id`, `opp_id`, `payment_terms[]` |
| `aims.project.linked_to_contract` | Aims | 项目创建或绑定合同 | Altoc / Assets / Finance | `project_code`, `customer_code`, `contract_code`, `opp_id`, `contract_id` |
| `aims.milestone.accepted` | Aims | 绑定 `payment_term_id` 的验收里程碑完成 | Altoc / Finance | `project_code`, `milestone_id`, `payment_term_id`, `receivable_plan_code?`, `accepted_at` |
| `altoc.receivable.billable` | Altoc | 回款计划进入可开票状态 | Finance / Console | `receivable_plan_code`, `contract_code`, `amount`, `planned_invoice_date` |
| `finance.invoice_request.approved` | Finance | 开票申请审批通过 | Altoc / Console | `invoice_request_code`, `contract_code`, `receivable_plan_code`, `requested_amount` |
| `finance.invoice.issued` | Finance | 正式发票生成 | Altoc | `invoice_code`, `invoice_no`, `contract_code`, `receivable_plan_code`, `invoice_amount` |
| `finance.receipt.confirmed` | Finance | 到账确认 | Altoc | `receipt_code`, `contract_code`, `receivable_plan_code`, `received_amount` |
| `finance.reconciliation.completed` | Finance | 核销完成 | Altoc / Aims | `reconciliation_code`, `contract_code`, `receivable_plan_code`, `reconciled_amount` |
| `finance.contract.summary.updated` | Finance | 合同摘要重算 | Altoc / Aims / Console | `contract_code`, `invoice_amount`, `received_amount`, `reconciled_amount`, `risk_status`, `calculated_at` |
| `aims.project_cost.summary.ready` | Aims | 项目期间成本重算完成 | Altoc / Finance | `project_code`, `period_start`, `period_end`, `total_hours`, `labor_cost`, `outsourced_cost`, `other_cost`, `total_cost`, `calculation_key` |
| `altoc.contract_line.profit_summary.updated` | Altoc | 合同行毛利重算或冻结完成 | Finance / Console | `contract_code`, `contract_line_code`, `period_start`, `period_end`, `total_revenue`, `total_cost`, `gross_profit`, `gross_margin`, `calculation_key`, `frozen_at` |
| `altoc.service_cost.summary.updated` | Altoc | 服务协议成本重算完成 | Finance / Aims / Console | `service_agreement_code`, `project_code`, `environment_code`, `period_start`, `period_end`, `ticket_count`, `sla_ticket_count`, `total_hours`, `total_cost`, `calculation_key` |
| `assets.delivery_view.upserted` | Assets | 客户交付视图创建或更新 | Aims / Altoc / Console | `delivery_code`, `customer_code`, `contract_code`, `project_code`, `status` |
| `assets.delivery_document.linked` | Assets | 交付视图关联 Codocs 文档 | Aims / Altoc / Console | `delivery_code`, `document_uuid`, `artifact_type`, `project_code`, `contract_code`, `milestone_id` |
| `assets.customer_delivery_asset.status_changed` | Assets | 客户交付资产进入 delivered / online / accepted 等状态 | Altoc / Aims / Finance | `delivery_asset_code`, `customer_code`, `contract_code`, `contract_line_code`, `status`, `accepted_at` |
| `assets.environment.upserted` | Assets | 正式客户环境创建或复用 | Aims / Altoc / Finance | `environment_code`, `customer_code`, `contract_code`, `source_project_code`, `status` |
| `assets.delivery_asset_environment.bound` | Assets | 正式交付资产与正式环境关系创建或更新 | Aims / Altoc / Finance | `delivery_asset_code`, `environment_code`, `relation_type`, `deployment_status`, `is_primary`, `source_project_code` |
| `aims.project_environment.status_changed` | Aims | 项目推进部署、上线、验收或交接 | Assets / Altoc / Finance | `project_code`, `environment_code`, `delivery_asset_code`, `delivery_status`, `assets_sync_status` |
| `altoc.service_agreement_coverage.resolved` | Altoc | 服务覆盖从计划或旧引用解析为正式对象 | Assets / Aims / Finance | `service_agreement_code`, `coverage_code`, `target_type`, `source_plan_code`, `delivery_asset_code`, `environment_code`, `resolution_status` |
| `assets.project_cost.summary.ready` | Assets | 项目资产成本摘要可供 Finance 同步 | Finance | `project_code`, `period_month`, `asset_purchase_amount`, `resource_subscription_amount`, `environment_investment_amount` |

### 幂等与审计要求

- 所有跨模块写操作必须带 `Idempotency-Key` header；没有 header 时，被调用方应拒绝 service-only 写操作或按请求体派生同等幂等键。
- 幂等键格式：`<source_app>:<source_object_type>:<source_object_key>:<action>:v<major>`；涉及目标对象时追加 `:<target_object_key>`。
- 被调用方必须记录 `source_app`、`source_biz_type`、`source_biz_code`、`idempotency_key`、`request_id`、`actor_uid`、`service_client_id`、`created_at`；若现有业务表没有字段，先写入审计日志或后续补专门 bridge log 表。
- 幂等冲突返回已创建对象的稳定业务键，不重复创建业务对象。
- Workflow 回调必须带 `instance_no`、`app_code`、`resource_code`、`action_code`、`biz_id`、`status`、`completed_at`、`idempotencyKey`。

Phase 1 实现说明：Altoc 合同激活→Aims 项目/里程碑、Aims 验收→Altoc 可开票、Altoc 开票申请→Finance/Workflow、Finance 核销→Altoc 财务摘要均已升级为 caller-owned `integration_operation` + target-owned `service_command_receipt`；业务 mutation、源命令和目标 receipt 的事务边界见下方 G3 可靠投递契约。Assets 客户交付资产状态仍按 `delivery_asset_code + status` 派生幂等键回传 Altoc 计划资产、义务和结算状态。

### 可靠投递、操作记录与目标回执（G3）

跨模块定向写入的可靠性模型以 [`CROSS_MODULE_OPERATION_MODEL.md`](./CROSS_MODULE_OPERATION_MODEL.md) 为唯一详细设计。关键边界如下：

- 调用方应用拥有 `integration_operation`，并由自身 data-runtime adapter 在本地业务 mutation 的同一数据库事务中写入；BFF、Cloudflare Queue、KV 和 data-runtime 进程内存都不是耐久事实源。
- 每条 operation 只代表一个目标应用的一条命令；多目标链路通过 correlation、顺序和依赖关联多行，不允许执行时改写 target app。
- 目标应用拥有 `service_command_receipt`，目标业务 mutation 与 succeeded receipt 同事务；同键同 hash 返回原目标业务键，同键异 hash 返回 `409 idempotency_payload_mismatch`。
- 业务审计、integration operation 和 domain event outbox 是三类不同事实，不合并成万能表。Altoc `contract_orchestration_job/step` 保留合同专用业务视图，不能冒充所有跨模块操作的通用队列。
- dispatcher 只能通过代码映射 operation code 到目标 app、audience、capability 和 path；payload 不得覆盖路由、安全上下文或幂等身份。每次尝试重新申请短期 service token，禁止持久化 token、Cookie、Authorization 或内部 runtime URL。
- 网络错误、timeout、408/425/429/5xx 可自动退避；401/403 和确定性契约错误进入人工终态，不得自动重试或泛化为 502。响应/ack 丢失或 lease 过期进入 `partial_unknown`，必须用原幂等键恢复。
- 管理员重放只接受 operation ID、原因和 expected version；不得修改 tenant/deployment/source/target/业务键/idempotency/payload。查看和重放权限分离，并记录原 actor 与 replay actor。
- Aims/Altoc/Assets/Finance/People 管理端列表与 `GET /api/v1/integration-operations/{operationId}/attempts` 必须命中同一 grant 的租户全局范围；浏览器 BFF 必须在 runtime 返回后执行 Foundation allow-list 投影。列表/attempt 只允许 operation ID、目标 app、operation code、source/target 业务键、状态、尝试计数、版本、稳定错误码/类别、时间和耗时；不得返回 operation/correlation/idempotency key、required capability、command/schema/hash、lock/fencing、原始错误正文、request/response 或认证材料。受控重放请求和响应只保留 `operationId`、`expectedVersion`、1–500 字符 `reason`。
- 共享 Cloudflare 自动 drain 由 Platform 无凭证 scheduler page 与 Tenant Gateway 5 分钟 cron 负责。registry 采用时间轮换窗口、稳定分片和不透明 cursor，只返回 tenant host/environment 与 Aims、Altoc、Console、Finance、People、Workflow app code；Gateway 重新 resolve runtime endpoint 后以空 body、内部 token、60 秒 HMAC 调固定私有 wake。业务应用使用 app 前缀路径，Console 使用根路径 `/api/internal/integration-operations/drain`；所有 wake 使用 event-bound IO，普通 HTTP/`/_nitro/tasks/**` 禁止。共享 Console 不配置单租户 Runtime URL/token，也不自带 Cloudflare cron。People 还把可信 Console target deployment 纳入 HMAC，以便投递 Directory lifecycle；跨应用调用重新进入 tenant host，由 Gateway 注入目标 app deployment。service-token 和 Console-runtime cache 必须按可信 tenant/deployment/environment/app 隔离。Gateway 对同一租户的应用使用有界并发唤醒；drain 返回本轮领取或新建操作时，只在同一个总 wall-time 内最多继续两轮，空队列立即停止，5 分钟 cron 仍作为恢复兜底。Tenant Gateway 对成功的 Platform 租户注册表解析保留 5 分钟新鲜缓存，并允许在 Platform/Hyperdrive 暂时不可用时使用不超过 24 小时的最近成功值；从未成功解析或已超过兜底窗口时仍失败关闭，缓存不得包含内部 token、runtime token 或登录 secret。
- Altoc→Aims、Aims→Altoc、Altoc→Codocs/Assets 的目标写接口使用统一 `service_command_receipt` executor。Foundation 以目标 Runtime bearer 对 source/target deployment、app、operation、capability、schema、idempotency、command hash 和 request ID 签名；原 actor 使用独立 service-command delegation/audit 证据，不进入可由另一授权操作者恢复的业务 command hash。目标 runtime 验证后才允许在目标业务 mutation 同一事务写 succeeded receipt；source checkpoint 校验并保存 `target_receipt_id`，ACK 丢失可用原幂等身份恢复。
- Aims 验收→Altoc 可开票使用同一 executor：source transaction 只从锁定的里程碑 `payment_term_id` 冻结 `aims.milestone.receivable-billable.v1`，不得接受浏览器 target hint；Altoc 以 `payment-term:{id}` 作为目标业务集合键，并在 receipt 事务中校验冻结 `contractCode` 与实际回款计划合同一致。
- Altoc 合同激活→Aims 按每个 `project_plan` 拆为 project operation 和依赖它的 milestone operation；两者 sequence/depends_on、target=`aims`、capability=`aims:write` 与 endpoint 都由代码固定。source 为无显式 code 的 plan 使用与 Aims 一致的规范化规则冻结确定 project code，并把原 actor 只保存在 operation 审计列，不写入 command hash；不同操作者重放同一 activation 不产生 payload mismatch。
- dead-letter 通知由 Aims/Altoc/Assets/Finance/People source runtime 提供安全候选和 CAS ack。source 以 `integration_operation_dead_letter_actionable` 保存 operation+generation 的 action key、冻结 object version、Console notification ID 与实际显式收件 UID；replay/success 事务写 resolved/cancelled closure，未 ACK 的旧 generation 阻止后续 generation 发布。People 只允许 Directory→Console 两条生命周期 operation 与 People→Assets 离职资产 operation 进入候选，未来 family 不会自动接入。Foundation 调 Console 专用 `POST /api/v1/console/notifications/integration-operation-dead-letter`。Console 要求 `aud=notifications`、`scope=notifications:publish`，并把 tenant/deployment/source app 绑定 service token；稳定 SHA-256 幂等键避免重复通知，成功后 source 保存 Console notification ID。Finance/Assets 与 People publish grant 分别由 v1.46/v1.47 seed 增量补齐，且不授予浏览器权限；fallback 收件人由 `notification.integrationOperationRecipients` 配置，初始设置见 v1.36。

## Aims ↔ GitLab / 外部任务消费者契约

Aims 是任务事实源，GitLab Issue 只是外部执行投影。GitLab Token 只在 Console tenant-runtime 的 fixed-operation 边界解析；Orca、WebDev 等消费者读取 Aims 任务时使用独立 Console service identity，不共享 GitLab Token、静态 API Key 或浏览器用户 Cookie。

| 调用方 | 被调用方 | 端点 / 事件 | 认证 | 幂等 / 追溯 | 状态 |
| ------ | -------- | ----------- | ---- | ----------- | ---- |
| Aims BFF | Console GitLab integration | `POST /api/v1/projects/{projectId}/sync-gitlab-issues` → Console fixed operation `gitlab.issue-upsert` | 浏览器先通过 Aims 项目 manager/scoped-admin 校验；Aims runtime 需 `integration_operations:execute` 且 semantic grant 包含 `gitlab.issue-upsert` | SHA-256 幂等键；Issue 正文固定 `hzy-aims:item-key` marker；`gitlab_issue_links` 对 `work_item_id+repo` 和 `repo+iid` 双唯一，已有 IID 更新前复验 marker | 已落地；单次最多 100 条，completed→closed，其余→opened；只允许 `aims_project_repos` 已绑定仓库，部分失败不写本地链接 |
| Orca / WebDev / 已登记服务客户端 | Aims | `GET /api/v1/service/tasks?projectCodes=&statuses=&assigneeUid=&cursor=&limit=` | Console service token，`aud=aims`、`token_use=service`、精确 capability `aims:tasks:read`；调用方准入只由 Console grant 决定 | 按 `work_items.updated_at,id` 升序的不透明 cursor；返回稳定 item/project key、任务执行字段、Aims 相对路径及最近 GitLab Issue 投影 | 已落地；`limit<=200`、项目过滤最多 100 个。Console v1.94 seed 为已存在的 WebDev/Orca service client 授权，未登记客户端需先安全 provision |

## People ↔ Aims / Finance / Workflow 项目绩效契约（Phase 3）

People 是人员运营事实、任职、M/P 职级设置、月度人员成本快照、项目贡献快照和个人绩效主流程事实源；Console Directory 是登录用户、部门、项目注册表和访问控制事实源，Console 系统参数提供 M/P 职级序列数量。生产切换期允许从 Console Directory 初始化 People 员工事实；正常运营期，入职、调岗、离职等 HR 事实应先落 People，再按服务契约投影到 Console Directory。钉钉 HR 同步使用通讯录员工的入职日期和 HR 离职接口的明确状态、最后工作日/原因；既有钉钉 identity 优先匹配，其次只允许唯一且无歧义的 Directory 邮箱，绝不以通讯录缺失推断离职。People 不复制 Aims 任务/工时明细、Codocs 文档正文或 Finance 财务核算结果；Finance 提供人力成本计算参数、项目财务指标和绩效金额/提成奖金财务口径快照，供 People 成本快照和绩效周期引用。项目成本核算主路径由 Finance 读取 Aims 月度工时与 People 职级设置后自行计算标准人力成本，不依赖 People 绩效周期或贡献快照。

| 调用方 | 被调用方 | 端点 / 事件 | 认证 | 幂等 / 追溯 | 状态 |
| ------ | -------- | ----------- | ---- | ----------- | ---- |
| People BFF | People data-runtime | `POST /v1/people/service/directory-users:sync` | Console service token，`aud=people`，`scope=people:write`，来源 `console` | `employee_uid` upsert 员工事实；`ASN-DIR-{employee_uid}` upsert 当前目录导入任职；保留 Console Directory 原始引用 | 已落地；用于 Console → People 初始化导入，不作为长期双向同步主路径 |
| People BFF | Console / Connector Runtime | `GET/POST /api/v1/console/service/directory/hr-sources/dingtalk/department-mappings`；`GET/POST .../dingtalk/department-changes`；`POST/GET .../service/connector-runtime/people-sync-jobs` 及 `cancel/retry` | `aud=console`；固定 `people.runtime` service client；精确 `console:hr-source-sync:view|execute|admin`；映射、部门停用及 job 创建/取消/重试均使用标准 service-command HMAC 绑定 tenant、source/target deployment、原 actor、capability、command hash 与幂等键；Console 向 Connector Runtime 继续传递原 actor 与幂等键 | `external_department_id -> canonical dept_code`；旧 `DT-* -> canonical dept_code` alias；Connector 提交 final marker、根部门、计数与聚合 hash；Console receipt + People 引用事务重映射，失败可通过已映射行的显式“重新对账 People 引用”动作恢复 | 已落地；浏览器入口仅 People `hr_source_sync`，Console 旧钉钉按钮/写 API 410。缺失正式部门只在完整快照验证后冻结，超过数量/比例阈值或根部门变化标高风险；所有停用仍需 People 管理员逐项确认并实时重查人员/子部门。钉钉只接管正式行政部门、人员主归属和在离职状态，委员会、虚拟组织、项目组及稳定 `dept_code` 不归钉钉 |
| People BFF | People data-runtime | `POST /v1/people/service/hr-source-sync/dingtalk/departments:remap` | 仅固定 `client:people.runtime`，精确 `people:hr-source-department-remap:execute`，并要求绑定请求目标的管理员 actor HMAC；alias 只能来自 People BFF 已验真的 Console mapping response，不允许 People Runtime 跨库读取 Console 表 | 批量把 `people_employees.dept_code` 与 `people_assignments.dept_code` 从旧 alias 改为 canonical code；重复执行无副作用 | 已落地；Console 成功、People 暂时失败时，管理员可对已绑定 mapping 执行“重新对账 People 引用”恢复；其他持有通用 `people.write` 的应用不能调用 |
| People data-runtime | Console Directory | `people.directory.employment-sync.v1` / `people.directory.offboarding-disable.v1` → employment/disable service API | `aud=console`；精确 `console:directory-employment:sync` / `console:directory-offboarding:disable`；标准 envelope + source/target deployment HMAC binding | People 在 employee/approved effective assignment mutation 同事务从锁定事实生成单调 revision operation；钉钉 Connector 也只能先写 People 后复用同一 operation。未来生效 assignment 用固定 `asOf` 调 `directory-lifecycle:prepare-due` 到期冻结。Console 同事务应用 Directory/session/钉钉 identity 事实、水位、receipt，并冻结下一跳 Platform operation。People 收到有效 Console succeeded receipt 后立即完成自身 operation；返回的 Platform pending 只表示 Console 所有的下一跳尚未完成，不得把 People operation 写成失败重试。低 revision stale-skip，同 revision 异 hash 409 | 已可靠化；共享 Worker 由 Platform registry + Tenant Gateway 版本化 scheduler 唤醒，HMAC 绑定 tenant、People deployment、Runtime endpoint 与 Console target deployment；每轮先有界领取、再并发投递冻结操作，单条失败互相隔离；专属 Worker 自有 cron 仍默认关闭。BFF 不读取浏览器 projection hints，旧 admin disable 旁路 410 |
| Console Directory | Platform authorization | `console.platform.employment-sync.v1` / `console.platform.offboarding-revoke.v1` → Platform internal authorization API | 固定 internal principal，精确 `platform:employment-authorization:sync` / `platform:offboarding-authorization:revoke`；tenant/deployment/principal/envelope/actor HMAC 绑定 | Console Directory/receipt 与 caller-owned Platform operation 同事务；Platform 校验 Console deployment 属于 tenant，在 authorization mutation 同事务推进 employee revision watermark 并写 receipt；ack 丢失按原 key 恢复 | 已可靠化；Platform 不可用不回滚 Directory/账号事实。Console drain 默认关闭、lease/fencing/append-only attempt、8次阈值和20条/45秒边界；每轮领取的有界批次并发投递且逐条 checkpoint；共享 Worker 由 Platform registry + Tenant Gateway 逐租户签名唤醒并使用 event-bound Runtime binding；active→left→active 和迟到旧任职按 source revision 收敛 |
| People BFF | Assets | `POST /api/v1/service/offboarding-recoveries:upsert` | Console service token，`aud=assets`，`scope=assets:offboarding-recovery:sync`，来源 `people`；标准 service-command envelope | `people.offboarding.assets-recovery-sync.v1`；People 固定 `asOf` 后只为当前 left/inactive 或最新已生效、approval-free/approved leave 创建 operation；Assets case 与 receipt 同事务，同键异载荷 409 | 新增、默认关闭；不读取 Console inactive，不复制 People 资产回收协调状态；未来/未批准 leave 与已被后续 onboard/transfer 覆盖的历史 leave 不投影，People 仅在精确 receipt 验证后确认 succeeded |
| People BFF | Console Settings | `GET /api/v1/console/settings/values?keys=people.rankSeries.managementCount,people.rankSeries.professionalCount` | Console service token，`aud=system_settings`，`scope=system_settings:view` | 读接口不要求；返回管理序列和专业序列职级数，默认 M5 / P10 | 已落地；People 职级设置页据此生成 M/P 页签和职级行，不提供自由新增职级 |
| Finance BFF / 工时核算方 | Console Work Calendar | `GET /api/v1/console/service/work-calendar/month?calendarCode=CN&yearMonth=YYYY-MM` | Console service token，`aud=system_settings`，`scope=system_settings:view`；Console handler 仅接受 service actor，普通用户态管理查询走 `/api/v1/console/work-calendars/**` | 读接口不要求；返回 `workdayCount`、`standardHoursPerDay`、`standardWorkHours` 和来源 | 新增；Console 是月标准工时事实源，Finance 项目人力成本分摊应使用 `project_hours / standardWorkHours`，不再用员工当月已填报总工时作为分母 |
| Aims BFF / 周报页面 | Console Work Calendar | `GET /api/v1/console/service/work-calendar/{calendarCode}/days?yearMonth=YYYY-MM` + `GET /api/v1/console/service/work-calendar/month?calendarCode=CN&yearMonth=YYYY-MM` | Console service token，`aud=system_settings`，`scope=system_settings:view` | 读接口不要求；返回日级 `dayType`、`isWorkday`、`holidayName` 和月度 `standardHoursPerDay`，用于项目周报日历区分工作日、休息日、法定假日和调休工作日；人工管理页面继续使用 `/api/v1/console/work-calendars/...` 会话接口 | 新增；Aims 项目周报日历按可视月份缓存日级工作日历，并在选中周日期范围后显示当周工作日天数和标准工时，100% 投入按当周标准工时折算 |
| People BFF | Finance | `GET /api/v1/finance/service/people-cost-parameters?effective_date=` | Console service token，`aud=finance`，`scope=finance:read`，来源 `people` | 读接口不要求；返回有效的人力成本参数 code、基本工资、福利费率、管理分摊系数和固定资源分摊 | 已落地；Finance BFF 在转发 tenant-runtime 前校验入站 service token；People 生成成本快照前读取，不从 Console 系统参数取值 |
| People BFF | People data-runtime | `POST /v1/people/service/cost-snapshots:generate` | Console service token，`aud=people`，`scope=people:write` | 按 `employee_uid + period_month` upsert 月度成本快照；`standard_rate_code` 追溯命中的 M/P 职级设置，`source_refs` 追溯 Finance 参数 code | 已落地；用于从职级设置 + Finance 参数生成月度成本快照 |
| Finance BFF | Aims | `GET /v1/aims/projects?current_user=&search=&page=&pageSize=` | Tenant-runtime service token，`scope=aims.read`；当前用户通过 `current_user` 控制可见性 | 读接口不要求；Finance 只保存/展示 `project_code` 等稳定业务键和财务摘要，不复制 Aims 项目主档 | 已落地；Finance 项目核算页以 Aims 项目清单为底表，合并 Finance `project_finance_summary` |
| Finance BFF | Aims data-runtime | `GET /v1/aims/admin/projects?search=` + `GET /v1/aims/projects/{projectId}/time-entries?start_date=&end_date=` | Tenant-runtime service token，`scope=aims.read`，来源 `finance` | 读接口不要求；按 `project_code + period_month` 读取项目当月工时，分摊比例由项目工时 / Console 月标准工时计算 | 已落地；Finance `POST /api/v1/finance/project-accounting/sync-people-costs` 使用该链路 |
| Finance BFF | Aims data-runtime | `GET /v1/aims/admin/projects` / `GET /v1/aims/projects`，可带 `project_codes`、`include_archived` / `exclude_archived`、`page`、`pageSize` | Tenant-runtime service token，`scope=aims.read`，来源 `finance`；普通项目列表仍叠加 Aims 当前用户可见性 | 只允许用 `project_codes` 精确缩小结果，不得据此扩大 Aims 可见性；Finance `projects` scope 必须先把授权项目编码下推再计算 total / 分页；归档过滤必须在 count 与 list 使用同一谓词 | Finance 项目核算列表使用该合同避免先取固定大页再做客户端范围过滤；当前页只解析当前页项目财务摘要 |
| People BFF | Aims data-runtime | `GET /v1/aims/admin/projects?search=` + `GET /v1/aims/projects/{projectId}/time-entries?start_date=&end_date=` | Tenant-runtime service token，`scope=aims.read`，来源 `people`；需 Console seed v1.24 授权 People runtime 读取 Aims | 读接口不要求；按 People 绩效周期 `project_code + period_start + period_end` 读取完整工时页，但只纳入 `review_status=approved` 的记录 | 已落地；保持兼容的 `source_biz_type=time_entries` 替换范围以清理旧快照，同时写入 `score_status=unscored`、`contribution_score=NULL`，页面显示“未评分” |
| People | Aims | `GET /api/v1/service/project-management-facts?periodStart=&periodEnd=&projectCodes=&afterRevision=&limit=` | Console service token，`aud=aims`、来源仅 `people`、精确 capability `aims:project-management-facts:read` | 以全局单调 `revision` 增量读取，返回 `correctionOfId`、结构化 `value`、`sourceRefs` 和 `sourceSha256`；`limit<=500`，项目过滤最多 100 个稳定 project code | 已落地；Console v1.91 授权。事实只在公司汇总 Codocs receipt 成功后生成，更正发布追加更高 revision，不覆盖旧事实。 |
| Aims | People | `aims.people-contributions.replace-scope.v1` → `POST /v1/people/service/contributions:sync` | 固定 dispatcher 申请 Console service token，`aud=people`、`scope=people:write`、来源 `aims`；浏览器不得指定 target/capability/tenant/deployment | Aims 只冻结期间内已审核工时，以既有 `time_entries` scope 维护单调 revision、完整集合与 caller-owned operation；People 重算 content hash，并在周期行锁事务内完成 replace-scope、水位推进及 target-owned receipt。低 revision 成功 `staleSkipped`、同 revision 同 hash 幂等、同 revision 异 hash 409；空集合是可推进的新版本 | 已升级为可靠操作/回执链路；新事实固定 `score_status=unscored` 且不携带默认分。People 仅允许 `collecting` 周期；confirmed/closed 周期保持不可变，通用贡献 CRUD 禁止写入。 |
| People BFF | People data-runtime | `POST /v1/people/service/performance-cycles/{cycleCode}:confirm` / `:close` | Console service token，`aud=people`，`scope=people:write` | 确认要求已有贡献快照；确认时固化周期 `confirmed_at` 和贡献快照 `confirmed_at`；关闭只允许已确认周期 | 已落地；People 绩效周期详情页提供“确认周期 / 关闭周期” |
| Finance BFF | People data-runtime | `GET /v1/people/service/standard-costs:resolve?employee_uids=&effective_date=` | Tenant-runtime service token，`scope=people.read`，来源 `finance` | 读接口不要求；返回员工在 `effective_date` 有效、`is_primary=1` 且 `approval_status IN ('none','approved')` 的主任职、职级和匹配的 M/P 职级设置，不返回项目成本分摊金额 | 已落地；Finance 项目核算按标准成本实时计算；较新的 pending/rejected 任职不得覆盖已生效主任职 |
| Finance / 兼容方 | People | `GET /v1/people/service/employees/{employeeUid}/cost-snapshot?period_month=` | Console service token，`aud=people`，`scope=people:read` | 读接口不要求；历史成本按月度快照固化 | 已在 data-runtime People adapter 落地；用于成本留档或兼容查询，不作为 Finance 项目核算主路径 |
| Finance / 兼容方 | People | `GET /v1/people/service/projects/{projectCode}/people-costs?period_month=` | Console service token，`aud=people`，`scope=people:read` | 读接口不要求；返回成本快照 + 绩效贡献快照聚合 | People adapter 已落地；保留兼容，不作为 Finance 项目核算主路径 |
| People BFF | Finance | `GET /api/v1/finance/service/performance-amounts?cycle_code=&period_start=&period_end=&employee_uid=&project_code=` | Console service token，`aud=finance`，`scope=finance:read`，来源 `people` | 读接口不要求；返回 Finance `employee_finance_performance` 稳定 code、金额、计算状态、项目贡献范围和 `cycle_code` 透传引用 | 已落地；Finance BFF 在转发 tenant-runtime 前校验入站 service token；People 绩效周期详情读取展示 Finance 金额快照，不作为 Finance 写 People 绩效终态 |
| People | Workflow | `POST /api/v1/action-defs/sync` | Console service token，`aud=workflow`，`scope=workflow:proxy` 或 app service grant | `workflow:action-defs:people:{manifest_hash}` | Nuxt 启动插件已声明动作 |
| Workflow | People | `POST /api/v1/service/workflow/callback`（People BFF），内部写入 `POST /v1/people/service/workflow/callback` | Console service token，`aud=people`，`scope=workflow:callback`，来源 `workflow`；People BFF 使用自身 tenant-runtime 身份写入 data-runtime | `workflow:{instance_no}:people:{resource}:{id}:{status}` | 已落地；BFF 规范化 Workflow `resource_code/instance_id` payload，审批通过的任职变更会读取 People 任职事实并触发 Console Directory employment/offboarding 投影，拒绝/取消只同步审批状态 |

关键约束：

- `people_employees.employee_uid` 必须能映射 Console Directory `uid`；People 保存员工、岗位、职级、入离职和成本口径快照，但不替代 Console 登录身份、认证和权限。
- Platform 岗位来源的系统角色只自动授予归类为 `main_position` 的角色。`high_risk_privilege`、`approval_duty`、`management_duty` 和 `custom_role` 即使岗位编码精确命中也不得自动授予，须显式授权或人工归类为主岗位；被闸门排除的候选通过 lifecycle 结果的 `excludedCandidates` 返回，用于生成管理员待办。
| People BFF | Console Directory | `people.directory.identity-reserve.v1` / `identity-release.v1` / `user-provision.v1` / `user-provision-status.v1` / `activation-link.v1` → `/api/v1/console/service/directory/onboarding/*` | `aud=console`；精确 `console:directory-identity:reserve` / `console:directory-user:provision`；标准 envelope + source/target deployment HMAC binding；`actorUid=originalActorUid` 来自已验证用户会话，并由 Console 重签后传给 tenant-runtime | 由 HR 在前台发起并等待结果，不进 drain 队列；People 先以 CAS 进入 `reserving_identity`，持久化预留回执后才排队 LDAP 建号，断线可从已保存阶段续跑。只有已验真的建号 operation `succeeded` 且 LDAP identity 已落地后才签发激活凭据；明文令牌不回传 People，不进入站内通知或持久 delivery ledger，只在外部钉钉请求中短暂出现。失败可落入可处理状态，取消仅允许在预留开始前；重发会轮换并作废旧令牌。 |

- 受控入职复用既有权限，不新增权限资源：People 侧读取用 `employees:view`、资料完善用 `employees:edit`、开通/激活/取消用 `employees:admin`；Console 侧使用精确的 `console:directory-identity:reserve` 与 `console:directory-user:provision`，不得退回宽泛的 `directory_users:edit`。
- 遗留 `dt-*` 主体归并的产品入口只保留只读预览。由于产品内尚无全应用引用扫描与跨库原子提交能力，浏览器 BFF、People runtime 与 Console service 的执行入口均返回 410；不得以“人工已检查”的未验真声明执行不可逆改写。实际迁移只能在审计运维窗口按 `docs/runbooks/dt-uid-merge.md` 和 precheck SQL 分阶段处理。
- 入职单终态由 Console 报告的下游状态推进，People 不直接访问 Platform：Platform 下一跳 `succeeded` 即 `completed`；目录已生效但 Platform 未收口停在 `projecting_authorization`；Platform `dead_letter` 转 `authorization_failed` 并可在下次刷新时自愈。`completed` 只要求 Platform subject 与 baseline 权限成功，岗位角色缺失由 Platform 侧生成管理员待办，不阻塞入职完成；已取消的入职单不得被下游状态复活。
- 入职单激活为正式员工前必须向 Console 验真建号 operation 已 `succeeded`，且该 operation 必须是这张入职单自己发起的；不接受浏览器声称账号已创建。员工创建、首次 `change_type=onboard` 任职与 `people.directory.employment-sync.v1` 冻结在同一事务内完成，后续 Console 目录与 Platform 授权交给现有可靠链路，不另建投递路径。
- 受控入职在开户前必须先原子预留身份：`directory_identity_reservations` 对 active 预留的 uid、登录名、邮箱和外部主体各有唯一索引，过期预留在下次预留时自动回收。LDAP 账号要到 Connector 回执成功才写入 `directory_users`，仅靠 pending operation 只能挡同一个 uid，登录名与邮箱没有跨请求保护。UID 建议由 Console 判定可用性（`identity-reservations:suggest`），发起方不得自行猜测变体。排队建号成功即消费预留，之后由 `directory_users` 与 pending operation 接管排斥。
- People 受控入职的初始凭据走一次性激活链接：开户只生成抛弃口令并排队 LDAP，不签发激活凭据；建号 operation 成功且 LDAP identity 已落地后，独立激活命令才轮换/签发凭据。`directory_activation_credentials` 只保存令牌 SHA-256，带令牌 URL 仅投递到入职单冻结的钉钉 `provider_subject`；站内通知只保存无令牌 `/set-password`。兑换在单事务内校验、消费并排队 `console.directory-connector.reset-password.v1` 管理员改密；令牌无效/已兑换/已过期/已作废统一返回同一错误码。
- Console LDAP 建号的 `initialPassword` 为可选：缺省时由 Console 生成随机初始密码，只在内存中用 Connector 公钥加密，明文仅在创建响应中出现一次且不写入可重放的 `console_mutation_receipts.result_json`；调用方不得依赖重放取回密码。自助改密不适用该生成逻辑，缺少新密码仍返回 400。
- 钉钉同步不再为未命中既有身份的员工或未解析的经理合成 `dt-*` UID。未匹配员工落成 `people_onboarding_cases` 入职候选，候选不是 employee，不参与员工统计、任职、成本、绩效、资产、项目成员或权限范围计算；经理未落地时 `manager_uid` 留空，只透传 `manager_provider_subject`。`ResolveDingTalkPeopleBatch` 分别返回正式条目与候选条目，候选只能写入入职单。
- 工号是 People 自主管理事实，钉钉 `job_number` 不进入 Connector Runtime → People 契约；People runtime 对旧任务残留字段同样忽略。存量员工无条件按入职日期、员工主键从 `000` 全量重排，新员工通过 `people_employee_number_sequences` 行锁在入职资料首次保存或首次正式员工同步时分配，至少三位且超过 `999` 后自然扩展；分配事务同时检查员工与未取消入职单，已消费号码不回收。
- People 员工手机号以 `people_employees.mobile` 一等列为事实源，`metadata->$.directory_user` 快照仅作迁移前存量行兜底；入职日期和私密员工档案均按字段执行 `dingtalk > manual > oa_archive` 来源优先级。钉钉提供有效非空值时接管，未下发、空值或无效值不得擦除 People/OA 回退事实。
- Connector Runtime 持久化每次钉钉同步的字段覆盖率，按 `provided / empty / absent / invalid` 区分有效值、显式空值、未下发和无法规范化；`partial_fields_missing` 只在全部在职用户都缺少该字段键时产生。People 同步 JSON 与落库均保留该语义：absent 不覆盖旧值，显式空值可清除来源字段，无效日期不擦除既有有效值；People → Console 生命周期命令继续携带字段来源状态，使 Directory 也不会把 absent 与 empty 再次折叠。
- People 成本快照以 `period_month` 月末有效主任职生成，并固化 `assignment_code`、部门、岗位和职级快照；后续任职变化不得改写历史月份的读取结果。新增/批准主任职必须拒绝与已有 `none/approved` 主任职的日期区间重叠；Directory bootstrap sync 仅用于初始化校准，不得作为正常调岗入口。
- Console → People 导入只用于生产初始化或目录校准；不得把 Console 手工目录维护作为 People 正常人事流程的长期事实源。
- 钉钉部门外部 ID 不得进入跨模块业务键；已映射部门改名、移动时只更新 canonical 正式部门的名称、父级、排序、负责人等钉钉权威字段并保留 `dept_code`。首次接管仅在同一父级有唯一名称精确匹配的未绑定正式部门时建立 `path_matched` identity；同层存在未解析正式部门时失败关闭。稳态发现新部门时创建不含供应商 ID 的 opaque `DPT-*` code。每次出现记录 `last_snapshot_revision` 与规范化摘要；只有 final marker、根部门、计数和聚合 hash 全部验证通过才持久化缺失差异。缺失数量/比例超过租户阈值或根部门变化时标记高风险；无论风险级别都不自动停用，须 `people:hr_source_sync:admin` 逐项确认并在事务中重查活跃主归属和未纳入子部门。存在首次映射冲突时 People 服务端禁止启动同步，不能只依赖页面按钮禁用。旧 `DT-*` 部门在 Directory 软停用后，其 alias subject 与原成员非主归属在首个兼容周期仍向 Platform 投影为 active，确保其他模块的存量 `dept_code` 引用不失去授权；清理须等待跨模块引用清单验证归零。
- 根公司负责人补充：仅当 active 钉钉部门 identity 的 `external_department_id=1`、canonical 正式部门 active 且无父级、`manager_external_subject` 为空时，Console `directory_departments:edit` 可通过现有 PATCH 设置、替换或清空 `managerId`，沿用用户有效性校验、幂等 receipt、审计和 subject 投影。名称、父级、排序、状态和类型仍受钉钉字段保护；`leaderId` 沿用汇智云本地维护规则。Console 编辑只提交实际变化字段。钉钉根快照未提供负责人时保留现有 `manager_uid`；上游后来提供负责人时恢复钉钉接管及原 lifecycle 回填，普通子部门空负责人仍按上游清空。本地补充不改变钉钉 identity、canonical code 或来源标识。
- LDAP 只维护认证目录字段。对 `source_provider=people/hr` 的用户，LDAP 不得覆盖姓名、邮箱、手机号、职位、正式主部门、用工类型或正式部门 membership；委员会和虚拟组织 membership 始终不在钉钉正式部门同步范围。
- People → Console 投影必须由已审批或管理员确认的人事事件触发，禁止跨模块直连 Console 数据库或使用静态 webhook secret；首批已落地员工创建/更新、调岗主部门投影、离职停用账号、会话撤销和 Platform 授权来源回收，Workflow 审批回调通过 People BFF 校验 `workflow:callback` 服务令牌后，在任职审批通过时触发同一 Console Directory / Platform 授权生命周期投影。
- Aims 是项目清单和项目执行事实源；Finance 项目核算页不得通过手工项目编码维护项目清单，只能读取 Aims 项目并合并 Finance 财务摘要。
- `people_standard_cost_rates` 是项目人力成本测算前置主数据，当前只维护 M/P 职级工资和绩效工资范围；基本工资、福利费率、管理分摊系数和固定资源分摊由 Finance `finance_people_cost_parameter` 维护。
- People 职级设置页按 Console 系统参数 `people.rankSeries.managementCount` / `people.rankSeries.professionalCount` 生成 M/P 序列行，默认 M1-M5 / P1-P10；超出序列数量的历史规则不作为页面新增入口展示。
- People 月标准成本公式为：基本工资 + 职级工资 + 绩效工资中位数 + 福利成本 + 管理分摊 + 资源分摊；公式参数来自 Finance，不放入 Console 系统参数。
- `people_cost_snapshots` 是 People 成本留档能力，由标准成本规则或实际成本导入按月固化，不随员工当前事实变更自动改写历史月份；Finance 项目核算主路径不读取该表。
- `people_contribution_snapshots` 是 Aims 输出或 People BFF 从 Aims API 汇集后的个人绩效周期快照，不允许 People 直连 Aims 数据库补算；Finance 项目成本核算不依赖该表。
- Console Work Calendar 是平台月标准工时和日级工作/休息日事实源，节假日和调休按年导入并允许手工修正，月度 `standardWorkHours = workdayCount * standardHoursPerDay`。
- Finance 同步标准人力成本时按 `project_code + period_month + employee_uid` 生成稳定分摊编码，月标准成本由 Finance 参数 + People 职级设置实时计算，分摊比例为员工本项目当月工时 / Console 月标准工时，写入 `project_cost_allocation(allocation_type=labor)` 后重算项目财务汇总。
- Finance BFF 对每个项目/月份只调用一次 data-runtime 领域动作 `POST /v1/finance/project-accounting/labor-costs:sync`。该动作以 summary 行 `FOR UPDATE` 串行化，在同一事务内 upsert 员工成本快照和当前 managed labor allocation、反转完整集合中已消失的旧分摊、持久化 `cost_readiness_status/reasons/input_hash/checked_at` 并更新摘要；`expectedInputHash` 防止晚到的旧抓取覆盖新结果。外部源缺失或不可证明完整时也必须写入 `not_ready`、使旧 managed labor 失效并把毛利/毛利率置空。
- Finance 普通项目摘要重算不得改变成本 readiness；它必须锁定同一 summary 行，只有持久化状态为 `ready` 时才计算毛利，否则只能刷新收支/成本并保持毛利和毛利率为 `NULL`。项目列表、详情、月报、看板和维保摘要不得用“已有正数 labor allocation”推断 ready。
- 没有 People 员工职级、M/P 职级设置、Finance 人力成本参数或 Aims 工时时，Finance 只能标识“人力成本未就绪”，不得把项目毛利展示为完整成本核算结果。
- 个人绩效周期创建、评分、确认、申诉和归档归 People；Finance 的 `employee_finance_*` 与 `performance_*` 对象只表达财务贡献归因、提成/奖金/绩效金额快照和计算依据。
- Finance 不写 People 个人绩效终态；People 读取 Finance 金额快照时只保存稳定业务键和必要摘要，不复制 Finance 财务明细。
- People 文档只保存 Codocs `document_uuid`，不保存正文。

## Altoc / Assets / Aims / Codocs / Finance 运维服务契约（Phase 4）

Phase 4 不新增独立运维应用，按现有事实源拆分：Altoc 管客户成功经营事实和服务工单入口，Assets 管客户系统 / 交付实例，Aims 管工单执行和缺陷 / 需求回流，Codocs 管运维知识正文，Finance 管维保收入和服务成本。

| 调用方 | 被调用方 | 端点 / 事件 | 认证 | 幂等 / 追溯 | 状态 |
| ------ | -------- | ----------- | ---- | ----------- | ---- |
| Altoc | Assets | `GET /api/v1/service/deliveries/package?customer_code=&contract_code=&project_code=` | Console service token，`aud=assets`，`scope=assets:read` | 读接口不要求；`customer_code` 必填 | G2-5 收口：精确 AND 过滤交付视图，并返回产品、正式资产、正式资产环境关系和仅含 UUID/类型/必要快照的文档；缺 `asset_documents.artifact_type/source_context` schema 时 503，不降级为语义不完整的成功响应 |
| Aims | Aims tenant-runtime | `POST /api/v1/service/projects/{projectCode}/milestones/{milestoneId}:rollover` / `POST /api/v1/service/milestones:rollover-due` | Console service token，`aud=aims`，`scope=aims:write`，来源仅 `aims` | `aims:milestone:{projectCode}:{templateKey}:{periodStart}:rollover:v1`；runtime 以 `project_id + template_key + period_start` 事务兜底 | 新增：Aims BFF 手动入口和 Nitro scheduled task 调用；runtime 只允许 periodic 里程碑关期，关闭当前周期、创建下一周期，并写入 `milestone_cycle_snapshots` 作为 R 阶段复盘输入 |
| Altoc | Aims | Altoc 用户编排 `POST /api/v1/service-tickets/{ticketCode}/aims-work-item` → Altoc freeze/claim → `POST /api/v1/service/service-tickets/{ticketCode}/work-item/receive` → receipt 校验与 Altoc complete checkpoint | 用户需 `service_ticket:edit`；跨应用 Console service token `aud=aims`、精确 capability `aims:service-ticket:work-item:create`、来源 `altoc`；原 actor 走独立签名 delegation | `altoc:service-ticket:{ticketCode}:aims-work-item:v1` | G3 可靠闭环：Altoc 锁定工单和可信项目上下文，在同一事务提交最小冻结 command、dispatch 投影和 caller operation；Aims 工作项 mutation、初始结果 operation 与 succeeded receipt 同事务。目标按全局 `source_ticket_code` 防改绑，Altoc 在精确 receipt checkpoint 后原子绑定项目/工作项；ACK 丢失按原键恢复，succeeded 重放不回退 pending，永久失败须受控 replay。旧 raw `POST .../work-item` 已从 middleware 移除并由 runtime 返回 `410 legacy_service_ticket_work_item_retired`。 |
| Aims | Altoc | Aims 单条 `PUT /api/v1/work-items/{id}` 或 `PATCH /api/v1/work-items/batch` 的服务工单状态修改原子写 operation → Aims operation claim/drain → `POST /api/v1/service/service-tickets/{ticketCode}/delivery-result:sync` → succeed/fail checkpoint | Aims operation runtime 需 `aims:integration_operation:execute`；跨应用 Console service token `aud=altoc`、kebab-case capability `altoc:service-ticket:delivery-result:sync` | `aims:work-item:{workItemKey}:ticket-result:g{generation}:v1` | G3 可靠闭环：业务事实、单调 generation 和 caller operation 同事务；批量仅在 `changes.status` 且已关联服务工单时按工作项创建 operation，保留 `updated` 响应且不在请求中 N 次外呼。operation 冻结失败会回滚整个批量写入；同状态返回真实 operation status 并校验 command hash。Altoc 工单写入与 receipt 同事务，较旧 generation 幂等忽略，resolved/closed/cancelled 不因更高 generation 非法重开；source ACK 暂不可用由原 operation 恢复。即时、专属 task 和共享 Gateway wake 复用 executor；阈值 dead-letter、管理员诊断/重放已落地。 |
| Altoc / Aims / Finance | Altoc | `GET /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations` / `GET /api/v1/service/service-agreements/{serviceAgreementCode}/default-project?allow_missing=true` | Console service token，`aud=altoc`，`scope=altoc:read`，来源按调用方 | 读接口不要求；使用 `service_agreement.code` 和 Aims `project_code` 作为跨应用键 | 新增：Altoc 通过 `service_agreement_project_rel` 维护服务协议到 Aims 项目的结构化关系；默认项目严格按当前有效 active/default 关系解析，多默认时报错，`allow_missing=true` 仅允许无默认时返回空 |
| Altoc | Altoc | `POST /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations/default` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations/{projectCode}:end` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations/{projectCode}:suspend` | 用户需 `contract:edit` 或 service token `aud=altoc`，`scope=altoc:write altoc:contract:edit` | `altoc:service-agreement:{serviceAgreementCode}:project:{projectCode}:{action}:v1` | 新增：服务协议项目关系由 Altoc data-runtime 事务写入；设置默认项会先清理同协议当前 active/planned 默认关系，保证当前默认解析唯一 |
| Altoc 用户编排 | Altoc / Codocs / Assets | `POST /api/v1/service-tickets/{ticketCode}/ops-knowledge` → Altoc `ops-knowledge:reserve` → operation claim → Codocs link + succeed/fail checkpoint → Assets document link → Altoc `ops-knowledge:complete` | 用户需 `service_ticket:edit`；跨应用分别使用 `aud=codocs/assets`、`scope=codocs:documents:write/assets:write`；operation runtime 需 `altoc:integration_operation:execute` | canonical root 固定为 `altoc:ticket:{ticketCode}:ops-knowledge:{documentUuid}`；外部 header 不得覆盖 | G3 可靠闭环：Altoc reservation 与两条 caller operation 同事务；Codocs relation 与 receipt 同事务，Assets document link/event 与 receipt 同事务；source 对每步校验 receipt 并保存 `target_receipt_id`，最终 Assets receipt 与工单 linked 投影原子收口。即时、专属 task 和共享 wake 复用 executor；dead-letter 使用 Console 幂等通知。管理员诊断/重放已落地；attempt UI 和部署态 live acceptance 仍待完成 |
| Finance | Altoc | `GET /api/v1/service/customers/{customerCode}/maintenance-summary` | Console service token，`aud=altoc`，`scope=altoc:read`，来源 `finance` | 读接口不要求 | P4.1 已落地：读取维保合同、SLA 权益、最近工单和续约机会摘要；Altoc BFF 在转发 tenant-runtime 前校验入站 service token |
| Altoc / Finance | Finance | `GET /api/v1/finance/service/customers/{customerCode}/maintenance-financial-summary?contract_codes=&project_codes=&period_month=` | Console service token，`aud=finance`，`scope=finance:read`，来源 `altoc` 或 `finance` | 读接口不要求；Altoc 必须先解析维保范围，Finance 要求至少一个合同或项目编码 | G2-5 收口：Finance 统一使用 `customer AND (maintenance contract OR maintenance project)`，用户项目授权再作为额外 AND；空业务范围 400，项目授权空集返回空结果。Altoc 显式非法过滤不得回退为另一维全量；Finance/Assets 404 均按上游不可用失败，不伪装成成功空数据 |

关键约束：

- `service_ticket.code` 是工单主业务键；回流到 Aims 后只保存 `aims_work_item_key` / `aims_project_code` 引用，不复制工作项正文。
- 服务协议到 Aims 项目的事实源是 Altoc `service_agreement_project_rel`，只保存 Aims 稳定业务键 `project_code`；Aims 继续负责项目、任务和工时执行事实，Altoc 不保存 Aims 本地主键。
- Altoc 服务工单派发 Aims 工作项时，项目解析顺序固定为：显式 `projectCode`、工单已绑定 `aims_project_code`、服务协议默认项目、旧版合同唯一候选项目兜底；若服务协议存在多个当前默认项目或旧版合同候选无法唯一确定，派发必须失败并暴露数据修复信号。
- 派发前 Altoc 必须读取 scoped `GET /v1/altoc/service-tickets/{ticketCode}/dispatch-context`，客户/合同/维保合同/服务协议编码以 runtime JOIN 事实为准；旧合同兜底必须通过 Aims `contract_match=exact` 查询最多两个精确候选，不得先取客户分页再在 BFF 过滤。
- Aims 使用 `work_items.template_key=altoc:service_ticket:{ticketCode}` 和 `work_item_service_ext.source_ticket_code` 唯一键记录来源自然绑定；同一工单不能改绑到另一项目。可靠写入口仅为 receipt-only `/work-item/receive`，旧 raw `/work-item` fail closed。若 Altoc 未指定里程碑，Aims 会创建 / 复用 `template_key=service_ops` 的项目里程碑作为工单执行容器，不新增 `work_items.type` 枚举。
- SLA 响应 / 解决时限由 Altoc 计算，Aims 只保存 `work_item_service_ext.sla_status_snapshot` 作为展示快照，并从执行状态派生 accepted / processing / resolved / closed 回写。首次响应晚于截止时间时不得因后续解决而改回 met；小时额度按 Aims 累计工时与工单已消费值之差扣减。
- Altoc 已绑定的 `project_code/aims_project_code + aims_work_item_key` 不得被后续回写覆盖；Aims 回写使用单调 generation，resolved / closed / cancelled 终态不得因更高 generation 回退 processing。Aims 只在工作项恰有一个关联文档时回写 Codocs UUID；多文档候选必须先消除歧义。
- 运维知识正文只保存在 Codocs；Altoc / Assets 仅保存 `document_uuid` 和客户、系统、产品版本上下文，Codocs 用稳定非用户主体建立客户、合同、项目、正式交付资产、环境、工单六类非 ACL 索引关系，不复制业务主档或改变文档授权。
- 维保收入以 Finance 财务事实为准；Altoc 提供维保合同、服务期和续约经营上下文。Altoc 客户页读取 Finance 摘要时只传维保合同关联的 `contract_codes/project_codes`；无显式过滤时传全部维保范围，有任一显式过滤时只传该显式维度的合法交集，不得用未请求的另一维补全扩大范围。

## Aims 产品对象授权内部契约（实施中）

- 当前精确服务授权的生成式 Seed／Verify 和签发组合见 [产品中心服务授权安装与验收](../aims/docs/Aims-Product-Center-Service-Grants.md)。脚本仅选择指定的 Aims／Assets 客户端，双 runtime audience 分别授权；18 条业务 grant 与 6 条既有传输前提逐项核验。仓库具备脚本不代表目标租户已经安装或实际签发成功。

- `GET /v1/aims/internal/products/{productCode}/authorization-object` 为 Aims BFF 到本应用 Runtime 的内部读取，不建立浏览器 API。要求受信来源应用 `aims`、tenant/deployment/client 上下文、已签名用户 actor，以及精确能力 `aims:products:authorization-object`；`aims.read` 传输权限或通配能力不替代该能力。
- 返回 `{ code: 0, data: { product_code, actor_uid, status, revision, is_member, is_manager } }`，只包含当前 actor 的关系事实。关系基于 Aims `product_members` 的 active 状态和数据库 UTC 当前时间（含起始、不含结束），不读取 Assets 所有者或项目成员。
- Aims `checkProductPermission` 验证响应产品／actor 一致后，调用 Foundation → Console scoped authorization，以 Manifest 声明动作和真实产品关系判定；事实读取本身不授予任何业务动作。
- 内部接口额外要求 Runtime 已验证 `hzy_runtime_actor_delegated=1`、空 actor purpose，且 actor 不等于 service client；拒绝普通服务主体回退和通知／service-command 身份挪用。Query 中伪造的受信字段会被 Runtime 入口清理。
- 已接入的浏览器接口为 `GET/PATCH /api/v1/products/{productCode}`、`POST .../archive`、`POST .../restore`。PATCH 输入 `{ expectedRevision, positioning, targetUsers, valueStatement, reason? }`，三个定位字段须显式提供，null 表示清空；生命周期输入 `{ expectedRevision, reason }`。写入必须有 `Idempotency-Key`。不允许浏览器提供 actor、授权、产品状态或 Runtime 命令字段。
- BFF 完成 Console 授权后构造一次请求的 `{ resource, action, facts, expires_at }`，有效期 15 秒；Runtime 拒绝已到期或距数据库时间超过 30 秒的上下文。它只在可信 Aims 服务通道传输，不返回给浏览器、不存为用户权限缓存。
- `GET /api/v1/products/{productCode}/permissions` 为页面提供当前产品的 edit／archive／restore／admin 提示；先验证产品 view，再通过相同 Foundation 授权 helper 分别检查每个动作。返回 no-store，不包含授权证据或完整 grants。此响应不是命令授权凭证，PATCH 仍独立重验身份、范围、revision 与幂等键。
- BFF 请求内部 `POST /v1/aims/internal/products/{productCode}/workspace:{view|edit|archive|restore}`，分别需要精确能力 `aims:products:{action}`；view 使用 aims.read 传输 scope，其他使用 aims.write。Runtime 先校验服务能力，再锁产品根记录并重新读取关系；事实与 Console 决策输入不一致则 409，客户端须重新发起完整授权请求。
- 工作空间 mutation、revision 递增、活动历史及成功回执处于同一事务；重放也先重验授权，业务 expectedRevision 仅在首次执行检查。重复键异 payload／并发冲突 409；已归档空间可读，编辑须先 restore；归档／恢复必须有原因。缺产品表／列为 503，不影响既有项目表的启动检查。
- 产品目录列表范围、真实令牌 grant 签发与租户启用仍待后续接入。本端点能力尚未自动播种或部署，产品页面不能据此标记已可用；缺能力必须失败关闭。

### 授权产品列表（C000001 测试环境已验收）

- `GET /api/v1/product-permissions` 返回当前用户显式全租户 onboard 提示，复用接入命令相同的全局授权 helper，no-store；依赖失败保留 503，拒绝授权返回 onboard=false。目录刷新每个命令仍重新鉴权，页面提示不是授权凭证。
- `GET /api/v1/products` 接受 page/pageSize（最大 100）、keyword、productLine、status=not_enabled/active/archived（省略表示全部）。BFF 从 Console 获取当前主体 products:view 授权，使用 Foundation `compileFoundationProductScope`，浏览器不能提供 actor、scope 或可见产品数组。
- Foundation 对非成员／有效成员／有效经理三个产品事实状态复用同一 evaluator，输出默认匹配位和具体 product_code 覆盖；仍在同一 grant 中判断权限、动作蕴含、default/assignment scopes，Runtime 不解释角色或策略。相关显式产品编码最多 512 个，超过返回 503，不截断；不相关动作不占此上限。
- 详情和列表共同使用 `evaluateFoundationProductAuthorization`，只接受产品事实可表达的 tenant-global、product code/member/manager 和已知产品关系谓词；含部门／项目／未知范围的 grant 不生效，不能用缺失上下文扩大权限。
- 内部 `POST /v1/aims/internal/product-list` 要求签名用户、可信 Aims 服务和 aims:products:view，传输为 aims.read。短时授权绑定 actor/resource/action；Runtime 在同一只读 repeatable-read 快照内关联生效目录及有效成员，先做范围和业务筛选，再计数与分页。成员有效期使用同一数据库时间点，避免总数与页数据因自然到期产生分歧。
- 列表合并生效目录与已有空间，同一 product_code 仅一行；只有目录、尚无空间时 status=not_enabled、biz_id=""、revision=0，并按非成员 products:view 范围求值。成员／经理范围不能据此看到其他未启用产品；显式编码和全租户查看范围仍有效。启用操作继续单独要求全租户 products:onboard，并实时核验 Assets 状态及初始产品经理。
- 返回 items/total/page/pageSize/catalog_generation/catalog_updated_at。未刷新或主档删除时，按权限保留空间和 product_code，目录字段为 null，不混入实时数据或伪造名称。GET 不创建、刷新或写审计；没有匹配权限时返回空列表。C000001 测试环境已验证统一目录 53 条、分页、搜索与同步后刷新；生产发布不在本轮范围。

### 产品空间接入（实现中，未部署验收）

- 浏览器 `POST /api/v1/products` 要求显式 tenant-global `products:onboard` 和 `Idempotency-Key`，输入 productCode、managerUid、reason 以及可选 positioning/targetUsers/valueStatement；不能输入主档名称、状态、授权或目录证据。未填写的定位字段为 null。
- BFF 先通过 Assets 精确目录接口核对大小写一致的单条主档和 onboardable，再通过 Foundation Directory active-status 核对指定负责人；不默认采用 Assets owner 或当前 actor，不创建虚拟项目。外部读取失败则不启动本地接入事务。
- 内部 `POST /v1/aims/internal/products/{productCode}/onboard` 要求可信 Aims 服务、签名用户和 `aims:products:onboard` 精确能力，使用 aims.write 传输 scope。BFF 构造产品／actor／动作绑定的短时授权、主档水位与负责人证据；Runtime 在取得产品根锁后检查各证据有效期，不能把外部快照误称为跨应用原子事务。
- 空间、active manager 关系、onboard 活动记录及成功回执同事务提交；失败无残留。按产品唯一根锁串行化并发接入，同 actor／键／业务内容重放原回执，异内容或其他键对已有空间返回 409；不覆盖定位或重新启用归档空间。重放同样需要新授权和来源核验。
- 初始 manager 关系仅提供产品对象范围，不自动赋予动作权限；租户角色安装、service grant 与实际租户验收仍须完成。接入不刷新或覆盖目录代际投影。

### 产品线统一管理（2026-09-11，代码实现，未部署）

- AIMS 增加产品线管理主体及来源产品→功能模块映射；Assets 继续拥有产品线与产品主档，AIMS 的 `~line-` 保留编码不是新的 Assets 产品编码，不得用它伪造源产品身份。详见 [产品线统一管理契约](../aims/docs/Aims-Product-Line-Management.md)。
- 浏览器 `GET /api/v1/products?tree=true` 按授权后的产品线分页，`childLine` 单独展开分页；范围仍由 Foundation 编译，来源模块按统一空间的产品权限和有效成员求值。完整资格检查不受前端产品分页或筛选影响。
- `GET /api/v1/product-candidates?mode=line&productLine=...` 和 `POST /api/v1/products` 的 productLine 形态要求原有 tenant-global products:onboard。只允许尚无独立/归档空间的整条线一次性启用，BFF 用既有 Assets 精确目录 API 的 productLine/watermark 分页合同取完整快照（最多 1000 项），源状态及有效经理重新核验。
- 新内部 `/v1/aims/internal/product-line-onboard` 复用 `aims:products:onboard` 与 aims.write，保留签名 actor、可信 Aims 服务、租户/部署和短时证据验证。空间、经理、模块、唯一来源映射、审计及回执同事务；独立启用/统一启用/目录激活共用控制锁，失败回滚。既有 Assets / Directory capabilities 和 Console grants 不增加。
- 目标先安装 v5.37 两表迁移，再更新 Runtime 与 AIMS；本次未对目标租户执行迁移、赋权或部署。

### 产品目录代际刷新（实现中，未部署验收）

2026-09-13 显示口径：Aims 产品树、统一空间标题和名称搜索优先读取当前 active 目录的产品线标签，接入时 `line_label` 仅作缺失回退；Assets 改名仍经显式目录同步生效。首页产品线下拉框复用带用户范围的产品树读取，无新增跨应用调用或授权。

- 浏览器 `POST /api/v1/products/catalog-refresh` 要求显式 tenant-global products:onboard，输入仅 action=start/continue/status/cancel、refreshId 和继续时的 expectedRevision。start 需 Idempotency-Key，只创建批次；后续每次 continue 最多从 Assets 读取一页 100 条，页码和水位由服务端保存的批次状态决定，浏览器不能提交目录行或任意源游标。
- 内部 `/v1/aims/internal/product-catalog/start|view|append|fail` 均要求签名用户与精确 aims:products:onboard；view 为只读 aims.read，其余 aims.write。批次限定创建 actor；每次读取、继续、取消和页回执重放均重新执行全局授权，授权过期拒绝。start 按 actor＋幂等键生成稳定批次 ID，不创建伪产品或虚拟项目。
- product_catalog_control 单行锁序列化提交；product_catalog_page_receipts 按 generation＋page 保存内容 hash 与结果。逐页校验总数、水位、完整条目数和跨页稳定顺序；页写入、游标、回执和最终生效切换同事务。相同页同内容重放不重复累计，异内容拒绝；过期 revision 不能跳页覆盖。
- staging 不参与普通产品列表。全部页完成后原子 supersede 原 active；较新批次已经生效时拒绝较早批次覆盖。来源水位 409 会尝试标失败，暂时不可用保留可续批次；取消标 failed，已有 active 目录保持可读。空主档目录可以完整切换，历史产品空间不随目录消失删除。
- 响应包含 refresh_id/status/watermark/row_count/revision/next_page/total；start 的 total=-1 表示尚未读取，完成的 next_page=0。并发继续返回 revision 冲突时客户端读 status 后再继续，不能盲目递增页码。最后刷新展示和授权列表页面仍待实现。

### 产品成员管理（实现中，未部署验收）

- 浏览器 `GET/POST /api/v1/products/{productCode}/members`、`PATCH/DELETE .../members/{memberId}` 全部要求产品对象的 products:admin；读取同样不以菜单隐藏代替授权。Runtime 内部命令为 members:list/create/update/revoke，精确服务能力 aims:products:admin；list 使用只读传输 scope，其余使用写入 scope。
- 列表按 uid、relation_type、id 稳定排序，返回 items/total/page/pageSize/workspace_revision，pageSize≤100；可按 relationType/status 筛选。effective 只表示本地关系状态及当前有效期，不代表目录用户仍有效，更不代表动作权限。
- 创建／更新输入 uid、relationType、status、validFrom、validUntil、expectedRevision、reason，更新另需 expectedMemberRevision；日期为 UTC ISO 毫秒字符串，validUntil 必须显式为 null 或晚于 validFrom。memberId 由路由解析、uid 不可替换。DELETE 软停用，输入 uid、两个 revision、reason，保留关系及活动历史。
- continuingManagerUid 可显式指定调整后继续负责的经理；普通操作默认当前 actor，新增／调整 active manager 默认目标 uid。BFF 通过 Foundation active-status 视图验证此人，以及新建或需要启用的目标用户（单次最多两人）。该校验不自动赋予任何产品角色权限。
- Runtime 在产品根锁下执行授权事实重验、成员和空间 revision 检查、变更、接管经理当前关系核对、活动历史及回执。接管人必须在同产品且当前 active、已生效、未到期；外部状态依据由可信 BFF 构造、15 秒有效，过期拒绝。最后经理撤销／降级、跨产品接管、未来才生效的接管均整体回滚。
- 保护的是本次主动操作后的当前责任关系；后续人员停用或自然到期可能产生无经理空间，仍按主方案由显式全租户产品管理员接管。归档空间禁止调整成员，需先恢复。

## Aims → Assets 产品目录契约（实施中）

- 新增 `GET /api/v1/service/products/catalog`，入站要求 `aud=assets` 与精确 `assets:product:read`；能力定义在 Assets manifest，调用方资格由 Console active service grant 控制，不另设业务调用方白名单。Assets 使用自身服务身份访问 `/v1/assets/service/products/catalog`，不得转发入站 Aims Token；Runtime 同时要求可信 Assets 来源、tenant/deployment/client 和精确能力。
- 查询：`page`（1～1000000）、`pageSize`（1～100，默认 100）、`keyword`、精确大小写 `code/productLine`、`watermark`。响应含精简主档 `items`、`total/page/pageSize/nextPage/watermark`；不返回资产关系或项目数据。`onboardable` 当前仅允许 poc/mvp/mmp/pmf/iterating，eol 和未知状态拒绝接入。
- 每页在同一只读数据库快照读取水位、总数和主档；后续页必须携带首批水位。产品主档或产品线分类变化递增水位；不匹配返回 409，调用方必须丢弃未激活的刷新批次并重启。迁移缺失或未就绪返回 503。GET 不生成目录投影或业务审计。
- Aims 候选入口 `GET /api/v1/product-candidates` 先检查显式 tenant-global `products:onboard`，再读取目录；不把此服务目录作为普通用户已授权产品列表。正式产品列表仍须独立执行产品范围过滤和分页。
- 当前完成代码、单元／SQL mock 及隔离 MySQL 验证：101 条分页、主档／产品线变更使旧水位失效、事务回滚水位不变、迁移重放及未就绪拒绝。Console 精确 grant Seed／Verify 已提供并经隔离 MySQL 验证；真实租户安装／签发、目录刷新和用户页面尚未收口，不代表租户可用。旧 `/service/products` 的分页改造仍需另行完成，不能用新接口测试证明存量接口已分页。

## Aims ↔ Assets 产品版本契约（有效）

定位：

- Assets 是产品主档事实源，稳定业务键为 `product_code`；`product_assets.current_version` / `target_version` 仅是台账展示快照。
- Aims 是产品版本事实源，维护 `product_versions`、`product_version_features`、`work_items.version_id` / `feature_id` 与版本进度聚合。
- Aims 的项目↔产品关联事实源为 `aims_project_products`。Assets 的 `product_assets.project_code` 仅用于历史台账和一次性初始导入，不作为在线关联事实源。

Service API：

| 调用方 | 被调用方 | 端点 | 认证 | 用途 |
| ------ | -------- | ---- | ---- | ---- |
| Aims / Altoc | Assets | `GET /api/v1/service/products?keyword=&codes=` | Console service token，`audience=assets`，`scope=assets:read`，来源应用 `aims` 或 `altoc` | Aims 项目关联产品、Altoc 合同行绑定软件产品时查询产品主档精简信息 |
| Aims | Assets | `POST /api/v1/service/products/resolve-codes` | Console service token，`audience=assets`，`scope=assets:read`，来源应用 `aims` | 按产品编码批量解析产品名称/状态 |
| Assets | Aims | `GET /api/v1/service/products/:productCode/version-summaries` | Console service token，`audience=aims`，`scope=aims:product-version-summary:read`，来源应用仅 `assets`；AIMS 到 Runtime 使用同名精确 capability | 产品详情页只读展示版本元数据、公开特性总数与已交付数；不含项目、人员、工作量、特性正文。旧 `/versions` 接口仅保留兼容，Assets 已不调用 |

`GET /api/v1/service/products` 的产品线字段同时返回稳定 code、展示名和 Assets 定义顺序：`productLine` / `product_line` 保留 Assets 产品主档原始 `product_line` 值（大小写不得由调用方归一化），`productLineLabel` / `product_line_label` 来自 Assets 资产类别管理中的产品线名称，`productLineSortOrder` / `product_line_sort_order` 来自产品线分类的 `sort_order`。调用方应用应使用 code 做过滤和写入引用，使用 label 做 UI 展示，并按 `productLineSortOrder` 排列产品线选项；当 label 缺失时才回退显示 code。

批量解析时，Assets BFF 必须把去重后的编码集合以单次 tenant-runtime 请求的 `product_codes=code1,code2` 下推；runtime 使用精确 `IN` 过滤一次读取，不能按编码逐条调用或把未命中的全量产品返回给 BFF。`POST /api/v1/service/products/resolve-codes` 的响应顺序与调用方首次传入的编码顺序一致，重复编码只返回一次。

Cloudflare 多租户部署下，上述服务调用的 base URL 由 Foundation 按 appCode 解析共享应用 origin，不读取 Console runtime `applications.homeUrl` / `applications.apiBase`。`applications.homeUrl` 可以是 `https://<tenant>.huizhi.yun/<app>/` 这类租户入口，仅用于用户导航；`applications.apiBase` 是应用逻辑 API root，不作为服务端跨应用 origin 配置。

Console grant 种子：`console/docs/sql/Console-SQL-Seed-v1.15-aims-assets-version-grants.sql`、`console/docs/sql/Console-SQL-Seed-v1.32-assets-service-api-grants.sql`、`console/docs/sql/Console-SQL-Seed-v1.33-altoc-aims-codocs-service-grants.sql`、`console/docs/sql/Console-SQL-Seed-v1.50-aims-codocs-project-cabinet-grants.sql`（v1.50 仅文件，未执行）。

## WebDev Issue 上报契约（阶段2，实现中）

业务应用（codocs/finance/workflow 等）向 WebDev Issue 收件箱上报问题：

- **链路**：业务应用前端 Foundation 报告组件 → 业务应用本地 `POST /api/webdev-report/issues`（Foundation 共享路由，派生当前用户身份）→ `requestServiceAccessToken({ audience: 'webdev', scope: 'webdev:issue:write' })` → `POST {webdev}/api/webdev/issues/intake`。业务应用前端不直连 WebDev、不持有 WebDev 凭证。
- **WebDev intake 校验**：Console JWKS + `aud=webdev` + `token_use=service` + `scope=webdev:issue:write` + 来源 `hzy.appCode` ∈ 允许上报应用集合（`HZY_WEBDEV_REPORT_ALLOWED_APPS`）。`app_code`/`tenant`/`reporter_uid` 只信任服务端派生，不接受客户端覆盖。
- **落库**：WebDev Console 用户读写走带完整 request-target HMAC actor delegation 的 `/v1/webdev/issues*`；已验证跨应用上报仅走精确 actorless service bridge `POST /v1/webdev/service/issues/intake`，而“我已提报”仅走 `GET /v1/webdev/service/issues/mine`。intake 内部自动领取只允许其固定的 settings/read/claim/patch/service-job persistence 子路径，不能放开通用 `/service/**`。Data Runtime 从已验证 runtime context 强制 tenant，普通路径覆盖浏览器自报的 `createdBy`、`reporterUid`、审计 actor 与 tenant。命中自动领取规则（severity=高 且 bug 且 app ∈ 白名单）时创建 Dev Agent 任务，幂等键 `clientRequestId=issue-<id>`。
- **WebDev → Data Runtime**：托管 tenant-runtime 部署必须由 WebDev 以 `service-client-policy` 获取自身 `webdev.runtime` 短期令牌，绑定目标租户的 `<tenant>-webdev` deployment；读写分别请求 `data-runtime:webdev:read|write`（或配置 audience 对应的 `tenant-runtime:*` scope）。WebDev 不得把上游业务应用 service token、Platform bootstrap credential 或长期 static token 转发给 Data Runtime；static bearer 仅保留给显式非 tenant-runtime 的本地/PoC 部署。
- **「我已提报」**：`GET /api/webdev-report/issues` → WebDev `/api/webdev/issues/mine`，按当前用户 + 层级过滤。
- **自动领取规则**：存于 `webdev_issue_settings`（按租户），WebDev 项目设置页维护，intake 评估命中后建任务；未配置时回退 `HZY_WEBDEV_AUTO_CLAIM_APPS` 等 env 默认值。
- **状态通知**：Issue 领取与状态流转（verifying/resolved/closed）经 Foundation `publishNotification`（audience=notifications）通知反馈人；WebDev 需 `notifications:publish` grant。
- 设计详见 `webdev/docs/WebDev-Issue-Inbox-Design.md`。Console 需为业务应用 service-client 配置 `webdev:issue:write` grant，为 `webdev.runtime` 配置 Data Runtime 双 audience 的 `webdev` read/write grant，并为 WebDev 配置 `notifications:publish` grant。

## Foundation 代理层

Foundation 作为 Nuxt Layer 提供服务端代理：

- `server/utils/accountApi.ts` — Account API 封装（legacy directory bridge）
- `server/utils/webdevReport.ts` — 业务应用 → WebDev Issue 上报/查询代理（service token）
- `server/utils/directoryApi.ts` — Console Directory API adapter；新接入模块通过 Console runtime config 只读 Console，不提供 Account fallback
- `server/utils/syncApprovalActions.ts` — 启动时同步审批动作
- `server/utils/serviceOidc.ts` — Console service token 获取，供跨模块服务调用、同步和回调使用
- `server/utils/platformBundleAuthorization.ts` — 业务应用授权消费层；普通权限快照和 scoped authorization 均调用 Console runtime，生产不读取业务应用本地 policy bundle，也不在 Console 不可用时降级为本地旧 bundle
- `server/api/workflow-proxy/[...path].ts` — Workflow API 透明代理

业务模块前端通过 Foundation 的 composables（`useAccount`、`useWorkflow`）访问平台服务，不直接调用。

授权事实源边界：Platform 负责 manifest、角色授权关系、scope、动作蕴含和签名 bundle；Console 负责拉取、验签、缓存、模拟会话以及生成普通/scoped 权限快照；Foundation 只把 Console 授权结果和 `actionPolicies` 适配给业务应用；业务模块只调用 Foundation helper。算法唯一事实源是 `@hzy/authz-core`，业务应用不得直接调用 `readCachedPlatformBundle()`，不得自行解析 policy bundle、选择有效角色或复制动作蕴含。

## Platform → Tenant Runtime 注册与治理

- 租户管理员从 Platform 复制安装命令；命令只携带短期单次 enrollment code，不携带长期 Runtime token、数据库密码或 release private key。
- Agent 通过 `POST /api/v1/runtime/enroll` 兑换独立入站兼容 token 和 control token；Platform 只保存 hash，并以 `(tenant, environment)` Runtime instance 绑定多个应用 deployment。
- Agent 使用 control token 调用 `POST /api/v1/runtime/agent-heartbeat`，只上报版本、release key id、endpoint、数据库连通性和各应用 Schema 粗粒度状态。
- Platform Admin 通过 `GET /api/platform/ops/runtime-releases` 查看稳定渠道、签名制品和实例版本分布；`POST /api/platform/ops/runtime-releases/sync` 从 R2 同步 `latest` 或精确版本并用当前 Ed25519 trust anchor 验签，`POST /api/platform/ops/runtime-releases/approve` 动态移动数据库中的 `stable` 渠道指针。批准与回滚均要求 `ops.deployments/deploy`，并写入 `platform_audit_logs`。发布目标不依赖 Platform Worker 版本；`HZY_DATA_RUNTIME_APPROVED_VERSION` 只作为首次动态批准前的迁移兜底。
- Platform Admin 批准或回滚 `stable` 渠道时，在同一数据库事务内把新版本物化到签名 key 一致的 Runtime `desired_version`；企业控制台以 `stable` 渠道作为有效目标版本事实源，避免已批准版本因实例行或 HTTP 缓存滞后而继续显示旧目标。Agent heartbeat 仍负责离线实例的最终校准和当前版本上报；版本漂移只标记 `runtime_version_incompatible` 作为滚动升级信号，不把数据库、endpoint 和信任锚均健康的运行时摘出数据面。默认禁止批准版本导致隐式降级，只有 Admin 明确确认且渠道记录为 `rollback` 时才允许下发更低目标。Signing key 变化不得通过批准或 heartbeat 隐式轮换，必须显式重新 enrollment。
- Tenant Gateway 只有在 Runtime instance 为 `ready` 且对应应用 binding 为 `schema_ready|active` 时才为业务 API 注入 endpoint；未就绪必须失败关闭，不得回退 Worker 直连数据库。业务应用自身的 `/api/auth/**` 是控制面例外：当当前应用 binding 未就绪但 Console binding 已就绪时，只允许这些认证路由借用 Console 的 runtime endpoint 完成 OIDC/session 操作，其他业务 API 仍不得获得 endpoint。
- Agent 的业务入站 JWT 仍由 Console 签发；runtime 按 `appCode` 查找 enrollment 中对应的 deployment binding 并精确校验，control token 不得用于业务 API。

## Align 协同边界（新增）

`Align` 调整为未来可选的深度组织协同业务模块，不再承担全平台统一员工入口。轻量待办、通知、公告摘要、最近访问、常用入口和简单事项入口优先归入 `console.employee-portal`。

- 新路径以 `Console directory-runtime` 作为用户、部门、角色、项目注册表事实源；未迁移模块可继续通过 `Account` legacy facade 读取
- `Workflow` 仍然是审批实例与待办的唯一事实源
- `Align` 只在轻量协同超出 Console 边界后承接完整协同业务对象，例如跨部门协助单、人员借调、HR/轻财务流程对象
- `Align` 若引用项目、合同、文档，只保存业务键，不复制主档

### Aims 产品需求创建（实现中）

`POST /api/v1/products/{productCode}/requests` 要求当前产品范围内 `product_requests:create`、Idempotency-Key 和 expectedRevision。BFF 重建 RequestDraft，委托已验证用户 actor 调内部 `POST /v1/aims/internal/products/{productCode}/requests:create`，要求精确 `aims:product-requests:create` 及 aims.write 传输权限。服务资源 `product-requests` 与用户资源 `product_requests` 分离。初始状态固定 submitted；创建、产品根 revision、审计、回执同事务，归档空间拒绝。创建 SQL 事务已通过隔离 MySQL 验证；目标租户实际签发链尚待验收。


### Aims 产品需求读取（实现中）

- 用户 GET `/api/v1/products/{productCode}/requests` 与 `/requests/{requestId}` 要求当前产品范围内 `product_requests:view`；requestId 使用需求 biz_id（规范小写 UUID）。用户不能传入授权对象、actor 或跨产品范围。
- BFF 调内部 POST `/v1/aims/internal/products/{productCode}/requests:list`、`requests:view`，组合 scope 为 `aims.read aims:product-requests:read`，内部校验签名 actor 与精确 capability。POST 在此仅承载可信授权快照，无业务写入或回执。
- 列表 page 默认 1、pageSize 默认 20／最大 100，page 最大 1000000；支持 keyword（最多 200 字符、按字面包含匹配）、decisionStatus、sourceType、urgencyLevel。过滤先于计数分页，按 id 倒序稳定返回；空结果 items=[]。返回 workspace_revision 与 items／total／unmerged_total 在产品根锁保护下读取。total 为匹配记录总数（用于分页），unmerged_total 为相同筛选范围内 decision_status 不为 merged 的需求数；已合并来源保留为历史记录，不算独立需求。详情同时限定 product_code 与 biz_id，跨产品或不存在对象返回 404。
- 列表可选 `mergedInto`（目标规范 UUID），Runtime 对应 merged_into_biz_id；在同产品内解析目标后筛选直接合并到该目标的记录，复用分页与全部既有筛选。目标不存在或不在当前产品返回 404；它不代表所有递归祖先的扁平集合，不按来源条数加分。
- 需求详情附带非空时的 `merge_trail`（biz_id／title／decision_status）；按原始合并边追溯，逐跳限定当前 product_code，在同一根锁事务内最多返回 64 层。超过时 `merge_trail_truncated=true`，末项不得宣称最终目标；循环返回 product_request_merge_cycle，缺失／跨产品目标拒绝，不输出部分越权数据。列表不展开链路。
- 读取允许已归档空间，但仍须当前授权；短期 permit 在锁内复核。归档不会自动隐藏历史需求。枚举、分页、未知参数在 BFF／Runtime 边界分别校验。
- Console seed／verify 的当前授权数量以 [产品中心服务授权说明](../aims/docs/Aims-Product-Center-Service-Grants.md)及生成脚本为准。实际 SQL 在隔离 MySQL 通过；目标租户 grant／令牌签发和浏览器真实链路仍须环境验收。

### Aims 产品需求修改（实现中）

`PATCH /api/v1/products/{productCode}/requests/{requestId}` 以 requestId（biz_id）定位当前产品需求，要求 `product_requests:edit`、Idempotency-Key、expectedRevision、expectedRequestRevision 和 reason；标题、问题说明、来源、紧急程度均显式提交。BFF 不接受评审／actor／授权字段。内部 POST `requests:edit` 要求组合 scope `aims.write aims:product-requests:edit`，签名 actor 与短期 edit permit 在产品根锁内复核。领域事务保留评审决定、拒绝合并源记录修改，连同关联规划事项证据 revision、根 revision、审计和回执一起提交；冲突返回 409。服务 grant 当前清单见 [产品中心服务授权说明](../aims/docs/Aims-Product-Center-Service-Grants.md)，本地 SQL 已验证，目标租户实际签发待验收。

### Aims 产品需求评审（实现中）

`POST /api/v1/products/{productCode}/requests/{requestId}/decision` 要求当前产品范围内 `product_requests:decide`、Idempotency-Key、双 revision 与目标 status。输入仅包含 status／reason／impactNote，决定人及时间由受信运行链产生。内部 POST `requests:decide` 要求 `aims.write aims:product-requests:decide`，edit capability 不蕴含 decide。首次 submitted→evaluating 可不填理由，其余允许转换要求理由；accepted→evaluating/rejected 还要求影响说明。merged 不经本入口产生。状态与说明在产品根锁内校验，决策／关联证据 revision／审计／回执原子提交，不撤销已有项目执行或版本范围。当前生成器安装 26 条业务 grant，verify 含传输前提共 32 项；隔离 SQL 通过，目标租户签发与 UI 链路待验收。

需求池 UI 操作提示由 `GET /api/v1/products/{productCode}/requests/permissions` 提供，先要求当前产品 `product_requests:view`，再分别计算 create／edit／decide；返回产品状态／revision，Cache-Control 为 no-store。该提示不代替每次命令重新授权，也不把编辑权限转换成评审权限。

### Aims 需求来源证据读取（实现中）

`GET /api/v1/products/{productCode}/requests/{requestId}/sources` 要求 product_requests:view，requestId 为该产品内需求 biz_id；只接受 page／pageSize（默认 1／20，最大页码 1000000、每页 100）。内部只读 POST `request-sources:list` 复用组合 scope `aims.read aims:product-requests:read`，在产品根锁内重新核验授权事实并解析需求归属，跨产品或不存在需求返回 404。按证据 id 倒序分页，返回 total、request_revision、workspace_revision；日期未知为 null，空页 items=[]。人工证据的 fact／assumption 是类别，verification_status 独立返回，不能把人工 fact 显示成已核验外部引用。此读取不新增业务 grant、不写审计或回执。

### Aims 人工来源证据添加（实现中）

`POST /api/v1/products/{productCode}/requests/{requestId}/sources` 要求 product_requests:edit、双 revision、Idempotency-Key；允许 note／evidenceDate／kind／direction，未知日期省略或 null，kind 为 fact／assumption，direction 为 supporting／opposing／neutral。拒绝 sourceApp、sourceBizId、verificationStatus、actor 和授权对象。BFF 调内部 POST `request-sources:create`，组合 scope 为 `aims.write aims:product-requests:source-create`；领域固定 manual／unverified，与根／需求／关联证据 revision、审计和回执同事务。该 capability 在两个 Runtime audience 下精确安装，当前共 28 条业务 grant、34 项 verify 要求；隔离 SQL 通过，目标租户签发仍待验收。

### Aims 产品规划事项创建与列表（实现中）

- 用户 GET／POST `/api/v1/products/{productCode}/planning-items` 分别要求当前产品 `product_priorities:view`／`edit`；创建带 Idempotency-Key、expectedRevision、标题、本次范围、投资类别、紧急程度建议及有界来源 UUID／revision。
- 内部 POST `/v1/aims/internal/products/{code}/planning-items:list`／`planning-items:create` 分别要求 `aims.read aims:product-priorities:read`／`aims.write aims:product-priorities:create`，使用当前委托用户及短期授权凭据。签名身份、精确能力校验在数据库访问前完成，产品成员事实在根锁内重新核验。
- 列表支持 page/pageSize、keyword、lifecycle、investmentCategory，过滤先于分页／计数；未知截止日期为 NULL，空列表为 []。创建初始 proposed，关联需求与审计／根版本／回执原子提交；不自动产生评分、周期选择或版本承诺。
- 服务授权由产品中心生成脚本和统一说明维护，用户角色权限与内部 service capability 分离。当前实现不代表规划页面、周期决策或真实租户部署已验收。

- 规划事项详情 GET `/api/v1/products/{productCode}/planning-items/{itemId}`（规范 UUID、无额外查询参数）委托内部 POST `planning-items:view`，复用 `aims.read aims:product-priorities:read` 和 product_priorities:view。详情含事项及产品 revision、来源 UUID／当前 revision；来源超过 100 条拒绝而非静默截断。详情与来源在同一产品根锁内读取，其他产品的 itemId 返回 404。

- 规划 PATCH `/api/v1/products/{productCode}/planning-items/{itemId}` 委托内部 POST planning-items:edit，要求 `aims.write aims:product-priorities:edit` 与 product_priorities:edit。请求必须显式携带完整 requests 数组、紧急程度、事项／产品 revision 和原因；不能省略来源来隐式清空。写入使用差异关系更新，历史评估／决定保留；完全相同的事实不增加业务 revision。已选／交付中修改需影响说明；终态只读。已承诺版本变更及验收失效合同仍在实施，不能用此接口替代版本范围变更命令。

### Aims 规划周期内部读取（实现中）

内部 POST `/v1/aims/internal/products/{code}/planning-cycles:list` 与 `planning-cycles:view` 复用 `aims.read aims:product-priorities:read`。入口在访问数据库前验证签名委托用户、来源、租户／部署、客户端及精确服务能力；领域读取在产品根锁内要求当前产品 `product_priorities:view`，不能以项目权限代替。列表 input 为 page、page_size、keyword、status（draft/open/closed），每页上限 100，计数与过滤集合一致；详情 input 为规范 UUID biz_id，跨产品对象返回 404。返回周期／队列版本、模型快照、可空预算与指标值，workspace_revision 用于后续并发控制。两个端点仅查询，不写活动或回执，不新增业务 service grant；用户 BFF 与页面尚未接入。

- 周期用户读取 BFF：`GET /api/v1/products/{productCode}/planning-cycles` 与 `GET .../planning-cycles/{cycleId}` 已接内部 list／view。列表只接受 page/pageSize/keyword/status，默认 1／20；详情只接受路径 UUID，不接受额外查询字段。两入口均 no-store，要求当前产品 product_priorities:view，以 Foundation Runtime helper 传递当前用户及 15 秒授权事实；下游错误保留统一语义，Runtime 不可用返回 503，不回退本地数据库。

### Aims 周期草案创建（实现中）

`POST /api/v1/products/{productCode}/planning-cycles` 要求当前产品 product_priorities:edit、expectedRevision 与 Idempotency-Key。仅允许 title、startsOn、endsOn、goalSummary、reviewIntervalDays 和可选 budget；复评间隔省略默认 14 天，budget 为 null／省略表示未知，提供时五项人日完整且类别加预留不超总量。小数输入规范为两位十进制字符串传入 Runtime，不以浮点计算容量。拒绝 actor、status、模型和评分等未定义字段。内部 `planning-cycles:create` 使用 `aims.write aims:product-priorities:create`，领域命令身份为 product_priorities:cycle-create，创建草案与活动／回执同事务；该服务资源的 create 同时覆盖规划事项和周期草案创建，不包含开放周期或最终决策。现有两个 Runtime audience 的 grant 组合不变，目标租户授权仍须部署验收。

周期草案编辑：`PATCH /api/v1/products/{productCode}/planning-cycles/{cycleId}` 调内部 `planning-cycles:edit`，要求 product_priorities:edit 与 `aims.write aims:product-priorities:edit`，使用独立 cycle-edit 命令身份。除完整草案字段外，必须提供 expectedCycleRevision、reason、budgetMode；budgetMode 为 keep／set／clear，set 要求完整预算，其他模式拒绝同时设置数值，reviewIntervalDays 编辑时不得省略。产品与周期 revision 均在事务重查；非草案和版本冲突返回 409。edit 服务能力用于事项及周期草案编辑，不包含开放期容量决策或关闭周期。

周期成功指标：周期 POST／PATCH 可提交 metric，包含 name、unit、direction（increase/decrease/maintain）、measurementMethod、baselineValue、targetValue。后两键必须显式提供字符串或 null，数字类型拒绝，精度上限为 14 位整数／6 位小数；其余字段要求非空且有界。metric 省略或 null 时创建不设置指标，编辑保留已有指标；提交对象则替换完整定义及数值，明确的 null 代表未知，不代表零。写入仍限草案并沿用 edit 用户授权及同一命令回执，不新增跨应用能力。详情以 metric_definition、baseline_value、target_value 返回。

周期开放：`POST /api/v1/products/{productCode}/planning-cycles/{cycleId}/open` 只接受 expectedRevision、expectedCycleRevision、reason，并要求 Idempotency-Key 和当前产品 product_priorities:prioritize。内部 `planning-cycles:open` 需独立 `aims.write aims:product-priorities:cycle-open`，读／创建／编辑服务能力不能替代；周期与产品版本、状态、预算、目标指标及唯一开放周期在事务中核验。Manifest 与生成器新增两个 Runtime audience 的精确 grant，当前共 40 条业务授权／46 个验证组合；目标租户启用仍须实际签发核验。

周期候选读取：内部 POST `/v1/aims/internal/products/{code}/planning-candidates:list` 要求 `aims.read aims:product-priorities:read`，input 为 cycle_biz_id、page、page_size、keyword、selection_status（candidate/selected/deferred）。在当前产品根锁及 product_priorities:view 授权内定位周期，再按同产品事项关联过滤、计数、分页；顺序为周期持久化 decision_rank，不以当前页覆盖队列。返回周期／队列／产品版本及事项事实、选择状态、评估引用；评估引用不表示评分当前有效。此读取不新增 grant；用户 GET `/api/v1/products/{code}/planning-cycles/{cycleId}/items` 经产品 view 授权转发，周期来自路径，selectionStatus 独立于周期状态筛选。

周期候选添加：用户 POST `/api/v1/products/{code}/planning-cycles/{cycleId}/items` 要求 product_priorities:edit，携带 Idempotency-Key、itemId、expectedRevision、expectedCycleRevision、expectedItemRevision。BFF 使用签名当前用户委托转发内部 POST `/v1/aims/internal/products/{code}/planning-candidates:add`，精确服务能力为现有 `aims:product-priorities:edit`（写传输 scope）；这是候选集合编辑，不授予 prioritize，不新增 grant。Runtime 在身份／服务能力检查后调用 candidate-add 事务命令，根锁内重新核验用户授权及三个版本；仅允许同产品、draft/open 周期及 proposed/in_delivery 事项。新增为 candidate/later，递增产品／周期／队列版本并原子记录审计与回执；重复关联保持已有选择和顺序，不重复增加业务版本。该动作不产生评分、选入决定或版本承诺。

产品评估追加：内部 POST `/v1/aims/internal/products/{code}/planning-assessments:create` 要求 `aims.write aims:product-priorities:assess` 与签名当前用户委托；用户动作独立为 product_priorities:assess，edit／create／cycle-open 不能替代。input 使用 PlanningAssessmentCreate：周期／事项标识及产品、周期、事项、范围、证据版本，固定模型 AssessmentInput、逐维度 rationale、带唯一 key 的人工 evidence、逐维度 evidence_references 和 estimate_confirmed。服务端计算分数并追加不可覆盖快照，更新当前评估引用、周期／产品版本、审计和回执同事务；不改变决定队列、选择结果及版本承诺。仅开放周期可评估；人工事实／假设不标记为外部验证事实。估算确认者当前绑定本次 actor，跨人研发确认流程与用户 BFF／页面仍待接入。Manifest 与 Console 生成器增加双 audience assess grant，当前共 42 条业务 grant、48 个核验组合（含 6 条已有传输权限）；目标环境仍须实际核验。

评估用户入口已接入 `POST /api/v1/products/{code}/planning-cycles/{cycleId}/items/{itemId}/assessments`：外层版本字段采用 expectedRevision／expectedCycleRevision／expectedItemRevision／expectedScopeRevision／expectedEvidenceRevision，另含 assessment、rationale、evidence、evidenceReferences、estimateConfirmed。assessment 和 evidence 内部字段沿用领域 snake_case；数值未知显式 null，置信度／投入以精确十进制字符串提交。用户 BFF 映射为领域输入并复核 assess 范围，不接收 actor、estimatedBy 或最终分数；当前尚未提供评估 UI。

评估历史读取已接入用户 GET `/api/v1/products/{code}/planning-cycles/{cycleId}/items/{itemId}/assessments` 与内部 POST `/v1/aims/internal/products/{code}/planning-assessments:list`。使用 product_priorities:view、精确 product-priorities:read 和只读传输能力；内部 POST 只读例外按精确路径匹配，嵌套路由不可借用。用户查询仅接收 page/pageSize，周期与事项来自路径，Runtime 根锁内检查归属与关联。按历史 ID 倒序返回完整冻结快照、分页总数、is_current 与 stale；stale 仅表明范围／证据／模型版本不匹配，不等于完整交付决策有效性判定。不新增 grant，不在读路径重新评分。

周期候选读取新增 sort=decision/recommended（省略按原队列）及 investmentCategory=reliability/usability/growth；BFF 映射为 investment_category。推荐为只读视图：分类内先展示 proposed 且范围／证据／模型版本匹配、推荐分非空的事项，按精确 DECIMAL 分数倒序，同分以稳定 biz_id 定序；其他事项后置，分类间不以分数比较。筛选同时用于 count 和分页，不写 queue_revision 或决定快照；不代表按推荐生成草案／正式定序命令已实现。

周期调序已接入用户 POST `/api/v1/products/{code}/planning-cycles/{cycleId}/move` 和内部 POST `/v1/aims/internal/products/{code}/planning-queue:move`。用户动作 product_priorities:prioritize，服务能力独立为 `aims:product-priorities:move` 加写传输 scope；edit、assess、cycle-open 均不可替代。用户输入 itemId、恰一个 beforeId/afterId、expectedRevision、expectedCycleRevision、expectedQueueRevision、reason 与幂等键；周期只取路径，不接受完整页面队列。领域根锁授权、开放周期、完整集合锚点移动、已选前置检查、审计和回执同事务，冲突 409。双 audience grant 新增 move 后共 44 条业务授权／50 个核验组合。此入口只调序，不替代后续 selection／capacity 决策接口。

调序预览已接入用户 POST `/api/v1/products/{code}/planning-cycles/{cycleId}/move-preview` 与内部 POST `/v1/aims/internal/products/{code}/planning-queue:preview`。两侧均为只读计算，使用 view、product-priorities:read 和精确只读 POST 路由，不要求或产生幂等回执。输入与 move 一致；预览返回周期总数、受影响事项选择状态及旧新位置、三个版本。预览不代表依赖／容量或版本承诺审核通过，正式 move 仍单独授权和校验。页面须按当前输入读取预览再确认，任何输入变化使旧预览失效。

价值／投入矩阵已接入用户 GET `/api/v1/products/{code}/planning-cycles/{cycleId}/matrix` 与内部 POST `/v1/aims/internal/products/{code}/planning-matrix:view`，复用 view／product-priorities:read 及精确只读 POST 例外。仅允许 keyword、selectionStatus、investmentCategory，周期来自路径；不接受 limit、page、pageSize、sort 或身份覆盖。返回 points／unplotted、total／returned／limit=200／truncated、周期阈值和版本；分组只基于当前有效完整评估，缺项与过期项不落坐标原点，不暗示全部数据已展示。不新增 grant，不产生业务写入。

### Aims 产品中心周期容量读取（2026-09-07 增量）

- 用户 `GET /api/v1/products/{productCode}/planning-cycles/{cycleId}/capacity` 不接受查询参数，以路径绑定周期；Foundation 校验 `product_priorities:view` 与产品范围，响应 `Cache-Control: no-store`。
- BFF 调自身 Runtime `POST /v1/aims/internal/products/{productCode}/planning-capacity:view`，使用精确 `aims:product-priorities:read` capability、签名委托当前用户及短时授权事实。内部 POST 仅精确单产品后缀进入只读例外，嵌套路径拒绝；没有新增服务授权。
- 输入为 `input.cycle_biz_id` 与 authorization。输出包含产品／周期／队列 revision、完整 budget（总量、预留、三类预算）、confirmed／latest 两组容量结果及逐项 changes（confirmed_category／latest_category 分别保留已决定与当前投资类别，即使投入相同也展示类别变化）。未知投入及不可计算差额保持 NULL，已确认投入来自决定快照；缺失快照失败关闭。读取完整产品依赖图，超过 10000 事项／100000 依赖明确拒绝，不能返回部分汇总。
- 当前为读取合同；不执行选择、预算变更或版本安排。未填写完整预算时返回明确领域错误，不把未知预算显示为零。

### Aims 产品中心选入预览（2026-09-07 增量）

- 用户 `POST /api/v1/products/{productCode}/planning-cycles/{cycleId}/items/{itemId}/selection-preview`，路径绑定产品／周期／事项；body 仅接受 expectedRevision、expectedCycleRevision、expectedItemRevision、expectedQueueRevision、expectedAssessmentId、reason 和显式 exceptions 数组（最多 100）。
- 例外字段为 code、按问题类型要求的 itemId／predecessorId／category、reason、responsibleUid、impact。只接受容量总额、类别容量、未知投入或未解除依赖问题；拒绝通用覆盖、评估豁免、重复问题及不对应问题类型的标识。责任人字段是决策说明，不授予身份或提交权限。
- BFF 使用 Foundation `product_priorities:view` 与产品范围、签名委托当前用户及精确 `aims:product-priorities:read` 调自身 Runtime `POST /v1/aims/internal/products/{productCode}/planning-selection:preview`。只读后缀严格匹配并拒绝嵌套；无新增服务授权，无幂等回执或业务写入。
- 返回 before／after 容量、产品／周期／队列版本和 can_confirm／blocker；can_confirm 仅表示提交的条件可满足领域检查，不表示查看者有 prioritize 权限。正式提交须再次校验事实及版本，不能信任客户端回传的预览结果。正式选入写接口见下节，预览本身不产生决定。

### Aims 产品中心正式选入（2026-09-07 增量）

- 用户 `POST /api/v1/products/{productCode}/planning-cycles/{cycleId}/items/{itemId}/select` 复用 selection-preview 的严格输入，并要求有效 `Idempotency-Key`、Foundation `product_priorities:prioritize` 与同产品范围。
- BFF 调 `POST /v1/aims/internal/products/{productCode}/planning-selection:select`，要求独立 `aims:product-priorities:select` service capability 和签名委托用户。read／edit／assess／move／cycle-open 不能代替 select；内部写命令不加入只读 POST 例外。
- 服务端重算预览相同领域条件，事务内写选择和评估引用／容量快照、产品／周期／队列 revision、审计及回执。幂等重放仍先检查最新授权。旧版本、已选重复选择、已变更决定及过期评估使用 409；容量／依赖问题按领域规则处理。
- Manifest 与 grant 生成器新增 select（data-runtime／tenant-runtime 两个 audience），共 46 条业务 grant，Verify 共 52 个组合；隔离数据库验证通过，不代表业务环境已安装授权。
- 当前接口尚未配套交互页面，期限确认、跨人研发估算、已选变更等完整决策要求仍在实施；不得将接口接通视为试点发布完成。

### Aims 产品中心前置依赖 API（2026-09-07 增量）

- `GET /api/v1/products/{productCode}/planning-items/{itemId}/dependencies` 拒绝查询参数，读取完整已有集合。返回 item_biz_id、产品／事项／范围版本、requires_impact_note 与 predecessors（biz_id/title/lifecycle/revision）。100 项以上明确拒绝，不返回部分集合。
- `PUT` 同路径要求 Idempotency-Key、expectedRevision、expectedItemRevision、predecessorIds 完整数组、reason 与可选 impactNote。空数组表示明确清空，缺失数组拒绝；重复、自依赖、非法标识／版本及客户端身份覆盖均拒绝。
- Aims BFF 通过 Foundation 校验产品范围内 product_priorities:view／edit，分别调用自身 Runtime `planning-dependencies:view`／`planning-dependencies:edit`，精确 service read／edit，绑定签名委托当前用户；没有新增 grant。view 的内部 POST 仅精确路径属于只读例外，edit 是写操作。
- Runtime 事务内执行完整产品图循环校验、状态／版本／影响说明验证，依赖增删、范围失效、审计及回执原子提交；已确认顺序、选择和版本快照不会被依赖维护自动重写。接口已接通，交互页和完整承诺变更流程继续实施。

### Aims 产品规划周期关闭

- BFF `POST /api/v1/products/{productCode}/planning-cycles/{cycleId}/close` 接受 expectedRevision、expectedCycleRevision、reason，复用严格周期流转解析，必须提供 Idempotency-Key。用户授权为 product_priorities:prioritize，复用 Foundation 产品对象范围和签名 actor 委托。
- 调用 Aims 自身 runtime `POST /v1/aims/internal/products/{productCode}/planning-cycles:close`，精确能力为 aims:product-priorities:cycle-close；cycle-open、edit、select 和宽写权限不蕴含关闭。双 runtime audience grants 由 manifest 对应生成器维护。
- 仅 active 产品的 open 周期可关闭；产品和周期版本冲突拒绝。关闭、产品/周期版本递增、审计及幂等回执在同一事务内；重放前重新授权。不改变队列版本、评估及选择快照，不自动结束共享事项或重开周期。读取保持原合同；本写端点不得加入 readonly POST 列表。

### Aims 周期结果观测 Runtime（BFF 待接）

- 内部 `POST /v1/aims/internal/products/{productCode}/planning-observations:list` 接收 input={cycle_biz_id,page,page_size}，需要 aims:product-priorities:read 和 product_priorities:view。列入只读内部 POST，真实分页并返回跨页更正关联。
- 内部 `POST /v1/aims/internal/products/{productCode}/planning-observations:create` 需要 aims:product-priorities:observe 与 product_priorities:observe，以及签名 actor 和幂等键。input 包含 biz_id、expected_revision、expected_cycle_revision、reason、value_mode、observed_value、observed_at、evidence_summary、evidence_source、conclusion、correction_of_id。value_mode 为 known/unknown，unknown 值为空；指标快照和记录 actor 由服务端生成。
- 更正来源限同周期，已有后续更正返回 409 planning_observation_already_corrected。产品/周期版本、状态、审计与幂等遵循领域命令；写端点不属于只读路由。双 runtime audience observe grants 由 manifest 和生成器维护，不借用 edit/assess/prioritize。

### Aims 观测 BFF 接入

- `GET /api/v1/products/{productCode}/planning-cycles/{cycleId}/observations` 接受 page/pageSize（默认 1/20，上限 100），拒绝其他过滤或身份参数，转发 observations:list。
- 同路径 POST 接受 expectedRevision、expectedCycleRevision、reason、valueMode、observedValue、observedAt、evidenceSummary、evidenceSource、conclusion、correctionOfId。observedValue 在 unknown 模式必须明确 null，correctionOfId 无更正时必须明确 null；其他字段、记录人和指标快照不得由浏览器覆盖。
- GET/POST 使用 Foundation view/observe 对象权限及签名 actor；POST 必须提供 Idempotency-Key，精确 observe service scope。均 no-store，调用自身 runtime，无本地数据库后备。

### Aims 单条结果观测读取

`GET /api/v1/products/{productCode}/planning-cycles/{cycleId}/observations/{observationId}` 拒绝全部查询参数，周期为规范 UUID，观测 ID 为正安全整数。调用自身 Runtime `planning-observations:view`，input={cycle_biz_id,observation_id}，精确 read scope 及 view 对象授权。授权后绑定产品/周期/记录读取原文、指标快照、后续更正 ID 和当前版本；缺失或跨周期记录不得退回其他周期查找。内部 view POST 属只读，create 不属于只读。

### Aims 规划预算决定 Runtime

- 内部 POST planning-budget:preview 接收 PlanningBudgetChange（biz_id、expected_revision、expected_cycle_revision、expected_queue_revision、budget、reason、impact_note、exceptions），view/read 授权，纯读取前后预算及 confirmed/latest 容量影响；此预览不表示所有问题已处理或具提交权限。
- 同产品内部 POST planning-budget:change 需要 prioritize 和独立 aims:product-priorities:budget-change，必须幂等键。重新计算全周期容量，拒绝已有估算/类别变更未确认或未显式处理的问题；事务更新三版本与预算、追加审计及回执。不改变冻结事项投入。
- 仅 preview 属只读 POST；预算写使用独立双 runtime audience grant，不借用 edit 或其他决策能力。BFF 与页面待接入。

### Aims 预算决定 BFF

`POST /api/v1/products/{productCode}/planning-cycles/{cycleId}/budget-preview` 与 `.../budget` 共享输入：expectedRevision、expectedCycleRevision、expectedQueueRevision、budget、reason、impactNote、exceptions。budget 要求总量/预留/三类完整精确金额，例外须明确数组；拒绝额外身份/容量快照。preview 为 view/read、无幂等键要求，budget 为 prioritize/独立 budget-change 且要求 Idempotency-Key。复用 Foundation 当前对象权限、actor 委托、no-store 与自身 Runtime 转发，无本地 DB 后备。

预算 preview 返回补充 can_confirm 与 blocker：基于完整当前数据和请求例外判断领域规则能否确认，不表示 view 用户具备 prioritize 权限。提交仍重新授权并重新计算。

### Aims 未开工事项撤回接口

- BFF `POST /api/v1/products/{productCode}/planning-cycles/{cycleId}/items/{itemId}/withdrawal-preview` 与 `.../withdraw` 接受 expectedRevision、expectedCycleRevision、expectedItemRevision、expectedQueueRevision、reason、impactNote、exceptions；路径绑定事项和周期，拒绝客户端消耗投入/状态等额外字段。
- Runtime 分别为 planning-withdrawal:preview（view/read，只读 POST）与 planning-withdrawal:withdraw（prioritize/独立 withdraw，幂等键必需）。共用完整周期投影，提交重新校验；未选中或需消耗确认返回 409。支持范围为 selected+proposed，已开工投入确认尚待后续命令。
- service withdraw 双 audience grant 已纳入 manifest 生成器，不蕴含于 edit/select/budget-change；复用 Foundation 对象范围/actor 与自身 Runtime，无本地 DB 后备。

### 产品周期撤回的投入确认引用（2026-09-08）

Aims 周期事项 withdrawal-preview/withdraw BFF 允许可选 `consumptionConfirmationId`（规范 UUID），映射 runtime `consumption_confirmation_id`。未开工撤回可省略；已开工撤回必须引用匹配当前事项版本、范围和原决定的服务端确认记录。不得提交已发生人日、确认人或任意确认快照来替代该引用。服务 capability 仍分别为 product-priorities:read / withdraw；实际已发生投入读取自领域命令保存的确认记录。确认命令的 Runtime/BFF 入口及 service grant 尚待接通，当前不宣称已开工撤回用户闭环可用。

### 产品已发生投入确认命令（2026-09-08）

Aims `POST /api/v1/products/{productCode}/planning-cycles/{cycleId}/items/{itemId}/consumption` 映射自身 Runtime `POST /v1/aims/internal/products/{productCode}/planning-consumption:confirm`。请求绑定四版本和 expectedScopeRevision、明确字符串 spentPersonDays（0～1000000 人日、至多两位小数）与核验依据 reason。用户需 product_priorities:assess，服务需 aims:product-priorities:consumption-confirm；请求使用既有受信 actor 委托及幂等键。只有 active/open/selected/in_delivery 状态可确认。确认保留原容量，不执行撤回；返回 confirmation 及新的产品/周期/队列版本，后续撤回引用 confirmation_id。仅生成授权文件和隔离验证不代表目标租户已启用。

### 产品投入确认读取（2026-09-08）

Aims `GET /api/v1/products/{productCode}/planning-cycles/{cycleId}/items/{itemId}/consumption` 不接受查询参数，映射自身 Runtime `planning-consumption:view`，精确 capability `aims:product-priorities:read`，用户对象动作为 view。响应包含产品/周期/事项/范围/队列版本、状态、pending、retained、current 与 blocker；current 只证明待用确认与当前范围/原决定及状态匹配，不表示整个周期依赖和容量校验已通过。范围变更保留历史确认供查看但 current=false；闭期/归档后不得据此撤回。撤回后的 retained 继续展示已发生投入，读取不产生业务写入。

#### Aims 产品功能未排期事项读取

BFF `GET /api/v1/products/:productCode/features/:featureId/unscheduled` 仅接受 `page` / `pageSize`，调用自身 Runtime `POST /v1/aims/internal/products/:productCode/feature-unscheduled:view`，要求精确 `aims:product-priorities:read` 及签名用户 actor。Runtime 在产品根锁内重新校验 `product_priorities:view` 和 `product_features:view`，确认功能属于该产品；返回 PlanningPage（items、total、page、page_size、workspace_revision）。未排期严格指事项不存在任何周期关联，不是未进入当前所选周期。读取不写业务状态，响应 no-store；服务授权沿用已有 read grant。

#### Aims 产品规划转交项目需求

- `POST /api/v1/products/:productCode/planning-items/:itemId/handoffs` 与 `POST /api/v1/products/:productCode/requests/:requestId/handoffs` 共用命令，后者必填 planningItemId 且来源绑定路径 requestId。输入包含 cycleBizId、四类 expected revision、projectCode、sliceKey、operation(create/link)、scopeSummary、reason；create 填 title，link 填 requirementId，可选 requestBizId/expectedRequestRevision 及 plannedVersionId/plannedVersionFeatureId。拒绝额外客户端授权/actor 字段与 query；必须携带 Idempotency-Key。
- BFF 通过 Foundation 验证 product_priorities:handoff、有来源时 product_requests:handoff、目标项目 requirements:edit，可选版本意图还须 product_versions:view。项目事实由自身 Runtime `POST /v1/aims/internal/products/:productCode/handoff-project:authorization` 提供，精确 capability 为 `aims:product-priorities:project-authorization`；只返回当前受信 actor 的上下文，用于 Foundation 授权，不对浏览器单独开放事实接口。
- 写入调用自身 Runtime `POST /v1/aims/internal/products/:productCode/planning-handoff:create`，精确 capability `aims:product-priorities:handoff`、签名 actor。Runtime 在回执前复验产品及项目授权票据；事务内检查当前选入决定、来源关系、active product_dev、产品/限定版本绑定和需求归属。创建需求草稿/范围章节或关联已有需求，与来源快照、审计、版本推进、回执原子提交；不会将草稿自动基线或改写已有正文。
- 同切片业务意图不一致返回 409；同键重放仍执行当前授权。版本意图仅保存关联，不等于修改版本范围或写执行 target 的 version_id。所有读取/写入返回 `{code:0,data:...}`，响应 no-store。授权 seed 现有 88 条业务 grant、verify 94 条含传输前提；目标环境安装/签发探测仍须实际核验。

Aims 项目列表 `GET /api/v1/projects` 新增可选 `product_code` 产品绑定筛选。Runtime 使用参数化 EXISTS，绑定条件同时参与完整集合计数与分页；不替代已有项目可见范围检查，也不隐式授予需求编辑权限。产品转交项目选择器组合 category=product_dev、lifecycle_status=active、page/pageSize/search 使用该条件。

### 产品中心版本清单与创建（2026-09-08）

- `GET /api/v1/products/{productCode}/versions`：Foundation 产品范围 `product_versions:view`；接受 page/pageSize/keyword/status，返回完整 total 和有界列表，产品编码精确匹配。自身 Runtime `POST .../versions:list` 为只读，需 `aims:product-versions:read`。
- `POST /api/v1/products/{productCode}/versions`：`product_versions:edit`、Idempotency-Key，严格接受 expectedRevision/versionCode/name/description/plannedReleaseDate；自身 Runtime `POST .../versions:create` 需 `aims:product-versions:create`。复验短期授权、签名 actor、active 产品与根 revision；创建 planning 版本，不要求牵头项目。拒绝客户端指定状态、发布事实、项目归属。版本、根 revision、审计、回执原子提交。
- `GET .../versions/permissions` 先验证产品范围 view，再返回当前 edit 能力、产品状态和 revision。以上响应 no-store，成功统一 `{code:0,data:...}`。
- 版本范围、验收、发布与旧项目版本写入口切换尚未由上述接口覆盖；目标租户授权安装与实际签发探测待核验。

### 产品中心版本详情与基本信息编辑（2026-09-08）

- `GET /api/v1/products/{productCode}/versions/{versionId}` 映射自身 Runtime `versions:view`，产品范围 `product_versions:view`、精确 `aims:product-versions:read`；只接受规范正安全整数路径 ID，不接受查询参数，锁定产品与版本并精确核对产品编码。
- `PATCH` 同路径映射 `versions:edit`，需产品范围 `product_versions:edit`、精确 `aims:product-versions:edit`、签名 actor 和幂等键。接受 expectedRevision、expectedVersionRevision、versionCode、name、description、plannedReleaseDate、reason；路径绑定版本，拒绝客户端更改产品、状态、项目或发布事实。
- 产品 active 且版本 planning/developing 才可编辑基本信息；任一 revision 不匹配返回 409。更新版本 revision 与产品 revision，保留 scope_revision 与项目归属；原因、前后快照、回执与修改同事务。已发布/归档内容不得由基本信息编辑覆盖。
- 当前详情为基本信息读取，正式发布快照视图与范围/验收/发布动作仍待补齐。

### 产品中心规划事项排入版本（2026-09-08）

- `GET /api/v1/products/{productCode}/versions/{versionId}/features`：产品范围 product_versions:view；自身 Runtime `versions:scope-list` 使用精确 aims:product-versions:read，属于只读 POST。接受 page/pageSize/keyword，完整 count 与真实分页；返回版本/范围/产品 revision、规划事项与长期功能业务 ID，旧未关联事项行标记 legacy_unscored。跨产品关系不暴露其业务 ID。
- `POST` 同路径：产品范围 product_versions:edit 与 product_priorities:prioritize 同时满足；自身 Runtime `versions:scope-create` 需精确 aims:product-versions:scope-create、签名 actor 与幂等键。严格接收规划事项/周期业务 ID、产品/事项/周期/队列/版本 revision、范围标题/说明/验收标准/changeType/原因。
- 与项目转交共用 ValidatePlanningDeliveryTx，重验当前开放周期 selected 决定及范围、证据、投入等依据。目标版本须同产品且 planning/developing，长期功能从当前事项关系读取；客户端不能另指定功能或已交付状态。事项最多安排一个版本范围，同版本同长期功能重复冲突。
- 新范围为 planned、默认未对外公开；保存范围与验收标准，版本 revision/scope_revision、事项 revision、产品 revision、决定依据审计及回执原子提交。scope_revision 推进使旧验收不再对应当前范围；不自动改变事项生命周期或写项目执行事实。
- 本批仅创建/读取范围；修改、合并、移出/顺延、验收/发布、紧急例外独立路径与旧入口切换仍待接通。

产品版本 permissions 读取在 view 范围校验后返回 scope_create（version edit 与 planning prioritize 的交集）；该布尔值只供 UI 使用，范围 POST 仍独立复验两项权限。规划事项页面的排入版本流程使用现有 GET versions 分页选择目标，再按所见 revision 提交 scope-create，成功跳转范围清单；不会凭 UI 权限或选择器代替 Runtime 决策检查。

### 产品中心版本范围修改（2026-09-08）

`PATCH /api/v1/products/{productCode}/versions/{versionId}/features/{scopeId}` 复用严格 scope 输入与五项 revision，scopeId 只从规范正安全整数路径绑定。产品版本 edit 与规划 prioritize 双权限、签名 actor、幂等键，Runtime `versions:scope-edit` 需精确 aims:product-versions:scope-edit。当前周期 selected 决定仍须有效；同产品/版本/规划事项/范围必须完整对应，当前事项长期功能不能与已排范围的功能绑定漂移。只允许 planning/developing 版本中的 planned 范围修改标题、说明、验收标准和变更类型；delivered/deferred、已发布/归档及 legacy 无事项绑定的范围不通过此新接口修改。

修改递增版本 revision/scope_revision、事项 revision、产品 revision，保存修改前内容、修改后输入、决定依据及原因；与审计、回执同事务。修改不重新绑定规划事项/长期功能，不更改状态或项目工作项。既有验收因 scope revision 不再匹配而失效；验收/发布命令仍须单独完成该门禁。

### 产品中心范围交付确认（2026-09-08）

`POST /api/v1/products/{productCode}/versions/{versionId}/features/{scopeId}/deliver` 需独立产品范围 product_versions:accept，edit 不蕴含 accept；自身 Runtime `versions:scope-deliver` 需精确 aims:product-versions:scope-deliver、签名 actor 与幂等键。严格接收 expectedRevision/expectedVersionRevision/expectedScopeRevision/evidence/reason，版本/范围身份只从路径绑定。产品 active、版本 planning/developing、范围 planned 且已有非空验收标准才可确认；当前产品/版本/范围 revision 必须一致。

确认将范围状态改为 delivered，推进版本 revision/scope_revision 与产品 revision，并在不可变活动日志保存范围原文、验收标准、证据、原因、受信 actor 和时间；与回执原子提交。该动作不要求重新建立历史 selected 决定，允许有明确验收标准的 legacy 未评分范围执行当前验收，但不补造历史评估。它不生成版本整体验收/发布记录、不改项目任务状态或长期功能生命周期。旧无验收标准范围须先通过后续兼容治理补齐标准。

版本 permissions 返回独立 accept 标志供 UI 控制；服务端确认接口仍自行校验。验收依据为用户显式记录的核验结果，不能据此宣称已自动检查项目缺陷或全部执行项。

### 产品中心版本验收预览与提交（2026-09-08）

- `GET /api/v1/products/{productCode}/versions/{versionId}/acceptance-preview` 不接受查询参数，产品范围 product_versions:view，自身 Runtime `versions:acceptance-preview` 需精确 aims:product-versions:read，属于只读 POST。返回当前版本、范围状态计数、执行快照、产品 revision 与 review_hash；执行快照明确缺陷覆盖仅为已关联后代，仍需人工核验。
- `POST .../acceptances` 不接受查询参数，产品范围 product_versions:accept、自身 Runtime `versions:accept` 精确 aims:product-versions:accept、签名 actor、Idempotency-Key。严格接受 expectedRevision/expectedVersionRevision/expectedScopeRevision/expectedReviewHash/checks/exceptions；路径绑定 versionId，禁止提交验收人/状态/发布事实。
- checks 必须各一次 execution-review、blocking-defects-review、release-readiness 并附 evidence；exceptions 必须显式数组，每项唯一 code、reason、responsibleUid、impact。Runtime 逐项核对未完成目标与未关闭关联缺陷的自动例外编号，当前事实已不存在的编号拒绝。
- review_hash 是服务端对所见版本、完整范围和执行事实的 SHA-256 内容摘要。正式验收在事务中重读并比对，任何影响该摘要的变化均返回 409 product_version_review_changed，不能仅依赖 legacy 写入可能未推进的 revision。该摘要不是授权凭证，权限仍独立校验。
- 验收写入不可变记录与审计/回执，并推进版本及产品 revision；不直接发布。验收页面、记录查询与发布门禁仍待继续接通。

#### 产品版本验收历史查询（PC-10）

- `GET /api/v1/products/{productCode}/versions/{versionId}/acceptances?page=1&pageSize=20` 返回真实分页元数据（id/version_id/scope_revision/accepted_by/accepted_at），total、page、pageSize 和 current_scope_revision；只接受 page/pageSize，页大小 1～100。
- `GET /api/v1/products/{productCode}/versions/{versionId}/acceptances/{acceptanceId}` 返回同一版本内的验收记录元数据及保存的 checks、exceptions。不会返回完整存储的执行项目快照。
- 两者经 Foundation product_versions:view，分别调用自身 Runtime 只读 POST `versions:acceptance-list` / `versions:acceptance-view`，使用 `aims.read aims:product-versions:read`，15 秒受信 actor 范围许可、no-store；无新增 service grant。Runtime 锁定并验证产品与版本归属，详情按版本和记录 ID 双重约束。历史查询不修改状态；范围修订号相同也不替代发布前的执行事实核验。

#### 首次正式发布命令（PC-10）

`POST /api/v1/products/{productCode}/versions/{versionId}/publish` 只接受 acceptanceId、expectedRevision、expectedVersionRevision、expectedScopeRevision、reason，必须带 Idempotency-Key；不接受查询参数、客户端发布人／时间／证据等级／状态覆盖。Foundation 要求产品范围 product_versions:publish，BFF 以可信 actor 和 15 秒许可调用自身 Runtime `versions:publish`，精确服务 scope `aims.write aims:product-versions:publish`。Manifest 和双 audience Console seed/verify 已加入该业务 capability（当前 90 条业务 grant／96 条含传输条件）。

Runtime 执行发布命令：不同验收／发布主体、当前产品／版本／范围修订、保存后范围及执行事实一致、不可变记录与状态／审计／回执同事务；过期验收或自发布返回 409，同键同 payload 重放原回执。首次发布返回 release_record_id/release_biz_id/content_hash/version_id/product_code/status/revision/workspace_revision。现有历史版本的重开／更正另行实现。发布不执行部署或跨应用业务写入。

版本权限读取已增加 publish 布尔值。API 接通不代表旧项目／管理员入口及工作项关联写入已切换到同一发布锁协议；上线前仍须完成该切换、真实租户 grant/token 探测和端到端验收。

#### 发布快照读取（PC-10）

`GET /api/v1/products/{productCode}/versions/{versionId}/releases/{recordId}` 不接受查询参数；Foundation product_versions:view，经自身 Runtime 只读 POST `versions:release-view`，精确 scope `aims.read aims:product-versions:read`，no-store 与 15 秒 actor 范围许可。无新增 grant。产品、版本、记录逐级校验归属。

返回发布元数据、current/withdrawn/superseded、snapshot_available、冻结的版本基本信息与完整范围、验收人／时间／依据及例外；不投影完整执行项目快照。verified 记录先从保存的两份 JSON 复算规范化内容 hash，再投影；内容校验失败拒绝读取，不能以当前业务表替代。legacy_import 返回其证据等级和元数据、snapshot_available=false，不伪装为新流程已核验记录。current 仅说明当前有效发布引用，不代表已部署。

版本权限 GET 额外返回受信 `actor_uid`，仅用于发布 UI 比较验收人并提示职责分离；发布请求不能提交 actor，Runtime 仍以签名委托身份独立校验。

发布领域命令已扩展更正语义：完成专用重开及新的验收后，重新调用既有 publish API 可生成递增 release_seq、新 supersedes_record_id 和旧记录 superseded 事件。没有覆盖旧发布 JSON；未撤回或已经更正的原记录拒绝作为来源。重开领域命令当前尚未提供在线 API，仍待单独接通。

重开接口已接入：`POST /api/v1/products/{productCode}/versions/{versionId}/reopen`，body 严格限定 releaseRecordId、expectedRevision、expectedVersionRevision、reason，需 Idempotency-Key，无 query。Foundation product_versions:reopen，经签名 actor、15 秒许可调用自身 Runtime versions:reopen；精确 scope aims.write aims:product-versions:reopen。当前 grant 基线为 92 条业务／98 条含传输条件，目标租户仍待实际安装与令牌探测。

版本权限 GET 已返回独立 `reopen` 布尔值；不由 edit/publish 布尔值推导。

发布历史：`GET /api/v1/products/{productCode}/versions/{versionId}/releases?page=1&pageSize=20` 仅接受这两个分页参数，pageSize 1～100，经 Foundation product_versions:view 与自身只读 Runtime `versions:release-list`，scope aims.read aims:product-versions:read。按 release_seq/id 降序真实分页，返回元数据、supersedes_record_id、current/withdrawn/superseded 和总数；不随当前引用清除而删除或隐藏旧记录，无新增 grant。

#### 旧版本状态接口退役（产品中心迁移）

`POST /api/v1/admin/product-versions/{id}/transition` 与 `POST /api/v1/projects/{projectId}/releases/{id}/transition` 对应 Runtime 路径现返回 410 legacy_product_version_transition_retired，不读取或写入数据库。管理员及项目版本页面的旧状态按钮已替换成产品中心版本详情链接；发布／重开使用已接入的独立命令。管理员旧创建接口只接受 planning，拒绝直接创建 developing/released/archived。

这一步只关闭旧状态写入与创建状态旁路。旧版普通版本编辑、特性 CRUD、项目分配与工作项关联仍待统一；产品中心普通 planning→developing、归档等专用动作仍待补齐，不能据此宣称全部旧入口切换或生产验收完成。

### 产品中心版本归档命令（2026-09-08）

Aims BFF `POST /api/v1/products/{productCode}/versions/{versionId}/archive` 调用自身 Runtime `POST /v1/aims/internal/products/{productCode}/versions:archive`，要求 `aims.write` 与精确 `aims:product-versions:archive`，用户侧要求 Foundation 产品范围 `product_versions:archive`。请求为 expectedRevision、expectedVersionRevision、expectedScopeRevision、reason；ID 取路径，actor 取受信会话，Idempotency-Key 必填。仅已发布版本可归档，状态、修订、审计、回执同事务；原发布记录不撤回、不删除，客户环境不变。双 audience 授权 seed／verify 已生成，未在目标租户安装或完成实际令牌探测。

### 产品版本验收／发布执行明细预检（2026-09-08）

Aims BFF 在 accept/publish 前，以产品 view 许可读取 acceptance-preview，并使用 Foundation 项目对象授权同时检查 projects:view、work_items:view。缺任一关联执行项目权限返回 403，不调用 mutation；授权依赖异常向上传播。Runtime accept/publish envelope 必须有 BFF 生成的 execution_review_hash（非浏览器输入），在新命令事务中与锁定后的执行核验快照比较，不一致 409。该值不纳入业务输入幂等 hash，已有成功回执仍在当前产品授权检查后重放。用户版本 accept/publish 权限及负责人／不可自发布规则继续独立执行。

#### 产品版本执行预检的项目授权事实完整性（2026-09-08）

Aims BFF 的版本验收预览及 accept/publish 预检，从自身 runtime 的 `GET /v1/aims/projects/{id}/authorization-object` 读取项目事实，启用严格模式。必须返回与请求一致的数值 ID、规范项目编码 `project_code`、创建人字段、可空部门/负责人字段及成员数组；缺失或畸形响应以 503 中止，不以项目详情、路由 ID 或空对象补造权限上下文。有效空成员数组不是故障。Foundation 仍是项目与工作项数据范围判断的唯一策略执行者；本次未新增 capability、未改变已有 grant 集合。

#### 版本业务负责人的提交时有效性（2026-09-08）

产品版本 accept 和 publish 在新命令事务内复用版本负责人校验：负责人须在该产品存在 status=active、valid_from 不晚于数据库 UTC 当前时间、valid_until 为空或晚于当前时间的产品成员关系。accept 仍要求操作者为版本负责人；publish 仍要求验收人为当前负责人且与发布人不同。成员关系失效返回既有 `product_version_owner_unavailable`（409），不产生验收、发布、审计或成功 receipt。已成功命令沿用 ExecuteCommand 的重放合同；本次不改变 Console Directory 身份校验，也不把本地成员有效性等同于 Directory 在职状态。

#### 产品规划评论 Runtime 契约（2026-09-08）

Aims 自身 Runtime 新增 POST `/v1/aims/internal/products/{productCode}/planning-comments:{list|create|edit|delete}`。list 要求 `aims:product-priorities:read`，写操作要求 `aims:product-priorities:comment`，均在数据库访问前校验精确 capability。产品动作分别为 view/comment；author_uid 来自受信 current_user，写入复用标准 input/authorization/idempotency_key envelope。列表 POST 归 aims.read 传输；写 POST 不加入只读白名单。本人关系失败 403、评论不存在 404、版本冲突/已删除/闭期冻结 409。

Manifest 与生成器已登记 comment，Seed 共 96 条业务 grant，Verify 共 102 个组合（含 6 条已有传输权限）。这些是仓库授权产物；尚未安装目标租户、未做实际 JWT 签发与 BFF 全链路验证。

#### 产品规划评论浏览器 API（2026-09-08）

Aims BFF 提供 `GET/POST /api/v1/products/{productCode}/planning-items/{itemId}/comments` 及 `PATCH/DELETE .../comments/{commentId}`。GET 仅接受 page/pageSize；新增正文及 expectedRevision，修改还需 expectedCommentRevision，删除不接受正文。写操作必须提供 Idempotency-Key 且禁止 query；正文最多 10000 字、拒绝空白/无效 Unicode/NUL。作者来自 requireProductPermission 返回的 actor_uid，不接受客户端作者、授权或对象覆盖字段。列表/写操作分别获得 product_priorities:view/comment 后调用既有 Runtime 契约；上游未接管返回 503，其他错误沿用统一映射，响应 no-store。

#### 评论跨周期冻结规则修正（2026-09-08）

评论写入依赖 v5.20 cycle_id 增量。新增评论由 Runtime 在产品根锁内解析事项当前 open 周期，不允许浏览器指定归属；无开放周期时保持未分配。编辑/删除读取评论自身周期：closed 保持冻结，不因事项进入新周期而解冻。未分配历史评论遇到闭期关联继续冻结，不推断历史。列表 readonly 表示新增限制，每条评论另有 readonly/readonly_reason/cycle_id；新旧讨论可同时显示而具有不同修改资格。此前“任一闭期永久冻结全部讨论”的规则由此替代。

#### 评论历史查询（2026-09-08）

GET `/api/v1/products/{productCode}/planning-items/{itemId}/comments/{commentId}/history` 仅接受 page/pageSize，BFF 校验路径标识并要求 product_priorities:view，调用 POST Runtime `planning-comments:history`，传输使用 aims.read、精确 capability 使用 aims:product-priorities:read。Runtime 同产品定位事项及评论后返回分页审计记录，包含编辑前正文和删除历史；普通评论列表仍隐藏删除正文。历史查询为显式查看原文的独立入口，没有新增授权动作或 grant。

#### 周期复评记录 API（2026-09-08）

POST `/api/v1/products/{productCode}/planning-cycles/{cycleId}/review` 接受 expectedRevision/expectedCycleRevision/reason，必须带 Idempotency-Key，不接受 query。BFF 从产品 prioritize 权限绑定 actor 和短期授权，调用 Runtime POST `planning-cycles:review`；精确 capability 为 aims:product-priorities:cycle-review，传输为 aims.write。复评记录不清除 stale、不替代评分或排序决定。Manifest/Seed/Verify 已同步到 98 条业务 grant、104 个核验组合；目标环境尚未安装或探测实际 JWT。

#### 周期复评历史 API（2026-09-08）

GET `/api/v1/products/{productCode}/planning-cycles/{cycleId}/reviews` 仅接收有界 page/pageSize，要求 product_priorities:view；BFF 调 Runtime POST `planning-reviews:list`，使用 aims.read 与 aims:product-priorities:read。历史归属在领域层校验，响应包含结论、操作者、时间及前后周期快照。无新增 grant，周期关闭不删除复评历史。

### Aims 产品中心版本删除（2026-09-08）

浏览器使用 `DELETE /api/v1/products/{productCode}/versions/{versionId}`，提交 `expectedRevision`、`expectedVersionRevision`、`expectedScopeRevision`、`reason` 和 `Idempotency-Key`。BFF 通过 Foundation 要求 `product_versions:delete`，以受信 actor 调用本应用 Runtime `POST /v1/aims/internal/products/{productCode}/versions:delete`，要求精确 capability `aims:product-versions:delete`。领域命令仅删除 active 产品下无范围、执行工作项、项目绑定、验收和发布引用的 planning 版本；版本校验、删除、根 revision、审计及 receipt 同事务。

旧 admin/project 版本删除 Runtime 入口返回 `410 legacy_product_version_delete_retired`，调用方应跳转产品中心取得当前版本和产品权限后操作。此变更不代表其他旧版本写入口已全部迁移；目标 Console grant 与实际 JWT 签发仍须按部署验收核验。

项目页的旧版本创建 Runtime 命令 `createProductVersion` 返回 `410 legacy_product_version_create_retired`。项目页面先选择已关联产品，再导航到 `/products/{productCode}/versions` 使用产品中心创建流程；不再通过项目管理员身份直接创建版本或隐式设置 owner_project_id。产品中心新建仍要求产品范围 edit 许可及原有幂等、revision 规则。管理端旧创建/编辑及项目关联等其他写命令的统一另行跟踪，不因本条标记为完成。

管理端旧版本创建和编辑分别返回 `410 legacy_product_version_create_retired`、`410 legacy_product_version_edit_retired`。管理页面创建入口导航产品中心版本列表，编辑入口导航对应版本详情，统一使用产品中心版本号规则、产品授权、revision 与幂等命令；原管理表单的自由 owner_project_id 写入被移除。项目编辑和范围等尚存旧命令不在本次迁移范围内，仍须继续收敛。

项目旧版本编辑（`PUT/PATCH /v1/aims/projects/{projectId}/releases/{versionId}`）同样返回 `410 legacy_product_version_edit_retired`。项目详情现有“在产品中心管理版本”入口指向产品中心版本详情。管理端和项目端旧创建、编辑、删除的八个 method/path 组合均通过实际路由分发测试，在访问数据库前返回对应迁移错误。无调用方的临时 legacy 基本信息编辑事务 helper 已移除；范围、项目绑定和工作项挂接仍须分别迁移，不能把基本信息入口收敛当作全部版本领域迁移完成。

项目页旧 `POST /v1/aims/projects/{projectId}/releases/{versionId}/features` 返回 `410 legacy_product_version_scope_create_retired`。项目“添加特性”入口转向 `/products/{productCode}/versions/{versionId}/features`，使用产品中心规划事项选择和范围创建命令；旧页面标题直填新增表单及 POST 已移除。该项只覆盖项目新增范围，管理端新增与两端旧范围编辑/删除仍需独立迁移。

管理端旧 `POST /v1/aims/admin/product-versions/{versionId}/features` 也返回 `410 legacy_product_version_scope_create_retired`，管理页面新增范围跳转产品中心版本范围页，旧表单仅保留尚待迁移的编辑流程，不再存在直接新增分支。两端新增路由由同一退役矩阵测试验证；旧范围编辑/删除仍需领域命令迁移。

### Aims 撤回版本范围交付确认（2026-09-08）

`POST /api/v1/products/{productCode}/versions/{versionId}/features/{scopeId}/reopen` 接收 expectedRevision/expectedVersionRevision/expectedScopeRevision/reason，要求 Idempotency-Key 和 Foundation product_versions:accept。BFF 使用受信 actor 调用本应用 Runtime `versions:scope-reopen`，精确 service capability 为 `aims:product-versions:scope-reopen`。仅未发布且无当前发布记录的 planning/developing 版本可将 delivered 范围退回 planned；保留原交付审计，新撤回审计、根/版本/范围 revision 和 receipt 同事务。API 已接入，页面及目标授权尚未验收。

范围交付/撤回历史通过 `GET /api/v1/products/{productCode}/versions/{versionId}/features/{scopeId}/history` 分页读取，仅接受 page/pageSize。BFF 要求 product_versions:view，以 `aims.read aims:product-versions:read` 调用 `versions:scope-history`；Runtime 将该 POST 明确归入只读传输，查询验证产品、版本及范围归属。返回受限审计字段，不返回完整 changes 内容。页面历史组件仍待接入。

### Aims 历史范围验收标准补录（2026-09-08）

`POST /api/v1/products/{productCode}/versions/{versionId}/features/{scopeId}/legacy-criteria` 接收 acceptanceCriteria、reason 和三个 expected revision，要求 Idempotency-Key。Foundation 要求 product_versions:edit；Runtime `versions:scope-legacy-criteria` 要求精确 capability `aims:product-versions:scope-legacy-criteria`。仅已有 planned、无 planning_item_id 的历史范围可补录标准，不能通过请求注入历史标记、规划决定或状态；命令不创建新范围。页面及目标授权部署仍待验收。

### 产品模块 Runtime 接口（2026-09-08）

Aims 自身 Runtime 新增 components:list/create/move，精确 capability 分别为 aims:product-components:read/create/move；产品范围权限为 product_components:view/edit。全部复用 Foundation 授权事实及既有 Runtime 服务认证/actor 委托边界。写入要求 idempotency_key；模块与根修订、审计、回执事务提交，三层树约束由领域命令执行。两个 runtime audience 的授权 seed/verify 已同步；目标安装及 BFF/UI 接入尚未完成。详见 [模块 API](../aims/docs/Aims-Product-Components-API.md)。

### 功能模块归类写入（2026-09-08）

Aims 自身 Runtime features:component-assign 要求 aims:product-features:component-assign 和统一 product_features:edit 产品范围授权，BFF 从已验证会话获取 actor，写入要求幂等键及产品/功能修订。Console 两个 Runtime audience 授权已加入生成清单；无需跨应用数据直写。详情见 [模块 API](../aims/docs/Aims-Product-Components-API.md)。目标授权安装及真实 JWT 探测未完成。

模块编辑补充（2026-09-08）：Aims 自身 components:edit 要求 aims:product-components:edit，业务权限 product_components:edit；双修订/原因与幂等原子写入，不接收层级变化。Manifest 和两个 Runtime audience 的 Console seed/verify 已同步，目标租户安装仍未执行。

模块删除补充（2026-09-08）：Aims 自身 Runtime components:delete 使用独立 aims:product-components:delete 服务 capability 与 product_components:delete 用户权限，双修订/原因/幂等事务执行，引用阻止返回 409。Manifest 与两个 Runtime audience seed/verify 已同步，未在目标环境安装。

### Aims 产品目标 Runtime（2026-09-08，BFF 待接入）

Aims 自身 Runtime 新增 `POST /v1/aims/internal/products/{code}/objectives:create|list|view`，创建要求 `aims:product-objectives:create`，读取要求 `aims:product-objectives:read`；业务对象使用 `product_objectives:edit/view` 的 Foundation permit，可信 actor 与产品修订校验复用产品命令边界。跨产品目标 ID 不可读取，创建审计/回执事务化。两 Runtime audience 的授权 seed/verify 已生成，尚未安装目标环境。字段与实现边界见 [目标 API](../aims/docs/Aims-Product-Objectives-API.md)。

产品目标浏览器 BFF 已接入列表/详情/创建，路径为 `/api/v1/products/{code}/objectives` 及其目标 ID 详情；通过 Foundation 产品权限和 Aims 自身 Runtime 实现，输入及能力合同见目标 API。未新增跨应用数据库访问。

产品目标 Runtime 新增 objectives:observe/activate/close/reopen/archive，均要求同名精确服务 capability 及独立对象动作权限。状态动作须与路由一致；观测使用服务端指标快照，不接受客户端达成率。双 audience 授权生成已同步（总130业务 grant/136核验项），隔离验证通过，目标环境尚未安装。

目标状态及观测 BFF 已接通 `/api/v1/products/{code}/objectives/{id}/{observe|activate|close|reopen|archive}` POST，双修订/幂等和独立动作授权沿用目标 Runtime 合同；状态动作由路由注入，客户端不提供指标快照或达成率。

目标观测历史 Runtime `objectives:observations` 使用既有目标read capability及view permit，按指定产品/目标真实分页；每条达成率由该观测不可变快照计算。读取采用只读传输路径，不新增业务grant。

目标观测历史 BFF `GET /api/v1/products/{code}/objectives/{id}/observations` 已接入既有目标read Runtime；查询仅允许page/pageSize，不能通过query覆写目标ID，响应no-store。

目标观测更正沿用observe BFF/Runtime权限及capability，浏览器配对字段correctionOfId/correctionReason映射原记录ID/原因；当前双修订仍校验，原指标快照由Runtime读取，原日期保持。历史接口返回更正前后关联。实际Adapter+MySQL链路已验证，非真实JWT环境验收。

### Aims 产品目标周期映射（2026-09-08）

Data Runtime内部POST `/v1/aims/internal/products/{code}/objectives:cycle-map`、`:cycle-revoke`分别使用精确`aims:product-objectives:cycle-map`、`:cycle-revoke`，业务Foundation permit为`product_objectives/edit`。`:cycles`分页历史为`product_objectives/view`及`aims:product-objectives:read`，按只读传输处理。以上共享可信操作者及产品数据范围，映射校验目标/周期同产品和三方修订，撤销检查映射归属及目标/产品双修订。双方快照由Runtime数据库读取生成，BFF禁止客户端提供，映射与撤销均有幂等回执和原子审计。v5.24保存快照及撤销历史，禁止历史删除/改写，不重算任何周期评分或观测结果。

### Aims 产品路线探索窗口（2026-09-08）

浏览器 BFF `GET/PATCH /api/v1/products/{code}/roadmaps/windows/{itemBizId}` 对应 Runtime `roadmaps:window-view/window-edit`，分别要求 `aims:product-roadmaps:read/window-edit` 精确服务能力及 `product_roadmaps/view/edit` Foundation permit。GET permissions 返回一致产品事实下独立计算的 edit/commit 能力，写入仍重新授权。事项必须属于路由产品；编辑检查当前产品及事项双修订、原因及幂等键，仅 active 产品的 proposed/in_delivery 事项可修改。日期必须为合法且顺序正确的一对日期，或明确双 null 清空。v5.25 保存探索窗口，命令将日期、双修订、审计及回执原子提交，不改变优先级、范围、证据或版本承诺。季度展示和正式承诺基线已接入，合同见下；当前授权脚本尚未安装目标环境。详见 [路线 API](../aims/docs/Aims-Product-Roadmaps-API.md)。

### Aims 季度路线与正式承诺（2026-09-08）

季度 GET roadmaps/quarter 和历史 GET roadmaps/commitments/{itemBizId} 使用路线/优先级 view 双 permit，BFF 核对产品事实一致，Runtime 使用精确 aims:product-roadmaps:read 且按只读传输处理。季度从既有周期决定顺序派生，历史真实分页返回不可变快照及当前变化原因，不自动撤销基线。

POST roadmaps/commit/{itemBizId} 使用 product_roadmaps/commit 及精确 aims:product-roadmaps:commit。四项当前修订、上一基线 ID、原因及幂等键绑定用户查看的事实；服务端核验当前选入/评估/投入与前置依赖，读取真实快照。v5.26 基线禁止改写/删除，变更追加后继；事务同时保存基线、审计、根修订及回执。浏览器不可提供日期、快照、操作者或例外覆盖。未取代版本范围确认或项目需求基线流程。详见路线 API。

### AIMS → Codocs 产品文档元数据（PC-16，代码接入中）

`POST /api/v1/service/product-documents/{uuid}/metadata` 要求精确 `codocs:product-document:read`，来源 `aims.runtime`，签名命令 `aims.codocs.product-document.read.v1`。固定载荷为 actorUid/productCode/documentUuid/action=metadata:read。来源 deployment 取服务身份，目标 deployment 取受信路由，Foundation HMAC 分别绑定二者、tenant、method/path/request ID 和 payload hash，不假定两个 deployment 相同。

Codocs 以自身运行身份调用 `/v1/codocs/service/product-documents/{uuid}/metadata`，申请 `codocs.read codocs:product-document:read` 并重新签名 actor。Runtime 要求精确 capability，再执行 owner/share/relation ACL；产品关系与部门 hint 不授予正文访问。只返回 UUID、标题、类型、更新时间，不返回正文或存储路径。AIMS 必须先验证自身产品文档关系，且候选 UUID 经本接口核验后才能向浏览器展示。

此为只读元数据链路，无业务写入；操作标识与幂等键用于签名关联。Console grant 的生成式 Seed/Verify 已包含本链路：aims.runtime → aud=codocs 的 codocs:product-document:read，以及 codocs.runtime → data-runtime/tenant-runtime 的精确产品文档读取能力。既有 codocs.read 传输权限只核验、不自动扩权。目标环境安装、令牌签发探测及完整跨服务测试尚未完成，不能标记为已启用。正文、模板创建和关联操作另行接入。

AIMS 侧内部调用方已新增 `aims/server/utils/productDocumentCodocs.ts`：产品文档 view 授权先于 Codocs token 申请，actor 来自当前授权事实；使用 Foundation 可信 Gateway 服务目录及目标路由 header helper，签名分别绑定 AIMS/Codocs deployment。此 helper 供现有关系读取和关联预检编排，尚未开放浏览器文档入口，不能替代 AIMS 关系归属校验；无可信服务目录时返回 503。

AIMS 内部候选关系读取新增 `POST /v1/aims/internal/products/{productCode}/roadmaps/documents:list`，只读传输 `aims.read`、精确能力 `aims:product-documents:read`，固定签名 actor 与 product_documents/view 许可。input 接受用途、解除状态和有界 page/page_size；返回关系 UUID、用途、修订和候选总数，不能直接作为浏览器可见列表。BFF 必须完成 Codocs 当前 ACL 核验后才返回文档标识与标题。Manifest 及双 audience Seed/Verify 已更新，当前为 167 业务 grant / 175 核验项，目标环境仍未安装。

产品文档浏览器列表接入 `GET /api/v1/products/{productCode}/roadmaps/documents?page=1&pageSize=20&purpose=design&removed=false`。用途可省略，解除状态默认 false；BFF 独立 product_documents/view 授权，经自身 Runtime 候选页和 Codocs 签名元数据服务过滤后计算可见总数/分页，响应 no-store。只有 403 permission_denied/product_document_inactive 计入 restrictedCount，其余认证/服务错误传播；产品根修订变化为 409，末尾再次核验权限与修订。尚未完成真实 JWT、页面及大文档空间性能验收。

产品文档内部关系详情新增 `POST /v1/aims/internal/products/{productCode}/documents:view`，input 为 biz_id，复用 aims:product-documents:read 与 product_documents/view 许可及只读传输。按产品+关系身份查找，含已解除关系，返回根修订和关系当前用途/状态/修订；仍为内部候选数据，浏览器曝光及恢复前须独立核验 Codocs ACL。无新增 grant。

产品文档解除关系 Runtime 新增 `POST /v1/aims/internal/products/{productCode}/documents:remove`，要求 aims.write 和 aims:product-documents:remove、受信 actor、product_documents/edit 许可及稳定 idempotency_key。input 为 biz_id/expected_revision/expected_document_revision，关系状态、产品修订、审计和回执同事务，不修改 Codocs 文档或 ACL。复用 manifest 生成双 audience grant，当前 169 业务 grant / 177 核验项；浏览器写入口及真实部署验收未完成。

解除关联 BFF 已接入 `POST /api/v1/products/{productCode}/roadmaps/documents/remove`，不接受 query，要求 Idempotency-Key，body 严格为 bizId/expectedRevision/expectedDocumentRevision。当前 product_documents/edit 授权先于 body，actor 仅来自授权事实；转自身 Runtime 精确 remove 能力。旧预期修订交 Runtime 处理幂等回执，不在 BFF 提前拒绝。该动作只解除关系，浏览器按钮尚未接入。

文档列表响应补充 canEdit：列表结束时独立计算 product_documents/edit，要求其产品、actor、修订和状态与当前查看事实一致，且产品 active 才返回 true。编辑权限故障传播，事实变化返回 409；该字段只控制 UI，解除关联 BFF/Runtime 仍独立授权。

文档用途维护 Runtime 新增 `POST /v1/aims/internal/products/{productCode}/documents:edit`，精确 aims:product-documents:edit、写传输及 product_documents/edit 许可，input 为 biz_id/purpose/expected_revision/expected_document_revision，稳定幂等键；复用领域用途枚举、已解除拒绝及双修订事务。Manifest 与双 audience 生成授权更新为 171 业务 grant / 179 核验项，目标环境未安装；用途修改 BFF/页面尚未接入。

用途编辑 BFF 已接入 `POST /api/v1/products/{productCode}/roadmaps/documents/purpose`，无 query，要求 Idempotency-Key，body 严格为 bizId/expectedRevision/expectedDocumentRevision/purpose；用途限定六个合同值。与解除复用产品 edit 授权/受信 actor/双修订及幂等转发，动作和精确 capability 由服务端固定为 edit。页面用途编辑入口尚待接入。

恢复关联内部 Runtime 新增 `POST /v1/aims/internal/products/{productCode}/documents:restore`，要求 aims.write + aims:product-documents:restore、受信 actor、product_documents/edit 许可、稳定幂等键及双修订。恢复原关系，不创建新 biz_id/UUID，不修改 Codocs ACL。调用方 BFF 须先读取同产品关系并核验 Codocs 当前访问权限，浏览器恢复入口尚未开放。生成授权当前 173 业务 grant / 181 核验项，目标环境未安装。

恢复 BFF 已接入 `POST /api/v1/products/{productCode}/roadmaps/documents/restore`，body/key 同解除。当前 edit/view 事实必须同产品、actor、根修订；先由自身 documents:view 读取关系，校验归属，再以关系中的 UUID 调 Codocs 当前 ACL 元数据服务，最后提交 restore。浏览器不得提交 UUID，已恢复状态不在 BFF 提前拒绝，以支持成功回执重放；每次重试仍核验 Codocs 当前权限。页面恢复入口尚待接入。

关联创建内部 Runtime 新增 `POST /v1/aims/internal/products/{productCode}/documents:create`，要求 aims.write + aims:product-documents:create、受信 actor、product_documents/edit、稳定幂等键；input 为 document_uuid/purpose/expected_revision。领域层产品+UUID唯一，已解除关系须恢复，不重复创建。BFF 须先核验 Codocs 当前权限，浏览器创建入口尚未开放。生成授权当前175业务grant/183核验项，目标环境未安装。

关联创建 BFF 接入 `POST /api/v1/products/{productCode}/roadmaps/documents/create`，无query、稳定Idempotency-Key，body仅documentUuid/purpose/expectedRevision。先产品edit授权，严格UUID/用途/修订，再以当前用户调用Codocs元数据ACL预检，成功后调自身documents:create。浏览器不提供actor/权限事实，Codocs拒绝或不可用时不写关系；重复请求仍核验当前ACL后交Runtime处理回执。

产品文档搜索 Service API 新增 `POST /api/v1/service/product-documents/search`：使用既有精确 codocs:product-document:read、aims.runtime 来源及独立源/目标 deployment；无 query，固定六字段 search.v1 签名命令（actorUid/productCode/action/search/page/pageSize），HMAC/hash 验证后以目标自身 runtime 身份重签 actor。响应严格分页和四元数据白名单，不返回 OSS/权限信息。middleware 本地 handler 已登记；调用方和真实部署验证待完成，复用 read grant 不新增授权。

AIMS 内部 searchProductDocuments 调用方已接入固定 search.v1 Service API：当前 product_documents/view 用户事实、可信 Gateway 路由和独立源/目标 deployment，搜索词/页码/页大小包含在签名命令中。与元数据读取共用本模块签名发送编排及Foundation helper；响应严格校验分页、规范UUID和重复项并投影白名单。浏览器搜索入口和选择器待接入。

### 2026-09-08：产品文档正文 Service API

`POST /api/v1/service/product-documents/{uuid}/content` 由 Codocs middleware 精确分发，复用 `codocs:product-document:read`。固定 operation/schema 为 `aims.codocs.product-document.content-read.v1`，command 严格为 actorUid/productCode/documentUuid/action（content:read）；源 AIMS 签名及 tenant/双 deployment 绑定先于 Runtime 和存储。Codocs 使用自身身份与同一精确 capability 访问 Runtime，当前文档 ACL 校验后才下载正文；空 Markdown 按既有 Yjs 恢复机制处理。对外仅返回 uuid/title/docType/updatedAt/contentSize/content，不返回 OSS 路径。存储失败为脱敏503。

复用已登记 read grant，不增加 scope 或放宽现有权限。AIMS 正文调用及预览尚未接入；VM测试含真实HMAC，但身份解析、Runtime及存储为stub，不等同真实JWT/OSS验收。

### 2026-09-08：产品模板创建内部 Runtime 阶段

Codocs Runtime 新增 POST `/v1/codocs/service/product-documents/create/{template|prepare|complete}`，固定签名创建命令与精确 `codocs:product-document:create` 先于存储；非POST拒绝。template返回内部模板读取授权，prepare/complete每次重新校验模板ACL，分别调用冻结快照及共享回执完成事务。快照/上传参数是Codocs BFF自产的内部数据，不接受浏览器直传；外部BFF还必须校验实际用户documents:create资格。返回模板/快照中的存储路径仅供Codocs内部，不得传给AIMS。

外部Service未开放，创建授权Seed仍不安装；后续接BFF时需要Codocs自身Runtime写传输授权及精确create能力。专项Go测试通过，覆盖三阶段缺scope/宽scope/readscope/缺签名及非POST在存储前拒绝；此轮未验证真实Service/JWT/OSS链路。

### 2026-09-08：产品模板创建 Service 入口与授权产物

`POST /api/v1/service/product-documents/create` 已由 Codocs middleware 精确分发到创建处理器。入站要求 AIMS 精确 `codocs:product-document:create`；Codocs 自身访问 Runtime 使用 `codocs.write codocs:product-document:create`。Console生成产物增加AIMS→Codocs及Codocs→双Runtime的create业务授权，Codocs写传输只列前置核验、不自动扩大。

矩阵现为178条业务授权、10条传输前置要求，共188项。七项manifest/grant测试、Codocs typecheck及相关Lint通过；隔离MySQL验证188项、种子幂等、缺客户端、非选定客户端、缺传输、inactive授权与过期凭证门禁。原测试固定数量随新增组合更新：Codocs凭证失效影响8项，AIMS凭证失效影响176项、其余12项通过。未安装到真实租户，未完成实际service token组合签发探测或OSS联调。AIMS模板创建调用与UI仍待接入。

### PC17 Altoc 客户反馈到 AIMS 产品需求（实现中）

AIMS 已登记 `POST /api/v1/service/product-requests/from-feedback` 专用 BFF，使用 `aims:product-request:create-from-feedback`，仅接受 altoc.runtime 与 Foundation 签名命令；可信 Gateway 的 AIMS 目标部署与 Altoc token 来源部署分别绑定。BFF 通过自身 Runtime 读取签名 actor/product 的授权事实，再用 Console/Foundation 评估 product_requests:create，最后调用自身内部接收事务。需求、来源、自然键绑定及目标 receipt 同事务；Altoc 工单与客户仍是来源事实，客户 priority 不映射产品评分。详细字段和验收见 `aims/docs/Aims-Product-Feedback-Contract.md`。Altoc 源提交／派发和目标环境 grant 尚未交付，不宣称反馈闭环已启用。

### 产品当前采用读取（PC18，开发中）

AIMS 产品中心通过 Assets 服务边界读取当前采用，精确 capability 为 `assets:product-adoption:read`，固定签名协议 `aims.assets.product-adoption.read.v1`；五字段 command 为 actorUid、productCode、action=read、page、pageSize。原用户须有当前产品查看权限，Assets 按同一原用户独立加载 deliveries:view 和 environments:view 数据范围，交集过滤后才统计或分页。不得通过 AIMS 直接读取 Assets Runtime，也不得把服务客户端权限代替原用户对象授权。

Assets manifest 及 Console seed/verify 已准备 AIMS→Assets 与 Assets→双 Runtime audience 精确授权。C000001 测试租户已安装 Seed 并 Verify 236 行 0 FAIL（记录见 `deploy/test-env/CLOUDFLARE_TEST_STATUS.md`），但只对 `assets:product:read` 做过真实令牌签发探测，`assets:product-adoption:read` 的签发探测与端到端验收仍未完成；生产租户未安装。Assets 已注册 `POST /api/v1/service/product-adoption/read`，专用 handler 完成身份、签名、原用户授权后调用自身 `POST /v1/assets/internal/product-adoption:read`；AIMS transport、页面及真实链路验收待完成。详细口径见 `aims/docs/Aims-Product-Adoption-Outcome-Contract.md`。

失败归类是这条链路的契约的一部分，因为两类失败对使用者的含义完全不同。Assets 的三个 403 出口都返回稳定 `data.reason`：原用户对象范围被拒为 `assets_object_scope_denied`，服务身份或部署绑定不匹配为 `product_adoption_service_identity_invalid`，签名命令不合法为 `product_adoption_command_invalid`。AIMS 只把 `assets_object_scope_denied` 作为 403 透出，并提示补 Assets `deliveries:view` / `environments:view` 及数据范围；其余 401/403、Console 服务令牌签发失败和无效响应一律收敛为 503，不携带 Console 诊断串，也不提示用户去申请权限。缺少产品查看权限时 AIMS 仍返回 404，不返回 403。

### 产品反馈决策回流（PC17，开发中）

Altoc 已登记 `POST /api/v1/service/product-feedback/status` 专用服务处理器，AIMS 来源精确能力 `altoc:product-feedback:update-status`，固定 `aims.runtime`，目标 Altoc 部署由可信 Gateway 绑定。命令 `aims.altoc.product-feedback.update-status.v1`、schema `product-feedback-status.v1` 包含 ticketCode/productCode/requestBizId/canonicalRequestBizId/decisionStatus/sourceRevision 六字段；不接受工单状态或客户身份。

验签后通过 Altoc 自身 Runtime `POST /v1/altoc/internal/product-feedback:status` 执行原子 receipt 和单调状态投影。同 revision 异内容冲突，旧 revision 跳过；需求合并保留原提交 UUID，更新 canonical 引用，不关闭服务工单。尚缺 AIMS 决策事务 outbox／派发与真实部署验收，接口登记不等于闭环启用。
# 产品中心期间成本读取补充（2026-09-09）

AIMS → Finance：`POST /api/v1/finance/service/product-cost/read`，精确 `finance:product-cost:read`，签名 operation/schema `aims.finance.product-cost.read.v1`。五字段命令为 actorUid、productCode、projectCode、periodMonth、action=read；Finance 固定接受 aims.runtime，同租户可信部署绑定，并通过 Console `product_cost_read` 查询原用户 `project_accounting:view` 项目范围。Finance BFF 校验后调用自身 Runtime `/v1/finance/internal/product-cost:read`，不直读其他应用数据库，不写只读 receipt。

结果仅含请求产品比例、分币种成本、ready／原因、规则及来源修订；成本沿用 Finance 非取消支出台账与有效 allocation 口径，不宣称实际已付。收入归因未配置时独立保持未就绪，不以收款或合同额替代。完整规则计算后再投影单产品，不能按可见产品重分比例或泄漏薪资来源。当前服务路由及受控测试已实现，真实租户 JWT 和 AIMS 页面未验收；详细约定见 `aims/docs/Aims-Product-Adoption-Outcome-Contract.md`。

### 产品成本规则可靠投递补充（2026-09-09）

AIMS 的 claimed-operation 派发器对 `aims.finance.product-cost.rules.replace.v1` 使用 Finance BFF `POST /api/v1/finance/service/product-cost/replace-rules`，仅申请 `finance:product-cost:replace-rules`，schema 为 `product-cost-rules.v1`。request IO 使用可信网关路由，scheduled IO 使用显式 `HZY_FINANCE_TARGET_DEPLOYMENT`，托管云通过 `HZY_FINANCE_SERVICE`。目标回执和结果均绑定项目、月份及下一修订；本地确认丢失维持 pending 并复用原幂等键重放。精确 grants 已纳入生成脚本；实际授权安装、源端冻结入口及完整用户流程验收未完成。

AIMS 源端冻结接口补充：POST /v1/aims/internal/product-cost-rules:freeze 仅供 aims.runtime 以精确 aims:product-cost-rules:freeze 和委托用户调用。请求为 requestId、完整 command 与短时 projects:edit authorization；在 AIMS 本地事务中锁定项目并冻结幂等任务。该 capability 已加入 data-runtime/tenant-runtime 双 audience 安装矩阵。用户 BFF 保存路由及真实租户验收未完成。

规则提交查询使用 AIMS 自身 Runtime 精确 capability aims:product-cost-rules:status，接口 POST /v1/aims/internal/product-cost-rules:status。仅返回当前项目编辑者本人提交的任务状态，按租户/部署/actor/项目及固定 Finance 规则 operation 约束查询；不返回冻结规则、员工或内部异常详情。

Finance 完整分摊规则读取 Service API 为 POST /api/v1/finance/service/product-cost/read-rules：来源 aims.runtime、capability finance:product-cost:read-rules，按签名四字段 command 校验后以原 actor 的 project_accounting:edit 调用自身只读 Runtime。结果仅 projectCode、periodMonth、revision、evidenceRef、shares；不允许以单产品过滤器取得不完整编辑基线。

### Assets 产品用户列表与服务目录分离（2026-09-09）

Assets 用户 `GET /v1/assets/products` 与详情读取必须携带由 Console scoped authorization 派生的 products 对象范围和当前用户；用户列表及 total 只包含同一 SQL 范围内的产品。产品负责人对应主档 business_owner_uid / technical_owner_uid，项目对应 project_code；无部门字段映射的授权单元不放宽。

存量 Assets Service API 的 serviceProducts helper 改为调用自身 `GET /v1/assets/service/products`，使用 `assets.read assets:product:read`，Runtime 校验受信 Assets 服务上下文及精确 capability 后执行目录读取。该 capability 已在产品目录 manifest 与双 runtime audience grants 中定义，未引入新增 grant。外部存量 service 路径保持其已有入站认证契约；新增产品中心同步继续使用分页 `/service/products/catalog`。存量服务目录的分页改造及产品写入口对象范围仍待完成。

### Assets 产品文档元数据校验（实现中，2026-09-09）

Codocs 自身 Runtime 新增 `POST /v1/codocs/service/assets-product-documents/{uuid}/metadata`，精确 capability 为 `codocs:product-document:read`，签名 operation/schema 为 `assets.codocs.product-document.read.v1`。受信来源固定 `assets` / `assets.runtime`；命令仅 actorUid、productCode、documentUuid、action（metadata:read），actor 必须与已验证服务委托一致。产品上下文不提供文档 ACL，Codocs 仍重验当前用户 documentAccess，只返回 uuid/title/doc_type/updated_at。

此入口与既有 AIMS metadata 路径隔离。尚待 Codocs Service API、Assets 签名传输和 source grant 接线；不能直接以 Assets 凭据调用 Codocs Runtime，也不能宣称用户链路已可用。

上述 Assets 产品文档元数据的 Codocs Service API 已注册：`POST /api/v1/service/assets-product-documents/{uuid}/metadata`。入站 auth requirement 独立固定 assets/assets.runtime，精确 `codocs:product-document:read`；Foundation 验证 HMAC、tenant 和来源／目标 deployment 后，Codocs 使用自身 runtime 身份及 actor 委托执行 ACL 查询。仍待 Assets 调用方与 source grant 安装接线。

Assets 产品文档关联接线（2026-09-09）：用户 POST products/:id/documents 的 middleware 先按产品对象范围查询规范 product_code，再由当前用户向 Codocs 发起上述签名 metadata ACL 查询。成功后派生 current_user_product_document_* 字段，绑定 actor、产品 ID/code、文档 UUID 和 15 秒有效期；所有同前缀入站 query/body 字段先清除。Assets 关联事务在父产品 edit 范围锁内校验该短期结果与当前产品编码后写入。该短期预检不授予 Codocs ACL，也不等同跨数据库原子撤权；点击打开文档仍须由 Codocs 当前 ACL 授权。

### Service client 的精确部署绑定（测试与非默认部署）

Console `service-client-policy` 签发目标应用自身 Runtime Token 时，若已验证的凭证策略或 Gateway 上下文属于该应用，必须保留其精确 deployment（例如 `C000001-test-assets`），不得重新拼接为 `C000001-assets`。其他来源应用的 deployment 不得复用为目标部署；跨租户或本应用绑定不完整时拒绝。无显式本应用绑定的 legacy canonical runtime client 才沿用既有命名兼容规则，最终仍由 Runtime 的 enrollment deploymentBindings 校验。此规则同样适用于 AIMS → Assets 产品目录 → Assets Runtime，业务 capability 保持 `assets:product:read`。

Runtime 的 `hzy_runtime_service_client_id` 必须取已验证 JWT 的 `client_id`（`auth.Context.ClientID`），不能取带 `client:` 主体前缀的 `sub`。仅缺少 ClientID 的 legacy 已验证上下文继续使用 Subject 兼容；外部 query/body 中同名字段仍由认证层剥离并覆盖。产品目录继续精确要求 `assets.runtime`，不接受通过截断或宽匹配伪造客户端。

- 用户通知代理 `fetchConsoleNotificationsForUser` 统一通过 `consoleServiceFetch` 消费 Console Service Binding，保留已验证用户凭证、查询参数和写操作幂等键；托管云不经公网回源读取通知。

### Aims 轻量版本计划（2026-09-12）

Aims 浏览器 BFF 经 Foundation 调用本应用 Runtime 的 `versions:plan/plan-items/plan-edit/plan-item-create/plan-item-edit/plan-item-delete/plan-confirm`，读取复用 `aims:product-versions:read`，写入复用 `aims:product-versions:edit`。不新增跨应用数据库访问或服务客户端。版本 `planning_mode` 持久化为 `simple/cycle`；旧版本和省略模式的旧创建调用保持 cycle，新 UI 默认 simple。

产品范围 permit 在 Runtime 事务内分别要求 `product_versions:view/edit`、来源 `product_requests:view`、明确采纳时的独立 `product_requests:decide`、创建规划事项的 `product_priorities:edit`、确认的 `product_priorities:prioritize`。转交继续叠加需求/规划 handoff 与目标项目 requirements edit；服务 capability 不替代用户权限。写入使用当前用户委托、幂等键和预期修订。simple 转交依据必须来自实际版本范围和当前有效确认；cycle 路径继续执行原评分/选入门禁。

计划元数据、范围估算及不可变确认快照由 v5.38 扩展，范围身份仍使用既有 planning item/version feature/source request。2026-09-12 已迁移 C000001 本机测试 Aims 库并部署 CF 测试 Aims / Runtime，生产未部署；线上已验证读取和表单，完整真实租户写入链路未实跑。本地隔离 MySQL、BFF/adapter 合同和 mock UI 的证据分别记录于 [第一阶段方案](../aims/docs/Aims-Lightweight-Product-Planning-Phase1.md)。完整输入输出见 [轻量规划 API](../aims/docs/Aims-Lightweight-Product-Planning-API.md)。
