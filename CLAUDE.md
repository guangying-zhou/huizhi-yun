# CLAUDE.md

This file provides repository-level guidance for Claude Code when working in this workspace. Keep this file short: put detailed runbooks, history, and design notes in `docs/`.

Quick documentation routing: start with [`docs/START_HERE.md`](./docs/START_HERE.md). Module/command index: [`docs/MODULE_INDEX.md`](./docs/MODULE_INDEX.md).

## Project Snapshot

**汇智云（huizhi-yun）** 是面向中小型企业的软件企业作业与管理 SaaS。工作区由多个独立 Nuxt 4 模块组成，各模块有独立 `.git` 仓库，根目录通过 `pnpm-workspace.yaml` 统一管理依赖。

平台分层：

- 控制面：`platform/` 管租户、订阅、部署、License、策略包和应用治理。
- 企业基础运行时：`console/` 管企业配置、目录、认证、凭证保险箱、集成配置，并默认内嵌 `collab/` 运行时；`workflow/` 管审批流程。
- 业务应用：`codocs/`、`aims/`、`altoc/`、`assets/`、`finance/`、`people/`、`align/`、`insights/`。
- 共享层：`foundation/` 是 `@hzy/foundation` Nuxt Layer，统一认证、目录、权限、审批和共享 UI。
- 迁移期兼容：`account/` 仍保留 legacy 用户/部门/项目注册表与旧 Account API；目标目录能力迁到 `console/`。

模块端口速览：

| 目录 | 端口 | 说明 |
| --- | --- | --- |
| `account/` | 3000 | legacy Account facade / 迁移源 |
| `console/` | 3000 | 客户侧基础运行服务 |
| `codocs/` | 3001 | 协作文档 |
| `aims/` | 3002 | 研发项目管理 |
| `altoc/` | 3003 | LTC 经营管理 |
| `assets/` | 3004 | 资产与资源管理 |
| `finance/` | 3006 | 经营财务中台 |
| `people/` | 3007 | 人员事实、任职、成本快照与项目绩效 |
| `align/` | 3008 | 深度组织协同，可选增强 |
| `insights/` | 3009 | 代码仓库分析 |
| `platform/` | 3011 | 平台控制面 |
| `workflow/` | 3020 | 通用审批流程 |
| `collab/` | 3021 | 实时协作运行时 |
| `webdev/` | 3090 | 远程开发代理控制台（ADR-015 PoC） |
| `data-runtime/` | — | tenant-runtime 业务 API Agent（Go，部署于客户数据库侧，无固定开发端口） |

## Scope Defaults

- 默认排除 `account/`：除非用户明确指定处理 `account`、`account/`、legacy Account API，或明确要求全仓包含 Account，否则搜索、修改、测试和排查范围都不包含 `account/`。
- 目录、身份、权限和服务认证的新能力默认走 `console/` Directory Runtime、Platform policy bundle 和 Foundation adapter，不新增依赖独立 Account 的主路径。
- 多仓工作区内操作 git 时，先确认当前模块所属仓库；不要把根仓和模块仓的状态混在一起。
- 根 `.gitignore` 会忽略多数模块目录；根目录 `rg --files` 可能漏掉模块文件。面向模块的搜索优先在目标模块内执行，或使用显式路径。

## Cross-Module Rules

- 模块间禁止直连数据库，必须通过 API、Foundation proxy/adapter 或 tenant-runtime/data-runtime 集成。契约见 `docs/MODULE_CONTRACTS.md`。
- 跨模块稳定标识：`uid`（用户）、`dept_code`（部门）、`project_code`（项目）、`uuid`（文档）、`biz_id`（业务对象）。

### 内部服务认证与授权

