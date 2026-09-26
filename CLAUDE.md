# CLAUDE.md

This file provides repository-level guidance for agents working in this workspace, including Codex / GPT-6 Astra and Claude Code. Keep detailed runbooks, history, and design notes in `docs/`.

When task routing is unclear, consult [`docs/START_HERE.md`](./docs/START_HERE.md); use [`docs/MODULE_INDEX.md`](./docs/MODULE_INDEX.md) to locate an unfamiliar module or command. Known, focused tasks do not require loading both indexes.

## Project Snapshot

**汇智云（huizhi-yun）** 是面向中小型企业的软件企业作业与管理 SaaS。工作区是单一 Git monorepo，多个 Nuxt 4 模块、共享层和 Go/Node runtime 通过根 `pnpm-workspace.yaml`、统一 CI 与组件级发布 Tag 协作。

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
- 所有模块共享根 Git 状态和分支；模块级检查仍使用显式目录或 `pnpm --dir <module>`，避免扩大无关改动。
- 组件发布 Tag 使用 `<component>/vX.Y.Z`；应用的 `app.manifest.json` 保持在组件目录内，由 Platform 的 `manifest_path/release_tag_prefix` 配置识别。

## Cross-Module Rules

- 当前未迁移的独立应用间禁止直连数据库，必须通过 API、Foundation proxy/adapter 或 tenant-runtime/data-runtime 集成。契约见 `docs/MODULE_CONTRACTS.md`。
- 跨模块稳定标识：`uid`（用户）、`dept_code`（部门）、`project_code`（项目）、`uuid`（文档）、`biz_id`（业务对象）。
- 已确认的整合方向见 [ADR-018](./docs/ADR-018-Unified-Enterprise-Application-and-Data.md) 与 [实施 TODO](./docs/Unified-Enterprise-Implementation-Plan.md)：统一企业应用、每租户业务库、全量功能交付；已按专项合同迁移的 Runtime 业务域允许受控跨域查询、内部领域服务和共享事务。Nuxt/BFF 不获得数据库凭据，人员权限与租户隔离保留。方案文档不代表现有路径已切换，未迁移路径继续遵守当前合同。
- Codocs 长期保留文档领域职责，不以保留完整独立企业前端为目标：普通页面和自有编辑工作区逐步原生组合到 Enterprise；Collab、文件处理与明确需要隔离的预览可保留专用服务。旧页面/iframe 仅作有退出条件的兼容，不能因页面接入就提前停旧消费者或宣称协作/写入验收通过。

### 角色授权模型

- 普通运行模式必须合并主体的全部有效授权，不得要求普通用户通过切换企业角色获得日常权限。
- 系统管理员正常运行时同样使用合并权限；角色切换仅作为显式授权模拟能力，不得根据 `system_admin` 角色自动进入单角色模式。
- 角色模拟必须由服务端会话控制，并要求 `platform:authorization:simulate-role` 或 `platform:authorization:simulate-user`；不得信任客户端 Cookie、Query 或 Header 直接指定模拟角色。
- 模拟模式下只计算被模拟角色或目标用户权限，不得隐式继承真实操作者的管理员权限；控制面仅保留查看和退出模拟的能力。
- 应用角色定义“能做什么”，企业角色组合应用角色，数据范围定义“能对哪些对象做”；具体部门、项目、客户或对象不得编码进角色名称。
- 授权判断必须保留角色、权限、数据范围、来源和有效期的同一授权上下文；不得分别合并全部权限和全部 scope 后任意拼接。
- 租户自定义企业角色只要 `app_code IS NULL`、`status=active`、`is_assignable=true` 就必须能够生效；角色来源不得作为运行时有效性的限制条件。
- `admin` 默认只满足同一资源的 `view/edit/admin`，`edit` 只默认蕴含 `view`；`approve`、`confirm`、`export`、`close`、`deploy` 等敏感动作必须显式授权。确需 `admin -> *` 的应用必须在 manifest / Policy Bundle 动作蕴含表中明示并有契约测试。
- Manifest 是应用资源、动作和应用角色的唯一技术事实源。业务代码、路由规则、平台角色和测试不得维护相互独立的权限清单。
- 所有服务端权限判断必须使用 Foundation 统一授权 helper；业务应用不得复制完整 Policy Bundle 解析、动作蕴含或角色选择算法。
- 部门、职位和模板授权只有在运行时继承链和对象范围真实执行后才可在管理界面标记为生效。
- 列表、详情、写入、批量操作和导出必须分别执行服务端数据范围检查；前端菜单和按钮隐藏不能作为安全边界。
- Workflow 审批任务、Aims 项目成员、Altoc 商机负责人、Codocs 文档分享、Assets 资产使用人等对象关系应优先使用动态关系授权，不得膨胀为全局静态角色。
- 高风险职责应与主岗位拆分，并对自审批、采购经办与审批、付款制单与确认、生产发布等场景实施职责冲突校验。
- 新增或修改角色授权逻辑时，复用、扩展或补充覆盖受影响行为的测试；共享授权核心或信任边界变化时，执行角色合并、模拟隔离、自定义角色、动作蕴含、数据范围和过期授权的完整回归矩阵。已有测试充分覆盖时无需重复新增。

