# Console 模块

> 客户侧管理 BFF | 端口 3000 | 租户数据：Tenant Runtime
>
> 本模块基于 `@hzy/foundation` Nuxt Layer，模块风格参考 `workflow`，不要按 `platform` 控制面模块组织代码。

## 职责边界

**负责**：企业基础资料、系统参数、基础字典、节假日/工作日历、外部集成、凭证、目录和认证能力的管理界面与 BFF 契约；租户数据处理由 Tenant Runtime 承担。Console 还承载 `/shell/{appCode}` 企业应用 UI Shell，只从授权应用目录加载同源业务入口，不接管业务应用授权或数据。可选的 collab-runtime 使用独立数据源。

**不负责**：平台授权和 license 治理（→ Platform）、业务对象主数据、具体 GitLab/AI/通知业务逻辑。过渡期用户/部门/项目目录仍可由 Account 兼容承接，但新增目录能力优先落在 Console。

## 核心约束

- PM2 / 私有部署的 `console` 实例只服务一个企业；Cloudflare `managed-cloud-multitenant` 共享 Worker 通过 Tenant Gateway 注入的租户上下文按请求切换，并把 policy bundle 按租户 scope 做短期内存缓存。
- ADR-017 迁移后 Cloudflare、PM2 和 Self-hosted Console 都不得持有
  `hzy_console` 凭证；迁移中的领域必须经 Foundation Console Tenant Runtime
  client 调用客户侧 Runtime，Runtime 不可用时失败关闭。首个样板
  `/api/v1/console/profile` 已走 `GET /v1/console/profile`，不得增加本地 DB
  fallback。
- 目录服务作为 Tenant Runtime 的 `console.directory-runtime` 逻辑域落地；`account` 只作为 legacy facade / 迁移源。
- Console Directory API 必须调用 Tenant Runtime；`/api/account/**` 仅作为迁移期兼容入口，不得反向代理独立 Account，也不得直连目录表。
- LDAP / 企业微信 / 钉钉等目录源配置必须落到 `integrations + integration_credentials + vault_secrets`，不得继续依赖 Account 模块环境变量或保存明文 secret。
- LDAP 技术目录同步必须通过 `directory_sync_jobs` 写入 `directory_*` 表并重建 `directory_subject_exports`；不得再写 Account 表。钉钉正式组织/人员同步的业务入口属于 People，Console 只保留集成配置、Connector 运维、canonical Directory 投影与 Platform 授权链路。
- 钉钉部门 ID 只能写入 `directory_department_identities` 并映射到稳定 canonical `dept_code`，不得再生成 `DT-*` 业务编码。存量重复树通过 `directory_department_aliases` 软停用归并；浏览器 `directory_sync:edit` 不得直接创建钉钉 People 任务。Connector 必须提交 final marker、根部门、部门计数和规范化快照 hash；Data Runtime 只冻结已验证完整快照的缺失差异，并要求 People 管理员逐项确认。应用时重新检查活跃主归属和未纳入子部门，不允许仅因缺失自动停用 canonical 部门。
- 钉钉根公司（active 外部部门身份 `1`、active 正式部门且无父级）未提供负责人时，允许 Console 补充 `managerId`；后续无负责人根快照保留本地值，上游提供负责人后重新接管。其他钉钉权威字段仍只读，编辑 PATCH 仅发送变化字段，具体规则见 `../docs/MODULE_CONTRACTS.md`。
- 配置与秘密分离，配置表不得保存明文 secret。
- vault 对外使用 `secret_ref`，关系表内部使用 `secret_id`；reveal 与 resolve 分离，且都必须写 `vault_access_logs`。
- vault `usage_type` 统一为 `integration / service / bootstrap / custody`；`custody` 默认禁止程序化 resolve，只能受控 reveal。
- `POST /api/v1/console/bootstrap/token` 仅作为 legacy bootstrap 接口保留；新业务应用不再通过 app 级 `license.lic` 换取 service token。legacy 调用必须先以 Vault 中 `bootstrap.{deploymentCode}.access_key` 完成精确匹配，缺失或错误 key 均不得读取 service client 或签发 token；runtime config 仅可兼容暴露该 URL，绝不携带 access key 或其他 secret。
- `server/plugins/collab-runtime.ts` 默认以内嵌模式启动 Collab Runtime；`CONSOLE_COLLAB_MODE=external` 使用独立服务，`disabled` 关闭。
- Console 进程不得接收 `DB_*`、Hyperdrive、Vault master key 或 OIDC signing private key。内嵌 Collab 如启用，只能使用独立 `COLLAB_DB_*`。
- Vault 加密和 OIDC 签名材料只由 Tenant Runtime 持有；Console 只传递受限命令并消费去敏回执。
- Nuxt 业务模块不得直接使用 `integration_credentials` 或 `/vault/resolve`，必须通过 Foundation adapter 按 `integrationCode` 消费集成能力。
- v1 不支持同一 integration 或 service client 并行 active credential。
- 业务模块不得直连 `hzy_console` 数据库，只能通过 API 或 Foundation adapter 读取。
- 企业应用 Shell 覆盖当前用户应用目录中全部同源、非 Console 原生入口的业务应用，最多保留两个 iframe。目标 URL 必须位于 `/api/user/applications` 对应应用 `homeUrl/basePath`，postMessage 必须校验同源、来源窗口、appCode 和协议版本；`/shell/{appCode}?target=...` 仅作为内部启动地址，子应用确认导航后使用 History API 展示其规范业务路径，刷新规范路径时必须恢复 Shell；只有显式 `standalone=1` 才进入独立应用模式，跨源应用保持直接导航。Shell 品牌位使用嵌入应用运行时 `appLogo`，嵌入应用隐藏侧栏内重复的 Logo/名称。

