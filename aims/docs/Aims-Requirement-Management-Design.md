# Aims · 需求管理模块设计方案

> 版本：v1.0
> 作者：Gavin & Claude
> 日期：2026-04-11
> 状态：已定稿，待实施
> 相关迁移：`migration_v3.0_requirement_management.sql`（待生成）
> 前置文档：`Aims-Requirement-Decomposition-Design.md`（旧的需求分解方案，本方案为其升级版）

---

## 一、设计目标与范围

### 1.1 背景与动机

旧的"需求分解"方案（v2.6）把需求规格书的章节直接落地为 `work_items(tier=target, type=requirement)`，将"需求"作为目标层工作项管理。随着实际使用，发现这种"需求即工作项"的模式存在以下问题：

1. **需求和任务混在同一张表，状态机互相干扰**：需求要走"草稿/评审/基线/变更"的生命周期，任务要走"待办/进行中/完成"的生命周期，挤在一个 `work_items.status` 字段里非常别扭。
2. **缺乏需求版本管理**：旧方案的"需求变更"是 clone 一条新的容器工作项，但具体被改的需求本身没有版本快照，无法回滚、无法 diff。
3. **缺乏需求评审环节**：旧方案直接生成需求，未对需求清单本身做评审，导致需求质量难以保证。
4. **入口收敛在分解工作项详情页，不直观**：用户期望"需求"作为项目的一等公民，在项目导航中有独立 Tab。
5. **需求与任务的语义混淆**：一条需求可能在不同迭代里被反复实现（变更后），但旧方案中"需求 1:1 对应一个 target 工作项"的设计无法表达这种关系。

### 1.2 设计目标

将"需求"提升为 Aims 模块的一等公民，提供完整的需求生命周期管理：

| 能力 | 旧方案 | 新方案 |
|---|---|---|
| 需求实体 | `work_items(type=requirement)` | 独立表 `requirement_items` |
| 需求与任务关系 | 父子（target→matter） | 1:1 引用（`work_items.requirement_id` FK） |
| 文档结构 | 不存储 | 独立表 `requirement_contents`（章节快照） |
| 需求评审 | 无 | 走 workflow，首次基线 + 后续变更两个动作 |
| 版本管理 | 无 | `requirement_versions` 快照 + `requirement_change_logs` 字段级 diff |
| 入口 | 工作项详情页按钮 | 项目导航独立 Tab `/projects/:id/requirements` |
| 导入限制 | 可重复导入 | 单次导入 + 状态锁定 |
| 导出 | 无 | 按当前章节树自动重新编号生成 md |
| 变更影响判定 | 无 | 按关联任务状态自动分支处理 |

### 1.3 范围

**本方案包含**：
- 需求规格书的导入、解析、章节展示
- 需求项的增删改查、批量操作、版本管理
- 需求评审与变更评审的 workflow 对接
- 需求 → 任务的手动创建与关联
- 需求变更对已关联任务的影响判定
- 需求规格书的回填导出

**本方案不包含（v1.0 out of scope）**：
- AI 辅助需求拆分与建议
- 需求与测试用例的双向追溯
- 需求覆盖率自动统计
- 跨项目需求复用模板
- 需求基线之间的可视化 diff（可在 timeline 中查看 JSON 快照，但不做侧边对比 UI）

### 1.4 与旧方案的兼容策略

旧方案已实施的部分（migration v2.6）保留并改造：
- `work_items.requirement_category` 列保留，迁移到 `requirement_items.type` 后清理
- `work_items.decomposition_source_id` 列保留，作为审计字段
- `work_item_source_anchors` 表逐步废弃，数据迁移到 `requirement_contents` + `requirement_items`

