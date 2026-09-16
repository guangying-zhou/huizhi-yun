-- Aims v4.9 - Altoc 服务工单执行扩展字段
-- 不修改 work_items.type；服务工单仍通过
-- work_items.template_key = altoc:service_ticket:{ticketCode} 幂等关联。

CREATE TABLE IF NOT EXISTS `work_item_service_ext` (
  `work_item_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `source_ticket_code` VARCHAR(64) NOT NULL,
  `customer_code` VARCHAR(100) DEFAULT NULL,
  `environment_code` VARCHAR(64) DEFAULT NULL,
  `response_due_at` DATETIME DEFAULT NULL,
  `resolution_due_at` DATETIME DEFAULT NULL,
  `sla_status_snapshot` VARCHAR(30) DEFAULT NULL,
  `first_responded_at` DATETIME DEFAULT NULL,
  `resolved_at` DATETIME DEFAULT NULL,
  `last_synced_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`work_item_id`),
  KEY `idx_svc_ext_project_customer` (`project_id`, `customer_code`),
  KEY `idx_svc_ext_project_env` (`project_id`, `environment_code`),
  UNIQUE KEY `uk_svc_ext_ticket` (`source_ticket_code`),
  CONSTRAINT `fk_svc_ext_work_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_svc_ext_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Altoc 服务工单执行扩展字段';
