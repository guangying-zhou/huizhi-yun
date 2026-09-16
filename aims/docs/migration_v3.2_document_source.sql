-- =====================================================================
-- v3.2 文档来源扩展：支持"项目组文档(codocs)"与"项目仓库文档(repo)"两种来源
--
-- project_documents / deliverables 加列：
--   document_source ENUM('codocs','repo') NOT NULL DEFAULT 'codocs'
--   repo_project_code VARCHAR(50)  -- 指向 Account git_projects.project_code
--   repo_file_path VARCHAR(500)    -- 仓库中相对路径
--   repo_commit_id VARCHAR(64)     -- 指定 commit_id 为快照；NULL = 跟随默认分支
--
-- 兼容：现有行默认 source=codocs，无需额外迁移
-- =====================================================================

-- project_documents
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_documents' AND COLUMN_NAME = 'document_source'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `project_documents`
     ADD COLUMN `document_source` ENUM(''codocs'',''repo'') NOT NULL DEFAULT ''codocs''
       COMMENT ''文档来源: codocs=项目组文档 / repo=项目仓库文档''
       AFTER `codocs_uuid`,
     ADD COLUMN `repo_project_code` VARCHAR(50) DEFAULT NULL
       COMMENT ''repo 来源: 仓库编码（指向 Account git_projects）''
       AFTER `document_source`,
     ADD COLUMN `repo_file_path` VARCHAR(500) DEFAULT NULL
       COMMENT ''repo 来源: 仓库中的相对路径''
       AFTER `repo_project_code`,
     ADD COLUMN `repo_commit_id` VARCHAR(64) DEFAULT NULL
       COMMENT ''repo 来源: 指定 commit_id 为快照；NULL 表示跟随默认分支''
       AFTER `repo_file_path`,
     ADD KEY `idx_project_documents_repo` (`repo_project_code`, `repo_file_path`)',
  'SELECT ''project_documents.document_source already exists'' AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- deliverables
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'deliverables' AND COLUMN_NAME = 'document_source'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `deliverables`
     ADD COLUMN `document_source` ENUM(''codocs'',''repo'') NOT NULL DEFAULT ''codocs''
       COMMENT ''文档来源: codocs=项目组文档 / repo=项目仓库文档''
       AFTER `document_title`,
     ADD COLUMN `repo_project_code` VARCHAR(50) DEFAULT NULL
       COMMENT ''repo 来源: 仓库编码''
       AFTER `document_source`,
     ADD COLUMN `repo_file_path` VARCHAR(500) DEFAULT NULL
       COMMENT ''repo 来源: 仓库中的相对路径''
       AFTER `repo_project_code`,
     ADD COLUMN `repo_commit_id` VARCHAR(64) DEFAULT NULL
       COMMENT ''repo 来源: 指定 commit_id 为快照；NULL 表示跟随''
       AFTER `repo_file_path`,
     ADD KEY `idx_deliverables_repo` (`repo_project_code`, `repo_file_path`)',
  'SELECT ''deliverables.document_source already exists'' AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'v3.2 document_source migration applied' AS msg;
