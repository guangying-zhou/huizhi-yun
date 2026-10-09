# PIVR V1.1 落地方案与任务清单

> 依据：《汇智PIVR项目管理生命周期模型说明书V1.1》《汇智PIVR实操指南增补-周期型服务与常设事务V1.0》
>
> 范围：Aims 模块 + data-runtime aims adapter。不涉及 Altoc、Assets、Console 侧改造（超范围事项转报价、SLA 判定回读为后续批次）。

## 0. 批次划分与依赖

| 批次 | 内容 | 依赖 | 可否并行 |
| --- | --- | --- | --- |
| **B1 分类与项目集基础** | `improvement` 下线、新增 `routine`、项目集 `default_category` | 无 | — |
| **B2 服务年度与日常事务字段** | 服务链字段、工作项三个标记、总览页分组 | B1 | 不可 |
| **B3 关期门与服务健康度** | rollover 五项校验、关期确认 UI、健康度看板 | 周期结构须先由 B1.7 对齐；看板依赖 B2 | 校验部分可与 B1/B2 并行 |
| **B4 商机桥接** | 商机 → 售前/销售项目 service endpoint | 无（Aims 侧）；Altoc 侧对接为外部依赖 | 可与 B1–B3 并行 |

**关键顺序**：`default_category` 必须先于 `routine` 可用。否则用户建日常事务项目时需在下拉框手工选“日常事务”，而该下拉框正是我们要收敛的对象。

### 落地状态（2026-09-01）

- B1–B4 代码、DDL、契约与文档已完成。仓库现有 migration 基线为 v5.13，因此原规划的 B2/B3 文件名顺延为 `migration_v5.14_service_year_and_routine.sql`、`migration_v5.15_period_close_gate.sql`；B4 的唯一索引与来源约束单列为 `migration_v5.16_opportunity_project_bridge.sql`。后续验收发现通用立项页仍会阻塞无立项语义的 `routine`，已由 `migration_v5.17_routine_no_initiation.sql` 与应用规则修正；日常事务工作项再由 `migration_v5.18_routine_flat_tasks.sql` 统一为扁平任务，并改用任务看板承载。
- 验收覆盖 Aims lint/typecheck/unit/build、data-runtime 全量 Go 测试，以及真实 Nuxt 组件在 1440px / 390px 下的浏览器夹具回归。手工场景由同路径的 SQLMock、契约测试和浏览器交互等价覆盖，详见各验证项。
- 本清单的“完成”指仓库内实现与验收完成；四份新 migration、Console service grant seed/verify 仍需随目标环境发布流程执行。本轮未部署，也未进行真实 Altoc 联调（Altoc 触发仍是外部依赖）。

### 日常事务无立项补充修正

- [x] `routine` 新建项目直接写入 `lifecycle_status='active'`，生命周期首事件同步记录为 `active`
- [x] 设置页不再为 `routine` 展示立项审批，也不检查立项书或里程碑
- [x] BFF 与 data-runtime 双层拒绝把 `routine` 推入 `approval_pending`
- [x] v5.17 数据修复把存量 `draft` / `approval_pending` 日常事务容器激活，并清理本地审批绑定
- [x] v5.18 数据修复把存量日常事务工作项统一为 `task + matter`，清除里程碑绑定并将 `planning` 归入 `todo`
- [x] 日常事务“工作项”入口复用任务看板；新建事务隐藏类型并由前后端固定为任务
- [x] 前端策略、BFF 路由、runtime 状态与 migration 契约测试覆盖

---

## B1 分类与项目集基础

三项改动都涉及 `category` 枚举，合并为一次 migration 执行。

### B1.1 数据库

