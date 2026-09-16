# Aims 交付与运维项目适配改造方案 (V1.0)

> 状态：方案评审修订稿 | 作者：AI 辅助分析 | 日期：2026-07-05
>
> 目标：在不破坏现有 PIVR 统一模型和跨模块契约的前提下，让 `delivery`（实施交付）和 `maintenance`（运维保障）两类项目获得与研发类项目同等的落地体验。
>
> 评审修订要点：补齐 `module_config` 单一契约、rollover service endpoint 鉴权/调度/幂等规则、SLA 事实源边界、环境 tab 复用路径和测试验收矩阵。

## 1. 背景

Aims 当前主要打磨的是 `product_dev` / `custom_dev` 研发类场景：需求分解、产品版本、迭代看板、GitLab 集成。`delivery` 和 `maintenance` 在 PIVR 方法论和 schema 层已有定义（分类枚举、模板集、里程碑三模式、种子示例项目），但执行层"最后一公里"未落地，实际使用时交付/运维项目只能套用研发界面手工运转。

## 2. 现状盘点

### 2.1 已具备的基础（可直接复用）

| 能力 | 现状 | 位置 |
| --- | --- | --- |
| 项目分类 | `category` 枚举含 `delivery` / `maintenance`，MVP 范围内 | `aims_projects.category` |
| PIVR 语义映射 | 方法论文档已定义两类项目的 P/I/V/R 含义（进场交底/部署配置/试运行/结项；周期规划/任务处理/质量抽检/复盘优化） | `汇智PIVR项目管理生命周期模型说明书V1.0.md` §3 |
| 分类模板机制 | `project_template_sets` 按 category 建集，`project_template_versions.definition_json` 承载里程碑/工作项/交付物预置；创建项目时按分类加载模板 | schema + `app/pages/projects/new.vue` |
| 里程碑三模式 | `mode` 枚举 `strong_constraint` / `rolling_plan` / `periodic`，含 `recurrence_rule` 字段 | `milestones` 表 |
| 模块开关字段 | `module_config` JSON 已在主表预留，但前端类型与配置口径尚未统一 | `aims_projects.module_config`、`app/types/aims.ts`、`app/config/project.ts` |
| 交付环境闭环 | `project_environments` 完整状态机（planned→provisioning→deployed→online→accepted→handed_over）+ Assets 同步 + service API；用户侧概览页已有 upsert/status/重试能力 | 表 + `/api/v1/service/projects/{code}/environments*` + `server/api/v1/projects/[id]/environments/**` |
| 工单回流 | Altoc 服务工单 → Aims 工作项（P4.2 契约），类型映射 incident→bug / requirement→requirement / change→change_request / consulting→task；`template_key=service_ops` 里程碑做容器 | `/api/v1/service/service-tickets/{ticketCode}/work-item` |
| 里程碑↔回款 | `payment_term_id` 映射 Altoc 回款节点，验收通过通知 Altoc 可开票（Phase 1 契约） | milestones + review-approve 链路 |
| 工时与成本 | `time_entries` + `project_cost_summary`（Goal 3），分类无关，直接可用 | 已落地 |

### 2.2 关键差距

按"schema 有、代码无"、"单侧已有、Aims 执行侧缺失"和"两侧都无"分级：

**G1. 周期循环引擎缺失（运维核心，schema 有字段、server 零实现）**
`recurrence_rule` 在 server 端无任何消费代码。运维项目"月度/季度周期滚动"（R 结束自动开启新 P、周期里程碑自动创建、未完项结转）完全靠手工。年度运维项目实际退化为一个大平铺看板。

> V1.1 落地更新：G1 已由 periodic milestone rollover 覆盖；滚动现在还包含五项关期门、完整例外登记、结转溯源/三期治理异常和 scheduled 待办输出。

