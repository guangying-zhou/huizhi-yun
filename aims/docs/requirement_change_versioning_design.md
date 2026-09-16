# 需求变更与规格书内容版本设计

## 背景

AIMS 的需求来源于需求规格书章节。章节树和需求项归属需要解耦：`requirement_contents` 只表示规格书内容本身，需求项与章节的绑定统一通过 `requirement_item_contents` 维护。

需求基线通过后，规格书章节内容应保持稳定。后续变更不应直接覆盖当前内容，而应创建新的内容版本和变更需求，经变更评审通过后再合入当前基线。

## 目标

- 已基线需求不能直接取消需求项，也不能直接编辑对应规格书章节。
- 已基线需求可通过“需求变更”创建变更需求。
- 变更需求编码采用原需求编码追加两位序号，例如 `HZY-REQ-001-01`。
- 变更内容不覆盖当前基线内容，而是新增 `requirement_contents` 版本。
- 变更评审时展示当前生效版本与本次变更版本的 diff。
- 变更评审通过后，新内容版本成为当前生效版本。

## 核心概念

### 基线需求

`requirement_items.item_kind = 'baseline'`

基线需求是当前有效需求项，编码示例：

```text
HZY-REQ-001
```

### 变更需求

`requirement_items.item_kind = 'change'`

变更需求是对某个基线需求的一次变更申请，编码示例：

```text
HZY-REQ-001-01
HZY-REQ-001-02
```

变更需求通过 `parent_requirement_id` 关联原基线需求。

### 内容版本族

`requirement_contents.content_original_id` 表示同一逻辑章节/内容族的首个内容记录 ID。

它只用于识别“这些内容记录属于同一个章节的不同版本”，不表示 diff 基准。

示例：

```text
id=10, content_original_id=10, version_no=1, version_status=archived
id=22, content_original_id=10, version_no=2, version_status=archived
id=31, content_original_id=10, version_no=3, version_status=baselined
id=45, content_original_id=10, version_no=4, version_status=change_draft
```

### Diff 基准

需求变更 diff 比较：

```text
同 content_original_id 下当前 version_status='baselined' 的内容
vs
本次变更需求绑定的 change_draft / in_review 内容
```

不和最初版本比较。

## 数据库设计

### requirement_items 扩展

```sql
ALTER TABLE `requirement_items`
  ADD COLUMN `item_kind` ENUM('baseline','change') NOT NULL DEFAULT 'baseline' COMMENT 'baseline=基线需求, change=变更需求' AFTER `id`,
  ADD COLUMN `parent_requirement_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '变更需求对应的原始基线需求ID' AFTER `item_kind`,
  ADD COLUMN `change_no` INT UNSIGNED DEFAULT NULL COMMENT '同一基线需求下的变更序号' AFTER `parent_requirement_id`,
  ADD COLUMN `change_reason` TEXT DEFAULT NULL COMMENT '变更原因' AFTER `change_no`,
  ADD KEY `idx_req_parent_requirement` (`parent_requirement_id`),
  ADD UNIQUE KEY `uk_req_change_no` (`parent_requirement_id`, `change_no`),
  ADD CONSTRAINT `fk_req_parent_requirement` FOREIGN KEY (`parent_requirement_id`) REFERENCES `requirement_items` (`id`) ON DELETE SET NULL;
```

### requirement_contents 扩展

```sql
ALTER TABLE `requirement_contents`
  ADD COLUMN `content_original_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '同一逻辑章节/内容族的首个内容ID' AFTER `id`,
  ADD COLUMN `version_no` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '内容版本号' AFTER `content_original_id`,
  ADD COLUMN `version_status` ENUM('draft','baselined','change_draft','in_review','archived') NOT NULL DEFAULT 'draft' COMMENT '内容版本状态' AFTER `version_no`,
  ADD KEY `idx_req_content_original_status` (`content_original_id`, `version_status`),
  ADD UNIQUE KEY `uk_req_content_original_version` (`content_original_id`, `version_no`);
```

首版内容迁移时：

```sql
UPDATE `requirement_contents`
SET `content_original_id` = `id`,
    `version_no` = 1,
    `version_status` = 'draft'
WHERE `content_original_id` IS NULL;
```

### requirement_item_contents 新增

```sql
CREATE TABLE IF NOT EXISTS `requirement_item_contents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `requirement_id` BIGINT UNSIGNED NOT NULL,
  `content_id` BIGINT UNSIGNED NOT NULL,
  `relation_type` ENUM('baseline','change','archived') NOT NULL DEFAULT 'baseline',
  `sort_order` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_req_content_relation` (`requirement_id`, `content_id`, `relation_type`),
  KEY `idx_req_item_content_requirement` (`requirement_id`, `relation_type`),
  KEY `idx_req_item_content_content` (`content_id`),
  CONSTRAINT `fk_req_item_content_requirement` FOREIGN KEY (`requirement_id`) REFERENCES `requirement_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_req_item_content_content` FOREIGN KEY (`content_id`) REFERENCES `requirement_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求项与规格书内容版本关联';
```

旧数据迁移：

```sql
INSERT IGNORE INTO `requirement_item_contents`
  (`requirement_id`, `content_id`, `relation_type`, `sort_order`, `created_by`)