## API 前缀

标准 API 前缀：

```text
/api/v1/console/**
```

设计契约按需查：

- `docs/Console-Functional-Design-v1.md`
- `docs/Console-Directory-Runtime-Integration-Plan.md`
- `docs/Console-API-Contract-v1.md`
- `docs/Console-Bootstrap-and-Rotation-Sequence-v1.md`
- `docs/Console-Vault-Credential-Management-Plan.md`

## Platform Runtime

涉及 Platform 激活、PM2、Cloudflare、prod/test/dev 隔离、诊断、public routing、runtime cache、签名 key 或部署验收时，先查相关脚本和运行手册，不把完整命令清单放在本常驻上下文中。主要入口：

- `../docs/Platform-Console-Prod-Dev-Isolation-Plan.md`
- `deploy/cloudflare/README.md`
- 根目录 `package.json` 中的 `validate:*`、`verify:*`、`probe:*`、`accept:*` 脚本
- `ecosystem.config.cjs`
- `deploy/nginx/*`

必须保留的运行规则：

- PM2 / 私有部署的 `console` 首次启动必须消费 Platform onboarding 生成的 `console.env`，其中包含 `HZY_PLATFORM_LICENSE_TOKEN`；Cloudflare `managed-cloud-multitenant` 共享 Console 不使用租户 runtime/license token，按请求使用 Console Worker 的 Platform internal service token 拉取签名 policy bundle。
- `console-dev` 默认关闭 Platform runtime / heartbeat / bundle refresh；生产和共享测试不得依赖 dev bypass。
- Prod/test/dev 必须隔离 Platform URL、deploymentCode、cache scope、PM2 名称、端口和 release/workdir。
- 稳定共享集成环境使用 `console-test`，开发人员本地实例使用 `console-dev`。
- Prod/test/dev 均不得在 Console 内生成、保存或轮换 OIDC signing private key。
- Platform runtime 服务端配置以运行期 env 优先，build-time `runtimeConfig` 只做兜底。
- Console 是运行时授权事实源：`/api/auth/permissions`、`/api/v1/console/user/permissions`、`/api/auth/scoped-authorization`、`/api/v1/console/user/scoped-authorization`、`/api/auth/instance-conflict-explain` 和 `/api/v1/console/user/instance-conflict-explain` 负责输出业务应用消费的权限快照、scoped grants、实例级职责冲突解释、active role、authorization mode 和 bundle 指纹。
- 权限计算使用本地已验签 policy bundle。`HZY_PLATFORM_BUNDLE_CACHE_BACKEND=runtime` 时经 Foundation/Data Runtime 存入 `hzy_console.policy_bundle_snapshots`，不直连数据库；Gateway 受信调度同步，普通 cache-miss 不访问 Platform。默认及非 test 环境无包或最近成功同步超过 5 分钟返回不可用；测试环境可显式设置 `HZY_PLATFORM_BUNDLE_MAX_AGE_MS=93600000`，上限 26 小时并配合每日同步，其他环境忽略该覆盖。内存 TTL 取配置与 freshness 截止的较小值，且始终不越过包自身到期时间。旧 memory 模式仍保留同步冷加载及同配置 in-flight 合并，供迁移回滚。明确要求 fresh-policy 的高风险接口不改语义。 持久化冷读取仅在同一请求内合并未完成 I/O；CAS 同步返回已验证的胜出记录并写入内存，避免整包回读，内存更新不得回退到更早同步版本。
- `POST /api/v1/console/service/authorization/subject-eligibility` 是业务 producer 发布 actionable 通知前的服务端资格边界：仅接受已登记来源应用、固定 purpose 和专用 service scope，要求目标 Directory 用户 active，并以 fresh normal-merged policy 判断来源应用固定 `resource:view`。调用方不得提交 resource/action/tenant/deployment 覆盖；拒绝或依赖不可用时 producer 必须保持未 ack 状态重试。
- People lifecycle 只接受 `aud=console`、精确 `console:directory-employment:sync` / `console:directory-offboarding:disable` 和完整签名 envelope。Directory 用户、People 来源唯一主部门、session/refresh token 回收、applied revision、succeeded receipt 与 Console-owned Platform operation 必须同事务；低 revision stale-skip，同 revision 异 hash 409。
- People 钉钉人事事实源只接受固定 People service client、`aud=console`、精确 `console:hr-source-sync:view|execute|admin` 与 tenant/source deployment/target deployment/command hash/幂等键绑定；部门映射和缺失部门停用确认都必须使用 service-command actor 重签。初始 grant 见 `docs/sql/Console-SQL-Seed-v2.1-people-dingtalk-hr-source-grants.sql`。
- Console→Platform 不再同步尽力调用。`HZY_CONSOLE_PLATFORM_LIFECYCLE_SYNC_ENABLED` 默认关闭的有界 drain 使用 lease/fencing/attempt 投递固定 operation；共享 Cloudflare Console 不配置单租户 Runtime URL/token，也不自带 cron，由 Tenant Gateway 逐租户签名唤醒 `/api/internal/integration-operations/drain` 并注入 Runtime binding。Platform 失败不得回滚 Directory/账号事实。receipt 重放必须实时返回 Platform operation status，使 pending 为 202、成功后同键恢复为 200。
- Aims/Altoc 跨应用 operation 的 dead-letter 通知只允许走 `POST /api/v1/console/notifications/integration-operation-dead-letter`：要求 `aud=notifications`、`notifications:publish`，source app、tenant、deployment 必须与已验证 service token 精确一致。新 source 合同完整提供冻结的 generation/actionable key/object version 后创建 pending actionable；legacy 四项全缺时只发布普通通知，部分缺失失败关闭。诊断 URL 必须绑定已验签 application catalog，不使用 service URL 猜测；详情先 fresh 校验 active 用户和 `integration_operations:view`，再交来源 verifier。通知/closure ack 丢失按 source 持久证据重试。请求和 metadata 禁止 command、hash、响应/错误摘要、token、内部 URL、operation key 或任意调用方 metadata；无有效收件人或发布失败时返回失败，让 source 保留待通知证据重试。
- `/api/activation/diagnostics` 是只读诊断端点，不返回 token、license 或 private key；公网探测必须配置 `HZY_CONSOLE_DIAGNOSTICS_TOKEN`。
- Cloudflare Worker 不使用 PM2、本地文件或数据库 cache；共享 Worker 使用 `HZY_CONSOLE_ACTIVATION_MODE=managed-cloud-multitenant`，可选 Runtime policy 持久层加 isolate 内存 cache，tenant/deployment/environment 只能来自受信 Tenant Gateway 上下文。Runtime 存储要求精确读写 scope、完整 JWT 及实时 credential/grant 校验；这两个 scope 的 Token 签发不读包摘要，避免循环。
- Cloudflare、PM2 test 和本地 dev 都不得在 Console 内生成或轮换 `auth_signing_keys`。
- 本地跨端口认证联调使用 `../deploy/test-env/local-gateway.mjs`；仅显式 dev/test 且已认证的 loopback Gateway 可以保留配置的 HTTP OIDC issuer（精确匹配 host/proto/prefix）。不得把该分支推广为公网 HTTP 或普通请求头信任；测试 license/策略包仍按正式流程验签。

