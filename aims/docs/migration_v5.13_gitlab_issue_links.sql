-- Aims v5.13: 工作项对接 GitLab Issue，并为外部任务消费者保留稳定链接。

START TRANSACTION;

CREATE TABLE IF NOT EXISTS `gitlab_issue_links` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT 'Aims项目ID',
  `work_item_id` BIGINT UNSIGNED NOT NULL COMMENT 'Aims工作项ID',
  `repo_project_code` VARCHAR(255) NOT NULL COMMENT 'GitLab仓库project_code',
  `issue_iid` BIGINT UNSIGNED NOT NULL COMMENT 'GitLab项目内Issue IID',
  `issue_url` VARCHAR(1000) NOT NULL COMMENT 'GitLab Issue URL',
  `issue_state` ENUM('opened','closed') NOT NULL DEFAULT 'opened',
  `last_synced_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gitlab_issue_work_item_repo` (`work_item_id`, `repo_project_code`),
  UNIQUE KEY `uk_gitlab_issue_repo_iid` (`repo_project_code`, `issue_iid`),
  KEY `idx_gitlab_issue_project` (`project_id`),
  CONSTRAINT `fk_gitlab_issue_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gitlab_issue_work_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gitlab_issue_project_repo` FOREIGN KEY (`project_id`, `repo_project_code`) REFERENCES `aims_project_repos` (`project_id`, `repo_project_code`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Aims工作项与GitLab Issue关联';

COMMIT;