迁移路径详见 [第七节](#七与旧方案的迁移路径)。

---

## 二、核心决策日志

| # | 决策点 | 最终值 | 理由 |
|---|---|---|---|
| 1 | 需求实体形态 | 独立表 `requirement_items`，与 `work_items` 解耦 | 状态机/版本/字段集合都不同，强行复用会让两边都难受 |
| 2 | 需求与任务的关系 | 1:1，`work_items.requirement_id` FK | 一条需求一个交付任务；变更时另开"变更任务"作为兄弟节点 |
| 3 | 文档结构存储 | 独立表 `requirement_contents`，章节树形结构 | 章节是"原始资料"，需求是"业务承诺"，分开管理便于双向同步 |
| 4 | 章节与需求的关联 | `requirement_item_contents` 关联表（N:M，运行时按 `relation_type='baseline'` 读取） | 章节树与需求归属解耦；多个兄弟章节可合并为一需求，变更版本也可独立挂接 |
| 5 | 章节编号 | **不存储**，导出时按层级 + sort_order 自动生成 | 增删章节时不需手动维护编号 |
| 6 | 章节正文存储 | 仅本章节正文，不含子章节 | 避免重复存储；导出时按树拼接 |
| 7 | 文档导入次数 | 状态机控制：初始可导入 → 修改后警告覆盖 → 创建任务后禁止 | 防止误覆盖人工修改 |
| 8 | 标题层级模式 | H2+H3 / H3+H4 两种，导入时手动选择 | 沿用旧方案的"分类/平铺"模式 |
| 9 | 需求版本管理 | `requirement_versions` 整快照，版本间 diff 通过 JSON 对比实现 | 单层结构足够；字段级变更日志走系统统一操作日志 |
| 10 | 评审颗粒度 | 首次整批评审 → v1.0；后续变更可单条/可整批 | 基线一次性建立，迭代变更允许细粒度 |
| 11 | 评审流程对接 | 走 Workflow 模块，两个动作：`requirement_baseline` / `requirement_change` | 不自建审批流 |
| 12 | 任务创建时机 | 评审通过后**手动**创建（PM 在需求列表上点按钮） | 指派人/工时/里程碑往往评审后才定 |
| 13 | 需求编号 | 项目内全局自增 `REQ-001`，删除不复用 | 简单稳定 |
| 14 | 变更影响判定 | 按关联任务状态自动分支：未开始→直接改 / 进行中→用户选 / 已完成→强制变更任务 | 平衡灵活性与严格性 |
| 15 | 导出策略 | 生成新版本文件 `项目名-需求规格书-v1.2.md`，不覆盖原文档 | 保留原始资料，符合基线理念 |
| 16 | 图片存储 | 走 Codocs 存储 URL，文档归档锁定（codocs 配合改造） | 复用现有基础设施，避免冗余存储 |
| 17 | 需求归属里程碑 | `requirement_items.milestone_id` 软关联，可空 | 评审前可指定预计里程碑，创建任务时带入并允许调整 |
| 18 | 入口位置 | 项目导航独立 Tab `/projects/:id/requirements`，位于"概览"和"里程碑"之间 | 一等公民 |
| 19 | 规格书元信息 | 复用 `project_documents` 表（`doc_category='requirement_spec'`），新增 3 列 | 不单建 `requirement_spec_meta` 表，减少表数量 |
| 20 | 需求项字段 | 只保留管理属性（标题/类型/优先级/来源/里程碑/状态/版本），不存内容字段 | 验收标准、度量指标、描述都写在章节正文中 |
| 21 | 评审级别策略 | 用户手选，不做自动提级 | 简单明确 |
| 22 | 评审提交方式 | 复用 Foundation 的 `usePageWorkflow` + `WorkflowPanel` 右侧栏，不自建对话框 | 与项目立项/任务完成的审批体验一致，减少重复建设 |

---

## 三、数据模型 DDL

### 3.1 表清单

| 表名 | 作用 | 预估行数（中等项目） |
|---|---|---|
| `requirement_contents` | 章节树（规格书内容快照） | 50-300 行 |
| `requirement_items` | 需求项 | 30-200 行 |
| `requirement_versions` | 需求项版本快照 | 100-500 行 |
| `requirement_review_batches` | 评审批次（关联多条需求） | 5-30 行 |

外加对 `project_documents` 的 ALTER：增加规格书导入相关列。
外加对 `work_items` 的 ALTER：增加 `requirement_id` 列。

### 3.2 完整 DDL

```sql
-- ========================================================================
-- Aims · 需求管理模块迁移 (v3.0)
-- ========================================================================

-- ------------------------------------------------------------------------
-- 1. project_documents 增加规格书导入相关列
-- 说明：需求规格书复用 project_documents 表（doc_category='requirement_spec'）
-- 通过 codocs_uuid 关联 Codocs 文档，新增 3 列管理导入状态
-- ------------------------------------------------------------------------
ALTER TABLE `project_documents`
  ADD COLUMN `import_mode` ENUM('category','flat') DEFAULT NULL
    COMMENT '需求规格书导入模式: category=分类(H2+H3+H4), flat=平铺(H2+H3)',
  ADD COLUMN `heading_levels` VARCHAR(16) DEFAULT NULL
    COMMENT '使用的标题层级，如 "2,3" 或 "3,4"',
  ADD COLUMN `import_status` ENUM('not_imported','imported_clean','imported_dirty','imported_locked') DEFAULT NULL
    COMMENT '需求规格书导入状态: not_imported=未导入, imported_clean=已导入未修改, imported_dirty=已导入有修改, imported_locked=已创建任务（禁止重新导入）';

-- 注：仅 doc_category='requirement_spec' 的行会使用这 3 列，其余行这些列为 NULL

-- ------------------------------------------------------------------------
-- 2. 章节内容表（规格书的结构与正文）
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `requirement_contents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `parent_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '父章节ID，根章节为 NULL',
  `heading_depth` TINYINT UNSIGNED NOT NULL COMMENT '标题层级 2/3/4',
  `title` VARCHAR(500) NOT NULL COMMENT '章节标题（不含编号前缀）',
  `content_md` MEDIUMTEXT DEFAULT NULL COMMENT '本章节正文（Markdown），不包含子章节',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '同级章节顺序，导出时按此生成编号',
  `status` ENUM('imported','modified','deprecated') NOT NULL DEFAULT 'imported'
    COMMENT '章节状态: imported=初始导入, modified=系统内修改过, deprecated=已废弃',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_req_content_project_parent` (`project_id`, `parent_id`, `sort_order`),
  KEY `idx_req_content_project_status` (`project_id`, `status`),
  CONSTRAINT `fk_req_content_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_req_content_parent` FOREIGN KEY (`parent_id`) REFERENCES `requirement_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求规格书章节内容';

-- ------------------------------------------------------------------------
-- 3. 需求项主表
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `requirement_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `req_number` INT UNSIGNED NOT NULL COMMENT '项目内自增编号',
  `req_code` VARCHAR(32) NOT NULL COMMENT '显示编号，如 REQ-001',
  `title` VARCHAR(500) NOT NULL,
  `type` ENUM('functional','non_functional') NOT NULL DEFAULT 'functional' COMMENT '需求类型',
  `category` VARCHAR(64) DEFAULT NULL COMMENT '非功能子类: performance/security/usability/compatibility/...',
  `priority` ENUM('P0','P1','P2','P3') NOT NULL DEFAULT 'P2',
  `source` ENUM('customer','internal','compliance','regulation','other') NOT NULL DEFAULT 'internal' COMMENT '需求来源',
  `milestone_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '预计里程碑（软关联，创建任务时带入）',
  `status` ENUM('draft','in_review','baselined','change_pending','deprecated') NOT NULL DEFAULT 'draft'
    COMMENT '状态: draft=草稿, in_review=评审中, baselined=已基线, change_pending=变更评审中, deprecated=已废弃',
  `current_version` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前生效版本号，0=尚未基线',
  `baselined_at` DATETIME DEFAULT NULL COMMENT '首次基线时间',
  `created_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_req_code` (`req_code`),
  UNIQUE KEY `uk_project_req_number` (`project_id`, `req_number`),
  KEY `idx_req_project_status` (`project_id`, `status`),
  KEY `idx_req_project_type` (`project_id`, `type`),
  KEY `idx_req_milestone` (`milestone_id`),
  CONSTRAINT `fk_req_item_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_req_item_milestone` FOREIGN KEY (`milestone_id`) REFERENCES `milestones` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求项';

-- ------------------------------------------------------------------------
-- 4. 需求项版本快照表
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `requirement_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `requirement_id` BIGINT UNSIGNED NOT NULL,
  `version_no` INT UNSIGNED NOT NULL COMMENT '版本号 1, 2, 3...',
  `snapshot_json` JSON NOT NULL COMMENT '需求项全字段快照 + 关联章节ID列表',
  `change_type` ENUM('baseline','add','modify','delete','restore') NOT NULL COMMENT '变更类型',
  `change_reason` TEXT DEFAULT NULL COMMENT '变更原因',
  `batch_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属评审批次（同一次评审通过的多条需求共享）',
  `approval_workflow_id` VARCHAR(128) DEFAULT NULL COMMENT 'Workflow 实例 ID',
  `approved_by` VARCHAR(64) DEFAULT NULL,
  `approved_at` DATETIME DEFAULT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_req_version` (`requirement_id`, `version_no`),
  KEY `idx_req_version_batch` (`batch_id`),
  CONSTRAINT `fk_req_version_item` FOREIGN KEY (`requirement_id`) REFERENCES `requirement_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求项版本快照';

-- 注：字段级变更日志不再单独建表，走系统统一操作日志
-- 需求版本间 diff 通过 requirement_versions.snapshot_json 两个版本做 JSON diff 实现

-- ------------------------------------------------------------------------
-- 5. 评审批次表
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `requirement_review_batches` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `batch_type` ENUM('baseline','change') NOT NULL COMMENT 'baseline=首次基线评审, change=变更评审',
  `title` VARCHAR(255) NOT NULL COMMENT '评审批次标题，如 "项目XX需求基线评审" 或 "REQ-005变更评审"',
  `description` TEXT DEFAULT NULL,
  `requirement_ids_json` JSON NOT NULL COMMENT '本次评审涉及的需求ID列表',
  `status` ENUM('pending','approved','rejected','withdrawn') NOT NULL DEFAULT 'pending',
  `workflow_instance_id` VARCHAR(128) DEFAULT NULL,
  `submitted_by` VARCHAR(64) NOT NULL,
  `submitted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_req_batch_project_status` (`project_id`, `status`),
  KEY `idx_req_batch_workflow` (`workflow_instance_id`),
  CONSTRAINT `fk_req_batch_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求评审批次';

-- ------------------------------------------------------------------------
-- 6. work_items 增加需求关联列
-- ------------------------------------------------------------------------
ALTER TABLE `work_items`
  ADD COLUMN `requirement_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联的需求项ID（type=task 时使用）' AFTER `requirement_category`,
  ADD COLUMN `change_request_of` BIGINT UNSIGNED DEFAULT NULL COMMENT '是变更任务时，指向原任务ID' AFTER `requirement_id`,
  ADD KEY `idx_work_item_requirement` (`requirement_id`),
  ADD KEY `idx_work_item_change_request` (`change_request_of`),
  ADD CONSTRAINT `fk_work_item_requirement` FOREIGN KEY (`requirement_id`) REFERENCES `requirement_items` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_work_item_change_request` FOREIGN KEY (`change_request_of`) REFERENCES `work_items` (`id`) ON DELETE SET NULL;

-- ------------------------------------------------------------------------
-- 7. work_items.type 增加 change_request 枚举值
-- ------------------------------------------------------------------------
ALTER TABLE `work_items`
  MODIFY COLUMN `type` ENUM('requirement','task','bug','change_request') NOT NULL;

-- ------------------------------------------------------------------------
-- 8. 项目计数器复用：req_number 走 project_counters
-- ------------------------------------------------------------------------
-- project_counters 已存在表，使用 counter_type='requirement' 区分
-- 应用层调用 nextRequirementNumber(project_id) 生成 REQ-001 编号
```

### 3.3 字段设计说明

**`requirement_items.req_number` vs `req_code`**：
- `req_number` 是数据库整数自增（项目内），用于排序和计数
- `req_code` 是显示字符串 `REQ-001`，零填充三位
- 复用 `project_counters` 表保证并发安全

**`requirement_items.current_version` 的语义**：
- 0 = 草稿状态，尚未基线（首次评审前）
- 1 = 首次基线后
- 2, 3, ... = 后续每次变更评审通过后递增

**`requirement_versions.snapshot_json` 的内容**：
```json
{
  "title": "...",
  "type": "functional",
  "priority": "P1",
  "source": "customer",
  "milestone_id": 12,
  "linked_content_ids": [101, 102, 103],
  "linked_task_ids": [501]
}
```

**版本间 diff 实现**：不单独建 change_log 表，走系统统一操作日志。需要展示两个版本之间的差异时，后端对 `snapshot_json` 做 JSON diff，返回字段级对比结果给前端渲染。

**规格书元信息**：不再使用独立的 `requirement_spec_meta` 表。规格书信息复用 `project_documents` 表（`doc_category='requirement_spec'`），新增 `import_mode`、`heading_levels`、`import_status` 三列。查询规格书状态：
```sql
SELECT * FROM project_documents
WHERE project_id = ? AND doc_category = 'requirement_spec'
```

---

## 四、状态机

### 4.1 规格书导入状态机

```
                    ┌────────────────┐
                    │  not_imported  │
                    └────────┬───────┘
                             │ 用户首次导入
                             ▼
                    ┌────────────────┐
        ┌───────────│ imported_clean │◄────────┐
        │           └────────┬───────┘         │
        │                    │                 │ 用户确认覆盖
        │ 用户增删改         │ 用户重新导入   │
        │ 需求项             │ （弹"将覆盖"   │
        │                    │   确认框）     │
        ▼                    ▼                 │
┌────────────────┐  ┌────────────────┐         │
│ imported_dirty │─►│ imported_clean │─────────┘
└────────┬───────┘  └────────────────┘
         │ 用户首次创建任务
         │ 或 imported_clean → 创建任务
         ▼
┌─────────────────┐
│ imported_locked │  ★ 终态：完全禁止重新导入
└─────────────────┘
```

**触发规则汇总**：

| 当前态 | 操作 | 新态 | 是否需要确认 |
|---|---|---|---|
| not_imported | 导入文档 | imported_clean | 否 |
| imported_clean | 增/改/删需求项 | imported_dirty | 否 |
| imported_clean | 重新导入 | imported_clean | **弹一次确认**（"将覆盖现有章节内容"） |
| imported_dirty | 重新导入 | imported_clean | **弹两次确认**（"将丢失所有手工修改"） |
| imported_clean | 创建任务 | imported_locked | 否 |
| imported_dirty | 创建任务 | imported_locked | 否 |
| imported_locked | 任何重新导入 | 阻断 | 按钮置灰 + tooltip |
| imported_locked | 增/改/删 | imported_locked | 允许（已锁定的是导入入口，不是编辑权限） |

### 4.2 需求项状态机

```
                       ┌───────┐
                       │ draft │ ◄──── 首次创建/导入
                       └───┬───┘
                           │ 用户提交评审批次
                           ▼
                   ┌──────────────┐
          ┌────────│  in_review   │
          │        └──────┬───────┘
   评审拒绝               │ 评审通过
          │               │ → 写 v1 快照
          │               ▼
          │       ┌──────────────┐
          └──────►│  baselined   │ ◄────────┐
                  └──────┬───────┘          │
                         │ 用户发起变更      │ 变更评审通过
                         ▼                  │ → 写 v(n+1) 快照
                  ┌──────────────┐          │
                  │change_pending│──────────┘
                  └──────┬───────┘
                         │ 用户撤销/拒绝
                         ▼
                  （回到 baselined）

任意态（draft 除外）→ deprecated（手动废弃，不可恢复）
```

**关键约束**：
- `draft` 态可任意编辑，不写版本快照
- `in_review` / `change_pending` 态**禁止编辑**，等评审结果
- `baselined` 态编辑会自动转为 `change_pending`（提交变更草稿）
- `deprecated` 态对应的任务保持原状，不连带删除

### 4.3 需求变更对任务的影响判定

```
                         需求变更评审通过
                                │
                                ▼
                  ┌────────────────────────┐
                  │  查询关联任务当前状态  │
                  └────────────┬───────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │                  │                  │
            ▼                  ▼                  ▼
      无任务/                 in_progress       completed
      未指派/
      已指派未开始
            │                  │                  │
            ▼                  ▼                  ▼
   ┌─────────────┐    ┌─────────────────┐   ┌─────────────┐
   │ 直接更新    │    │ 弹窗用户选择    │   │ 强制生成    │
   │ 任务字段    │    │                 │   │ 变更任务    │
   │ （标题/描述/│    │ A) 直接更新     │   │             │
   │   验收标准）│    │    + 通知负责人 │   │ change_     │
   │             │    │                 │   │ request_of  │
   │ 默认弹"是否│    │ B) 生成变更任务 │   │   = 原任务  │
   │ 同步任务"  │    │    （兄弟节点） │   │             │
   │ 开关       │    │                 │   │ 原任务保持  │
   │            │    │                 │   │ completed   │
   └─────────────┘    └─────────────────┘   └─────────────┘
