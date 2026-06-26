# Console 模块

> 客户侧基础运行服务 | 端口 3000 | 数据库：hzy_console
>
> 本模块基于 `@hzy/foundation` Nuxt Layer，模块风格参考 `workflow`，不要按 `platform` 控制面模块组织代码。

## 职责边界

**负责**：企业基础资料、系统参数、基础字典、节假日/工作日历、外部集成配置、凭证保险箱、本地 service client credential、directory-runtime、auth-runtime，以及默认内嵌的 collab-runtime。

**不负责**：平台授权和 license 治理（→ Platform）、业务对象主数据、具体 GitLab/AI/通知业务逻辑。过渡期用户/部门/项目目录仍可由 Account 兼容承接，但新增目录能力优先落在 Console。

## 核心约束

- PM2 / 私有部署的 `console` 实例只服务一个企业；Cloudflare `managed-cloud-multitenant` 共享 Worker 通过 Tenant Gateway 注入的租户上下文按请求切换，并把 policy bundle 按租户 scope 缓存。`org_profiles` 仍只能有一行。
- 目录服务作为 `console.directory-runtime` 逻辑域落地；`account` 只作为 legacy facade / 迁移源。
- Console Directory Runtime 读取接口以本地 `directory_*` 表为准；`/api/account/**` 仅作为迁移期兼容入口，不得再反向代理独立 Account。
- LDAP / 企业微信 / 钉钉等目录源配置必须落到 `integrations + integration_credentials + vault_secrets`，不得继续依赖 Account 模块环境变量或保存明文 secret。
- LDAP / 企业微信 / 钉钉目录同步必须通过 `directory_sync_jobs` 写入 `directory_*` 表并重建 `directory_subject_exports`；不得再写 Account 表。
- 配置与秘密分离，配置表不得保存明文 secret。
- vault 对外使用 `secret_ref`，关系表内部使用 `secret_id`；reveal 与 resolve 分离，且都必须写 `vault_access_logs`。
- vault `usage_type` 统一为 `integration / service / bootstrap / custody`；`custody` 默认禁止程序化 resolve，只能受控 reveal。
- `POST /api/v1/console/bootstrap/token` 仅作为 legacy bootstrap 接口保留；新业务应用不再通过 app 级 `license.lic` 换取 service token。
- `server/plugins/collab-runtime.ts` 默认以内嵌模式启动 Collab Runtime；`CONSOLE_COLLAB_MODE=external` 使用独立服务，`disabled` 关闭。
- Console 自身 `DB_*` 只能指向 `hzy_console`；内嵌 Collab 访问 Codocs 文档库必须使用 `COLLAB_DB_*`，不得复用 Console DB 名。
- `storage_backend='db_encrypted'` 需要配置 `HZY_CONSOLE_VAULT_MASTER_KEY` / `CONSOLE_VAULT_MASTER_KEY`，不得在无 master key 时落库明文。
- Nuxt 业务模块不得直接使用 `integration_credentials` 或 `/vault/resolve`，必须通过 Foundation adapter 按 `integrationCode` 消费集成能力。
- v1 不支持同一 integration 或 service client 并行 active credential。
- 业务模块不得直连 `hzy_console` 数据库，只能通过 API 或 Foundation adapter 读取。

## API 前缀

标准 API 前缀：

```text
/api/v1/console/**
```

设计契约按需查：

- `../docs/Console-Functional-Design-v1.md`
- `../docs/Console-Directory-Runtime-Integration-Plan.md`
- `../docs/Console-API-Contract-v1.md`
- `../docs/Console-Bootstrap-and-Rotation-Sequence-v1.md`
- `../docs/Console-Vault-Credential-Management-Plan.md`

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
- 共用 `hzy_console` 时，prod/test/dev 不得自动生成或轮换共享 OIDC signing key。
- Platform runtime 服务端配置以运行期 env 优先，build-time `runtimeConfig` 只做兜底。
- Console 是运行时授权事实源：`/api/auth/permissions`、`/api/v1/console/user/permissions`、`/api/auth/scoped-authorization` 和 `/api/v1/console/user/scoped-authorization` 负责输出业务应用消费的权限快照、scoped grants、active role、authorization mode 和 bundle 指纹。
- `/api/activation/diagnostics` 是只读诊断端点，不返回 token、license 或 private key；公网探测必须配置 `HZY_CONSOLE_DIAGNOSTICS_TOKEN`。
- Cloudflare Worker 不使用 PM2，不启用本机进程控制，不使用文件 cache 保存 Platform runtime 状态；共享生产 Worker 使用 `HZY_CONSOLE_ACTIVATION_MODE=managed-cloud-multitenant`，tenant/deployment/environment 只能来自带内部 token 的 Tenant Gateway 请求头。
- Cloudflare、PM2 test 和本地 dev 都不得自动生成或轮换共享 `auth_signing_keys` 的 current key。

## 数据库

Schema 定义：`docs/hzy_console_schema.sql`

核心表：

- `org_profiles`, `org_business_domains`, `regions`, `region_divisions`
- `setting_catalogs`, `setting_values`, `work_calendars`, `work_calendar_days`, `work_calendar_months`, `work_calendar_import_jobs`, `dictionaries`, `dictionary_items`
- `vault_secrets`, `vault_secret_versions`, `vault_access_logs`
- `integrations`, `integration_credentials`, `integration_check_logs`
- `service_clients`, `service_client_credentials`, `service_client_grants`
- `directory_users`, `directory_departments`, `directory_user_departments`
- `directory_projects`, `directory_project_members`, `directory_identities`, `directory_subject_exports`
- `directory_sync_jobs`, `directory_sync_events`
- `operation_logs`

## 开发注意

- `nuxt.config.ts` 必须 `extends: ['@hzy/foundation']`。
- 默认开发端口为 `3000`，数据库默认名为 `hzy_console`。
- 前端页面使用 Nuxt UI V4 写法，优先参考本模块和 `workflow/` 现有模式。
- 新增 API 后同步更新 `docs/hzy_console_schema.sql` 或相关 API 文档。
- `pnpm typecheck` / `pnpm lint` 按需执行，建议在提交前或关键改动后执行。