**G2. 前端千项一面（module_config 未形成单一契约）**
`ProjectNavbar` 对所有分类渲染同一套 tab（里程碑/版本/目标/任务/文档/成果/工时/周报）。`module_config` 已进入项目主表和 store，但现有口径分裂：`app/types/aims.ts` 使用 `milestonesEnabled/processAuditEnabled`，`app/config/project.ts` 使用 `milestones/workflows/requirements`，本方案需要的 `releases/environments/service_desk/decomposition` 尚无规范。后果：
- 运维项目看到"需求分解、产品版本"等不相关入口；
- 交付项目最核心的"环境"没有独立 tab（`project_environments` 有数据和 service API，前端仅概览页少量引用）；
- `releases.vue`、需求入口和后续工单入口会继续产生散落硬编码。

**G3. 工单执行属性缺失（Altoc 有主档，Aims 缺执行侧快照）**
`work_items.type` 已覆盖 requirement/task/bug/change_request，但没有来源工单、客户、环境、SLA 截止时间快照和首次响应时间。Altoc 工单主档已有 `sla_status`、`response_due_at`、`resolution_due_at`、`first_responded_at`、`resolved_at` 和服务权益 entitlement。Aims 不能复制 SLA 判定事实源，但需要保存执行侧快照和回写事实，才能展示倒计时、按客户/环境切片，并支撑运维项目 V 阶段的 SLA 核对。

**G4. 官方模板内容未预置**
种子数据只有 delivery/maintenance 示例项目，无对应模板集的 `definition_json` 内容。用户建交付/运维项目时无开箱即用的里程碑与交付物清单。

**G5. 巡检与知识沉淀缺位（可选增强）**
周期性巡检任务无自动生成机制；工单关闭无结构化"解决方案"沉淀，PIVR R 阶段"SOP 更新、重复问题入知识库"无系统支撑。

> V1.1 落地更新：B3 已部分覆盖 G5 的周期复盘证据（关期门、SLA/成本快照、重复问题率与跨期趋势）；巡检任务自动生成和知识库沉淀仍为后续范围。

## 3. 改造原则

1. **不建第二套系统**：交付/运维在现有 PIVR + 统一工作项模型上扩展，符合方法论"底层统一、顶层灵活"。
2. **契约分工不变**：工单与 SLA 主档、客户成功经营分析在 Altoc；环境主档在 Assets；Aims 只做执行事实源并回写结果（P4.2 / Goal 2 契约）。
3. **配置驱动而非硬编码**：分类差异通过模板集 + `module_config` 默认值表达，前端按配置渲染，避免散落 `if category === ...`。
4. **不动 `work_items.type` 枚举**：P4.2 类型映射已是落地契约；新增 type 牵动状态机、看板、Roll-up、统计全链路。工单属性走扩展表；同时修正前端 `WorkItemType` 类型债务，确保 `change_request` 被类型层承认。
5. **所有数据操作走 tenant-runtime**：新表、新端点先补 runtime adapter，Aims 侧只做代理与编排（ADR-016）。
6. **SLA 结果事实源只在 Altoc**：Aims 可保存 SLA 截止时间、状态快照和执行时间用于展示与追溯，但不计算、不拥有最终 SLA 达成结果。官方达成率和经营考核仍以 Altoc 为准。
7. **新增 service endpoint 先补契约再开放**：所有 `/api/v1/service/**` 新端点必须同步登记 middleware 白名单、capability、allowed source apps、幂等键和 `docs/MODULE_CONTRACTS.md`，否则默认 403。

## 4. 分阶段改造方案

### 阶段一：分类模板与界面适配（配置契约 + 前端，无新增业务表 DDL）

阶段一不是单纯 UI 改动。它不新增业务表 DDL，但必须完成模板 seed/runtime 解析、`module_config` 规范化、项目设置覆盖和导航/路由行为收敛。

**1a. 统一 `module_config` 契约**

- 在 Aims 本地单点维护 `ProjectModuleConfig`，不要下沉 Foundation，除非后续多应用复用该 schema。
- 持久化 JSON 采用资源式 key：