### 内部服务认证与授权

- 未迁移的独立应用调用默认采用“调用方 BFF → 目标应用 Service API → 目标应用自己的 tenant-runtime”路径。业务应用不得直接访问其他应用的 tenant-runtime；ADR-018 内部整合及其他例外须在 `docs/MODULE_CONTRACTS.md` 中明确适用路径、业务权限、身份边界和幂等规则，不能通过放宽既有鉴权替代迁移。
- 每个信任边界分别使用 Console 签发的短期 `token_use=service` JWT。应用间 Token 的 `aud` 是目标应用；目标应用访问自身 tenant-runtime 时使用自己的运行身份，不得将上游调用方 Token 直接转发给 runtime。
- `source_app` 永远表示调用方，`target_app` 永远表示目标应用或目标 runtime adapter；不得继续用同一个 `appCode` 同时表达来源和目标。Legacy `hzy.appCode` 只按来源应用语义解释。
- 新增或改造的 Service Token 必须校验 Console JWKS、`iss`、`aud`、`token_use=service`、`source_app`、`target_app`、tenant、deployment、有效期和撤销状态；生产环境不得接受缺失关键 claim 的 Token。
- 跨应用 capability 统一使用 `<target-app>:<resource>:<action>` 格式，全部使用小写和 kebab-case，例如 `finance:invoice-request:create`。不得新增 `assets.read`、`finance.contracts.read` 等点号格式，也不得将 `tenant-runtime`、`data-runtime` 等传输层名称编码进业务 capability。
- `app:read`、`app:write` 等应用级宽 scope 仅作为存量兼容能力；新增跨应用写操作必须定义具体业务 capability，修改存量链路时应优先收敛到细粒度 capability。
- 目标应用的 manifest/API 契约负责定义“有哪些 capability”，Console service grant 负责定义“哪个调用方拥有哪些 capability”，目标接口只声明“本接口要求哪个 capability”。SQL Seed 只能用于初始化授权记录，不得成为第二套授权事实源。
- Service Token 请求中的每一个 scope 都必须有独立、精确且 active 的 Console grant；`<app>.write` 不蕴含 `<app>:integration_operation:execute`。运行任务的单数 `integration_operation:execute` 与管理界面的复数 `integration_operations:view/replay` 是不同能力，不得互相替代或用宽 scope 绕过。
- 新增 scheduled worker、outbox drain 或可靠集成任务的代码交付必须包含 worker 调用代码、Data Runtime 精确 scope 校验、`data-runtime` 与 `tenant-runtime` 双 audience 的 Console grant seed/verify 和契约测试；在目标环境启用前，还必须完成该环境的授权核验。缺少环境访问时可以交付代码并明确待核验项，不得宣称已启用或生产可用。生产出现 `insufficient_scope` / `console_service_token_grant_inactive` 时必须修复 grant 漂移，不得删除精确 scope、吞掉 403 或退回静态 Token。
- 托管云业务 Worker 访问 Console token/runtime/service API 必须通过 `HZY_CONSOLE_SERVICE -> hzy-console-prod` Service Binding；所有业务模块的 Cloudflare renderer 都必须由根级 `validate:business-cloudflare` 统一校验。Service Binding 请求必须移除租户网关的 `/console` 前缀，不得经租户公网地址形成跨 Worker 自等待。
- 托管云业务 Worker 读取普通权限快照、scoped authorization 和实例冲突解释时同样必须复用 Foundation 的 Console Service Binding 请求 helper，不得以普通 `$fetch` / `fetch` 经公网调用 Console。Console 授权依赖不可用必须保留为 `503`，不得在业务应用 `checkPermission` 中吞掉并伪装成用户缺权的 `403`。
- 托管云跨 Worker 直达目标应用时，必须通过 Foundation 受信 route helper 原子改写 `x-hzy-app-code`、`x-hzy-deployment` 和 `x-forwarded-prefix`；只改目标 app 而保留来源 deployment 会被精确 runtime-client 绑定拒绝。涉及目标路由或上下文传播的代理层改动，复用或补充契约测试，同时断言这三个目标上下文字段。
- 发布涉及服务调用、scope、grant、Service Binding 或目标环境变化时，在目标租户执行受影响调用方的 Console grant verify，并用实际 service client 对其全部组合 scope 做令牌签发探测；同环境、同配置且仍有效的验证证据可复用。新环境、首次启用或缺少适用证据时必须完成核验；其他发布验证本次受影响路径。只验证 SQL 行存在、宽 scope 可签发或浏览器页面可打开都不足以证明 worker 授权完成。
- 不得在 Console grant、业务代码 `allowedApps`、SQL Seed 和文档中重复维护同一调用方白名单。`allowedApps` 仅允许用于少数明确记录的高风险接口，且必须有对应契约测试。
- 所有 `/api/v1/service/**` 接口必须在使用本应用 tenant-runtime 凭证、执行代理或调用领域命令之前，校验入站 Token 的具体 capability。仅验证 Token 有效或 `aud` 正确，不足以授权业务操作。
- Service API 不得利用目标应用自身的高权限 runtime Token，为缺少入站 capability 的调用方完成操作，避免产生 confused-deputy 或代理权限放大问题。
- 跨应用 Token 获取、Service API 调用、tenant-runtime 调用、tenant/deployment 上下文传播、Gateway 校验、actor 委托、错误映射和 tracing 必须使用 Foundation 统一 helper。不得在各业务模块重复手工拼装认证 Header、runtime Header、Token 缓存或重试逻辑；缺少能力时先补 Foundation。
- 所有跨应用写操作必须携带 `Idempotency-Key` 或由稳定业务键派生等效幂等键，目标应用必须实现服务端幂等；GET 和其他读取接口不得产生业务副作用。
- 将已上线 UI 的数据路径迁入 tenant-runtime 时，必须按实际页面盘点并验证 list/detail/create/update/delete 等可达动作；`*_contract_required` 的失败关闭只能作为安全过渡，不能在入口仍可操作时作为生产完成状态。专用范围合同未落地时必须同步隐藏或禁用入口并给出明确状态，或者在发布前补齐合同和端到端验收。
- tenant-runtime 为存量对象补范围合同时，父子关系和对象归属必须按该对象类型的规范命名空间判断，并用真实存量行做回归：私人对象可绑定 owner，部门对象应绑定部门，项目对象应绑定项目。仅用于记录创建人、迁移来源或审计的 legacy 字段不得被误当成范围维度，造成同一规范范围内的存量对象无法继续写入。
- 高价值操作中的用户 actor 必须来自已验证用户会话，并通过签名委托声明、Token Exchange 或受信 Gateway 上下文绑定。不得仅信任浏览器或普通请求 Header 传入的 `x-hzy-actor-uid`。
- Tenant Gateway 上下文必须同时验证 Gateway 身份和凭证，例如内部 Token、签名或 mTLS；不得仅凭 `x-hzy-gateway=tenant-gateway` 信任 tenant、deployment、runtime URL 或 runtime Token。
- `auth=disabled` 只能用于显式本地开发；静态 runtime Token 只能用于明确配置的离线兼容部署。生产、共享测试和托管云环境不得默认关闭认证，也不得退回共享 API Key 或“内网默认可信”模式。
- 未被 Token 签发流程和目标端校验逻辑实际执行的 `scope_json.endpoints` 不得作为安全边界。新授权优先通过可执行的细粒度 capability 表达。
- 认证失败统一返回 `401`，身份已验证但 capability、来源应用、租户或部署不匹配时返回 `403`；不得将下游 `401/403` 一律转换为 `502`，也不得向调用方泄露内部地址、Token 或敏感诊断信息。
- 新增或修改跨应用调用时，按实际契约变化更新受影响的 `docs/MODULE_CONTRACTS.md`、目标应用 manifest/API 文档及 Console grant 初始化或安装逻辑，事实未变的制品无需修改。复用、扩展或补充覆盖受影响行为的契约测试；新增调用、共享授权核心或信任边界变化时，执行正确调用、缺 capability、错 audience、错来源应用、错 tenant/deployment、Token 过期及写请求幂等重放（写操作适用）的完整回归矩阵。

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

