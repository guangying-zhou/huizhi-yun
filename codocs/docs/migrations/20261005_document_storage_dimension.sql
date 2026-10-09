-- Document storage dimension (document asset design DOC-06a).
-- Design: docs/Document-Asset-Unified-Management-Design.md §4 and
-- docs/Document-Asset-DOC-05-06-Implementation-Spec.md §2.
--
-- Additive only: no existing column changes and no behaviour change. Code
-- keeps using doc_type/oss_path until DOC-06b–6d switch readers over, and it
-- works on a database without these columns.
--
-- DDL is not transactional: install after a full backup. Executing this in any
-- environment is an environment write and needs approval for that environment.
-- The backfill is idempotent and can be re-run.
--
-- storage_type    : where the content lives. 'oss' for everything today.
--                   'git' is a read-only reference to a repository file.
-- storage_locator : oss -> {"bucket":"documents"|"projects"}; the object key
--                   stays in oss_path. git -> {"integrationCode","repoPath",
--                   "filePath","ref"}. NULL means {"bucket":"documents"}.
-- origin_json     : provenance only, never used to locate content. Repository
--                   copies record {"type":"git","repoPath","filePath","commitId"}.
-- storage_revision: commit id for git documents; NULL for oss documents, which
--                   keep using oss_version_id / object_key.
ALTER TABLE `documents`
  ADD COLUMN `storage_type` ENUM('oss', 'git') NOT NULL DEFAULT 'oss' COMMENT '内容存储: oss / git(只读引用)' AFTER `oss_path`,
  ADD COLUMN `storage_locator` JSON NULL COMMENT '存储定位信息; NULL 等价于 {"bucket":"documents"}' AFTER `storage_type`,
  ADD COLUMN `origin_json` JSON NULL COMMENT '来源记录(不参与读取定位)' AFTER `storage_locator`,
  ADD INDEX `idx_documents_storage_type` (`storage_type`);

ALTER TABLE `document_versions`
  ADD COLUMN `storage_revision` VARCHAR(128) NULL COMMENT 'git 文档的 commit id; oss 文档为空' AFTER `object_key`;

-- Backfill the implicit bucket. Repository copies live in the project-documents
-- bucket; every other document lives in the documents bucket.
UPDATE `documents`
SET `storage_locator` = JSON_OBJECT('bucket', 'projects')
WHERE `storage_locator` IS NULL AND `doc_type` = 'git-project';

UPDATE `documents`
SET `storage_locator` = JSON_OBJECT('bucket', 'documents')
WHERE `storage_locator` IS NULL AND `doc_type` <> 'git-project';