| key | 含义 | 默认兼容 |
| --- | --- | --- |
| `milestones` | 里程碑/计划页 | 旧 `milestonesEnabled` |
| `workflows` | 流程/审批审计 | 旧 `processAuditEnabled` |
| `requirements` | 需求管理页 | 现有 `requirements` |
| `releases` | 产品版本页 | 新增 |
| `environments` | 项目环境页 | 新增 |
| `service_desk` | 运维工单页 | 新增 |
| `decomposition` | 需求分解入口 | 新增 |

- 增加 normalize helper：读取项目时合并 `category` 默认值、模板 `default_module_config`、项目自身 `module_config` 和旧 key；写回时只写新 key。
- 项目设置页只允许项目管理员覆盖模块开关；覆盖操作走现有项目更新路径和项目 scoped authorization。

分类默认值：

| 模块 | product_dev | custom_dev | delivery | maintenance |
| --- | --- | --- | --- | --- |
| milestones | ✅ | ✅ | ✅ | ✅ |
| workflows | ✅ | ✅ | ✅ | ✅ |
| requirements | ✅ | ✅ | ❌ | ❌ |
| releases | ✅ | ❌ | ❌ | ❌ |
| environments | ❌ | ✅ | ✅ | ✅ |
| service_desk | ❌ | ❌ | ❌ | ✅ |
| decomposition | ✅ | ✅ | ❌ | ❌ |

**1b. 预置官方模板集**（tenant-runtime seed 或 admin 界面录入）

- `delivery` 模板：4 个 `strong_constraint` 里程碑（进场交底 → 部署配置 → 试运行 → 项目结项，对应 P/I/V/R），预置必选交付物（部署方案、试运行报告、验收单、交接清单）与必选工作项（环境勘察、数据迁移、用户培训等）。
- `maintenance` 模板：1 个 `template_key=service_ops` 常驻工单容器里程碑 + 1 个 `periodic` 周期里程碑（`recurrence_rule=monthly`），预置周期复盘交付物。
- seed 必须创建 `project_template_sets` 和 published `project_template_versions`，不能只创建示例项目。
- `app/utils/projectTemplateVersions.ts` 的 `normalizeTemplateDefinition()` 需要保留 `default_module_config`、`carryover`、`recurring_work_items` 等未知扩展字段，而不是只返回 milestones。

**1c. `module_config` 驱动导航与页面**

- `ProjectNavbar` 改为按 normalized module config 渲染 tab，移除版本、需求、后续工单入口的分类硬编码。
- 若用户直接访问被关闭模块的 URL，显示“该项目未启用此模块”的轻量空状态，避免 404 或泄露无关数据。
- 保留现有基于数据存在的需求入口判断，但必须被 `requirements=true` 总开关约束。

**1d. 环境 tab**

- 新增 `app/pages/projects/[id]/environments.vue`，复用现有用户侧端点：
  - `GET /api/v1/projects/{id}/environments`
  - `POST /api/v1/projects/{id}/environments/upsert`
  - `POST /api/v1/projects/{id}/environments/{environmentCode}:status`
- 页面必须覆盖 upsert、推进部署→上线→验收→交接、Assets 同步失败提示和重试。
- 不直接从前端调用 service API；service API 仍只用于跨模块和 runtime-forwarded 契约。

**1e. 概览分类适配**

- delivery 显示环境状态、里程碑进度、回款节点。
- maintenance 显示本期工单量、完成率、工时消耗；若阶段三尚未落地 SLA 快照，则 SLA 指标显示“待工单增强启用”。

### 阶段二：周期循环引擎（运维运转核心）

**2a. tenant-runtime 新增周期滚动端点**

```
POST /api/v1/service/projects/{projectCode}/milestones/{milestoneId}:rollover
```

服务契约：

| 项 | 约束 |
| --- | --- |
| 调用方 | `aims`（Aims scheduled task / Aims BFF 手动按钮） |
| 目标 audience | `aims` |
| capability | `aims:write`，后续可收敛为 `aims:milestone:rollover` |
| allowed source apps | `aims` |
| 幂等键 | `aims:milestone:{projectCode}:{templateKey}:{periodStart}:rollover:v1` |
| 审计字段 | `source_app=aims`、`source_biz_type=milestone_rollover`、`source_biz_code={projectCode}:{milestoneId}:{periodStart}`、`idempotency_key`、`request_id`、`actor_uid/system`、`service_client_id` |