- [x] 新建 migration `migration_v4.7_execution_mode.sql`（v4.0–v4.6 已占用；MySQL 8 不支持 `ADD COLUMN IF NOT EXISTS`，改用 information_schema + PREPARE，与 v4.6 同款写法）
- [x] `project_portfolios` 增加 `default_category`（ENUM，可空）、`is_system`（TINYINT，默认 0），加 `idx_portfolio_default_category`
- [x] 回填：`UPDATE project_portfolios SET default_category='product_dev' WHERE is_product_line=1`
- [x] `aims_projects.category` 与 `project_template_sets.category` 枚举增加 `routine`（`improvement` 暂留）
- [x] 预置两个系统项目集：「周期性服务」（`default_category='maintenance'`）、「日常事务」（`default_category='routine'`，`is_system=1`）
- [x] 同步更新 `docs/aims_schema.sql`（第 53、102 行枚举 + portfolio 表定义）
- [x] 执行存量核查：`SELECT ... WHERE category='improvement'` → **空结果**（2026-08-31）。无存量 improvement 项目，入口下线无需数据归位；枚举清理可在 B1.5 完成后另行提交

### B1.2 data-runtime

- [x] `project_templates.go:95` 分类白名单加 `routine`
- [x] `project_templates.go:1020` 模板分支加 `routine`（空模板：无里程碑、无交付物）
- [x] portfolio adapter 支持 `default_category` / `is_system` 读写
- [x] 项目创建校验：所属项目集 `default_category='routine'` 时强制 `category='routine'`，拒绝覆盖
- [x] 项目集删除校验：`is_system=1` 不可删除
- [x] 唯一性校验：`default_category='routine'` 的项目集全局仅允许一个（应用层判断，不用函数索引）

### B1.3 前端 — 类型与配置

- [x] `app/types/aims.ts:17` `ProjectCategory` 增加 `routine`
- [x] `app/schemas/project.ts:10` 校验枚举同步
- [x] `app/utils/projectModuleConfig.ts` 增加 `routine` 默认：`milestones/requirements/releases/environments/service_desk/decomposition` 全 false，仅保留工作项与工时
- [x] `app/config/project.ts:33` 增加 `routine: { label: '日常事务', icon: ... }`
- [x] `app/config/milestone.ts`、`app/config/project-template-defaults.ts` 补 `routine`（不登记即为空）；`deliverable-templates.ts` 本身是 `Partial<Record<...>>` 带 `|| []` 兜底，无需改动

### B1.4 前端 — 分类标签收敛（技术债）

同一 `improvement` 在代码中有「持续改进」「改进优化」「内部改善」「改进」四种标签，说明分类标签缺少单一来源。

- [x] 以 `app/config/project.ts` 的 `label` 为唯一来源，导出 `getProjectCategoryLabel(category)`
- [x] 替换各处硬编码映射：`ProjectCard.vue:28`、`ProjectNavbar.vue:90`、`projects/[id]/index.vue:134`、`projects/index.vue:143`、`embed/project/[bizId].vue:69`、`projectTemplateVersions.ts:70`
- [x] 移除上述文件中的本地分类字典
- [x] 新增防回归测试 `test/projectCategoryLabelSingleSource.test.ts`：扫描 app 目录，除白名单外不允许再出现分类字典
- [x] 统一后 UI 文案变更（以说明书 §3 为准）：产品研发→产品开发、交付实施→实施交付、运维保障→维保项目、销售/销售机会→销售项目、售前/售前支持→售前项目、合规/合规治理→合规审计

### B1.5 前端 — `improvement` 入口下线

- [x] `app/pages/projects/new.vue:161` 移除选项
- [x] `app/components/project/ProjectCreateModal.vue:117` 移除选项
- [x] `app/pages/projects/index.vue:162` 筛选器移除选项
- [x] `app/pages/admin/project-templates.vue:33` 移除选项
- [x] 展示映射保留（存量项目仍需正确显示分类名），统一显示为「改进（已停用）」
- [x] 四处 `categoryOptions` 选项数组一并收敛：创建入口用 `selectableProjectCategoryOptions`（排除 improvement 与 routine），筛选器与模板管理用既有 `projectCategoryOptions`（全量）
- [x] 防回归测试补 `value: 'product_dev'` 形式扫描——初版只查冒号形式，漏掉了这四处