## Tenant Runtime 数据

兼容 schema 定义保留在 `docs/hzy_console_schema.sql`，由 Tenant Runtime 迁移和访问，
不属于 Console 部署资产。Console 不包含数据库 driver、连接配置或 SQL 执行路径。

核心表：

- `org_profiles`, `org_business_domains`, `regions`, `region_divisions`
- `setting_catalogs`, `setting_values`, `work_calendars`, `work_calendar_days`, `work_calendar_months`, `work_calendar_import_jobs`, `dictionaries`, `dictionary_items`
- `vault_secrets`, `vault_secret_versions`, `vault_access_logs`
- `integrations`, `integration_credentials`, `integration_check_logs`
- `service_clients`, `service_client_credentials`, `service_client_grants`
- `directory_users`, `directory_departments`, `directory_user_departments`
- `directory_projects`, `directory_project_members`, `directory_identities`, `directory_subject_exports`
- `auth_external_login_transactions`（外部 OAuth state/browser binding 仅存 SHA-256，tenant/deployment 绑定且单次消费）
- `directory_sync_jobs`, `directory_sync_events`
- `directory_connector_enrollments`, `directory_connectors`
- `connector_runtime_enrollments`, `connector_runtime_instances`
- `operation_logs`
- `portal_notifications`, `portal_notification_recipients`, `portal_actionable_projections`

## 开发注意

- `nuxt.config.ts` 必须 `extends: ['@hzy/foundation']`。
- 默认开发端口为 `3000`；本地开发同样通过本地 Tenant Runtime 访问数据。
- 前端页面使用 Nuxt UI V4 写法，优先参考本模块和 `workflow/` 现有模式。
- 新增 API 后同步更新 `docs/hzy_console_schema.sql` 或相关 API 文档。
- `pnpm typecheck` / `pnpm lint` 按需执行，建议在提交前或关键改动后执行。