业务语义：

- 仅允许 `mode=periodic` 且当前周期到期或手动确认的里程碑 rollover。
- 关闭当前周期并按 `recurrence_rule` 创建下一周期里程碑（名称带周期后缀，如"2026-08 月度运维"）。
- 幂等判断使用 `project_id + template_key + period_start`；重放返回既有新周期，不重复创建。
- 未完成工作项结转策略由请求参数控制：`carryover=auto`（自动移入新周期）/ `manual`（留在原里程碑待确认）。默认来自模板 `carryover`。
- rollover 同事务写入周期统计快照（完成数/结转数/工时合计），作为 R 阶段复盘输入。

**2b. Aims BFF 与 middleware**

- 在 `server/middleware/tenant-runtime.ts` 登记 rollover service path，否则会被 unsupported service endpoint 拒绝。
- 补 `serviceCapabilityRequirement()`，要求 `scope=aims:write` 且 `allowedApps=['aims']`。
- UI 手动按钮不直接调用 service path；新增用户侧 BFF，例如 `POST /api/v1/projects/{id}/milestones/{milestoneId}/rollover`，先做项目 scoped admin 校验，再以 Aims service identity 调 runtime。

**2c. 触发机制**

- Aims 侧每日调度扫描到期 periodic 里程碑并调用 rollover；Cloudflare 部署需同步增加 wrangler cron trigger，否则 Nitro scheduled handler 不会自动触发。
- 多实例/重复触发不依赖内存锁，runtime 幂等键兜底；建议 runtime 事务内使用唯一约束或幂等日志避免并发双建。
- 调度失败不阻塞业务；项目经理可在里程碑 UI 手动开启下一周期，使用同一幂等键规则补偿。

### 阶段三：工单执行增强（SLA 快照与切片）

**3a. 新增扩展表**（`migration_v4.9_work_item_service_ext.sql`，runtime 侧同步实现）

```sql
CREATE TABLE work_item_service_ext (
  work_item_id BIGINT UNSIGNED PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,             -- 冗余，切片查询用
  source_ticket_code VARCHAR(64) NOT NULL,         -- Altoc service_ticket.code
  customer_code VARCHAR(100) DEFAULT NULL,
  environment_code VARCHAR(64) DEFAULT NULL,       -- Assets 环境编码快照
  response_due_at DATETIME DEFAULT NULL,           -- Altoc SLA 截止时间快照
  resolution_due_at DATETIME DEFAULT NULL,         -- 对齐 Altoc 字段命名
  sla_status_snapshot VARCHAR(30) DEFAULT NULL,    -- Altoc 状态快照，仅展示，不作为 Aims 事实
  first_responded_at DATETIME DEFAULT NULL,        -- Aims 执行事实，回写 Altoc
  resolved_at DATETIME DEFAULT NULL,               -- Aims 执行事实，回写 Altoc
  last_synced_at DATETIME DEFAULT NULL,
  KEY idx_svc_ext_project_customer (project_id, customer_code),
  KEY idx_svc_ext_project_env (project_id, environment_code),
  UNIQUE KEY uk_svc_ext_ticket (source_ticket_code)
);
```

- 不动 `work_items.type`；工单识别靠 `source_ticket_code` 非空。
- 现有 `work_items.template_key=altoc:service_ticket:{ticketCode}` 幂等键保持不变。
- `sla_status_snapshot` 只用于列表展示与“待 Altoc 判定/已同步状态”提示；官方 SLA 达成率从 Altoc 获取或由 Altoc 回写快照，不由 Aims 自行判定。

**3b. 契约扩展**（需同步 `docs/MODULE_CONTRACTS.md` + Altoc）