```

**变更任务的命名与挂载**：
- 编号：`AIMS-123-CR1`（CR = Change Request，序号自增）
- `type = 'change_request'`
- `parent_id = 原任务.parent_id`（与原任务同级，避免破坏 Epic 层级）
- `change_request_of = 原任务.id`
- `requirement_id = 原需求.id`
- `milestone_id` 由 PM 在弹窗中指定（默认沿用原任务）
- 关联到 `requirement_versions` 中本次变更的版本号（通过 `requirement_change_logs` 反查）

---

## 五、页面与组件清单

### 5.1 入口与路由

```
/projects/:id/requirements                  # 主入口（默认到子路由 spec）
/projects/:id/requirements/spec             # 规格书视图（章节树）
/projects/:id/requirements/list             # 需求项列表视图
/projects/:id/requirements/:reqId           # 需求项详情抽屉（drawer over list）
/projects/:id/requirements/import           # 导入向导
/projects/:id/requirements/review/:batchId  # 评审批次详情
```

项目导航 Tab 顺序调整为：

```
概览 | 需求 | 里程碑 | 任务看板 | 文档 | 成员 | 设置
       ↑ 新增
```

### 5.2 页面草图

#### 5.2.1 规格书视图（spec.vue）

```
┌──────────────────────────────────────────────────────────────────┐
│ 项目导航：概览 [需求] 里程碑 任务 文档                          │
├──────────────────────────────────────────────────────────────────┤
│ ┌─[规格书]─[需求列表]──┐                                        │
│                                                                  │
│ ┌─ 工具栏 ──────────────────────────────────────────────────┐  │
│ │ 状态: ✓ 已导入 (80个章节)         [导出 v1.2 ▼] [重新导入]│  │
│ │ 模式: 分类(H2+H3+H4)              [搜索章节...]            │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ ┌─ 章节树 ───────────────────────────┬─ 当前章节预览 ─────────┐ │
│ │                                    │                         │ │
│ │ ▼ 1. 概述                          │ ## 2.1 用户管理        │ │
│ │ ▼ 2. 功能需求                      │                         │ │
│ │   ▼ 2.1 用户管理 🔗REQ-003 ─┐     │ 用户管理模块负责...    │ │
│ │     • 2.1.1 登录 🔗REQ-001  │     │                         │ │
│ │     • 2.1.2 注册 🔗REQ-002  │     │ [编辑此章节] [废弃]    │ │
│ │     • 2.1.3 改密 🔗REQ-002  │←合并│                         │ │
│ │   ▶ 2.2 权限管理                   │ 关联需求项：           │ │
│ │ ▼ 3. 非功能需求                    │ • REQ-003 用户管理     │ │
│ │   ▼ 3.1 性能                       │   状态: baselined      │ │
│ │     • 3.1.1 响应时间 🔗REQ-010    │   版本: v1.0           │ │
│ └────────────────────────────────────┴─────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**交互要点**：
- 章节带 🔗 表示已关联需求项，点击高亮列表对应行
- 章节"被合并"时显示链接到同一需求的兄弟章节
- 单击章节展示右侧预览；双击进入内联编辑（更新 status 为 modified）
- 工具栏的"重新导入"按钮根据 `import_status` 显示不同状态