- 跨应用调用默认采用“调用方 BFF → 目标应用 Service API → 目标应用自己的 tenant-runtime”路径。业务应用不得直接访问其他应用的 tenant-runtime；确需例外时，必须在 `docs/MODULE_CONTRACTS.md` 中说明调用方、目标应用、capability、安全原因和幂等规则。
- 每个信任边界分别使用 Console 签发的短期 `token_use=service` JWT。应用间 Token 的 `aud` 是目标应用；目标应用访问自身 tenant-runtime 时使用自己的运行身份，不得将上游调用方 Token 直接转发给 runtime。
- `source_app` 永远表示调用方，`target_app` 永远表示目标应用或目标 runtime adapter；不得继续用同一个 `appCode` 同时表达来源和目标。Legacy `hzy.appCode` 只按来源应用语义解释。
- 新增或改造的 Service Token 必须校验 Console JWKS、`iss`、`aud`、`token_use=service`、`source_app`、`target_app`、tenant、deployment、有效期和撤销状态；生产环境不得接受缺失关键 claim 的 Token。
- 跨应用 capability 统一使用 `<target-app>:<resource>:<action>` 格式，全部使用小写和 kebab-case，例如 `finance:invoice-request:create`。不得新增 `assets.read`、`finance.contracts.read` 等点号格式，也不得将 `tenant-runtime`、`data-runtime` 等传输层名称编码进业务 capability。
- `app:read`、`app:write` 等应用级宽 scope 仅作为存量兼容能力；新增跨应用写操作必须定义具体业务 capability，修改存量链路时应优先收敛到细粒度 capability。
- 目标应用的 manifest/API 契约负责定义“有哪些 capability”，Console service grant 负责定义“哪个调用方拥有哪些 capability”，目标接口只声明“本接口要求哪个 capability”。SQL Seed 只能用于初始化授权记录，不得成为第二套授权事实源。
- 不得在 Console grant、业务代码 `allowedApps`、SQL Seed 和文档中重复维护同一调用方白名单。`allowedApps` 仅允许用于少数明确记录的高风险接口，且必须有对应契约测试。
- 所有 `/api/v1/service/**` 接口必须在使用本应用 tenant-runtime 凭证、执行代理或调用领域命令之前，校验入站 Token 的具体 capability。仅验证 Token 有效或 `aud` 正确，不足以授权业务操作。
- Service API 不得利用目标应用自身的高权限 runtime Token，为缺少入站 capability 的调用方完成操作，避免产生 confused-deputy 或代理权限放大问题。
- 跨应用 Token 获取、Service API 调用、tenant-runtime 调用、tenant/deployment 上下文传播、Gateway 校验、actor 委托、错误映射和 tracing 必须使用 Foundation 统一 helper。不得在各业务模块重复手工拼装认证 Header、runtime Header、Token 缓存或重试逻辑；缺少能力时先补 Foundation。
- 所有跨应用写操作必须携带 `Idempotency-Key` 或由稳定业务键派生等效幂等键，目标应用必须实现服务端幂等；GET 和其他读取接口不得产生业务副作用。
- 高价值操作中的用户 actor 必须来自已验证用户会话，并通过签名委托声明、Token Exchange 或受信 Gateway 上下文绑定。不得仅信任浏览器或普通请求 Header 传入的 `x-hzy-actor-uid`。
- Tenant Gateway 上下文必须同时验证 Gateway 身份和凭证，例如内部 Token、签名或 mTLS；不得仅凭 `x-hzy-gateway=tenant-gateway` 信任 tenant、deployment、runtime URL 或 runtime Token。
- `auth=disabled` 只能用于显式本地开发；静态 runtime Token 只能用于明确配置的离线兼容部署。生产、共享测试和托管云环境不得默认关闭认证，也不得退回共享 API Key 或“内网默认可信”模式。
- 未被 Token 签发流程和目标端校验逻辑实际执行的 `scope_json.endpoints` 不得作为安全边界。新授权优先通过可执行的细粒度 capability 表达。
- 认证失败统一返回 `401`，身份已验证但 capability、来源应用、租户或部署不匹配时返回 `403`；不得将下游 `401/403` 一律转换为 `502`，也不得向调用方泄露内部地址、Token 或敏感诊断信息。
- 新增或修改跨应用调用时，必须同步更新 `docs/MODULE_CONTRACTS.md`、目标应用 manifest/API 文档、Console grant 初始化或安装逻辑，并增加至少覆盖正确调用、缺 capability、错 audience、错来源应用、错 tenant/deployment、Token 过期和写请求幂等重放的契约测试。

## Commands