- Altoc 下发 `.../work-item` 请求体增加或补齐可选字段：`responseDueAt` / `resolutionDueAt` / `slaStatusSnapshot` / `customerCode` / `environmentCode`。
- Aims 回写 `delivery-result:sync` 增加：`firstRespondedAt` / `resolvedAt`。字段命名对齐 Altoc 的 `first_responded_at` / `resolved_at`。
- Aims 不能要求 Altoc 同步所有 SLA 主档字段；服务权益、额度扣减、SLA 判定、经营考核仍由 Altoc 完成。

**3c. 运维工作台视图**（`service_desk` 模块开启时的"工单"tab）

- 工单列表：SLA 截止时间倒计时/超时标记、Altoc SLA 状态快照、按客户/环境/类型筛选。
- 周期统计：本期工单量、完成数、结转数、工时消耗；按时响应率/按时解决率标明来源为 Altoc 状态快照，缺失时显示“待同步”。
- 修正前端 `WorkItemType` 包含 `change_request`，避免服务工单 change 类型在 UI 过滤和详情页中丢失。

### 阶段四：巡检与知识沉淀（可选增强）

**4a. 巡检**：不建新对象。模板 `definition_json` 支持在 periodic 里程碑下声明周期工作项，阶段二 rollover 时自动实例化。巡检 = 周期自动生成的模板任务。

**4b. 知识沉淀**：工单类工作项关闭时可填"解决方案摘要"和标签，Aims 保存执行摘要；SOP 正文走 Codocs 文档，关联关系优先复用既有 Altoc/Codocs `ops-knowledge` 契约，Aims 不复制知识正文。

**明确不做**：值班排班表（属人员管理域，超出 Aims 边界，如有需求由 People 或独立能力承接）；Aims 内建工单受理入口（工单入口在 Altoc，Aims 不复制主档）。

## 5. 模板 definition_json 结构扩展

阶段一/二/四需要模板支持以下新属性（向后兼容，旧模板不受影响）。解析器必须保留未知字段，避免后续模板扩展被前端 normalize 丢弃。

```jsonc
{
  "schema_version": 2,
  "default_module_config": {
    "milestones": true,
    "workflows": true,
    "requirements": false,
    "releases": false,
    "environments": true,
    "service_desk": true,
    "decomposition": false
  },
  "milestones": [
    {
      "key": "service_ops",
      "name": "工单处理",
      "mode": "rolling_plan"
    },
    {
      "key": "monthly_cycle",
      "name": "月度运维周期",
      "mode": "periodic",
      "recurrence_rule": "monthly",
      "carryover": "auto",
      "recurring_work_items": [
        { "key": "patrol_db", "type": "task", "title": "数据库巡检" }
      ]
    }
  ]
}
```

## 6. 跨模块影响与文档同步

| 模块 | 影响 | 需更新 |
| --- | --- | --- |
| Aims | `module_config` 统一 schema、ProjectNavbar 配置渲染、环境 tab、用户侧 rollover BFF、service_desk tab | `app/types/aims.ts`、`app/config/project.ts`、相关页面与测试 |
| Altoc | 工单下发补 SLA/客户/环境快照字段；接收回写新增首次响应/解决时间；SLA 判定事实源不变 | Altoc service API 文档、`MODULE_CONTRACTS.md`、`aims-work-item` 编排器 |
| Assets | 无新增跨模块能力；环境 tab 复用现有 Aims 用户侧环境端点和 Goal 2 同步链路 | — |
| tenant-runtime | rollover 端点、service_ext 表读写、模板实例化扩展、模板 seed | runtime adapter + `aims_schema.sql` |
| Workflow | 无变更（周期里程碑不走审批，验收里程碑沿用现有链路） | — |
| Foundation | 无新增能力诉求；Aims 分类模块开关先保留在 Aims 本地 | — |
| Cloudflare 部署 | 若使用 scheduled task，需生成 wrangler cron trigger | `scripts/render-cloudflare-config.mjs` 或共享 render 配置 |

## 7. 测试与验收矩阵