### B1.6 前端 — 项目集默认分类

- [x] `app/stores/portfolio.ts` 增加 `defaultCategory` / `isSystem` 字段映射
- [x] `app/components/portfolio/PortfolioCreateModal.vue:212` 将 `isProductLine` 开关替换为 `defaultCategory` 下拉（选 `product_dev` 时等价于原产品线）
- [x] `app/pages/projects/index.vue:1177` 项目集编辑表单同步替换
- [x] `app/pages/projects/new.vue:182` 与 `ProjectCreateModal.vue:140` 的 `watch`：由 `isProductLine → product_dev` 改为 `defaultCategory → category`
- [x] `defaultCategory='routine'` 时分类字段置为只读并显示锁定说明
- [x] 项目集选项标签：`产品线` Badge 改为按 `defaultCategory` 显示对应分类名（`index.vue:681`、`index.vue:897`、`new.vue:171`、`ProjectCreateModal.vue:127`、`index.vue:545/557`）
- [x] `isProductLine` 保留为派生只读值（`defaultCategory==='product_dev'`），标注 deprecated
- [x] 清单外补做：`app/pages/portfolios/[id].vue` 是第三个项目集编辑入口，同步替换开关、Badge 与表单
- [x] 新增契约测试 `test/portfolioDefaultCategory.test.ts`：routine 唯一性/强约束、系统集保护、improvement 拒绝、派生写入、竞态防护保留
- [x] 行为变更：产品线项目集由「强制 product_dev 且分类只读」改为「预设可覆盖」，与 V1.1 §1.4「默认值，创建时可覆盖」一致；仅 routine 保持只读

### B1.7 里程碑名称规范与模板收敛

里程碑定义分散在四处，各自的 `maintenance` 结构并不一致：

| 定义位置 | 用途 | maintenance 结构 |
| --- | --- | --- |
| `app/config/milestone.ts` `pivrTypeMapping` | `MilestoneTimeline.vue` 展示 | 四阶段名称，作为周期内节奏标签保留 |
| `project-template-defaults.ts` `buildDefaultProjectTemplateDefinition()` | 前端建项目 | **符合 V1.1**：`service_ops`（工单处理，`rolling_plan`）+ `monthly_cycle`（月度运维周期，`periodic`，含巡检 `recurringWorkItems` 与 `carryover: auto`） |
| `project-template-defaults.ts` `getDefaultMilestoneSeeds()` | 通用种子 | 四个 `periodic`；maintenance 走特殊分支提前返回，此分支对 maintenance 为死代码 |
| `project_templates.go` `defaultProjectMilestoneSeeds()` | runtime 建项目 | 四个 `periodic`，**未跟进 V1.1 结构** |
| `service_ticket_bridge.go:248` | 工单回流懒创建 | `service_ops` 名为「运维服务」 |

`maintenance` 按《模型说明书 V1.1》§4.6.1 定稿为「一个周期单元里程碑 + 一个常驻工单容器」，前端已实现，本节负责让其余路径对齐。

