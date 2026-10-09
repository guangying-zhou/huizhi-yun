-- 文档访问策略：归属类型与组内继承（文档资产设计 DOC-05，5b-1）
--
-- 候选迁移，未在任何环境执行。仅适用于独立 Codocs 库。
--
-- source_owner_type：策略所属对象的类型。项目集编码与项目编码可能同名，
--   必须显式区分，不能靠 source_project_code 猜。存量行默认为 project；
--   项目集文档的存量策略行由对账命令
--   `hzy-document-catalog-reconcile --portfolio-policy-owners` 另行标记（默认 dry-run）。
-- inherit_to_member_projects：项目集文档是否对组内项目成员可读（仅 L0/L1 生效）。
--   对 source_owner_type='project' 的行没有意义。
--
-- 两条 ALTER 只能执行一次。执行前确认列不存在：
--   SHOW COLUMNS FROM document_access_policies LIKE 'source_owner_type';
--   SHOW COLUMNS FROM document_access_policies LIKE 'inherit_to_member_projects';
-- 代码与迁移可任意先后上线：列不存在时项目集文档判权失败关闭（503），
-- 项目文档路径不读取这两列，行为不变。

ALTER TABLE `document_access_policies`
  ADD COLUMN `source_owner_type` ENUM('project', 'portfolio', 'product_line') NOT NULL DEFAULT 'project' COMMENT '策略所属对象类型' AFTER `source_app`;

ALTER TABLE `document_access_policies`
  ADD COLUMN `inherit_to_member_projects` TINYINT NOT NULL DEFAULT 1 COMMENT '项目集文档是否对组内项目成员可读（仅 L0/L1）' AFTER `allow_cross_project`;