SELECT
  `requirement_id`,
  `id`,
  'baseline',
  `sort_order`,
  `created_by`
FROM `requirement_contents`
WHERE `requirement_id` IS NOT NULL;
```

旧字段 `requirement_contents.requirement_id` 仅用于历史数据迁移。迁移完成后直接删除该列，后续运行时逻辑一律只读写 `requirement_item_contents`。

## 交互设计

### 规格书页签

已基线需求标题右侧增加“需求变更”按钮。

显示条件：

- 当前需求状态为 `baselined`
- 当前查看的是完整需求项，不是未绑定章节
- 当前需求没有未完成变更需求

点击后打开 `UModal`，不是抽屉。

Modal 内容：

- 原需求编码和标题
- 变更编码预览，例如 `HZY-REQ-001-01`
- 变更原因
- 当前生效内容
- 变更后内容编辑区
- diff 预览

### 变更草稿

保存变更时：

- 创建一条 `requirement_items.item_kind='change'` 的变更需求。
- 变更需求绑定的是“变更后的完整内容集合”。
- 对发生变化的内容新增一条 `requirement_contents` 版本，新内容版本 `version_status='change_draft'`。
- 对未发生变化的内容不新增 `requirement_contents`，直接复用当前生效内容 ID。
- `requirement_item_contents.relation_type='change'` 绑定完整内容集合，即新旧 contents 的组合。

同一个基线需求同一时间只允许一个未完成变更需求：

```sql
SELECT id
FROM requirement_items
WHERE parent_requirement_id = ?
  AND item_kind = 'change'
  AND status IN ('draft','in_review','change_pending');
```

## 变更评审

`requirement_review_batches.batch_type='change'` 时，`requirement_ids_json` 存储变更需求 ID。

提交变更评审：

- 变更需求状态从 `draft` 改为 `change_pending`
- 原基线需求状态也改为 `change_pending`
- 仅将本次新增的变更内容版本从 `change_draft` 改为 `in_review`
- 变更需求复用的未变化基线内容保持 `baselined`

评审页展示 diff：

- 找变更需求绑定的 `relation_type='change'` 内容
- 按 `content_original_id` 找当前 `version_status='baselined'` 内容
- 比较当前生效版本和变更版本
- 未变化的内容返回 `diffStatus='unchanged'`，默认折叠
- 发生变化的内容返回 `diffStatus='changed'`，默认展开

## 审批通过

变更评审通过后：

1. 旧生效内容版本归档：

```sql
UPDATE requirement_contents
SET version_status = 'archived'
WHERE content_original_id = ?
  AND version_status = 'baselined';
```

2. 新内容版本成为生效版本：

```sql
UPDATE requirement_contents
SET version_status = 'baselined'
WHERE id = ?;
```

3. 原基线需求按 `content_original_id` 切换发生变化的内容绑定，未变化内容绑定保持不变：

```sql
UPDATE requirement_item_contents ric
INNER JOIN requirement_contents c ON c.id = ric.content_id
SET relation_type = 'archived'
WHERE requirement_id = ?
  AND relation_type = 'baseline'
  AND c.content_original_id = ?;

INSERT INTO requirement_item_contents
  (requirement_id, content_id, relation_type, sort_order, created_by)
VALUES
  (?, ?, 'baseline', ?, ?);
```

4. 原基线需求状态回到 `baselined`。
5. 变更需求状态标记为 `baselined`，表示已合入。
6. 写入 `requirement_versions` 快照，`change_type='modify'`。

## 审批拒绝

变更评审拒绝后：

- 原基线需求状态回到 `baselined`
- 变更需求状态改为 `deprecated`
- 仅本次新增的变更内容版本改为 `archived`
- 变更需求复用的未变化基线内容保持 `baselined`
- 当前生效内容绑定不变

## 删除/废弃变更需求

删除或废弃变更需求时：

- 先删除该变更需求独有的 `requirement_contents` 新版本记录。
- 复用的当前基线内容不删除、不改状态。
- 再删除该变更需求的 `requirement_item_contents` 关联。
- 草稿变更需求硬删除；非草稿变更需求标记为 `deprecated`。

判断“变更需求独有内容”的条件：

```sql
ric.requirement_id = :change_requirement_id
AND ric.relation_type = 'change'
AND NOT EXISTS (
  SELECT 1
  FROM requirement_item_contents parent_ric
  WHERE parent_ric.requirement_id = :parent_requirement_id
    AND parent_ric.content_id = ric.content_id
    AND parent_ric.relation_type = 'baseline'
)
```

## 编码规则

基线需求编码：

```text
HZY-REQ-001
```

变更需求编码：

```text
HZY-REQ-001-01
HZY-REQ-001-02
```

`change_no` 按同一个 `parent_requirement_id` 递增。

## 实施顺序

1. 增加迁移脚本和 schema 说明。
2. 规格书读取改为只读 `requirement_item_contents`。
3. 创建需求时只写 `requirement_item_contents`。
4. 增加需求变更创建 API。
5. 增加需求变更 Modal。
6. 变更评审页增加 diff 展示。
7. 调整变更评审通过/拒绝逻辑。
8. 迁移并删除旧字段 `requirement_contents.requirement_id`。