- [x] **Go 侧 `maintenance` 对齐前端**：改为 `service_ops`（`rolling_plan`）+ 周期单元（`periodic`，`recurrence_rule=monthly`），移除四个 PIVR periodic 里程碑
- [x] **统一 `service_ops` 里程碑名称**：前端模板为「工单处理」、runtime 懒创建为「运维服务」，同一 `template_key` 两个名称，择一统一并同步两处
- [x] 删除或修正 `getDefaultMilestoneSeeds()` 的 `maintenance` 分支——对 maintenance 为死代码，保留会误导后续维护者
- [x] **修正 `delivery` R 阶段 mode 不一致**：「项目结项」前端为 `strong_constraint`、Go 为 `rolling_plan`，统一为 `strong_constraint`（交付结项有明确截止日期）
- [x] 以《模型说明书 V1.1》§3 映射表为唯一规范来源，三处实现对齐并在代码注释中标注来源文档
- [x] **`routine` 必须显式返回空里程碑数组**，前端与 Go 两侧都要加 case，不得落入 `default:` 分支——否则日常事务容器创建后会带上四个无意义的 PIVR 里程碑
- [x] `default:` 分支（「准备/实施/验证/改进」）保留但增加告警日志：未知分类落入通用模板时可被发现，避免今后新增分类再次漏配
- [x] `improvement` 分支保留（存量项目时间线仍需正确渲染），标注 deprecated
- [x] 前端两处合并为单一常量：以 `{ title, description, mode, pivrStage, sortOrder }` 为统一结构，`pivrTypeMapping` 与 `getDefaultMilestoneSeeds()` 均由其派生
- [x] `MilestoneTimeline.vue:36` 对 `routine` 项目不渲染 PIVR 时间线
- [x] 契约测试：遍历全部 category，断言前端与 Go 两侧的名称、mode、pivrStage、sortOrder 完全一致（新增分类若两侧不同步则测试失败）
- [x] 核查存量：`SELECT project_id, COUNT(*) FROM milestones WHERE mode='periodic' GROUP BY project_id HAVING COUNT(*)>1` → **空结果**（2026-08-31）。无四 periodic 结构的存量维保项目，B3 无需迁移

### B1.8 验证

- [x] `pnpm --dir aims typecheck`、`pnpm --dir aims lint`
- [x] data-runtime `go test ./internal/apps/aims/...`
- [x] `pnpm --dir aims test`（311/311，含 `test/pivrMilestoneTemplateContract.test.ts`、PIVR V1.1 总体契约及日常事务无立项测试）
- [x] 等价验收：`portfolioDefaultCategory.test.ts` 覆盖日常事务项目集强制 `routine` 且不可改；模块配置契约仅保留工作项与工时
- [x] 等价验收：周期性服务项目集默认 `maintenance`，非 `routine` 默认分类允许覆盖为 `custom_dev`
- [x] 回归：现有产品线项目集仍派生 `isProductLine`，未显式覆盖时自动归为 `product_dev`
- [x] 浏览器/契约检查 1440px / 390px：项目总览分组与响应式布局；项目集编辑表单由 typecheck、build 与默认分类契约覆盖
- [x] 全分类模板契约核对里程碑名称与 mode，与说明书 §3 映射表一致
- [x] `routine` 项目创建模板不带任何里程碑（前后端双侧契约测试）

---

## B2 服务年度与日常事务字段

### B2.1 数据库

- [x] 新建 migration `migration_v5.14_service_year_and_routine.sql`（按仓库 v5.13 基线顺延）
- [x] `aims_projects` 增加 `service_line_code`、`service_period_seq`、`service_period_start`、`service_period_end`、`service_period_label`，加 `idx_service_line`
- [x] `work_items` 增加 `routine_scope`（ENUM）、`beneficiary_dept_code`、`is_unplanned`，加 `idx_routine_beneficiary`
- [x] 同步 `docs/aims_schema.sql`

### B2.2 data-runtime

- [x] 项目 CRUD 支持服务年度五字段读写
- [x] 工作项 CRUD 支持三个标记读写
- [x] 写入校验：`routine_scope='cross_dept'` 时 `beneficiary_dept_code` 必填
- [x] 新增服务链查询：按 `service_line_code` 返回历年项目及累计指标
- [x] 新增日常事务统计：按容器返回 `routine_scope` 分布、计划外占比、跨部门工时流向

### B2.3 前端

- [x] 维保项目创建表单增加服务年度区块（服务链、年度序号、起止、展示标签）
- [x] 服务年度标签校验：合同期非自然年时禁止简写为单一年份
- [x] 项目详情页展示服务链，可跳转历年项目
- [x] `routine` 项目的工作项表单增加归属选择（部门事务 / 跨部门协助）与计划外勾选
- [x] 选择「跨部门协助」时受益部门必填，复用 Foundation `DeptTreeSelector`
- [x] 项目总览页：日常事务项目集默认折叠并排在末位；历史年度容器在项目集内按年度收起
- [x] 日常事务容器页增加季度回顾视图：承接量、计划外占比、跨部门工时流向

