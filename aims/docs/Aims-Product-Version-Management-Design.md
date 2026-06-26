# Aims · 产品版本管理设计方案

> 版本：v1.0
> 作者：Gavin & Claude
> 日期：2026-06-12
> 状态：已实施（P1-P6）
> 相关迁移：`aims/docs/migration_v3.5_product_version_management.sql`、`aims/docs/aims_schema.sql`、data-runtime Aims adapter required tables
> 关联文档：`assets/docs/Assets-Design.md`（产品资产主档）、`docs/MODULE_CONTRACTS.md`（跨模块契约）

---

## 一、设计目标与范围

### 1.1 背景与动机

公司需要对软件产品进行版本管理：定义每个版本的功能清单，并跟踪实现进度。当前现状：

1. **Assets 模块**的 `product_assets` 是产品资产主档（台账定位），记录产品编码、负责人、等级、状态；现有 `current_version`/`target_version` 仅是手工维护的快照字段（定位见 3.4），没有版本实体，也没有执行过程数据。
2. **Aims 模块**拥有完整的交付执行链路：里程碑（计划层）→ 目标/工作项（目标层）→ 任务（执行层），以及需求管理、周报、GitLab 提交关联。"实现进度"的数据源全部在 Aims。
3. 模块间禁止直连数据库，若版本管理放在 Assets，进度聚合需要反复跨模块调用 Aims API，等于在台账模块里复刻执行域逻辑。

**结论：版本管理的主链路放在 Aims，Assets 侧只做只读展示。**

### 1.2 核心建模决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 版本归属 | 版本（Release）锚定**产品**（`product_code`），不锚定项目 | 产品长存、项目有起止；"产品 X 的 v2.1 包含哪些功能"这一事实不依赖哪个项目实施 |
| 产品↔项目关系 | N:M 关联表，不强制 1:1 | 一个产品可由多个项目先后演进（v1 研发项目、v2 研发项目）；现状 1:1 是模型的退化特例，零额外成本 |
| 关联的版本范围 | 关联时可**限定某个版本**或**不限版本（全版本）** | 限定版本 → 单独的版本升级项目；不限版本 → 产品迭代开发项目（长期演进） |
| 可关联项目类型 | `product_dev`（产品研发）、`delivery`（交付实施）、`maintenance`（运行维护）可关联产品（和版本） | 研发类项目承载版本演进；交付/维护类项目以产品（版本）为作业上下文。**版本生命周期管理（创建/流转/发布）仅产品研发类项目可操作** |
| 关联关系事实源 | **Aims 为"项目↔产品"关联的事实源**；`product_assets.project_code` 仅作首次导入的初始数据来源 | 避免双写；版本/交付链路在 Aims 侧 |
| 功能清单载体 | 版本功能清单 = 打了版本标签的 target 层工作项（`work_items.version_id`） | 进度从工作项状态自动聚合，不手填；规划期可先创建 `planning` 状态的 target 占位 |
| 功能特性清单 | 版本下独立子实体 `product_version_features`：**粗粒度版本目标，销售/对外口径** | 比需求项粗一层，不进执行状态机；与执行层通过可选挂接（`work_items.feature_id`）建立追溯；后续供 Altoc 售前/方案消费 |
| 版本 vs 里程碑 | 不合并，**软关联**（`product_versions.milestone_id` 可选） | 里程碑是项目内时间容器，版本是产品级范围容器，生命周期不同；典型场景"一个里程碑做一个版本迭代"通过软关联表达 |
| 管理入口 | 数据挂产品，**入口放项目内**（`/projects/:id/releases`） | 日常操作发生在项目空间；MVP 不做产品维度全局版本页 |

### 1.3 范围

**本方案包含**：

- 项目关联产品（设置页管理，N:M，支持限定版本/不限版本）
- 新建产品研发类项目时的产品选择、基于产品名称自动命名、随项目创建新版本或指定为全版本项目
- 产品版本的增删改查与生命周期（规划 → 开发中 → 已发布 → 归档）
- 版本功能清单：target 工作项打版本标签、版本详情展示清单与进度
- 版本功能特性清单：粗粒度版本目标（销售/对外口径）的增删改查、排序、状态维护、与 target 工作项的可选挂接
- 版本进度自动聚合（target-only weight 聚合，口径见 2.5）
- 版本与里程碑的软关联
- Assets 产品详情页只读版本区块（service API 桥接）
- 跨模块契约登记（`product_code` 成为跨模块稳定标识）

**本方案不包含（v1.0 out of scope）**：

