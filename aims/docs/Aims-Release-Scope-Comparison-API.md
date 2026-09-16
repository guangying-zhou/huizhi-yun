# 产品发布范围对比

PC-15 的发布范围对比仅比较不可变发布快照，不使用当前版本范围补全历史。

## 接口

浏览器：`GET /api/v1/products/{productCode}/roadmaps/release-diff`。

必填查询：`beforeVersionId`、`beforeRecordId`、`afterVersionId`、`afterRecordId`，均为正整数。可选 `page`（默认 1，上限 1000000）、`pageSize`（默认 20，上限 100）。拒绝未知查询参数。前后顺序由用户选择保留，不按发布日期自动交换。

BFF 使用当前用户 `product_versions:view` 权限，绑定可信 actor，转发 `POST /v1/aims/internal/products/{productCode}/versions:release-diff`，精确能力 `aims:product-versions:read`。Runtime input 使用 snake_case，包含四个标识与 page/page_size；authorization 是短期版本读取 permit。接口不缓存。

## 数据与比较规则

同一授权事务内核对两份记录的版本与产品归属、快照内容 hash；缺快照的 legacy_import 明确不可比较。读取权限失败或运行服务错误不得表现为空差异。

响应包含 product_code、workspace_revision、before_record_id、after_record_id、before_content_hash、after_content_hash，以及 added/removed/changed/unchanged、total、page、pageSize 和 changes。

- `changes` 以范围记录 ID 排序，每项含 scope_id、kind（added/removed/changed）、before、after；不存在的一侧为 null。
- `total` 是全部变化数量，不包括未变项；四类统计均针对完整两份快照，不能对当前页重算。
- 对比包含完整范围字段：名称、描述、状态、验收标准、功能/规划引用、类别、公开性、顺序、变更类型及顺延来源。
- 不按名称或功能 ID 合并不同范围。同一范围内容变化计 changed；跨版本顺延形成独立范围增减，保留 deferred_from_feature_id 供追溯。
- 发布撤回/替代不改写快照，也不将该历史记录自动解释为当前有效发布。

## 当前验证与剩余交付

领域纯计算、实际 MySQL 修正版对比及稳定性、Runtime 边界、BFF 身份/权限/错误处理和输入分页专项已验证。Runtime 成功数据库集成已验证同发布对比及错误版本拒绝；对比选择与结果页面、浏览器及视觉验收仍待完成。本文不表示整个 PC-15 已完成。