前端使用 Nuxt UI V4。优先参考项目现有 Nuxt UI V4 写法；当组件 API 不确定、引入新组件或报错时，再查官方文档或 Nuxt UI 工具。颜色使用 Nuxt UI 语义色：`primary`、`secondary`、`success`、`warning`、`error`、`info`、`neutral`，不要使用 `red`、`green`、`blue` 这类原色名，也不要用已废弃的 `gray`（v4 是 `neutral`）。

平台级 UI/UX 约束（视觉基础、布局导航、页面范式、组件选用、反馈文案、格式化、响应式）见 `docs/UI_UX_SPEC.md`。

非平凡前端改动默认遵循以下流程：

- 复用已读取的根与模块指导；缺少相关上下文时再读取，确认模块边界、现有组件模式和运行命令。
- 使用 Nuxt UI V4 与项目现有组件/布局模式；不确定组件 API 时，按问题选择本地生成类型、官方文档或 Nuxt UI 工具。
- 涉及页面结构或交互设计时，简要说明信息层级、关键状态、响应式约束和复用模式，然后继续实现；已有明确设计或仅修组件 API 时无需额外设计提案。说明设计判断本身不是等待批准的关卡。
- 页面布局、导航或响应式行为变化时，使用真实浏览器检查桌面和移动视口（默认 `1440px` 和 `390px`）；仅组件逻辑变化时验证受影响交互，无需机械重复双视口检查。修复本次引入或阻碍本次验收的文字溢出、元素重叠、间距失衡、视觉层级问题和控制台错误；其他历史问题记录即可。
- 浏览器或运行环境不可用时，先排查可修复的启动问题并使用其他可用验证；最后说明已验证的行为、未验证的部分和原因。必需的视觉验收未完成时不得声称视觉验证通过，但继续完成不依赖该环境的实现工作。