### B2.4 验证

- [x] typecheck / lint / go test
- [x] SQLMock + 浏览器夹具验证：同一服务链跨年度查询按序返回，并正确累计工作项、工时与 SLA
- [x] 单元测试验证：跨部门协助未填受益部门时写入被拒绝
- [x] 浏览器/契约检查 1440px / 390px：服务年度与跨年趋势、总览年度折叠；工作项表单由组件契约、typecheck 与 build 覆盖

---

## B3 关期门与服务健康度

### B3.1 数据库

- [x] 新建 migration `migration_v5.15_period_close_gate.sql`（按仓库 v5.13 基线顺延）
- [x] `milestone_cycle_snapshots` 增加：`gate_result`（JSON，五项校验结果）、`gate_passed`（TINYINT）、`exception_reason`、`exception_owner_uid`、`exception_due_date`、`confirmed_by`、`confirmed_at`、`sla_snapshot`（JSON）、`period_cost`（DECIMAL）
- [x] 同步 `docs/aims_schema.sql`

### B3.2 data-runtime — 关期门校验

改动集中在 `service_milestone_rollover.go`。

- [x] `milestoneRolloverStats` 扩展：除现有完成数/结转数/工时外，增加悬空工单数、超时工单数、未确认工时数
- [x] 新增 `evaluatePeriodCloseGate()`：按节拍（月/季/年）执行五项校验，返回逐项结果
- [x] `rolloverProjectMilestoneTx` 在创建下一周期前调用校验，结果写入快照
- [x] 未通过且未登记例外时拒绝关期，返回明确的未通过项列表（非静默滚动）
- [x] 登记例外时要求 `exception_reason` + `exception_owner_uid` + `exception_due_date` 三项齐全
- [x] 结转项保留原始工单标识、原周期归属、累计结转次数；连续结转三期以上标记治理异常
- [x] `rolloverDueProjectMilestones` 扫描逻辑同步：到期但关期门未过的项目产出待办而非直接滚动

### B3.3 data-runtime — 测试

- [x] 五项校验各自的通过 / 不通过用例
- [x] 月度可豁免、季度不可豁免的分级用例
- [x] 例外登记缺字段被拒用例
- [x] 结转次数累计与治理异常触发用例
- [x] 幂等：同一 `idempotency_key` 重放返回原快照，不重复关期

### B3.4 前端

- [x] 关期确认页：展示五项校验结果，未通过项可跳转到对应工单列表
- [x] 月度关期做成轻量流程：系统算好的部分只读展示，仅异常项需要人工处理
- [x] 例外登记表单（原因、责任人、计划关闭时间）
- [x] 服务健康度看板：SLA 达成率、积压进出比、重复问题率、权益消耗率四项 + 阈值色标
- [x] 服务链跨年趋势图（依赖 B2 服务链查询）

### B3.5 验证

- [x] go test 全绿
- [x] SQLMock 验证：存在悬空工单时关期被拒，登记完整例外后可关期并生成结转
- [x] 单元测试验证：月度关期在无复盘记录时可豁免，季度关期不可
- [x] SQLMock 验证：scheduled task 扫描到期周期时，未过门的返回 `pendingItems` 待办而非静默滚动
- [x] 浏览器检查 1440px / 390px：关期确认页、健康度看板与跨年趋势

---

## B4 商机桥接：Altoc 发起售前与销售项目

`sales` 与 `presales` 在 Altoc 发起、落到 Aims 执行。现状是 `aims_projects.opp_id` 字段与读写路径均已就绪（`projects.go:68/239/886`），但**写入 `opp_id` 的唯一入口是 `from-contract`**（`service_contract_bridge.go:301`）——商机阶段尚无独立入口，售前项目只能手工创建。

