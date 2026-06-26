# Aims · 需求分解功能设计方案

> 版本：v1.0
> 作者：Gavin & Claude
> 日期：2026-04-11
> 状态：已定稿，待实施
> 相关迁移：`migration_v2.6_requirement_decomposition.sql`

---

## 一、功能目标

从一篇 **Markdown 格式的需求文档**（由 Codocs 管理）出发，通过提取 H2–H4 标题构建大纲树，允许用户勾选章节生成需求（target）和开发任务（matter），一次性批量创建，并自动挂接交付物要求。

整个"分解活动"本身作为可审批、可记工时的 **分解工作项（requirement_breakdown）**，完成分解提交后记录投入工时、走审批、归档为已完成任务。后续需求变更复用同一机制，通过 **需求变更工作项（requirement_change）** 反复启动。

---

## 二、核心设计决策（决策日志）

| # | 决策 | 最终值 | 说明 |
| -- | -- | -- | -- |
| 1 | 源文档范围 | 仅"项目已关联的 Codocs 文档"（通过 `project_documents.codocs_uuid` 匹配） | 不做全局搜索 |
| 2 | 文档结构识别 | 两种模式：**分类模式** / **平铺模式**，用户手动切换，启发式给默认值 | 自动识别不可靠 |
| 3 | 标题编号前缀 | **保留**（如 "2.1.1 登录"） | 便于开发者定位原文 |
| 4 | 描述存储方式 | **不复制正文到 `description`**，改用 **锚点关联表** + Codocs 运行时懒加载 | 单一数据源，避免污染 |
| 5 | 功能/非功能区分 | 存字段 `requirement_category ∈ {functional, non_functional}`，平铺模式为 NULL | 英文枚举，利于 i18n |
| 6 | 非功能需求形态 | **仍然创建 target 层**，与功能需求对称；差别只在子 task 的交付物类型 | 不破坏 PIVR 两层模型 |
| 7 | 交付物自动规则 | 功能需求 task → `code`；非功能需求 task → `document`（行级可切 `artifact`） | 自动创建 deliverable |
| 8 | target 行级形态 | **拆分为任务** / **直转任务** 两选一；无子标题时强制直转 | 灵活适配原开发任务务 |
| 9 | 打包合并 | 勾选多个同级子标题 → "合并为一个任务"，可拆分还原 | 跨 target 的合并禁止 |
| 10 | 里程碑定位 | 通过 `template_key='requirement_breakdown'` 精确匹配 | 模板里预埋 |
| 11 | 入口位置 | 仅在 `template_key ∈ {requirement_breakdown, requirement_change}` 的工作项详情页 | 收敛入口 |
| 12 | 层级结构 | **扁平化**：分解产物的 `parent_id` 只用于 target→task，不挂到分解工作项下 | 看板无需适配 |
| 13 | 活动溯源 | 新增 `work_items.decomposition_source_id` 指向产生它的分解/变更工作项 | 独立于 parent_id |
| 14 | 提交流程 | 提交时录工时 → 走审批 → 通过后分解工作项状态变为 completed | 复用现有审批 |
| 15 | 需求变更 | 每次变更从模板 clone 一条新的 `requirement_change` 工作项实例 | 每次变更一条记录，历史清晰 |
| 16 | 增量分解 | 已分解锚点自动锁定，可追加；父锚点已是 target 的自动复用 parent_id | 支持分多次完成 |

---

## 三、文档结构的两种模式

### 3.1 分类模式（Category Mode）

**适用场景**：需求文档按"功能需求 / 非功能需求"等类别组织。

```markdown
# 项目需求文档
## 1. 概述               ← 跳过
## 2. 功能需求           ← 作为"分类"标签
### 2.1 用户管理         ← target (requirement)
#### 2.1.1 登录          ← task (code deliverable)
#### 2.1.2 注册          ← task (code deliverable)
### 2.2 权限管理         ← target (requirement)
## 3. 非功能需求         ← 作为"分类"标签
### 3.1 性能指标         ← target (requirement)
#### 3.1.1 响应时间      ← task (document deliverable)
```

