# Codocs 纳入 Enterprise：迁移边界与任务输入

日期：2026-09-19。依据：用户确认“个人文档先行、部门文档随后；旧 Codocs 项目文档暂不迁移，后续在项目管理实现”，并进一步明确“把整个我的文档一并迁移”。最新范围调整：用户明确允许演示文稿后续迁移；第一批包含除演示文稿外的 `mydocs` 页面树及可达既有操作，不再裁剪为基础文档子集。本文是范围与实施输入；当前 9 个非演示页面、统一工作汇报入口及其 Host/Runtime 合同已经接线并通过非浏览器构建与回归，浏览器页面验收仍按用户要求暂缓，环境安装与发布另行执行。

演示文稿后置包括 `mydocs/slides.vue`、专用编辑/预览/导出、`/api/slides/**` 接线及其验收，本轮只记录待办，不作为当前整合完成的阻塞项。已有通用文档合同中对 slide 类型的兼容代码保留，不因此回滚或删除旧数据。文件柜中既有 PPT/PPTX 文件上传、预览、下载属于文件柜能力，仍在本轮范围内；日志/周报、共享及部门文档安排不变。

唯一进度台账：[统一企业应用实施计划 INT-606](./Unified-Enterprise-Implementation-Plan.md)。本文不另设完成勾选表。

2026-09-19 执行补充：用户要求先完成除页面验证外的整合工作。跳过的是浏览器页面验收，不是页面迁移、接口闭环、权限测试或构建验证；完整交付范围不缩减。逐页源 API 与直接依赖见 [路由盘点](./Codocs-Enterprise-Route-Inventory.md)。候选代码逐批实现，不能把读取入口或路径适配视为整个 mydocs 完成。

## 1. 固定边界

- Enterprise 提供统一 Shell、会话、导航与显式页面/BFF 注册；不 extends Codocs 完整 Nuxt 配置，不自动装载其全局权限中间件、heartbeat、快捷键或后台任务。
- 编辑器复用 `codocs/app/pages/documents/[uuid].vue` 及现有 Milkdown 组件，以 Enterprise 原生文档工作区为目标，不重写 Y.js 或强行合并 Collab。原独立页面、受控 iframe 和本地独立编辑器进程仅作为未迁能力的兼容/回退路径；保留短期协作 token、文档 ACL 与保存/断线恢复规则，正式协作通道未接通时不得把共享编辑标为完成。
- 暂不搬 `hzy_codocs`、正文、附件或对象路径；保留 UUID 和既有数据。Nuxt/BFF 不获得 DB 凭据；同一文档仍由同一 Runtime 文档领域维护，不能复制一套写入实现。
- 目标元数据路径为 Host → Runtime 文档领域，不新增 Enterprise → Aims → Codocs 多跳链。直接接入是待实现合同，现有 Enterprise 注册和 scope 不自动涵盖 Codocs；须明确物理 enterprise 身份、逻辑 codocs 领域、数据库绑定和具体 capability 后才能启用。
- 不因统一应用放宽 owner、分享、部门或发布权限；业务关联不是授权。保留 Console/Runtime 的既有策略新鲜度要求，不将此前项目链的超时绕过作为接入方案。
- 旧 Codocs 项目页面不注册进 Host；旧数据、UUID、链接及合法引用保留，后续由项目管理专项决定接续方式。本轮不再推进此前项目文档候选，不发布生产、不复制生产文档。

长期目标不是同时演进两套完整文档前端。普通文档页面和自有编辑工作区统一由 Host 组合；需要独立运行的协作、转换或安全隔离能力以专用服务/嵌入边界登记。旧 Codocs 前端仅在旧链接、后置演示、项目页面等实际消费者仍存在时维护必要安全兼容；清退须逐项验证替代入口、功能/失败恢复、消费者归零和回退，不以删除 Worker 数量代替业务验收。

## 2. 页面与动作分批