### 列表页与交互规范

源自 2026-07 五应用 UI/UX 评审（详见 `docs/UI_UX_REVIEW_2026-07-10.md`）的强制约定，完整规范见 `docs/UI_UX_SPEC.md`。本节的确认指产品内用户交互，不是代理向开发者申请批准：

标准页面结构、组合式函数示例与响应式验收清单见 `docs/STANDARD_LIST_PAGE.md`。

必须做：

- 删除、禁用、覆盖等危险操作确认统一使用 Foundation `useConfirm()`（不可逆删除用 `tone: 'danger'`，可恢复操作用 `tone: 'warning'`），文案包含对象名和后果说明。
- 服务端搜索统一使用 Foundation `useDebouncedSearch()`：输入框绑定 `search`，请求 query 使用 `debounced`，回车绑定 `flush`；有分页时通过 `onChange` 重置页码。
- 服务端列表必须真实分页：`page`/`pageSize` 进请求参数，`UPagination`（`v-model:page` + `:items-per-page` + `:total`）配「共 N 条」；任何筛选变化都要重置页码到第 1 页。
- 列表 `UTable` 必传 `:loading`；空表通过 `#empty` slot 使用 Foundation `CommonEmptyState`（图标 + 说明，首屏场景加下一步 CTA）。
- 优先复用 Foundation 现有组件与 composable（`ConfirmDialog`、`CommonEmptyState`、`AppLauncher`、`UserMenu`、`DeptTreeSelector` 等）。缺失能力属于共享职责或统一安全边界时，先补 Foundation；单模块业务专用逻辑留在模块内，不为单次使用强建通用框架。尚未接入 Foundation 的模块遵循其明确的迁移边界。
- 跨应用前端切换由 Console `/shell/{appCode}` 企业 Shell 与 Foundation `useApplicationShell()` 统一处理；业务模块不得自建 iframe 总入口、复制 AppRail/AppLauncher 或信任未校验的 postMessage。当前用户应用目录中同源、非原生入口的业务应用统一进入 Shell；跨源部署保持直接 URL。ADR-019 的物理 Enterprise Host 自带唯一布局，属于原生入口，不再次包入 Console Shell；逻辑业务模块不因此全面豁免，试点网关仅对已注册迁移页面受控转换旧 Shell 链接。
- 创建/编辑入口按复杂度选择：不超过 6 个独立字段的轻量对象使用 `UModal` 或 `USlideover`，7–8 个仍为单步录入的对象优先使用宽 Slideover；存在步骤依赖、子表明细、实时汇总或审批预检的复杂对象使用独立页面。列表结果区内不得展开长期占位的创建表单。

禁止做：

- 使用浏览器原生 `confirm` / `alert` / `prompt`。
- 把搜索 ref 直接放进响应式 `useFetch` query 或 watch 触发请求（会逐字符发请求）；也不要给纯客户端过滤的小字典列表加防抖或分页。
- 列表无分页、一次拉取大 `page_size`（如 500），或不传分页参数依赖服务端默认 20 条却不提供翻页控件。
- 从 Foundation 复制组件副本到业务模块内维护。
- 给存在客户端 `reduce()` 合计的列表直接加服务端分页（当页数据会算错合计）；需先让服务端返回合计再分页。