#### 5.2.2 需求列表视图（list.vue）

```
┌──────────────────────────────────────────────────────────────────┐
│ ┌─[规格书]─[需求列表]──┐                                        │
│                                                                  │
│ ┌─ 筛选 ─────────────────────────────────────────────────────┐  │
│ │ [类型 ▼] [状态 ▼] [优先级 ▼] [里程碑 ▼] [来源 ▼] [搜索]  │  │
│ │ □ 显示已废弃                       [+ 新增需求] [批量评审]│  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ ☐│编号    │标题       │类型│优先│状态     │里程碑│任务   │  │
│ │──┼────────┼───────────┼────┼────┼─────────┼──────┼───────┤  │
│ │ ☐│REQ-001 │用户登录   │功能│ P0 │baselined│M1    │AIMS-1 │  │
│ │ ☐│REQ-002 │用户注册   │功能│ P1 │baselined│M1    │AIMS-2 │  │
│ │ ☐│REQ-003 │用户管理   │功能│ P1 │draft    │ -    │  -    │  │
│ │ ☐│REQ-010 │响应时间   │非功│ P2 │baselined│M1    │AIMS-5 │  │
│ │  │        │≤200ms    │    │    │         │      │       │  │
│ │ ☐│REQ-011 │权限管理   │功能│ P0 │change_  │M2    │AIMS-3 │  │
│ │  │        │           │    │    │pending  │      │ +CR1  │  │
│ └────────────────────────────────────────────────────────────┘  │
│ 共 25 条 · 草稿 3 · 评审中 2 · 已基线 18 · 变更中 2            │
└──────────────────────────────────────────────────────────────────┘
```

**批量操作**：
- 勾选多条 → "批量评审" / "批量改优先级" / "批量改里程碑" / "批量删除"
- 批量评审会进入评审提交对话框（5.2.5）

#### 5.2.3 需求项详情抽屉（[reqId] drawer）

从右侧滑出，覆盖列表 60% 宽度。

```
┌─ REQ-001 用户登录 ────────────────────────[版本: v1.0] [✕] ┐
│                                                              │
│ 状态: ● baselined  类型: 功能  优先级: P0  来源: customer  │
│ 预计里程碑: M1 (2026-04-30)                                 │
│                                                              │
│ ┌─[详情]─[关联章节]─[关联任务]─[版本历史]─[变更日志]─┐    │
│                                                              │
│ ## 描述                                                      │
│ （来自关联章节 2.1.1 登录 的内容，懒加载渲染）              │
│ 用户应能通过用户名+密码或手机号+验证码登录系统...           │
│                                                              │
│ ## 验收标准                                                  │
│ 1. 错误密码连续 5 次锁定账号 30 分钟                        │
│ 2. 登录成功后跳转到首页                                      │
│ 3. 支持记住登录状态 7 天                                     │
│                                                              │
│ ## 关联章节                                                  │
│ • 2.1.1 登录 (主关联)                                       │
│                                                              │
│ ## 关联任务                                                  │
│ • AIMS-101 实现登录页面 [in_progress] @张三                 │
│                                                              │
│ [编辑] [发起变更] [创建任务] [废弃]                         │
└──────────────────────────────────────────────────────────────┘
```

**Tab 切换**：
- **详情**：当前展示
- **关联章节**：列出所有 `requirement_item_contents.requirement_id = this.id` 且 `relation_type='baseline'|'change'` 的章节
- **关联任务**：任务列表 + 状态 + 指派人，包括变更任务（CR）
- **版本历史**：timeline，每个版本展示快照 JSON 的关键字段，点击可查看与上一版的 diff