每个模块独立运行，通常先进入对应目录或使用 `pnpm --dir <module>`：

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm preview
```

Codocs 构建需要额外内存：

```bash
NODE_OPTIONS='--max-old-space-size=4096' nuxt build --dotenv .env
```

Collab Runtime 默认由 Console 内嵌启动；只有需要独立扩容、隔离故障或调试 standalone 时才单独进入 `collab/` 运行。

默认排除 legacy Account 的根级验证命令：

```bash
pnpm lint:active
pnpm typecheck:active
pnpm test:active
```

只有明确需要包含 `account/` 时才使用 `pnpm lint:all` / `pnpm typecheck:all`。

## Architecture

通用业务模块结构：

```text
<module>/
├── app/          # components, composables, layouts, pages, stores, types
├── server/       # Nitro API and server utils
├── docs/         # schema and API/design docs
├── nuxt.config.ts
└── CLAUDE.md     # module-specific guidance
```

业务模块通过 `nuxt.config.ts` 的 `extends` 引用 `foundation/`。涉及认证、目录、权限、审批、共享组件、server utils，或准备新增可能复用的能力时，先按需查 `docs/FOUNDATION_CAPABILITIES.md`；简单局部改动不需要预读该文档。

数据库访问规则由模块决定：尚未迁入 tenant-runtime 的模块使用本地 `server/utils/db.ts`，已迁入 tenant-runtime 的模块不得恢复本地 DB 主路径。以当前模块 `CLAUDE.md` 为准。

## Environment

- 开发使用 `.env.dev`，生产使用 `.env`。
- Console 是企业端运行配置事实源，负责 platform runtime、目录、认证、系统设置、集成配置和凭证解析。
- 业务应用优先只保留自身必要运行参数，例如 `HZY_APP_CODE`、base URL、deployment profile，以及本应用专属迁移源配置。
- `ALIYUN_OSS_*`、`GITLAB_*`、`WECOM_*`、`DINGTALK_*`、`AI_*` 等集成 secret 应进入 Console `integration-config + credential-vault`，业务应用通过 Foundation adapter 按 `integrationCode` 消费。
- 详细收敛方案按需查 `docs/ENV_SIMPLIFICATION_PLAN.md`。

## Frontend

前端使用 Nuxt UI V4。优先参考项目现有 Nuxt UI V4 写法；当组件 API 不确定、引入新组件或报错时，再查官方文档或 Nuxt UI 工具。颜色使用 Nuxt UI 语义色，如 `primary`、`success`、`warning`、`error`、`info`、`gray`，不要使用 `red`、`green`、`blue` 这类原色名。

非平凡前端改动默认遵循以下流程：

- 先阅读根 `CLAUDE.md` 和当前模块 `CLAUDE.md`，确认模块边界、现有组件模式和运行命令。
- 使用 Nuxt UI V4 与项目现有组件/布局模式；不确定组件 API 时先查官方文档或 Nuxt UI 工具。
- 实现前先给出设计判断，明确页面信息层级、交互状态、响应式约束和需要复用的本地模式。
- 实现后使用真实浏览器检查 `1440px` 和 `390px` 视口，修复文字溢出、元素重叠、间距失衡、视觉层级问题和控制台错误。
- 最后说明改动文件、验证方式，以及未执行验证的原因。

## Documentation Sync

代码变更涉及以下内容时同步更新文档：

- 模块间调用关系变更：更新 `docs/MODULE_CONTRACTS.md` 和相关模块 `CLAUDE.md`。
- 整体架构变更：更新根 `CLAUDE.md` 和 `docs/MODULE_CONTRACTS.md`。
- 数据库 Schema 变更：更新对应模块 `docs/*_schema.sql`。
- API 接口变更：更新对应模块 API_SPEC 文档。
- Foundation 能力新增或变更：更新 `docs/FOUNDATION_CAPABILITIES.md`。

## Execution Style

- 小步、聚焦、可验证；每个改动都应能追溯到用户请求。
- 优先复用现有模式和 helper，避免为单次使用新增抽象。
- 只问阻塞问题；能从代码或文档确认的先自己查。
- 不改无关代码，不清理非本次改动造成的历史问题。
- 测试按风险选择：关键路径、跨模块契约、schema/API 变更要跑更强验证；文档或窄小改动可说明未跑测试。

## Git

提交信息必须遵照 `docs/Git提交规范指南.md`。