| 批次 | 源页面/能力 | 迁移边界 |
| --- | --- | --- |
| 第一批：我的文档（演示后置） | `codocs/app/pages/mydocs/index.vue`、`favorites.vue`、`recently.vue`、`recycle.vue` | 私人文件夹与文档列表、创建、上传、预览/打开编辑器、重命名、移动、收藏、最近访问、下载、软删除及恢复；分享入口复用现有能力，包含权限授予和撤回验证 |
| 同属第一批 | `mydocs/cabinet.vue`、`shared.vue` | 文件柜上传/预览/下载/删除/转文档，共享发现、移交及页面实际可达的发文/收发/盖章操作；外部依赖必须按现有合同接通，不因依赖复杂排除 |
| 同属第一批 | `mydocs/journal.vue`、`worklogs.vue`、`weekly-reports.vue` | 日志/工作日志/个人周报的创建、提交、修订与关联入口；包含未列入菜单但可达的兼容页面 |
| 后续演示批次（用户明确后置） | `mydocs/slides.vue` 与 `/api/slides/**` | 演示文稿创建/编辑/预览/导出/删除及专用依赖，另排迁移和验收；保留原功能、数据和已有兼容代码 |
| 部门基础闭环 | `departments/index.vue`、`departments/cabinet.vue` | 复用首批基础组件，补齐部门目录、对象范围、跨部门分享、移动/恢复归属；发布审批等外部副作用另列子批次 |
| 不主动扩大 | 独立公司管理页面、GitLab 同步管理等不属于 mydocs 的页面树 | 不迁无关管理页面，但必须承接 mydocs 中实际可达且既有的动作/依赖，不能用“后续迁移”作为删减这些动作的理由 |
| 项目管理阶段 | 旧 Codocs 项目文档 | 不迁旧项目页面；由项目工作台专项实现 |

`departments/knowledge.vue` 当前是 TODO 空列表，不能作为已存在完整功能迁入或计入验收。

第一批内部可以按页面/动作拆分开发和分配代理，但交付、验收范围是“整个我的文档”。迁移期间保留旧入口用于兼容或回退，不以跳回旧个人页面替代迁移完成。既有运行依赖确实未配置时保留真实状态，不将未实现的接线伪装为环境未配置。

### 菜单归位与实施顺序（2026-09-19 调整）

“整个我的文档”定义源功能的交付范围，不要求在 Enterprise 中原样保留全部菜单位置。

| 功能 | 目标主入口 | 交付批次 |
| --- | --- | --- |
| 私人文档、文件柜、共享、最近/收藏/回收站 | 文档 → 我的文档 | 第一批，保留全部既有动作 |
| 演示文稿 | 文档 → 我的文档（后续确认入口） | 后续演示批次，本轮仅记录 |
| 工作日志、个人周报、历史汇报 | 工作台 → 我的工作 → 工作汇报；页内分“工作日志 / 个人周报” | 仍属第一批，不因菜单归位后置 |
| 部门/成员汇报与提交情况 | 工作台 → 团队管理 → 团队汇报 | 后续部门批次；提醒等新增能力另行明确，不扩大首批 |
| 项目整体进展、风险和计划周报 | 项目工作台 → 团队与投入 → 项目周报 | 后续项目管理阶段，不迁旧项目页面 |

上述为目标菜单语义，不代表已注册路由；实现时须对照现有导航合同，将“我的工作 / 团队管理”映射到现有工作台分组，不能因此无审阅地重构全站导航。