**按钮权限**：
- `draft` 态：编辑按钮可用，提交评审 / 删除
- `in_review` / `change_pending` 态：所有按钮禁用，显示"等待评审"
- `baselined` 态：编辑触发"发起变更"流程，可创建任务（如未创建）
- `deprecated` 态：所有按钮禁用，仅展示

#### 5.2.4 导入向导（import.vue）

```
┌─ 导入需求规格书 ─ Step 2/3 ─ 选择章节与模式 ────────────────┐
│                                                              │
│ 源文档: PRD-V1.2.md (来自 Codocs)         [更换文档]        │
│                                                              │
│ 模式: ● 分类(H2+H3+H4)  ○ 平铺(H2+H3)   [启发式: 分类]    │
│                                                              │
│ ┌─ 章节树预览 ──────────────────────────────────────────┐  │
│ │ ▼ 2. 功能需求            （H2 分类标签，跳过）         │  │
│ │   ▼ 2.1 用户管理          ☐ 整体作为需求              │  │
│ │     ▼ 2.1.1 登录          ☑ 创建为需求 → REQ-001     │  │
│ │     ▼ 2.1.2 注册          ☑ 创建为需求 → REQ-002     │  │
│ │     ▼ 2.1.3 改密          ☑ ↗合并到REQ-002           │  │
│ │   ▶ 2.2 权限管理                                       │  │
│ │ ▼ 3. 非功能需求                                        │  │
│ │   ▼ 3.1 性能                                           │  │
│ │     ▼ 3.1.1 响应时间      ☑ 创建为需求 → REQ-010     │  │
│ │                              类型: 自动=非功能 ▼      │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ 已选 4 条需求 · 跳过 3 个章节                              │
│                                                              │
│                          [上一步] [取消] [下一步: 评审提交]│
└──────────────────────────────────────────────────────────────┘
```

**Step 1**: 文档选择 + 模式选择
**Step 2**: 章节勾选 + 合并设置（如上图）
**Step 3**: 评审批次提交（提交人/评审级别/附言）

注意：导入完成后，需求处于 `draft` 态。Step 3 提交评审是**可选**的，PM 可以先导入草稿，后续整理完再批量提交。

#### 5.2.5 评审提交（通过 LayoutSidebar + WorkflowPanel）

需求评审和变更评审**不使用自建对话框**，而是通过 Foundation 提供的 `usePageWorkflow` + `WorkflowPanel` 侧边栏实现，与项目立项、任务完成等审批方式完全一致。

**基线评审**：在需求列表页（list.vue）勾选多条 draft 需求后，页面注册 `requirement_baseline` 动作，右侧栏自动出现 WorkflowPanel，用户在侧边栏中填写评审说明并提交。

**变更评审**：在需求详情抽屉中编辑 baselined 态的需求后，页面注册 `requirement_change` 动作，右侧栏出现 WorkflowPanel + 变更预览（diff 摘要 + 任务影响面板）。

```
┌──────────────────────────────────────────────┬─ 右侧栏（LayoutSidebar）──┐
│                                              │                            │
│  需求列表（主内容区）                        │  ┌─ WorkflowPanel ──────┐ │
│                                              │  │                      │ │
│  ☑ REQ-001 用户登录       P0  baselined     │  │ 需求基线评审         │ │
│  ☑ REQ-002 用户注册       P1  draft         │  │                      │ │
│  ☑ REQ-003 用户管理       P1  draft         │  │ 涉及 3 条需求        │ │
│  ☑ REQ-010 响应时间≤200ms P2  draft         │  │                      │ │
│                                              │  │ 说明: [          ]   │ │
│  [批量基线评审] ← 触发右侧栏出现            │  │                      │ │
│                                              │  │ ⚠ 完备性检查:       │ │
│                                              │  │   REQ-002 无里程碑   │ │
│                                              │  │                      │ │
│                                              │  │ [提交评审]           │ │
│                                              │  └──────────────────────┘ │
└──────────────────────────────────────────────┴────────────────────────────┘
```

**usePageWorkflow 集成示例**（基线评审）：

```ts
const { isReadonly } = usePageWorkflow({
  appCode: 'aims',
  resourceCode: 'requirements',
  bizId: computed(() => String(batchId.value)),
  bizTitle: computed(() => `${project.value.name} 需求基线评审 (${selectedReqs.value.length} 条)`),
  actions: computed(() => {
    if (!selectedReqs.value.length) return []
    return [{
      actionCode: 'requirement_baseline',
      actionName: '需求基线评审',
      icon: 'ClipboardCheck',
      canSubmit: computed(() => completenessIssues.value.length === 0),
      completenessIssues,
      async beforeSubmit() {
        // 创建评审批次 + 设置需求状态为 in_review
        const batch = await $fetch(`/api/v1/projects/${projectId}/requirement-reviews`, {
          method: 'POST',
          body: {
            batchType: 'baseline',
            requirementIds: selectedReqs.value.map(r => r.id)
          }
        })
        batchId.value = batch.id
      },
      async onApproved() {
        // 审批通过回调：写版本快照、更新状态为 baselined
        await refreshRequirements()
      },
      async onRejected() {
        // 审批拒绝回调：恢复状态为 draft
        await refreshRequirements()
      }
    }]
  })
})
```

**usePageWorkflow 集成示例**（变更评审）：

```ts
// 在需求详情页中
const { isReadonly } = usePageWorkflow({
  appCode: 'aims',
  resourceCode: 'requirements',
  bizId: computed(() => String(changeBatchId.value)),
  bizTitle: computed(() => `${req.value.reqCode} 变更评审`),
  actions: computed(() => {
    if (req.value.status !== 'change_pending') return []
    return [{
      actionCode: 'requirement_change',
      actionName: '需求变更评审',
      icon: 'FilePenLine',
      canSubmit: computed(() => changeImpactResolved.value),
      completenessIssues: changeCompleteness,
      async beforeSubmit() {
        // 保存变更草稿 + 创建评审批次
        await saveChangeDraft()
      },
      async onApproved() {
        // 写版本快照、处理任务影响（生成变更任务 or 直接更新）
        await handleChangeApproved()
      }
    }]
  })
})
```

#### 5.2.6 变更影响面板（嵌入详情页主内容区）

变更时的"任务影响分析"不放在侧边栏中（空间不够），而是作为需求详情页的内嵌面板展示：

```
┌─ REQ-001 用户登录 · 变更中 ──────────────────┬─ WorkflowPanel ─┐
│                                               │                  │
│ ## 变更摘要                                    │ 需求变更评审     │
│ • 优先级: P0 → P1                             │                  │
│ • 章节 2.1.1 内容已修改                       │ 变更原因:        │
│                                               │ [客户要求增加    │
│ ## 关联任务影响                               │  微信登录支持  ] │
│ ┌──────────────────────────────────────────┐ │                  │
│ │ AIMS-101 实现登录页面                     │ │ ⚠ 完备性:       │
│ │ 状态: in_progress  指派: @张三            │ │   影响面板待确认 │
│ │ ⚠ 任务正在进行中，请选择处理方式：       │ │                  │
│ │   ○ 直接更新任务并通知负责人              │ │ [提交变更评审]   │
│ │   ● 生成变更任务 AIMS-101-CR1（推荐）     │ │                  │
│ │     里程碑: [M2 ▼]  指派: [@张三 ▼]      │ │                  │
│ └──────────────────────────────────────────┘ │                  │
└───────────────────────────────────────────────┴──────────────────┘
```