- **H2** = 分类标签（写入 `requirement_category`），本身不创建工作项
- **H3** = target（`tier=target, type=requirement`），写入 `requirement_category`
- **H4** = task 候选（`tier=matter, type=task`），父级挂到所在 H3 的 target
- 任务的 `deliverable_type` 按 H3 的 `requirement_category` 自动决定

### 3.2 平铺模式（Flat Mode）

**适用场景**：需求文档每个 H2 就是一个独立功能。

```markdown
# 项目需求文档
## 1. 概述               ← 跳过
## 2. 用户登录           ← target (requirement, category=NULL)
### 2.1 登录表单         ← task
### 2.2 验证逻辑         ← task
## 3. 用户注册           ← target
### 3.1 邮箱注册         ← task
### 3.2 手机号注册       ← task
```

- **H2** = target（`requirement_category=NULL`）
- **H3** = task 候选
- **H4** 整体忽略
- 任务 deliverable 默认 `code`，行级可切

### 3.3 模式切换的默认启发式

```ts
const categoryKeywords = /功能需求|非功能需求|性能|安全|可用性|可维护性/
const h2s = outline.filter(n => n.depth === 2)
const hitCategory = h2s.some(h => categoryKeywords.test(h.title))
const defaultMode = (h2s.length <= 6 && hitCategory) ? 'category' : 'flat'
```

用户可随时手动切换。切换会弹确认框清空当前勾选状态。

---

## 四、target 行级的两种形态

每个 target 候选（分类模式下的 H3、平铺模式下的 H2）在 UI 上有一个单选开关：

| 形态 | 数据库产物 | 触发条件 |
| -- | -- | -- |
| **拆分为任务** | 1 条 target（requirement）+ N 条 matter（task，`parent_id=target.id`） | 默认，当有子标题时 |
| **直转任务** | 1 条 matter（task，`parent_id=NULL`，`requirement_category` 保留） | 用户手选，或无子标题时强制 |

直转任务的 task 依然挂 deliverable，类型按 `requirement_category` 决定。

### 打包合并

- 在同一 target 下勾选多个子标题 → 点 `[合并所选为一个任务]`
- 合并后的任务显示为可折叠束，标题可改名，可拆分还原
- 描述拼接方式：各子标题的锚点加入同一 task 的 `work_item_source_anchors`，按顺序
- **跨 target 的合并禁止**

---

## 五、锚点存储与懒加载

### 5.1 不复制正文

`work_items.description` 列保留作为"用户手写备注"，分解流程**不写入**任何内容到该列。

### 5.2 锚点格式

由于保留编号前缀，锚点文本在单篇文档内天然唯一：

```
锚点 = 编号 + 空格 + 标题原文
例："2.1.1 登录"
```

边界处理：
- 无编号前缀时降级为全路径：`功能需求 > 用户管理 > 登录`
- 同文档内检测到重复标题时自动降级到全路径

### 5.3 锚点关联表

```sql
CREATE TABLE work_item_source_anchors (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  work_item_id BIGINT UNSIGNED NOT NULL,
  source_document_uuid CHAR(36) NOT NULL,
  source_document_title VARCHAR(255) NOT NULL
    COMMENT '冗余快照，断链时仍可展示',
  heading_anchor VARCHAR(500) NOT NULL,
  heading_depth TINYINT NOT NULL COMMENT '2|3|4',
  sort_order INT NOT NULL DEFAULT 0
    COMMENT '同一工作项多锚点时的展示顺序（合并任务用）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_work_item (work_item_id, sort_order),
  KEY idx_source_doc (source_document_uuid),
  CONSTRAINT fk_anchor_work_item FOREIGN KEY (work_item_id)
    REFERENCES work_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='工作项源文档锚点';
```

### 5.4 展示时的懒加载

工作项详情页提供 `SourceSectionViewer` 组件，按锚点懒加载：