- 我的文档中的日志/周报仅保留指向同一工作汇报页面的兼容入口，旧 URL 也映射到对应页签与记录；不复制页面、写入逻辑或权限算法。
- `journal.vue` 当前包含日志与周报，先核对动作再映射，不能仅凭名称当作私人日记；若确有独立私人笔记语义，保留在我的文档且不自动纳入团队可见范围。
- 菜单归位不变更现有数据库、Runtime 领域、编辑器、正文版本与协作的归属。个人周报与项目周报是不同业务对象，不合并表；工作汇报也不替代工时填报，任务/工时关联按现有能力复用。
- 下一步先固定逐动作 API/capability 与主路由、兼容路由对照，再由 Luna 承接窄范围注册和测试；主代理负责权限与集成。首批内部先打通文档基础及编辑器，再完成工作汇报和共享副作用，最后统一验收；演示按用户最新决定另排批次，其余范围不变。
- 验收补充：新旧入口打开同一记录和页签，创建/提交/修订不产生重复数据；个人与团队读取范围分别验证，改菜单不得增加主管或跨部门的可见权限。

## 3. 接入前必须处理的耦合

1. **页面请求路径**：原页面既有 `apiFetch('/api/...')` 也有 `$fetch('/api/...')`；须逐动作适配 Host 路径，不能仅改菜单。Gateway 按已验收路由切换，不能将整个 `/codocs/*` 指向 Host 导致旧编辑器和未迁页面失效。
2. **会话与组件作用域**：显式复用或适配 `useAuth`、`usePermissions`、预览/下载、回收站、目录树、移动/分享 Modal；不复制另一套授权算法。页面缓存键包含租户/环境/主体/范围，清理旧的全局个人缓存键。
3. **目录接口**：Codocs 调用方存在 `/api/account/user-departments`、`/api/account/department-members` 等 legacy 路径。仅在迁入调用方改用现有 Console Directory/Foundation 能力，不改造或新增对独立 `account/` 的依赖。
4. **Runtime 用户范围**：私人 owner 取已验证 actor；请求中的 owner、部门、文档 UUID 或恢复目的地只是待校验输入。列表/计数/分页与详情、下载、分享、删除、恢复分别校验，不用前端过滤代替后端范围。
5. **存储与写入一致性**：复用存储 adapter 与稳定 UUID/幂等检查。数据库与 OSS 不声明为同一事务；保留失败重试、重放不覆盖和明确失败状态。老编辑器和新 Host 不各自成为不同的正文权威写入方。
6. **注册与真实就绪**：新增 Codocs layer 显式入口，接入 `enterprise/composition/registry.mjs`；辅助导航已有 `documents/space`。Host 路由从 `enterprise/server/routes` 派生 API readiness，不手写第二份清单，不用占位 API 对外宣称可用。

## 4. 人员分工与交接规则

主代理负责范围、身份/权限、Runtime/BFF 合同、共享文件、集成审阅和最终验收。GPT-5.6 Luna 承接边界明确的小任务：页面/API 对照、测试盘点、窄范围注册与文档更新；后续机械改动须在主代理固定合同和文件所有权后派发。

每个子任务只修改明确分配的文件，复用当前工作树，不回滚他人改动。输出变更路径、验证命令/结果和未完成项。默认不启动完整历史上下文、不重复全仓盘点、不让多个代理同时修改 Foundation/Runtime 安全边界，也不授权子代理自行部署、迁移数据或更改 grants。

本轮两个 Luna 任务分别完成 UI/API 依赖盘点和测试/注册模式盘点，并各自更新 Codocs、Enterprise 模块指南。用户扩大为整个 mydocs 后，两位代理已追加盘点全部 10 个页面与日志/周报/演示/共享副作用的依赖及测试输入；完整的 METHOD + API + capability + runtime 合同对照仍由下一步固定，以下不代表已运行新迁移的验收。

补充依赖：日志/周报使用 `/api/worklogs/*`、`/api/personal-weekly-reports/*` 与文档编辑器；演示使用 `/api/slides/{content,preview,export}` 与文件夹/文档接口。共享页相关发布动作依赖 Workflow 审批状态、receipt checkpoint，归档/盖章/发送/接收依赖 Runtime 专用合同及 OSS/通知编排。不得仅靠注册页面判断已具备这些能力。

## 5. 复用测试与验收门槛