## Documentation Sync

代码变更涉及以下内容时同步更新文档：

- 模块间调用关系变更：更新 `docs/MODULE_CONTRACTS.md` 和相关模块 `CLAUDE.md`。
- 整体架构变更：更新根 `CLAUDE.md` 和 `docs/MODULE_CONTRACTS.md`。
- 数据库 Schema 变更：更新对应模块 `docs/*_schema.sql`。
- API 接口变更：更新对应模块 API_SPEC 文档。
- Foundation 能力新增或变更：更新 `docs/FOUNDATION_CAPABILITIES.md`。

## Execution Style

本节维护项目执行与验收约定，按能够独立判断和交付的 GPT-6 Astra 设计。用户要求实现、修复或优化时，完成必要修改、集成和验证；仅要求分析、计划或报告时，以该产物为边界。

- **自主推进。** 常规实现细节自行判断，复用已有答案和同一对象、范围、后果内的授权。先查项目事实，只询问无法查明且实质影响目标、权限或高成本返工的问题；仅依赖答案的工作等待。没有授权的外部动作先完成可审阅准备，再针对该动作询问。保留用户明确的审批点和运行时限制。
- **范围以因果关系判断。** 为达成目标所必需的跨模块 helper、契约、调用方和测试修改属于任务范围，可直接完成；`account/` 等显式排除仍适用。无关历史问题记录即可，不顺带迁移架构或扩大产品需求。遇到他人改动先隔离本次修改；仅有实质冲突且无法安全协调时才询问。
- **验证与风险匹配。** 文档改动检查内容、链接和格式；窄小代码改动运行最相关的检查。关键路径、授权、跨模块契约、schema/API 变更执行上文要求的更强验证；已有测试能够证明不变量时复用或扩展，不机械重复新增测试。检查通过后，只有新改动、失败或未解决的风险才扩大或重跑。
- **修复失败，不移交可自行解决的问题。** 本次修改引入的测试失败、可修复的依赖或启动错误应自行排查修复。缺少某个工具时，先找满足相同要求的可用工具；不能绕过安全边界，也不能把未运行的检查报为通过。
- **如实结束。** 完成表示请求的产物已落地且相关验收有证据。代码完成、验证受限、待批准发布是不同状态，应准确说明，不能统称全部完成。真实阻塞时先完成独立工作，再给出具体阻塞和最小解锁动作；不以笼统的“要我继续吗”移交剩余工作，也不在条件未变时重复无效尝试。
- **Skills 按需叠加。** `hzy-dev-workflow` 负责项目实施索引，`nuxt-ui` 补充组件知识，可独立使用。常规开发不自动串联 gstack 的完整评审、QA 或 ship 流程；正式 QA、设计评审、计划评审和发布按用户要求使用可用的对应工作流。已加载的上下文、用户决定和验证证据可以复用。
- **有界推进。** 计划与 TODO 本身是工作索引，以用户当前请求及仍适用的既有授权确定实施范围，不重新询问已授权事项。用户明确暂停原任务处理新事项时，先完成新事项，不因历史摘要或后台代理结果继续扩大改动；同步暂停相关后台代理。重试应有新的诊断依据；外部条件未变时停止重复尝试，报告具体阻塞。
- **批准只针对具体动作。** 已授权范围内的可逆本地修改、隔离测试和相关修复直接执行。确认测试仅使用可丢弃夹具且无生产访问后，可自行运行和清理；不能仅凭测试名称假定隔离。已有同环境、同对象授权不重复询问；测试部署授权不延伸为生产发布授权。
- **流程冲突就地消解。** 模块与 Skills 补充专项知识；过时的流程按当前用户请求和根执行约定处理，保留适用的安全约束，不额外叠加审批流程。

## Git

提交信息必须遵照 `docs/Git提交规范指南.md`。

GitHub 是经过脱敏处理的公开快照镜像，不与 GitLab 原始分支共享提交历史。需要同时提交两端时，先将本地提交推送到 GitLab `origin`，确认本地分支与对应 `origin/<branch>` 一致，再执行 `pnpm sync:github-public-branch --dry-run <branch>` 和 `pnpm sync:github-public-branch <branch>` 发布功能分支；发布 `main` 则使用 `pnpm sync:github-public --dry-run` 和 `pnpm sync:github-public`。脚本会检查 GitLab 同步状态、清除敏感文件并以租约保护 GitHub 分支。不要直接 `git push` 原始提交到 GitHub，也不要手工强推或合并公开快照分支；发布后以脚本输出的远端校验结果为准。