WorkflowPanel 的 `completenessIssues` 动态检查"影响面板中所有任务是否已选择处理方式"，未全部确认则按钮置灰。

### 5.3 组件清单

```
aims/app/
├── pages/
│   └── projects/
│       └── [id]/
│           └── requirements/
│               ├── index.vue                  # 重定向到 spec
│               ├── spec.vue                   # 规格书视图
│               ├── list.vue                   # 需求列表视图
│               ├── import.vue                 # 导入向导
│               └── review/
│                   └── [batchId].vue          # 评审批次详情
├── components/
│   └── requirements/
│       ├── RequirementTabsHeader.vue          # 顶部 [规格书]/[列表] 切换
│       ├── spec/
│       │   ├── SpecToolbar.vue                # 工具栏（状态/导出/重新导入）
│       │   ├── ChapterTree.vue                # 章节树（递归）
│       │   ├── ChapterPreview.vue             # 右侧章节预览
│       │   ├── ChapterEditor.vue              # 内联编辑器（Milkdown 简化版）
│       │   └── ExportSpecDialog.vue           # 导出对话框（输入版本号）
│       ├── list/
│       │   ├── RequirementFilters.vue         # 筛选栏
│       │   ├── RequirementTable.vue           # 列表主体
│       │   ├── RequirementStatusBadge.vue     # 状态徽章
│       │   └── BatchActionMenu.vue            # 批量操作菜单
│       ├── detail/
│       │   ├── RequirementDrawer.vue          # 详情抽屉容器
│       │   ├── RequirementDetailTab.vue
│       │   ├── RequirementContentsTab.vue
│       │   ├── RequirementTasksTab.vue
│       │   └── RequirementVersionsTab.vue     # timeline + 点击查看版本 diff
│       ├── import/
│       │   ├── ImportStepDocSelect.vue        # Step 1
│       │   ├── ImportStepOutline.vue          # Step 2
│       │   └── ImportStepReview.vue           # Step 3
│       ├── review/
│       │   └── ReviewBatchDetail.vue          # 批次详情页主体（含审批历史 timeline）
│       └── change/
│           ├── ChangeSummaryPanel.vue          # 变更摘要面板（字段 diff 展示）
│           ├── TaskImpactPanel.vue             # 任务影响判定面板
│           └── ChangeRequestTaskBuilder.vue    # 变更任务表单（里程碑/指派/工时）
└── composables/
    ├── useRequirementSpec.ts                  # 规格书 CRUD（chapter tree）
    ├── useRequirementList.ts                  # 需求列表筛选/分页
    ├── useRequirementDetail.ts                # 单个需求详情 + tabs
    ├── useRequirementImport.ts                # 导入向导状态机
    ├── useRequirementReview.ts                # 评审批次 CRUD + completeness 检查
    ├── useRequirementChange.ts                # 变更提交 + 影响判定 + completeness
    ├── useRequirementExport.ts                # 导出（生成 md）
    └── useMarkdownOutline.ts                  # 复用旧 decompose 的解析器
```

---

## 六、API 清单

全部位于 `aims/server/api/v1/`。

### 6.1 规格书与章节

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/projects/:id/requirements/spec` | 取规格书元信息 + 章节树 |
| GET | `/projects/:id/requirements/spec/export?version=v1.2` | 生成导出 md，返回文件流 |
| POST | `/projects/:id/requirements/spec/import` | 导入规格书（含章节解析与需求项创建） |
| POST | `/projects/:id/requirements/spec/reimport` | 重新导入（带强制覆盖标记） |
| PATCH | `/requirement-contents/:id` | 编辑章节标题/正文（status → modified） |
| DELETE | `/requirement-contents/:id` | 废弃章节（status → deprecated） |
| POST | `/requirement-contents/:id/insert` | 新增同级或子章节 |

### 6.2 需求项

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/projects/:id/requirements` | 列表（支持筛选/分页/排序） |
| GET | `/requirements/:reqId` | 单条详情（含关联章节、任务、版本概览） |
| POST | `/projects/:id/requirements` | 新建需求项（draft 态） |
| PATCH | `/requirements/:reqId` | 编辑（draft 态直接改；baselined 态自动转 change_pending） |
| DELETE | `/requirements/:reqId` | 草稿态硬删除；其他态软删（status → deprecated） |
| POST | `/requirements/:reqId/restore` | 从 deprecated 恢复（需评审） |
| POST | `/requirements/batch/update` | 批量改字段（priority/milestone/...） |

### 6.3 评审与变更

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/projects/:id/requirement-reviews` | 提交评审批次（首次基线 or 整批变更） |
| GET | `/requirement-reviews/:batchId` | 评审批次详情 |
| POST | `/requirement-reviews/:batchId/approve` | Workflow 回调：通过 |
| POST | `/requirement-reviews/:batchId/reject` | Workflow 回调：拒绝 |
| POST | `/requirements/:reqId/change` | 单条需求变更（自动建批次） |
| GET | `/requirements/:reqId/change-impact` | 查询变更对关联任务的影响 |
| GET | `/requirements/:reqId/versions` | 版本快照列表 |
| GET | `/requirements/:reqId/versions/:versionNo` | 单个版本快照详情 |
| GET | `/requirements/:reqId/versions/:versionNo/diff` | 与上一版本的 JSON diff（字段级对比） |

### 6.4 需求 → 任务

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/requirements/:reqId/create-task` | 为需求创建关联任务（需求需为 baselined 态） |
| POST | `/requirements/:reqId/create-change-task` | 创建变更任务（change_request_of 指向原任务） |
| GET | `/requirements/:reqId/tasks` | 列出关联任务（包含 CR） |

### 6.5 关键 payload 示例

#### 导入接口

```ts
POST /projects/:id/requirements/spec/import
Body: {
  codocsUuid: string,
  docName: string,
  mode: 'category' | 'flat',
  headingLevels: '2,3,4' | '2,3' | '3,4',
  items: Array<{
    // 章节树（嵌套结构，前端解析后传过来）
    title: string,
    headingDepth: 2 | 3 | 4,
    contentMd: string,
    children: Array<{...}>,
    // 标记：是否作为需求项创建，及合并组
    asRequirement: boolean,
    mergeGroupId?: string,  // 合并到同一需求时，多个章节共享 groupId
    requirementType?: 'functional' | 'non_functional',
    requirementCategory?: string  // 非功能子类
  }>
}

Response: {
  contentsCreated: number,
  requirementsCreated: number,
  requirementIds: number[],
  specMeta: { importStatus: 'imported_clean', ... }
}
```

#### 变更影响查询