```
┌ 工作项详情：AIMS-123 · 2.1.1 登录 ───────────┐
│                                              │
│ [备注] （空则不显示）                        │
│                                              │
│ 📎 源文档章节（1 个）                        │
│ ┌──────────────────────────────────────────┐│
│ │ ▼ PRD-V1.2.md · 2.1.1 登录                ││
│ │                                            ││
│ │ （从 Codocs 拉取的该章节 Markdown 渲染）  ││
│ │                                            ││
│ │ ⟳ 上次同步于 5 分钟前 · [打开源文档]     ││
│ └──────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

### 5.5 断链降级

| 断链情况 | 处理 |
| -- | -- |
| 锚点在源文档中找不到 | 卡片提示"⚠ 此章节在源文档中已不存在"，展示冗余标题快照 |
| 源文档被删 | 卡片提示"⚠ 源文档已删除"，建议用户手动转存 description |
| 锚点 heading depth 变化 | 按文本匹配为准，忽略 depth |
| 源文档更新 | 顶部 banner 提示"源文档自创建以来已更新 N 次" |

**所有降级均不阻塞任务本身的使用，仅影响内容展示。**

---

## 六、分解活动的完整生命周期

```
① 项目立项 → PIVR 规划阶段模板生成：
   🎯 需求分解 (template_key='requirement_breakdown', tier=target, type=task)
   🎯 需求变更 (template_key='requirement_change', tier=target, type=task)

② 用户打开 需求分解 工作项详情页
   → 右上角出现 [打开需求分解器] 按钮（按 template_key 显示）
   → 跳转 /work-items/:id/decompose

③ 分解页加载
   → 调 /work-items/:id/decompose-context 拿到：
     {projectId, milestoneId, sourceDocumentCandidates, existingAnchors}
   → 用户选源文档 → 调 /codocs/documents/:uuid/content 拉全文
   → 前端 marked 解析 → 大纲树 → 启发式默认模式
   → 用户勾选 + 行级开关 + 打包

④ 用户点 [提交]
   → 弹出提交对话框：本次投入工时 (必填) + 附言 (可选)
   → POST /work-items/:id/decompose-submit
   → 后端事务：
     a) 再次校验锚点是否已被他人分解（409 冲突保护）
     b) 为每个 item 创建 work_items（target + matter）
        - decomposition_source_id = 源工作项.id
        - requirement_category 按模式写入
        - parent_id 仅用于 target→task 关系
     c) 为每个 task 写 work_item_source_anchors
     d) 为每个 task 创建 deliverables（按分类自动选 type）
     e) 给源工作项插一条 time_entries
     f) 若源工作项 review_level > 0 → 调 submit.post 入审批流
        否则 → 状态改为 in_review

⑤ 审批通过
   → 走现有 approval-status.patch 流程
   → 源工作项状态 → completed
   → 记录 approved_at, approved_by

⑥ 后续需求变更
   → 用户打开 需求变更 工作项详情页 → [新一轮变更]
   → POST /work-items/:id/clone-from-template
     → 从 requirement_change 模板 clone 新实例，item_key 自增
   → 新实例的详情页再次看到 [打开需求分解器]
   → 重复步骤 ③④⑤，decomposition_source_id = 新 clone 的工作项.id
```

---

## 七、增量分解（锚点 diff）

进入分解页时，后端返回已分解的锚点集合：

```ts
{
  existingAnchors: Array<{
    anchor: string,           // "2.1.1 登录"
    workItemId: number,
    workItemKey: string,      // "AIMS-123"
    tier: 'target' | 'matter',
    mode: 'target_with_tasks' | 'direct_task',
    parentAnchor?: string
  }>
}
```

### 前端匹配规则

| 匹配结果 | 展示 | 行为 |
| -- | -- | -- |
| 锚点已存在 | 🔒 badge + 灰底 + 链接 | 不可勾选，文案"已分解为 AIMS-123" |
| 父锚点已是 target | 正常可勾选，提示"将追加到已有需求 AIMS-120 下" | 提交时复用已有 target 作 parent_id，不重建 |
| 完全新增 | 正常勾选 | 正常创建 |
| 父锚点已是 direct_task | 正常可勾选 | 新项作为兄弟（parent_id=NULL），不复用 |

### 后端提交时的二次防护

```sql
SELECT heading_anchor FROM work_item_source_anchors
WHERE source_document_uuid = ? AND heading_anchor IN (?)
```

发现提交的 items 包含已存在锚点 → 返回 409，携带冲突列表，前端提示刷新。

---

## 八、数据库改动（最终 DDL）

迁移文件：`aims/docs/migration_v2.6_requirement_decomposition.sql`

```sql
-- ========================================================================
-- Aims · 需求分解功能迁移 (v2.6)
-- ========================================================================

