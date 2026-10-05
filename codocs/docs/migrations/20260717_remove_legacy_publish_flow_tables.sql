-- Codocs 发文流程收口到 Workflow 后的数据库清理脚本
-- 适用数据库：hzy_codocs
-- 执行顺序：先部署已移除 Codocs 本地流程模板页面/API 的版本，再执行本脚本。

-- 1. 执行前核对旧模板数量并按需导出留档；表已不存在时也可重复执行。
SET @legacy_publish_flow_table_exists := (
  SELECT COUNT(*)
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'review_flow_templates'
);

SET @legacy_publish_flow_count_sql := IF(
  @legacy_publish_flow_table_exists > 0,
  'SELECT COUNT(*) AS legacy_publish_flow_template_count FROM `review_flow_templates`',
  'SELECT 0 AS legacy_publish_flow_template_count'
);
PREPARE legacy_publish_flow_count_stmt FROM @legacy_publish_flow_count_sql;
EXECUTE legacy_publish_flow_count_stmt;
DEALLOCATE PREPARE legacy_publish_flow_count_stmt;

SET @legacy_publish_flow_rows_sql := IF(
  @legacy_publish_flow_table_exists > 0,
  'SELECT `id`, `name`, `review_type`, `sub_type`, `target_category`, `status`, `updated_at` FROM `review_flow_templates` ORDER BY `id`',
  'SELECT NULL AS `id`, NULL AS `name`, NULL AS `review_type`, NULL AS `sub_type`, NULL AS `target_category`, NULL AS `status`, NULL AS `updated_at` WHERE FALSE'
);
PREPARE legacy_publish_flow_rows_stmt FROM @legacy_publish_flow_rows_sql;
EXECUTE legacy_publish_flow_rows_stmt;
DEALLOCATE PREPARE legacy_publish_flow_rows_stmt;

-- 2. 流程定义、路由和节点已由 Workflow 管理，Codocs 不再读取该表。
DROP TABLE IF EXISTS `review_flow_templates`;

-- 3. 以下表不要随本次页面清理删除。
-- document_publish_requests：当前 Workflow 发文申请及实例绑定的业务事实表。
-- document_seal_records / document_send_records：审批通过后的盖章、发送、接收业务记录。
-- document_reviews / review_actions：当前仍用于旧发文历史只读兼容。

-- 4. 若未来明确放弃旧发文历史查询，可先核对是否还有未完成旧记录：
SELECT `status`, COUNT(*) AS record_count
FROM `document_reviews`
GROUP BY `status`
ORDER BY `status`;

-- 只有在旧详情页和 tenant-runtime 历史兼容代码也一并下线、且历史数据已备份后，
-- 才可另行执行下面两句；本次不要执行：
-- DROP TABLE IF EXISTS `review_actions`;
-- DROP TABLE IF EXISTS `document_reviews`;