| 范围 | 必测内容 | 建议测试 |
| --- | --- | --- |
| module_config | 分类默认值、模板默认值、项目覆盖值、旧 key 兼容、新 key 写回 | `node --test` 单元测试 + ProjectNavbar 组件/页面测试 |
| 导航与路由 | tab 按开关显示；关闭模块直达 URL 显示空状态；需求入口同时受数据存在和开关约束 | 前端组件测试或 Playwright smoke |
| 环境 tab | 列表、upsert、状态推进、Assets 同步失败提示、重试、权限前置校验 | 复用 `projectEnvironment*` 测试并补页面流 |
| rollover | service path 白名单、scope/audience/source_app 拒绝、幂等重放、并发双触发、manual/auto 结转 | tenant-runtime 契约测试 + `sensitiveRoutePermissions` |
| 调度 | cron trigger 生成、重复触发补偿、调度失败后手动按钮补偿 | 配置生成测试 + runtime 幂等测试 |
| SLA 快照 | Altoc 缺省字段兼容、字段命名对齐、Aims 不计算官方 SLA 结果、回写首次响应/解决时间 | Aims/Altoc 契约测试 |
| service_desk | 按客户/环境/类型筛选、`change_request` 类型展示、状态快照缺失显示“待同步” | 页面测试 + 数据映射测试 |
| 存量迁移 | maintenance 存量项目补默认 `module_config` 和 periodic 里程碑，重复执行不破坏已有覆盖 | dry-run + apply 脚本测试 |

文档同步要求：
- 更新 `docs/MODULE_CONTRACTS.md`，新增 rollover endpoint 和 SLA 字段扩展。
- 更新 `aims/docs/aims_schema.sql` 和 migration 文档。
- 更新 Altoc service ticket API 文档或对应设计文档。
- 若修改 Cloudflare cron 配置，更新部署 runbook。

## 8. 风险与依赖

1. **ModuleConfig 迁移风险**：现有类型口径不一致，必须先做 normalize helper 和旧 key 兼容，否则阶段一会让部分旧项目 tab 异常。
2. **runtime 实现成本**：所有 schema/写路径在 tenant-runtime 侧，阶段二/三各含一次 runtime 发版，需与 data-runtime 排期对齐。
3. **service endpoint 默认拒绝**：rollover 不登记 middleware 白名单和 capability 时会被 Aims middleware 403，不能只补 runtime adapter。
4. **调度可靠性**：Nitro scheduled task 在 Cloudflare 部署下需要 cron trigger；多实例重复触发依赖 runtime 幂等键和事务唯一约束兜底。
5. **Altoc 排期耦合**：阶段三 SLA 快照依赖 Altoc 下发字段扩展；可先落扩展表与 UI 降级态，字段为空时显示“待同步”，Altoc 就绪后补全。
6. **SLA 事实源混淆**：Aims 只能展示和回写执行事实，不得把本地倒计时计算包装成官方 SLA 达成率。
7. **存量项目迁移**：已有 maintenance 项目（如 OPS-2026）需一次性脚本补 `module_config` 默认值与 periodic 里程碑，不强制重建。

## 9. 建议节奏

- 阶段一先做 `module_config` 单一契约、模板 seed 和环境 tab。它感知最强，但不再描述为“纯前端”，因为需要 runtime 模板解析与存量兼容。
- 阶段二先补 `MODULE_CONTRACTS.md` 和 middleware capability，再做 runtime rollover，最后接 scheduled task 和手动按钮。
- 阶段三可与阶段二并行，但必须先和 Altoc 对齐字段命名与事实源边界；Aims 侧先支持缺省字段降级。
- 阶段四按实际运维项目反馈决定是否启动，避免在未验证工单执行闭环前扩大范围。

## 10. 暂不纳入范围

- 不新增独立运维应用。
- 不在 Aims 建工单受理入口；工单入口和主档仍在 Altoc。
- 不在 Aims 复制 Altoc SLA 判定、服务权益、额度扣减和经营考核逻辑。
- 不在 Aims 建环境主档或生成正式 `environment_code`；正式环境主档仍在 Assets。
- 不做值班排班表；如后续需要，由 People 或独立能力承接。
- 不把 Aims 分类模块开关提前下沉到 Foundation。