-- 1. work_items 增加两列
ALTER TABLE work_items
  ADD COLUMN requirement_category VARCHAR(32) NULL
    COMMENT '需求分类: functional/non_functional（分类模式专用，平铺模式为 NULL）',
  ADD COLUMN decomposition_source_id BIGINT UNSIGNED NULL
    COMMENT '溯源：产生此项的需求分解/变更工作项ID';

CREATE INDEX idx_work_items_req_category
  ON work_items(project_id, requirement_category);
CREATE INDEX idx_work_items_decomp_src
  ON work_items(decomposition_source_id);

-- 2. 工作项源文档锚点表
CREATE TABLE IF NOT EXISTS work_item_source_anchors (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  work_item_id BIGINT UNSIGNED NOT NULL,
  source_document_uuid CHAR(36) NOT NULL,
  source_document_title VARCHAR(255) NOT NULL,
  heading_anchor VARCHAR(500) NOT NULL,
  heading_depth TINYINT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_work_item (work_item_id, sort_order),
  KEY idx_source_doc (source_document_uuid),
  CONSTRAINT fk_anchor_work_item FOREIGN KEY (work_item_id)
    REFERENCES work_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='工作项源文档锚点';

-- 3. 项目模板 seed（如未预埋，补充两个模板工作项）
-- 注：实际 seed 需依据 project_templates / project_template_versions 的结构调整
-- INSERT INTO project_template_work_items (template_version_id, template_key, ...)
-- VALUES (..., 'requirement_breakdown', ...),
--        (..., 'requirement_change', ...);
```

**同步更新**：`aims/docs/aims_schema.sql` 主 schema 文件。

---

## 九、后端接口清单

全部位于 `aims/server/api/v1/`：

| 方法 | 路径 | 作用 |
| -- | -- | -- |
| `GET` | `/work-items/:id/decompose-context` | 分解器初始化上下文（项目、里程碑、候选文档、已分解锚点） |
| `GET` | `/codocs/documents/:uuid/content` | 透传 Codocs 内容接口（新增） |
| `GET` | `/codocs/documents/:uuid/section?anchor=...` | 按锚点截取章节原文（新增） |
| `POST` | `/work-items/:id/decompose-submit` | 主接口：事务建 work_items + deliverables + anchors + time_entry + 状态流转 |
| `POST` | `/work-items/:id/clone-from-template` | 克隆需求变更新实例 |
| `GET` | `/work-items/:id/source-sections` | 工作项详情页展示锚点内容 |

### 主接口 payload

```ts
POST /work-items/:id/decompose-submit

Body: {
  mode: 'category' | 'flat',
  sourceDocumentUuid: string,
  sourceDocumentTitle: string,
  workHours: number,              // 必填，本次分解投入工时
  submitNote?: string,            // 可选附言
  items: Array<{
    category: 'functional' | 'non_functional' | null,
    kind: 'target_with_tasks' | 'direct_task',
    title: string,
    headingAnchor: string,
    headingDepth: 2 | 3,
    priority?: 'P0'|'P1'|'P2'|'P3',
    assigneeUid?: string | null,
    estimatedHours?: number | null,
    tasks: Array<{
      title: string,
      sourceAnchors: Array<{ headingAnchor: string, headingDepth: 3 | 4 }>,
      priority?: 'P0'|'P1'|'P2'|'P3',
      assigneeUid?: string | null,
      estimatedHours?: number | null,
      deliverableType: 'code' | 'document' | 'artifact'
    }>
  }>
}
```

### 事务伪代码

```
BEGIN
  1. 校验源工作项存在且 template_key ∈ {requirement_breakdown, requirement_change}
  2. 读取源工作项的 project_id、milestone_id
  3. 二次防护：锚点冲突检测
  4. FOR each item:
     IF kind === 'target_with_tasks':
       是否复用已有 target？查 decompose-context 返回的 existingAnchors
       若复用 → targetId = existing.workItemId
       若不复用 → 新建 target (tier=target, type=requirement,
                             decomposition_source_id=sourceWorkItemId,
                             requirement_category=item.category)
                  插入 work_item_source_anchors (target 自己)
       FOR each task in tasks:
         新建 matter (tier=matter, type=task, parent_id=targetId,
                      decomposition_source_id=sourceWorkItemId)
         插入 work_item_source_anchors (每个 anchor 一行)
         新建 deliverable (type=task.deliverableType)
     ELSE (direct_task):
       新建 matter (tier=matter, type=task, parent_id=NULL,
                    decomposition_source_id=sourceWorkItemId,
                    requirement_category=item.category)
       插入 work_item_source_anchors
       新建 deliverable
  5. 给源工作项插 time_entries (hours=workHours)
  6. 若源工作项 review_level > 0 → 调 submit.post 入审批
     否则 → 直接 UPDATE work_items SET status='in_review' WHERE id=?
COMMIT

返回：{
  createdWorkItems: Array<{ id, itemKey, tier, type }>,
  reusedTargets: Array<{ id, itemKey }>,
  timeEntryId, approvalStatus
}
```

---

## 十、前端组件清单

```
aims/app/
├── pages/
│   └── work-items/
│       └── [id]/
│           └── decompose.vue                    # 分解页主入口
├── components/
│   ├── decompose/
│   │   ├── DecomposeLauncherButton.vue          # 仅在分解/变更工作项详情页显示
│   │   ├── SourceDocumentPicker.vue             # 源文档选择器
│   │   ├── ModeSwitcher.vue                     # 分类/平铺切换 + 启发式默认
│   │   ├── DocumentOutlineTree.vue              # 大纲树容器
│   │   ├── RequirementRow.vue                   # target 行（带拆分/直转开关）
│   │   ├── TaskBundleRow.vue                    # 任务束（打包折叠）
│   │   ├── LockedHeadingRow.vue                 # 已分解锚点的锁定展示
│   │   └── DecomposeSubmitDialog.vue            # 提交对话框（工时 + 附言 + 预览）
│   └── work-item/
│       └── SourceSectionViewer.vue              # 工作项详情页的锚点懒加载卡片
└── composables/
    ├── useMarkdownOutline.ts                    # 基于 marked.lexer() 的大纲解析
    └── useDecomposeState.ts                     # 勾选/打包/模式的响应式状态
```

---

## 十一、边界处理

| 情况 | 处理 |
| -- | -- |
| 文档有 H1 | 忽略（视为文档标题） |
| 标题无编号前缀 | 锚点降级为全路径 `父1 > 父2 > 标题` |
| 同文档内重复标题 | 自动降级全路径锚点 |
| H3 下无 H4（分类模式） | target 强制为"直转任务"，开关隐藏 |
| H2 下无 H3（平铺模式） | 同上 |
| 模式切换 | 弹确认框清空当前勾选 |
| 源文档拉不到内容 | 错误提示 + 重试，不做离线缓存 |
| 合并任务改名后拆分 | 拆分后恢复原标题，toast 提示 |
| 里程碑无 `requirement_breakdown` 项 | 红色 banner 阻断，提示"项目模板未配置需求分解工作项" |
| 源文档并发被他人分解 | 提交时 409 冲突，前端提示刷新 |
| 工时输入为 0 或空 | 前端校验阻断，提示"请填写实际投入工时" |

---

## 十二、实施阶段拆分

| 阶段 | 工作内容 | 预计 |
| -- | -- | -- |
| 1 | 迁移 + schema 更新 + 项目模板 seed 补充 | 0.5d |
| 2 | 后端接口（context / content / section / submit / clone / source-sections） | 1d |
| 3 | 前端解析器 + 大纲树 + 勾选/打包/diff | 1d |
| 4 | 提交对话框 + 工时录入 + 状态联动 | 0.5d |
| 5 | 工作项详情页的锚点懒加载展示 | 0.5d |
| 6 | 需求变更 clone 功能 + 看板 badge | 0.5d |
| 7 | 联调 + typecheck + 手动 QA | 0.5d |
| **合计** | | **~4.5d** |

---

## 十三、开工前待核实

1. PIVR 规划阶段的项目模板是否已预埋 `requirement_breakdown` / `requirement_change` 两个 `template_key`。如未预埋，在迁移脚本中补 seed。
2. `time_entries` POST 接口的授权逻辑是否允许系统代写（而非必须走前端手填）。
3. 现有工作项详情页是否已有"按钮区"插槽供 `DecomposeLauncherButton` 插入。
4. aims 的 `approval-status.patch` 是否能处理 `in_review → completed` 的状态流转。

---

## 十四、未来扩展（Out of Scope for v1）

- AI 辅助：调 Codocs `ai-decompose` 接口自动建议拆分粒度、估时、指派
- 锚点变更追踪：记录源文档更新时的 diff，高亮新旧差异
- 批量修改已分解工作项：在分解页直接修改老项而不是追加
- 跨文档分解：一次分解引用多篇源文档
- 模板化分解配置：将常用的分类/优先级默认值保存为项目级模板

---

## 附录 A · 示例 payload

### 分类模式示例

```json
{
  "mode": "category",
  "sourceDocumentUuid": "550e8400-e29b-41d4-a716-446655440000",
  "sourceDocumentTitle": "项目PRD-V1.2.md",
  "workHours": 3.5,
  "submitNote": "完成首轮功能需求分解，非功能待后续补充",
  "items": [
    {
      "category": "functional",
      "kind": "target_with_tasks",
      "title": "2.1 用户管理",
      "headingAnchor": "2.1 用户管理",
      "headingDepth": 3,
      "priority": "P1",
      "tasks": [
        {
          "title": "2.1.1 登录",
          "sourceAnchors": [{ "headingAnchor": "2.1.1 登录", "headingDepth": 4 }],
          "deliverableType": "code"
        },
        {
          "title": "账号验证合并",
          "sourceAnchors": [
            { "headingAnchor": "2.1.2 邮箱验证", "headingDepth": 4 },
            { "headingAnchor": "2.1.3 手机号验证", "headingDepth": 4 }
          ],
          "deliverableType": "code"
        }
      ]
    },
    {
      "category": "functional",
      "kind": "direct_task",
      "title": "2.2 权限管理",
      "headingAnchor": "2.2 权限管理",
      "headingDepth": 3,
      "tasks": [
        {
          "title": "2.2 权限管理",
          "sourceAnchors": [{ "headingAnchor": "2.2 权限管理", "headingDepth": 3 }],
          "deliverableType": "code"
        }
      ]
    }
  ]
}
```

### 平铺模式示例

```json
{
  "mode": "flat",
  "sourceDocumentUuid": "550e8400-e29b-41d4-a716-446655440000",
  "sourceDocumentTitle": "项目PRD-V1.2.md",
  "workHours": 2.0,
  "items": [
    {
      "category": null,
      "kind": "target_with_tasks",
      "title": "2. 用户登录",
      "headingAnchor": "2. 用户登录",
      "headingDepth": 2,
      "tasks": [
        {
          "title": "2.1 登录表单",
          "sourceAnchors": [{ "headingAnchor": "2.1 登录表单", "headingDepth": 3 }],
          "deliverableType": "code"
        }
      ]
    }
  ]
}
```

---

## 附录 B · 相关文档

- [Aims-Design.md](./Aims-Design.md) — Aims 整体设计
- [Aims-PRD.md](./Aims-PRD.md) — Aims 产品需求
- [汇智PIVR项目管理生命周期模型说明书V1.0.md](./汇智PIVR项目管理生命周期模型说明书V1.0.md) — PIVR 方法论
- [Aims-Approval-Actions-Manifest.md](./Aims-Approval-Actions-Manifest.md) — 审批动作清单
- [../../codocs/docs/CODOCS_API_SPEC.md](../../codocs/docs/CODOCS_API_SPEC.md) — Codocs 提供给 Aims 的 API