- Codocs：`documentReadScope.test.ts`、`documentShareVersionAuthorization.test.ts`、`documentWriteActorBinding.test.ts`、`documentAccessAuthorization.test.ts`、`departmentDocumentsServiceContract.test.ts`、`cabinetReadAuthorization.test.ts`。
- 全量 mydocs 新增测试输入：`documentDownloadUrl.test.ts` 覆盖部分列表下载 URL；`sensitiveRoutePermissions.test.ts` 包含工作日志/周报创建 actor、Slides 内容/预览/导出及柜文件下载授权；`publishRequestWorkflowContract.test.ts`、`publishRequestWorkflowTransport.test.ts` 覆盖发布依赖，Runtime `publish_execution_test.go` 覆盖发布后续动作。尚缺全量个人页面 Host bridge 与逐动作浏览器闭环证据。
- Runtime：`document_lifecycle_test.go`、`document_list_scope_test.go`、`document_queries_test.go`、`document_read_authorization_test.go`、`document_create_transaction_test.go`、`document_share_transaction_test.go`、`document_share_version_authorization_test.go`、`department_document_service_test.go`、`open_folders_test.go`、`cabinet_queries_test.go`、`cabinet_mutations_test.go`。
- Enterprise：复用 `registry.test.mjs`、`business-navigation.test.mjs`、`business-api-readiness.test.mjs` 的模式；项目文档代理测试只能参考测试组织，不能复制其多跳实现作为新架构。
- 补缺口：真实恢复/移动目标范围、Host 身份与 Runtime 文档合同、错用户/租户/部门拒绝、分享撤回立即生效、存储失败与重复提交、页面切换无状态串用。源码断言不能代替请求级和真实数据验证。
- 页面验收（当前用户要求暂缓）：除后置演示外的 mydocs 页面树逐页逐动作验证，包含文件柜、最近/收藏/回收站、共享/移交/发文相关动作、日志/周报；原编辑器保存后回列表能读取最新内容；旧 URL 兼容；桌面 1440px、移动 390px；明确区分空列表、无权、未配置和依赖故障。演示专用验收随其后续批次执行。
- 新路由后运行 `pnpm --dir enterprise generate:api-readiness` 并检查生成差异；具体单测使用对应模块现有脚本或显式 `node --test`/`tsx --test`，Go 按 `go test ./internal/apps/codocs` 等受影响包执行。

完成标准是用户当前范围内“我的文档”（演示文稿后置）的真实闭环，不是新增一个菜单、只迁基础列表、让旧个人页面出现在 iframe 中或让构建通过。2026-09-20 安排：先收口已有 9 页的动作及依赖证据，不重复迁移；个人文档代码验证完成后，可单独准备部门文档/团队汇报代码和环境，不必等待暂缓的浏览器验收，但个人、部门分别记录环境与业务待验项，不能相互替代。独立公司管理、旧项目页面不顺带铺开；其余 mydocs 已有动作所必需的外部依赖仍在第一批范围内。当前工作包与共享生产存储的测试隔离前置见实施台账 §3.1 / INT-606。

2026-09-19 非页面验证收口：Enterprise 显式注册 `/codocs/mydocs` 下 9 个非演示路由，且不加载 Codocs 旧布局、登录、Store 或后台任务；`worklogs`、`weekly-reports` 兼容 URL 与主入口共用 `journal.vue`，周报 URL 自动选择周报页签。菜单为“文档 → 文档空间/文档协作”和“工作台 → 我的工作 → 工作汇报”。个人文档/目录/文件柜、共享、移交、发布执行、日志/周报、正文/版本/批注、回收恢复的 Host 路由均由生成 readiness 覆盖；批注写入已改为数据库事务内持久回执，重复请求不重复创建。Enterprise 生产构建、三端 typecheck、Enterprise/Codocs/Foundation 全量测试及 Runtime Codocs/server/integrationoperation 测试通过。此条不等同于浏览器页面验证、环境部署或生产数据迁移。