```ts
GET /requirements/:reqId/change-impact

Response: {
  linkedTasks: Array<{
    id: number,
    itemKey: string,
    title: string,
    status: 'todo' | 'in_progress' | 'completed',
    assigneeUid: string | null,
    impactCategory: 'safe_to_update' | 'user_choice' | 'force_change_request'
  }>,
  // 整体建议
  recommendation: 'direct_update' | 'mixed' | 'change_request_only'
}
```

#### 变更提交

```ts
POST /requirements/:reqId/change
Body: {
  changes: {
    title?: string,
    priority?: 'P0'|'P1'|'P2'|'P3',
    source?: 'customer'|'internal'|'compliance'|'regulation'|'other',
    milestoneId?: number | null,
    // ...其他管理属性字段（内容变更走章节编辑）
  },
  changeReason: string,
  reviewLevel: 1 | 2 | 3 | 4,
  taskActions: Array<{
    taskId: number,
    action: 'direct_update' | 'change_request',
    // action=change_request 时必填
    crMilestoneId?: number,
    crAssigneeUid?: string,
    crEstimatedHours?: number
  }>
}

Response: {
  batchId: number,
  workflowInstanceId: string,
  pendingTasks: number[]  // 等待审批通过后才会真正生成的变更任务计划
}
```

注意：变更任务**不在提交时立即创建**，而是在审批通过的回调中创建。审批拒绝则计划作废。

---

## 七、与旧方案的迁移路径

### 7.1 现状分析

旧的 v2.6 已经在生产环境跑过：
- `work_items` 表中存在 `tier=target, type=requirement` 的需求行
- `work_item_source_anchors` 表存了章节锚点
- `work_items.requirement_category` 标记了需求类型
- `work_items.decomposition_source_id` 标记了来源

### 7.2 迁移脚本（伪代码）

```sql
-- 步骤 1: 创建新表（v3.0 DDL：ALTER project_documents + 建 requirement_contents/items/versions/batches）

-- 步骤 2: 为每个有需求数据的项目，在 project_documents 中插入一条 requirement_spec 记录
INSERT INTO project_documents (uuid, project_id, title, doc_category, import_status, ...)
SELECT UUID(), DISTINCT project_id, '需求规格书(迁移)', 'requirement_spec', 'imported_locked', ...
FROM work_items WHERE type = 'requirement';

-- 步骤 3: 把 work_items(type=requirement) 迁移到 requirement_items
INSERT INTO requirement_items (
  project_id, req_number, req_code, title, type, priority,
  status, current_version, baselined_at, created_by, created_at
)
SELECT
  project_id,
  ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY id) AS req_number,
  CONCAT('REQ-', LPAD(ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY id), 3, '0')),
  title,
  CASE WHEN requirement_category = 'non_functional' THEN 'non_functional' ELSE 'functional' END,
  priority,
  'baselined',
  1,
  created_at,
  reporter_uid,
  created_at
FROM work_items
WHERE type = 'requirement' AND tier = 'target';

-- 步骤 4: 把 work_item_source_anchors 转换为 requirement_contents
-- 4.1 按 (project_id, source_document_uuid) 分组建立 contents 树
-- 4.2 anchor 中的"编号 + 标题" → 拆出 title（去掉编号前缀）
-- 4.3 heading_depth 复用
-- 4.4 sort_order 按原始锚点出现顺序
-- 4.5 requirement_id 通过 work_item_id 反查到新的 requirement_items.id
-- （需要写应用层 Node.js 脚本而非纯 SQL，因为需要解析锚点字符串）

-- 步骤 5: 把已有的 task 工作项关联到需求
UPDATE work_items t
JOIN work_items r ON t.parent_id = r.id AND r.type = 'requirement'
JOIN requirement_items ri ON ri.title = r.title AND ri.project_id = r.project_id
SET t.requirement_id = ri.id
WHERE t.type = 'task';

-- 步骤 6: 为每个迁移过来的需求生成 v1 版本快照
INSERT INTO requirement_versions (
  requirement_id, version_no, snapshot_json, change_type,
  change_reason, approved_at, created_by, created_at
)
SELECT
  id, 1,
  JSON_OBJECT('title', title, 'type', type, 'priority', priority, ...),
  'baseline',
  '从 v2.6 迁移',
  baselined_at,
  created_by,
  created_at
FROM requirement_items;

-- 步骤 7: 删除 work_items 中的 type=requirement 行（保留 type=task 关联到新需求）
DELETE FROM work_items WHERE type = 'requirement' AND tier = 'target';

-- 步骤 8: 标记旧表为废弃（保留观察期）
ALTER TABLE work_item_source_anchors COMMENT '【已废弃】v3.0 起请使用 requirement_contents';
```

### 7.3 灰度发布建议

- **第一阶段（第 1 周）**：数据库迁移在测试环境跑通；后端新接口与旧接口共存
- **第二阶段（第 2-3 周）**：前端新页面上线，旧的"分解工作项详情页"按钮置灰，跳转新页面
- **第三阶段（第 4 周）**：移除旧的 decompose 相关代码与组件
- **第四阶段（第 6 周）**：drop `work_item_source_anchors` 表

---

## 八、Workflow 集成

### 8.1 评审动作定义

在 Aims 的 `Aims-Approval-Actions-Manifest.md` 中追加两个动作：

```yaml
- action_key: requirement_baseline
  display_name: 需求基线评审
  category: requirements
  description: 项目首次或新增一批需求的基线评审
  default_review_level: 1
  callback_url: /api/v1/requirement-reviews/:batchId/approve
  reject_callback_url: /api/v1/requirement-reviews/:batchId/reject

- action_key: requirement_change
  display_name: 需求变更评审
  category: requirements
  description: 已基线需求的变更评审
  default_review_level: 2
  callback_url: /api/v1/requirement-reviews/:batchId/approve
  reject_callback_url: /api/v1/requirement-reviews/:batchId/reject
```

注：评审级别由用户在提交时手选，不做自动提级策略。

### 8.2 评审流程（通过 LayoutSidebar + WorkflowPanel）

需求评审**不自建对话框**，复用 Foundation 的 `usePageWorkflow` + `WorkflowPanel` 右侧栏模式，与项目立项、任务完成等审批体验一致。

```
1. 用户在需求列表页勾选 draft 态需求 → 页面通过 usePageWorkflow 注册 requirement_baseline 动作
   → LayoutSidebar 右侧栏自动出现 WorkflowPanel
   ↓
2. 用户点击 WorkflowPanel 中的 [提交评审]
   → WorkflowPanel 调用 beforeSubmit() 钩子
   → beforeSubmit() 内：
     a) POST /projects/:id/requirement-reviews 创建 requirement_review_batches 行
     b) 把涉及的需求项 status 改为 in_review
   → WorkflowPanel 自动调 prepareInstance() + createInstance() 提交到 Workflow 服务
   → 拿回 workflow_instance_id 写入 batch 表
   ↓
3. 评审人在 Workflow 模块 / 审批中心审批
   （LayoutSidebar 自动检测：如果当前用户是审批人，显示"通过/驳回"按钮）
   ↓
4. Workflow 回调 Aims：
   POST /api/v1/requirement-reviews/:batchId/approve
   ↓
5. Aims 事务处理（onApproved 回调）：
   a) 更新 batch.status = 'approved'
   b) 对每条需求：
      - 写 requirement_versions 快照 (version_no = current_version + 1)
      - 更新 requirement_items.current_version 和 status = 'baselined'
      - baseline 类型时设置 baselined_at
   c) 如果是 change 批次，处理 taskActions：
      - direct_update: 更新关联任务字段
      - change_request: 创建变更任务（status=todo）
```