本批次只做 Aims 侧接口，Altoc 侧调用与触发时机为外部依赖，需另行对接。

**商机与销售状态由 Altoc 维护，Aims 不回写**。中标、未中标、取消等结果在 Altoc 侧记录，Aims 只承接执行侧的项目、里程碑、工作项与工时，不产生反向状态推送。

### B4.1 data-runtime

- [x] 新增 `POST /v1/aims/service/projects/from-opportunity`，位置参照 `service_contract_bridge.go` 的路由注册方式
- [x] 入参：`oppId`、`customerCode`、`customerName`、`category`（限 `presales` / `sales`）、项目名称、负责人、预计起止
- [x] 幂等键：`opp_id + category`，同商机同类型重复调用返回既有项目；v5.16 增加数据库唯一索引兜底
- [x] 复用共享项目创建事务，避免第二套建项目逻辑
- [x] 按 `category` 加载对应模板集（售前：方案与标书交付物；销售：商务里程碑）
- [x] 项目 mutation 与 `service_command_receipt` 同事务提交，遵循既有 service-command envelope 契约

### B4.2 Aims BFF 与鉴权

- [x] `server/middleware/tenant-runtime.ts` 登记新 service 后缀
- [x] 校验 `aud=aims`、来源 `altoc`、精确 capability `aims:project:create-from-opportunity`
- [x] Console service grant seed 与 verify（`data-runtime` 与 `tenant-runtime` 双 audience）
- [x] 契约测试：正确调用、缺 capability、错 audience、错来源应用、错 tenant/deployment、Token 过期、写请求幂等重放

### B4.3 前端

- [x] 售前 / 销售项目详情页展示关联商机，可跳转 Altoc
- [x] 由商机创建的项目在列表与详情标注来源，禁止在 Aims 侧修改商机主数据

### B4.4 验证

- [x] Go + BFF 契约测试覆盖幂等重放与鉴权矩阵
- [x] SQLMock 验证：同一商机重复调用返回同一项目
- [x] 单元测试验证：`category` 传入非 `sales`/`presales` 时被拒

---

## 1. 文档同步

- [x] `aims/CLAUDE.md`：补充 `routine` 分类、项目集 `default_category`、关期门约束
- [x] `aims/docs/aims_schema.sql`：B1–B4 DDL 同步
- [x] `docs/MODULE_CONTRACTS.md`：登记 B4 的 `from-opportunity` 调用方、capability、幂等规则
- [x] `aims/CLAUDE.md`：补充 B4 service endpoint 与 capability
- [x] `docs/MODULE_CONTRACTS.md`：确认 B3 本轮不接入 Altoc SLA 回读或范围外事项出口，并记录边界
- [x] 《Aims 交付与运维项目适配改造方案 V1.0》：标注 G1 已由 rollover 覆盖、G5 由 B3 部分覆盖

## 2. 风险与注意事项

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| `improvement` 存量数据 | 生产库可能存在该分类项目 | B1.1 先核查再下线入口；枚举值本批不删 |
| `is_product_line` 引用面广 | 前端 8 处依赖 | 保留为派生只读值，本批不删字段 |
| 月度关期退化 | 人工填写过多会使关期门在数月内形同虚设 | B3.4 强制轻量化，可自动计算的一律不让人填 |
| 容器项目数量增长 | 每年每部门一个 | 总览页按项目集分组 + 年度折叠，不做列表过滤 |
| 服务年度标签歧义 | 合同期非自然年时 | B2.3 校验禁止单一年份简写 |

## 3. 不在本轮范围

* 服务范围外事项 → Altoc 报价出口（需 Altoc 侧接口）
* SLA 判定结果从 Altoc 回读（需 Console service grant）
* 服务终止与移交流程
* 巡检计划自动生成与知识库沉淀（原方案 G5 剩余部分）