- 产品维度的全局版本总览页（跨项目视图）
- 多项目共建同一版本的协调 UI（模型支持，UI 不做）
- 版本 Release Notes 自动生成、GitLab 提交自动归集到版本
- Altoc 消费特性清单（售前方案/报价引用产品版本特性）——本方案预留 service API 形态，Altoc 侧集成另行立项
- 版本间功能 diff、版本路线图（Roadmap）可视化
- Altoc 侧"客户使用版本"的关联（后续按需扩展）

---

## 二、数据模型

> Aims 已迁入 tenant-runtime，以下表变更通过 data-runtime 迁移落库，Nuxt 侧不得新增本地 DB 主路径。
> 迁移顺序：先建 `product_versions`（2.2），再建 `aims_project_products`（2.1）、`product_version_features`（2.3）与 `product_version_logs`（2.5，均含指向前者的外键），最后 `work_items` 列变更（2.4）。

### 2.1 新表：`aims_project_products`（项目↔产品关联）

```sql
CREATE TABLE IF NOT EXISTS `aims_project_products` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `product_code` VARCHAR(64) NOT NULL COMMENT '关联Assets product_assets.product_code(逻辑关联, 非外键)',
  `product_name` VARCHAR(255) DEFAULT NULL COMMENT '产品名称快照(展示用, 关联时同步)',
  `version_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '限定版本(关联product_versions.id; NULL=不限版本/全版本项目)',
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否主产品(项目默认版本上下文)',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_product` (`project_id`, `product_code`),
  UNIQUE KEY `uk_project_primary` ((CASE WHEN `is_primary` = 1 THEN `project_id` END)),
  KEY `idx_project_product_code` (`product_code`),
  KEY `idx_project_product_version` (`version_id`),
  CONSTRAINT `fk_project_product_project` FOREIGN KEY (`project_id`)
    REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_project_product_version` FOREIGN KEY (`version_id`)
    REFERENCES `product_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目与产品资产关联';