### 8.3 与 Foundation 的对接

通过 `usePageWorkflow` composable 注册审批动作（而非直接调 useWorkflow.submit），WorkflowPanel 组件自动处理实例创建、状态轮询、审批操作。

页面只需关注：
- `actions[]` 动作注册（actionCode/canSubmit/completenessIssues）
- `beforeSubmit()` 钩子（创建批次、更新需求状态）
- `onApproved()` / `onRejected()` 回调（写快照、处理任务影响）

`isReadonly` 返回值用于控制页面编辑权限：审批流进行中时，需求项表单自动只读。

---

## 九、实施阶段拆分

| 阶段 | 工作内容 | 预计 | 依赖 |
|---|---|---|---|
| 1 | 数据库迁移脚本 + schema 更新 + 单测 | 1d | - |
| 2 | 后端：spec_meta + 章节 CRUD + 导入解析 | 1.5d | 1 |
| 3 | 后端：需求项 CRUD + 列表筛选 + 批量操作 | 1d | 1 |
| 4 | 后端：评审批次 + Workflow 对接 + 回调 | 1.5d | 3 |
| 5 | 后端：变更影响判定 + 变更任务生成 | 1d | 4 |
| 6 | 后端：导出 md 生成器 | 0.5d | 2 |
| 7 | 前端：导入向导（复用 decompose 解析） | 1d | 2 |
| 8 | 前端：规格书视图（章节树 + 预览 + 编辑） | 1.5d | 2 |
| 9 | 前端：需求列表 + 筛选 + 批量 | 1d | 3 |
| 10 | 前端：需求详情抽屉 + 4 个 Tab | 1.5d | 3-5 |
| 11 | 前端：评审/变更对话框 + 影响面板 | 1d | 4-5 |
| 12 | 旧 decompose 数据迁移 + 灰度切换 | 1d | 1-11 |
| 13 | 联调 + typecheck + 手动 QA | 1d | 全部 |
| **合计** | | **~14 天** | |

可分两个迭代：
- **Sprint 1**（约 7d）：阶段 1-6 + 阶段 8 主体（不含编辑）。可达成"导入 + 浏览 + 列表"的最小可用版本
- **Sprint 2**（约 7d）：阶段 7、9、10、11、12、13。完成评审、变更、导出、迁移

---

## 十、开工前待核实

1. **Workflow 模块的 action_key 注册接口**：是否支持 Aims 自助注册新动作，还是需要在 Workflow 数据库手动 seed？
2. **`useWorkflow` composable 的回调机制**：Workflow 审批通过后如何回调 Aims？是 HTTP webhook 还是 Workflow 主动 PATCH？
3. **`project_counters` 表是否支持新增 counter_type**：当前是否已有泛化机制，还是需要新增字段或新表？
4. **Codocs 文档归档接口**：是否已有 `archived` 字段或类似机制？如无，需要 codocs 模块新增接口。
5. **现有 `work_items.parent_id` 触发器**：变更任务作为原任务的兄弟节点（而非子节点）是否会被现有触发器拦截？需要验证。
6. **Milkdown 嵌入式编辑器**：章节内联编辑用什么组件？是嵌入完整 Codocs 的 Milkdown 还是简化版 textarea？建议第一版用 textarea，后续升级。
7. **导出 md 的图片 URL 处理**：图片 URL 直接保留指向 Codocs OSS 的地址，导出后用户在外部打开 md 时图片是否可访问？需测试 OSS 的公有读权限。
8. **`project_documents` 表现有约束 `chk_doc_single_owner`**：要求 portfolio_id/project_id/milestone_id/work_item_id 恰好设一个。规格书用 `project_id`，需确认导入时其余三列为 NULL 是否满足此约束。

---

## 十一、未来扩展（v1.5+）

- **AI 辅助**：基于章节正文自动建议需求拆分粒度、优先级、验收标准
- **需求覆盖率统计**：仪表盘展示"已基线 / 已开发 / 已测试 / 已上线" 各阶段比例
- **需求与测试用例双向追溯**：对接 Aims 测试管理模块
- **跨项目需求模板库**：常用的非功能需求模板（性能/安全/合规）
- **需求基线 diff 可视化**：版本间的并排对比 UI
- **需求文档多份支持**：同一项目支持多份规格书（如功能 PRD + 接口 PRD 分开管理）
- **需求评审会议记录集成**：评审通过/拒绝时附带会议纪要

---

## 附录 A · 需求字段完整定义

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| req_code | string | 自动 | 如 REQ-001 |
| title | string | ✓ | 需求标题，不超过 500 字 |
| type | enum | ✓ | functional / non_functional |
| category | string | 条件 | type=non_functional 时建议填，如 performance |
| priority | enum | ✓ | P0/P1/P2/P3 |
| source | enum | ✓ | customer/internal/compliance/regulation/other |
| milestone_id | int | 否 | 预计里程碑（软关联） |
| status | enum | 自动 | 状态机管理 |
| current_version | int | 自动 | 0=未基线，1+=已基线版本 |

注：验收标准、度量指标、详细描述等内容全部写在关联章节的正文（`requirement_contents.content_md`）中，需求项表只存管理属性。

## 附录 B · 状态对照速查

| requirement_items.status | 含义 | 可编辑 | 可发起评审 | 可发起变更 | 可创建任务 |
|---|---|---|---|---|---|
| draft | 草稿 | ✓ | ✓（首次基线） | - | - |
| in_review | 评审中 | - | - | - | - |
| baselined | 已基线 | ✓ → 转 change_pending | - | ✓ | ✓ |
| change_pending | 变更评审中 | - | - | - | - |
| deprecated | 已废弃 | - | - | - | - |

## 附录 C · 相关文档

- [Aims-Requirement-Decomposition-Design.md](./Aims-Requirement-Decomposition-Design.md) — 旧的 v2.6 分解方案
- [Aims-Approval-Actions-Manifest.md](./Aims-Approval-Actions-Manifest.md) — Aims 审批动作清单
- [Aims-Design.md](./Aims-Design.md) — Aims 整体设计
- [Aims-PRD.md](./Aims-PRD.md) — Aims 产品需求
- [aims_schema.sql](./aims_schema.sql) — 数据库 schema
- [汇智PIVR项目管理生命周期模型说明书V1.0.md](./汇智PIVR项目管理生命周期模型说明书V1.0.md) — PIVR 方法论