```

说明：

- 允许关联的项目分类：`product_dev`、`delivery`、`maintenance`（应用层校验，POST 时检查项目分类）。其中只有 `product_dev` 项目可管理版本生命周期，交付/维护类项目的关联是作业上下文引用。
- **版本范围**：`version_id` 为空表示不限版本（全版本项目，如产品迭代开发项目）；非空表示限定到某个版本（如单独的版本升级项目）。限定版本的项目，其工作项只能挂接该版本。
- `product_code` 与 Altoc 的 `customer_code`/`contract_code` 同模式：逻辑关联、非外键，事实源在对方模块。
- `product_name` 为展示快照，关联时从 Assets API 取一次；不做实时同步（产品改名属低频事件，后续可加手动刷新）。
- 一个项目可关联多个产品，`is_primary` 标记主产品：releases 页和工作项版本选择器默认使用主产品的版本列表。每个项目至多一条 `is_primary=1`：应用层在事务内"先清后设"，并由函数式唯一索引 `uk_project_primary`（仅 `is_primary=1` 行参与，MySQL 8.0.13+）兜底并发写入。
- `version_id` 外键为 `ON DELETE RESTRICT`：被项目关联限定的版本不可删除，防止限定版本项目被静默放大为全版本项目。删除版本的前置校验同时检查本表引用（见 3.1 DELETE releases）。

### 2.2 新表：`product_versions`（产品版本）

```sql
CREATE TABLE IF NOT EXISTS `product_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_code` VARCHAR(64) NOT NULL COMMENT '所属产品(关联Assets product_assets.product_code)',
  `version_code` VARCHAR(64) NOT NULL COMMENT '版本号(如 v2.1.0)',
  `name` VARCHAR(200) DEFAULT NULL COMMENT '版本名称/主题(可选)',
  `description` TEXT DEFAULT NULL COMMENT '版本说明(Markdown)',
  `status` ENUM('planning','developing','released','archived') NOT NULL DEFAULT 'planning'
    COMMENT '版本状态: planning(规划)→developing(开发中)→released(已发布)→archived(归档)',
  `planned_release_date` DATE DEFAULT NULL COMMENT '计划发布日期',
  `released_at` DATETIME DEFAULT NULL COMMENT '实际发布时间',
  `released_by` VARCHAR(64) DEFAULT NULL COMMENT '发布操作人uid',
  `milestone_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '软关联里程碑(可选, 逻辑关联非外键; 关联后可复用里程碑起止日期)',
  `owner_project_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '归属项目(创建该版本的项目; 生命周期操作仅限该项目负责人; 逻辑关联非外键, 项目删除后可由其他关联项目认领)',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序(默认按版本创建倒序)',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_version` (`product_code`, `version_code`),
  KEY `idx_product_status` (`product_code`, `status`),
  KEY `idx_version_milestone` (`milestone_id`),
  KEY `idx_version_owner_project` (`owner_project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品版本(Release)';
```

说明：

- 不挂 `project_id` 作为归属外键：版本属于产品，跨项目可见。项目侧通过 `aims_project_products` 间接获得可见的版本集合。
- **`owner_project_id` 收敛编辑权**：创建版本的项目即归属项目，版本的生命周期操作（编辑基本信息、状态流转、发布、删除）与特性清单管理仅限归属项目的负责人；其他关联了同一产品的项目对该版本只读 + 可挂工作项。避免全版本迭代项目负责人误发布/回退某升级项目的版本。归属项目被删除后版本保留（`owner_project_id` 残留为悬挂引用），由其他关联项目负责人通过独立"认领"动作接管，且需当前归属项目已不存在。
- `milestone_id` 为逻辑关联（里程碑随项目删除级联，版本不能被外键拖垮）；读取时若里程碑已不存在则展示"关联已失效"。MVP 仅支持单里程碑关联，多项目共建一个版本时该字段可为空，限制已知。
- 状态机为单向推进 + 允许 `released → developing` 回退（误操作纠正），`archived` 为终态。状态流转记录写入操作日志（见 2.5）。

### 2.3 新表：`product_version_features`（版本功能特性清单）

粗粒度的版本目标，定位是**销售/对外口径**：比需求项粗一层，不进入执行状态机，用于回答"这个版本带来什么能力"。后续 Altoc 售前/方案可直接引用。

```sql
CREATE TABLE IF NOT EXISTS `product_version_features` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `version_id` BIGINT UNSIGNED NOT NULL COMMENT '所属版本',
  `title` VARCHAR(255) NOT NULL COMMENT '特性标题(对外口径)',
  `description` TEXT DEFAULT NULL COMMENT '特性说明(Markdown, 可含客户价值描述)',
  `category` VARCHAR(64) DEFAULT NULL COMMENT '特性分类(如 新增能力/体验优化/性能/安全, 字典可后置)',
  `status` ENUM('planned','delivered','deferred') NOT NULL DEFAULT 'planned'
    COMMENT '特性状态: planned(规划)→delivered(已交付)/deferred(顺延后续版本)',
  `is_public` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否对外可见(销售/Altoc消费时过滤)',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_feature_version` (`version_id`, `sort_order`),
  CONSTRAINT `fk_feature_version` FOREIGN KEY (`version_id`)
    REFERENCES `product_versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品版本功能特性清单(粗粒度, 销售/对外口径)';
```

说明：

- **状态手工维护**，不与工作项状态机联动——特性是承诺口径，是否"已交付"由项目负责人判断后标记；`deferred` 表示顺延到后续版本（可在后续版本重建条目）。
- 与执行层的追溯通过 `work_items.feature_id` 可选挂接（见 2.4）：挂接后特性详情可展示关联 target 的聚合进度作参考，但不自动改写特性状态。
- `is_public` 区分对外/对内条目：service API（含后续 Altoc 消费）默认只返回 `is_public=1`。
- 版本发布（`released`）后特性清单默认锁定，修改需先回退版本状态——保证对外口径与发布事实一致。

### 2.4 列变更：`work_items.version_id / feature_id`

```sql
ALTER TABLE `work_items`
  ADD COLUMN `version_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '目标版本(关联product_versions.id, 仅tier=target有效)' AFTER `milestone_id`,
  ADD COLUMN `feature_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属功能特性(关联product_version_features.id, 可选, 须与version_id同版本)' AFTER `version_id`,
  ADD KEY `idx_work_item_version` (`version_id`),
  ADD KEY `idx_work_item_feature` (`feature_id`),
  ADD CONSTRAINT `fk_work_item_version` FOREIGN KEY (`version_id`)
    REFERENCES `product_versions` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_work_item_feature` FOREIGN KEY (`feature_id`)
    REFERENCES `product_version_features` (`id`) ON DELETE SET NULL;
```

规则：

- 仅 `tier=target` 的工作项可设置 `version_id`（应用层校验）；matter 层任务通过 `parent_id` 归属 target，进度统计时随父项计入。
- 可设置的版本范围 = 该工作项所属项目关联产品下的版本，且状态为 `planning/developing`（已发布版本不再接收新功能；变更已发布版本清单需先回退状态）。若关联限定了 `version_id`，则只能挂接该版本。
- 交付/维护类项目的工作项同样允许打版本标签（受其关联的版本限定约束），使维护期 bugfix 可计入对应版本清单；但这类项目不能创建或流转版本。
- `feature_id` 可选：设置时必须已设置 `version_id` 且特性属于同一版本（应用层校验）；清空 `version_id` 时联动清空 `feature_id`。
- 删除特性时工作项 `feature_id` 置空（`ON DELETE SET NULL`），工作项本身不受影响；删除版本虽然有 `ON DELETE SET NULL` 兜底，但 API 必须先校验无 target 工作项、无特性清单、无项目关联限定引用，避免静默丢失版本清单语义。
- **防绕过**：data-runtime compat 层会把请求体中匹配表字段的列直接写入通用资源（aims adapter 当前将 work_items 登记为通用 CRUD 资源）。实施时必须在 adapter 中把 `version_id`、`feature_id` 列入 work_items 通用写入的**字段黑名单**，这两列只能经专用端点（`product_version_items.go` 及 work-item 专用写 handler）写入并执行上述校验；创建/更新/批量更新三条路径都要覆盖。

### 2.5 版本进度与操作日志

**进度计算**（不落表，读时聚合）：

```text
版本进度 = Σ(已完成 target 的 weight) / Σ(全部关联 target 的 weight)
辅助指标：按 status 分组的 target 数量(planning/todo/in_progress/in_review/completed)
边界：无任何关联 target 时，进度返回 0，total/completed 均为 0（前端展示"暂无功能清单"而非 100%）
```

**口径声明**：版本进度为 **target-only**——只统计 `version_id` 挂接的 target 层工作项，matter 层任务不单独计入（其完成情况通过父 target 的状态体现）。注意这与现有里程碑 roll-up 不同：里程碑进度对里程碑下**全部工作项**汇总、无 tier 过滤（见 `milestone_detail.go`）。两者共用 `weight` 字段但口径独立，不复用同一段聚合实现。

**操作日志**：版本创建、状态流转、发布、功能清单增减、特性清单增删改，写入 `product_version_logs` 表，MVP 仅记录不做 UI 时间线（版本详情页展示最近 10 条即可）：

```sql
CREATE TABLE IF NOT EXISTS `product_version_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `version_id` BIGINT UNSIGNED NOT NULL,
  `action` VARCHAR(64) NOT NULL COMMENT '动作: create/update/transition/release/item_attach/item_detach/feature_create/feature_update/feature_delete',
  `old_value` TEXT DEFAULT NULL COMMENT '动作前值或摘要(JSON文本)',
  `new_value` TEXT DEFAULT NULL COMMENT '动作后值或摘要(JSON文本)',
  `operator_uid` VARCHAR(64) DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL COMMENT '动作备注',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_version_log` (`version_id`, `created_at`),
  CONSTRAINT `fk_version_log_version` FOREIGN KEY (`version_id`)
    REFERENCES `product_versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品版本操作日志';
```

四张新表（2.1/2.2/2.3/本表）均需登记到 data-runtime aims app 的 `requiredTables`。

---

## 三、API 设计

### 3.1 Aims Nuxt 路由与 tenant-runtime 放行

用户态路由沿用 `forwardAimsRuntimeGet/Post` 模式，本地 handler 只做鉴权上下文与转发，runtime 未启用时 503。实现时必须同步更新 `aims/server/middleware/tenant-runtime.ts` 的 `/api/v1/**` 转发表达式：要么由 middleware 直接转发下表新增路径，要么明确放行到本地 Nuxt handler 再由 handler 调用 `forwardAimsRuntime*`。否则请求会在进入 handler 前被 middleware 拦截为 runtime 不可用或 404。

新增路径至少包括：

- `/api/v1/projects/:id/products`
- `/api/v1/projects/:id/products/:productCode`
- `/api/v1/projects/:id/products/:productCode/primary`
- `/api/v1/projects/:id/releases`
- `/api/v1/projects/:id/releases/:versionId`
- `/api/v1/projects/:id/releases/:versionId/claim`
- `/api/v1/projects/:id/releases/:versionId/transition`
- `/api/v1/projects/:id/releases/:versionId/items`
- `/api/v1/projects/:id/releases/:versionId/items/:workItemId`
- `/api/v1/projects/:id/releases/:versionId/features`
- `/api/v1/projects/:id/releases/:versionId/features/:featureId`
- `/api/v1/service/products/:productCode/versions`（service-only 本地 handler，必须从 tenant-runtime middleware 放行后再做 Console service JWT 校验）

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | `/api/v1/projects/:id/products` | 项目关联产品列表 | 项目成员 |
| POST | `/api/v1/projects/:id/products` | 添加产品关联 `{product_code, version_id?, is_primary}`（仅 `product_dev/delivery/maintenance` 项目，否则 403；`version_id` 空=不限版本） | 项目负责人 |
| PUT | `/api/v1/projects/:id/products/:productCode` | 修改关联的版本限定（改限定版本/切换为不限版本；收窄限定时校验已挂其他版本的工作项） | 项目负责人 |
| DELETE | `/api/v1/projects/:id/products/:productCode` | 移除关联（存在挂接该产品版本的工作项时拒绝） | 项目负责人 |
| PUT | `/api/v1/projects/:id/products/:productCode/primary` | 设为主产品 | 项目负责人 |
| GET | `/api/v1/projects/:id/releases` | 项目关联产品的版本列表（含进度聚合） | 项目成员 |
| POST | `/api/v1/projects/:id/releases` | 创建版本 `{product_code, version_code, name, planned_release_date, milestone_id?}`，`owner_project_id` 置为本项目 | 项目负责人 |
| GET | `/api/v1/projects/:id/releases/:versionId` | 版本详情（含功能清单 + 进度 + 最近日志） | 项目成员 |
| PUT | `/api/v1/projects/:id/releases/:versionId` | 编辑版本基本信息；仅允许归属项目修改，不承担认领语义 | 归属项目负责人 |
| POST | `/api/v1/projects/:id/releases/:versionId/claim` | 认领孤儿版本：仅当当前 `owner_project_id` 对应项目已删除，且当前项目已关联该产品 | 项目负责人 |
| POST | `/api/v1/projects/:id/releases/:versionId/transition` | 状态流转 `{to_status}`（含发布动作，写 `released_at/by`） | 归属项目负责人 |
| DELETE | `/api/v1/projects/:id/releases/:versionId` | 删除版本（仅 `planning`、无 target 工作项、无特性清单、**且无 `aims_project_products.version_id` 限定引用**） | 归属项目负责人 |
| POST | `/api/v1/projects/:id/releases/:versionId/items` | 批量挂接 target 工作项 `{work_item_ids[], feature_id?}` | 项目成员 |
| DELETE | `/api/v1/projects/:id/releases/:versionId/items/:workItemId` | 从清单移除 | 项目成员 |
| GET | `/api/v1/projects/:id/releases/:versionId/features` | 特性清单（含挂接工作项的聚合进度参考） | 项目成员 |
| POST | `/api/v1/projects/:id/releases/:versionId/features` | 新增特性 `{title, description, category, is_public}` | 归属项目负责人 |
| PUT | `/api/v1/projects/:id/releases/:versionId/features/:featureId` | 编辑特性 / 标记状态（planned/delivered/deferred）/ 调整排序 | 归属项目负责人 |
| DELETE | `/api/v1/projects/:id/releases/:versionId/features/:featureId` | 删除特性（已挂接工作项时置空其 `feature_id`） | 归属项目负责人 |

工作项创建/编辑接口扩展：现有 work-item 写接口的 body 增加可选 `version_id` / `feature_id` 字段，校验规则见 2.4（注意防绕过要求：这两列不得进入 compat 通用 CRUD 的可写字段）。

项目创建接口扩展：现有项目创建接口的 body 增加可选 `product_binding` 对象：

```jsonc
{
  "product_binding": {
    "product_code": "PRD-001",
    "mode": "new_version" | "all_versions" | "existing_version",
    "version_code": "v2.1.0",   // mode=new_version 时必填，随项目创建 planning 状态新版本并限定关联
    "version_id": 123           // mode=existing_version 时必填，限定到已有版本
  }
}
```

`mode=new_version` 时版本创建与项目创建、产品关联在 data-runtime 同一事务内完成（`is_primary=1`，新版本 `owner_project_id` 置为新项目）。

> 版本路由收在项目 scope 下而非独立 `/products/:code/versions`，目的是直接复用现有项目成员/负责人权限链路；版本实体本身仍是产品级的，同一版本在关联了同一产品的多个项目里均可见。

### 3.2 data-runtime 端点（Go）

data-runtime 端新增/扩展以下文件，同时同步 Aims Nuxt middleware：

| 文件 | 职责 |
|---|---|
| `project_products.go` | 项目↔产品关联 CRUD（含版本限定）、主产品切换、移除/收窄前置校验 |
| `projects.go`（扩展） | 项目创建接口支持 `product_binding`（同事务建版本 + 关联） |
| `product_versions.go` | 版本 CRUD、状态机流转、发布、删除前置校验；认领接口只允许把孤儿版本转给已关联该产品的当前项目 |
| `product_version_items.go` | 功能清单挂接/移除、进度聚合查询 |
| `product_version_features.go` | 特性清单 CRUD、排序、状态标记、发布锁定校验 |
| `adapter.go`（扩展） | work_items 通用 CRUD 可写字段排除 `version_id/feature_id`（见 2.4 防绕过）；新表登记 `requiredTables` |
| `aims/server/middleware/tenant-runtime.ts`（扩展） | 增加或放行产品/版本/特性相关 `/api/v1/**` 路径，确保业务数据请求统一进入 data-runtime |

端点路径遵循现有 aims 专用业务端点命名（见 `data-runtime/README.md` 清单），随实现同步登记。

### 3.3 跨模块 service API

**鉴权路径与 scope 命名（统一约定）**：两个 service-only 端点都实现在目标模块的 **Nuxt 层**，由 Foundation 校验 Console 签发的 service JWT（JWKS、`aud`、`scope`、`token_use=service`、来源应用），**不经过 data-runtime 入口的 scope 校验**。scope 采用 Console grant 的 `resource:action` 格式：`assets:read`、`aims:read`，需在 Console service client grant 中登记。Aims 的 service 端点在 Nuxt 校验通过后，经既有 tenant-runtime 转发链路取数——该内部链路使用的是 tenant runtime token 的 `aims.read`（点号格式）scope，两套 scope 属于不同信任域，不要混用命名。

Console grant 必须随实现提供迁移/种子数据，至少包含：Aims service client → `assets:read`，Assets service client → `aims:read`；Altoc 后续若直接读取 Aims 版本，同样通过 Console grant 授 `aims:read`。缺少 grant 时 `requestServiceAccessToken()` 应失败为权限不足，不得回退静态 token 或绕过来源应用校验。

**(a) Aims → Assets：产品选择器数据源**

- Aims server 持 Console service token（`audience=assets`，`scope=assets:read`，经 Foundation `requestServiceAccessToken()`）调用 Assets。
- Assets 现有 `GET /api/v1/products` 为用户态接口，需新增 service 鉴权分支或独立端点 `GET /api/v1/service/products`（返回 `product_code/product_name/product_line/status` 精简字段，支持 `keyword` 过滤），按 MODULE_CONTRACTS 统一规则验证来源应用 `aims`。
- Assets 产品数据现由 data-runtime 托管的，该 Nuxt 端点同样经 Assets 既有 runtime 转发链路取数，service JWT 校验仍在 Nuxt 层完成。

**(b) Assets → Aims：产品详情页只读版本区块**

- Aims 新增 service-only 端点 `GET /api/v1/service/products/:productCode/versions`（`audience=aims`，`scope=aims:read`，来源应用 `assets`），返回版本列表 + 进度摘要 + 特性清单（仅 `is_public=1`）+ 关联项目（project_code/name）。
- 该端点形态同时为后续 **Altoc 消费特性清单**预留：届时仅需在来源应用白名单中加入 `altoc`（售前方案/报价引用产品版本特性），无需新端点。
- Assets 产品详情页新增"版本"区块，server 侧代理调用上述端点，前端只读展示；Aims 不可达时区块降级为空态提示，不阻塞产品详情页。

### 3.4 Assets 现有版本字段的定位

Assets 的产品资产已存在 `current_version` / `target_version` 字段（runtime 目录读写均覆盖）。为避免形成第二事实源，约定：

- 这两个字段定位为**展示快照**：版本事实源是 Aims `product_versions`，Assets 字段仅供台账列表/导出快速查看。
- v1.0 不做自动同步：字段保留现有手工维护方式，Assets 产品详情页的"版本路线"区块（实时调 Aims）是权威视图；两处不一致时以 Aims 为准。
- 后续可由 Aims 版本发布动作触发回写 `current_version`（service 写接口，out of scope，立项时再评审）。
- `Assets-Design.md` 与字段注释同步标注此定位（见 §6）。

### 3.5 初始数据导入

一次性脚本：`aims/scripts/import_product_version_bindings.mjs`（package script：`pnpm import:product-version-bindings -- ...`）。脚本扫描 Assets `product_assets.project_code` 非空记录，按 `project_code → aims_projects.id` 匹配且项目 `category ∈ {product_dev, delivery, maintenance}` 的写入 `aims_project_products`（默认 `version_id=NULL` 不限版本）。匹配不上或项目类型不符的输出清单人工处理。导入后 Assets 的 `project_code` 字段保留不删（台账历史字段），但不再作为关联事实源，文档中标注。

默认不传 `--apply` 为 dry-run；可选 `--create-versions` 从 Assets `current_version` / `target_version` 创建 Aims 版本快照，可选 `--bind-target-version` 将项目关联限定到目标版本。

导入必须按项目分组并保持幂等，避免违反 `uk_project_primary`：

- 同一项目只允许一个默认产品写为 `is_primary=1`。
- 若同一项目匹配多个 Assets 产品，按确定性规则选择一个默认产品（例如最小 `product_code`，或既有导入配置显式指定的首个 `product_code`），其余写为 `is_primary=0`，并在导入报告列出供人工确认。
- 重跑导入时以 `(project_id, product_code)` upsert，仅插入缺失关联；不覆盖既有关联的 `version_id` 与人工调整过的主产品选择，除非显式传入 `--reset-primary` 一类的维护参数。

---

## 四、前端页面

### 4.1 项目设置页：关联产品区块

`aims/app/pages/projects/[id]/settings.vue` 新增"关联产品"卡片（`product_dev/delivery/maintenance` 项目显示）：

- 列表展示已关联产品（产品编码、名称、版本范围徽标——限定版本显示版本号、不限版本显示"全版本"、主产品标记），支持修改版本限定、移除、设主。
- "添加产品"打开 `UModal`：产品搜索选择器（调 3.3(a) 接口，关键字搜索）+ 版本范围选择（不限版本 / 选择已有版本）。
- 仅项目负责人可操作，其余成员只读。

### 4.2 新建项目页：产品选择与自动命名

`aims/app/pages/projects/new.vue` 扩展——当项目分类选择 `product_dev` 时展示"软件产品"区块：

- **选择产品**：产品搜索选择器（同 4.1），选定后展示产品名称与现有版本概览。
- **版本模式**（`URadioGroup` 三选一）：
  - **创建新版本**：输入版本号（如 `v2.1.0`），项目创建时同步创建 `planning` 状态新版本并限定关联 → 版本升级项目；
  - **指定已有版本**：从该产品 `planning/developing` 版本中选择 → 接手某版本的研发项目；
  - **全版本项目**：不限版本 → 产品迭代开发项目。
- **自动命名**：选定产品后按模式自动填充项目名称（可手改）——新版本/指定版本如"{产品名} {版本号} 版本研发"，全版本如"{产品名}迭代研发"；项目简称默认取产品名。
- 该区块为可选项，不选产品则与现有创建流程一致；`delivery/maintenance` 项目创建后在设置页补充关联（创建页不展示该区块，避免与客户/合同字段混杂，后续按需加入）。

### 4.3 新页面：版本管理 `projects/[id]/releases.vue`

项目导航新增"版本" Tab（位于"里程碑/计划"之后；已关联产品的项目显示。`product_dev` 项目可管理，`delivery/maintenance` 项目只读）：

- **版本列表**：按产品分组（多产品时），每行展示版本号、名称、状态 Badge、计划发布日期、进度条（`UProgress`）、功能数统计（completed/total）。关联限定了版本的项目默认聚焦该版本（直接进入版本详情视图，可切换查看产品其他版本的只读概览）。
- **新建版本**：`USlideover` 表单 — 选产品（默认主产品）、版本号、名称、说明、计划发布日期、可选关联里程碑（选择后自动带出里程碑起止日期作参考）。
- **版本详情**：`USlideover` 或子页 `releases/[versionId].vue` — 基本信息 + 状态流转按钮 + 两个清单区块：
  - **功能特性**（上方，粗粒度对外口径）：卡片/表格展示标题、分类、状态 Badge（`planned=gray`、`delivered=success`、`deferred=warning`）、对外可见标记，支持增删改、拖拽排序；挂接了工作项的特性显示聚合进度作参考。
  - **功能清单**（下方，执行口径）：target 工作项表格（编号、标题、状态、负责人、weight、所属特性），支持"挂接已有工作项"（弹出未挂版本的 target 列表多选，可同时归入某特性）与移除。
- 状态色用语义色：`planning=gray`、`developing=info`、`released=success`、`archived=gray`。

### 4.4 工作项表单与列表

- target 工作项编辑表单（创建/详情）新增"目标版本"下拉：选项为所属项目关联产品下 `planning/developing` 状态的版本，按产品分组；关联限定版本的项目仅显示该版本（默认选中）；可清空。
- 工作项列表/看板卡片展示版本标签（`UBadge`，如 `v2.1.0`），列表筛选器增加"版本"维度。

### 4.5 Assets 产品详情页（只读）

`assets/app/pages/products/[id]` 详情页新增"版本路线"只读区块：调 3.3(b) 接口展示版本列表（版本号、状态、进度、计划/实际发布日期、来源项目）。空态文案引导"在 Aims 项目中关联本产品后管理版本"。

---

## 五、权限与校验汇总

| 动作 | 角色 | 关键校验 |
|---|---|---|
| 管理产品关联 | 项目负责人 | 项目 `category ∈ {product_dev, delivery, maintenance}`；移除时：该产品版本下无本项目工作项挂接；收窄版本限定时：无挂接其他版本的工作项 |
| 创建版本 | 项目负责人 | **仅 `product_dev` 项目**；版本号产品内唯一；`owner_project_id` 置为本项目 |
| 编辑/流转/发布/删除版本 | **归属项目**负责人 | 仅 `product_dev` 项目且 `owner_project_id` = 本项目；删除仅限 `planning`、无 target 工作项、无特性清单、且无 `aims_project_products` 限定引用；`released` 需先回退才能改清单 |
| 认领版本（改归属） | 项目负责人 | 仅当原归属项目已删除；本项目须已关联该产品 |
| 挂接/移除功能清单项 | 项目成员 | 仅 target 层；工作项属本项目；版本状态为 `planning/developing`；受关联版本限定约束 |
| 管理功能特性清单 | **归属项目**负责人 | 版本 `released` 后锁定，修改需先回退版本状态 |
| 设置工作项 version_id/feature_id | 项目成员 | 仅 target 层；版本属于本项目已关联产品；关联限定版本时仅限该版本；`feature_id` 须与 `version_id` 同版本；不得经 compat 通用 CRUD 写入（见 2.4 防绕过） |
| service 端点 | — | Nuxt 层 Console JWKS + `aud` + `scope`（`resource:action` 格式）+ `token_use=service` + 来源应用校验（见 3.3） |

注意：版本对所有关联了该产品的项目可见、可挂工作项；生命周期与特性清单的编辑权通过 `owner_project_id` 收敛到归属项目（通常是创建它的版本升级项目或迭代项目）。

---

## 六、文档同步清单

| 文档 | 变更 |
|---|---|
| `docs/MODULE_CONTRACTS.md` | 登记 `product_code` 为跨模块稳定标识（事实源 Assets）；新增 Aims↔Assets 双向 service API 契约；标注 Altoc 消费版本特性清单的预留契约（来源应用白名单扩展） |
| Console service grant 迁移/文档 | 登记并落库 Aims → `assets:read`、Assets → `aims:read`；Altoc 后续读取 Aims 版本时补充 `aims:read` grant |
| `aims/docs/aims_schema.sql` | 新增 2.1/2.2/2.3/2.5 四张表与 2.4 列变更 |
| `aims/CLAUDE.md` | 补充版本管理能力与产品关联说明 |
| `assets/docs/Assets-Design.md` | 标注 `product_assets.project_code` 不再是关联事实源；标注 `current_version`/`target_version` 为展示快照（事实源 Aims，见 3.4）；新增版本只读区块说明 |
| `data-runtime/README.md` | 登记新增 aims 业务端点与 `requiredTables` 变更 |

---

## 七、实施计划

| 阶段 | 内容 | 状态 |
|---|---|---|
| P1 数据与运行时 | data-runtime schema required tables、四张表 + `work_items.version_id/feature_id`、adapter 字段黑名单、版本/特性/挂接业务端点、Console grant 种子 | 已完成 |
| P2 Aims 服务端 | tenant-runtime middleware 转发、版本认领接口、work-item 版本字段受控写入、Aims service-only 版本端点 | 已完成 |
| P3 Assets 服务端 | Assets service 产品查询/批量解析端点、Assets → Aims 产品版本代理、Console scope 校验 | 已完成 |
| P4 Aims 前端 | 设置页产品关联入口、`/projects/:id/releases` 页面、工作项版本字段展示/筛选/创建后挂接 | 已完成 |
| P5 Assets 前端 | 产品详情页版本路线只读区块 | 已完成 |
| P6 收尾 | 初始数据导入脚本、文档同步、类型检查和 Go 测试 | 已完成 |

本轮验证：

- `cd data-runtime && go test ./...`
- `cd aims && pnpm typecheck`
- `cd assets && pnpm typecheck`

**验收路径**：

1. 新建产品研发项目时选择产品 + "创建新版本 v2.1.0"，项目名自动填充 → 项目与版本同时建立、关联限定 v2.1.0；
2. 版本详情维护功能特性清单（含对外可见标记）→ target 挂接版本（选择器仅 v2.1.0，可归入特性）→ 推进任务状态 → releases 页进度自动更新 → 特性逐项标记 delivered → 发布版本（特性清单锁定）；
3. 另建全版本迭代项目关联同一产品，可见该产品全部版本；仅能管理归属本项目的版本，可向允许协作的 `planning/developing` 版本挂接本项目 target；
4. 维护类项目在设置页关联该产品并限定 v2.1.0，其 bugfix 工作项可计入该版本清单，但无法创建/流转版本；
5. Assets 产品详情页只读可见全部版本、进度与来源项目。
