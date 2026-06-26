-- ============================================================
-- Aims 种子数据 — 用于开发环境页面效果预览
-- 执行前确保已创建 hzy_aims 数据库并导入 aims_schema.sql
-- 工作项类型: requirement(需求), task(任务), bug(缺陷)
-- ============================================================

USE `hzy_aims`;

-- 清空现有数据（可重复执行）
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE `approval_records`;
TRUNCATE TABLE `deliverables`;
TRUNCATE TABLE `project_documents`;
TRUNCATE TABLE `notification_rules`;
TRUNCATE TABLE `time_entries`;
TRUNCATE TABLE `work_item_changelog`;
TRUNCATE TABLE `work_item_comments`;
TRUNCATE TABLE `work_item_attachments`;
TRUNCATE TABLE `work_item_relations`;
TRUNCATE TABLE `gitlab_commits`;
TRUNCATE TABLE `work_items`;
TRUNCATE TABLE `milestones`;
TRUNCATE TABLE `workflow_transitions`;
TRUNCATE TABLE `work_item_status_catalog`;
TRUNCATE TABLE `workflow_status_catalog`;
TRUNCATE TABLE `project_counters`;
TRUNCATE TABLE `aims_project_repos`;
TRUNCATE TABLE `aims_project_members`;
TRUNCATE TABLE `aims_projects`;
TRUNCATE TABLE `project_portfolios`;
TRUNCATE TABLE `system_parameters`;
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 默认状态目录
-- ============================================================
INSERT INTO `workflow_status_catalog` (`entity_type`, `status`, `is_initial`, `is_terminal`, `sort_order`) VALUES
('project', 'draft', 1, 0, 10),
('project', 'approval_pending', 0, 0, 20),
('project', 'active', 0, 0, 30),
('project', 'paused', 0, 0, 40),
('project', 'completed', 0, 0, 50),
('project', 'archived', 0, 1, 60),
('milestone', 'planning', 1, 0, 10),
('milestone', 'active', 0, 0, 20),
('milestone', 'completed', 0, 1, 30),
-- target 层状态（不区分 type）
('target', 'planning', 1, 0, 10),
('target', 'todo', 0, 0, 20),
('target', 'in_progress', 0, 0, 30),
('target', 'in_review', 0, 0, 40),
('target', 'completed', 0, 1, 50),
-- matter 层状态（统一为 task）
('matter', 'todo', 1, 0, 10),
('matter', 'in_progress', 0, 0, 20),
('matter', 'in_review', 0, 0, 30),
('matter', 'completed', 0, 1, 40);

INSERT INTO `work_item_status_catalog` (`item_type`, `status`, `is_initial`, `is_terminal`, `sort_order`) VALUES
-- target 层（按 tier 区分，不按 type）
('target', 'planning', 1, 0, 10),
('target', 'todo', 0, 0, 20),
('target', 'in_progress', 0, 0, 30),
('target', 'in_review', 0, 0, 40),
('target', 'completed', 0, 1, 50),
-- matter 层
('matter', 'todo', 1, 0, 10),
('matter', 'in_progress', 0, 0, 20),
('matter', 'in_review', 0, 0, 30),
('matter', 'completed', 0, 1, 40);

-- ============================================================
-- 默认工作流规则
-- ============================================================

-- 项目生命周期
INSERT INTO `workflow_transitions` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`) VALUES
(NULL, 'project', 'draft', 'approval_pending', 'submit'),
(NULL, 'project', 'approval_pending', 'active', 'approve'),
(NULL, 'project', 'approval_pending', 'draft', 'reject'),
(NULL, 'project', 'active', 'paused', 'pause'),
(NULL, 'project', 'paused', 'active', 'resume'),
(NULL, 'project', 'active', 'completed', 'complete'),
(NULL, 'project', 'completed', 'archived', 'archive');

-- 里程碑
INSERT INTO `workflow_transitions` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`) VALUES
(NULL, 'milestone', 'planning', 'active', 'start'),
(NULL, 'milestone', 'active', 'completed', 'complete'),
(NULL, 'milestone', 'completed', 'active', 'reopen');

-- Target 层（目标）：planning → todo → in_progress → in_review → completed
INSERT INTO `workflow_transitions` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`) VALUES
(NULL, 'target', 'planning', 'todo', 'decompose'),
(NULL, 'target', 'todo', 'in_progress', 'start'),
(NULL, 'target', 'in_progress', 'todo', 'reset'),
(NULL, 'target', 'in_progress', 'in_review', 'submit'),
(NULL, 'target', 'in_review', 'completed', 'approve'),
(NULL, 'target', 'in_review', 'in_progress', 'reject'),
(NULL, 'target', 'completed', 'in_progress', 'reopen');

-- Matter 层（执行任务）：todo → in_progress → in_review → completed
INSERT INTO `workflow_transitions` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`) VALUES
(NULL, 'matter', 'todo', 'in_progress', 'start'),
(NULL, 'matter', 'in_progress', 'todo', 'reset'),
(NULL, 'matter', 'in_progress', 'in_review', 'submit'),
(NULL, 'matter', 'in_review', 'completed', 'approve'),
(NULL, 'matter', 'in_review', 'in_progress', 'reject'),
(NULL, 'matter', 'completed', 'in_progress', 'reopen');

-- ============================================================
-- 1. 项目
-- ============================================================
INSERT INTO `aims_projects` (`id`, `project_code`, `name`, `description`, `category`, `methodology`, `lifecycle_status`, `dept_code`, `leader_uid`, `start_date`, `end_date`, `customer_name`, `contract_code`, `created_by`) VALUES
(1, 'HZY-V2', '汇智云 v2.0', '汇智云企业作业与管理云平台 2.0 版本开发，包含 Account、Codocs、Aims、Altoc、Align 五大模块的协同开发。', 'product_dev', 'PIVR', 'HZY', 'active', 'GMO', 'zhouguangying', '2026-01-01', '2026-06-30', NULL, NULL, 'zhouguangying'),
(2, 'NR-CUSTOM', '自然资源定制开发', '为XX自然资源局定制开发不动产登记与国土空间规划管理系统。', 'custom_dev', 'hybrid', 'NR', 'active', 'RD', 'shiweijia', '2026-02-01', '2026-08-31', 'XX自然资源局', 'HT-2026-001', 'shiweijia'),
(3, 'EGRET-DEPLOY', '底座平台交付实施', '为YY集团部署公司底座平台（Egret），含环境搭建、数据迁移、用户培训和验收。', 'delivery', 'waterfall', 'DEP', 'active', 'RD', 'caoqian', '2026-03-01', '2026-04-30', 'YY集团', 'HT-2026-003', 'caoqian'),
(4, 'OPS-2026', '2026年度运维保障', '面向所有已交付客户的年度运维保障服务，包含故障响应、系统巡检和版本升级。', 'maintenance', 'kanban', 'OPS', 'active', 'RD', 'lubo', '2026-01-01', '2026-12-31', NULL, NULL, 'lubo'),
(5, 'MOBILE-APP', '移动端 APP 开发', '汇智云移动端 APP（企业微信小程序 + H5），支持任务查看、审批和通知。', 'product_dev', 'PIVR', 'MOB', 'draft', 'GMO', 'zhouguangying', '2026-07-01', '2026-09-30', NULL, NULL, 'zhouguangying');

-- ============================================================
-- 2. 项目计数器
-- ============================================================
INSERT INTO `project_counters` (`project_id`, `counter`) VALUES
(1, 15),
(2, 8),
(3, 8),
(4, 5),
(5, 0);

-- ============================================================
-- 3. 项目成员
-- ============================================================
INSERT INTO `aims_project_members` (`project_id`, `uid`, `role`) VALUES
(1, 'zhouguangying', 'manager'),
(1, 'shiweijia', 'developer'),
(1, 'caoqian', 'developer'),
(1, 'chenyiming', 'developer'),
(1, 'renjianwei', 'tester'),
(1, 'lubo', 'developer'),
(1, 'douyanqun', 'developer'),
(2, 'shiweijia', 'manager'),
(2, 'caoqian', 'developer'),
(2, 'chenyiming', 'developer'),
(2, 'pengbukun', 'developer'),
(2, 'renjianwei', 'tester'),
(3, 'caoqian', 'manager'),
(3, 'weishanming', 'developer'),
(3, 'guopeipei', 'developer'),
(4, 'lubo', 'manager'),
(4, 'wangguanghui', 'developer'),
(4, 'douyanqun', 'developer'),
(5, 'zhouguangying', 'manager'),
(5, 'chenyiming', 'developer');

-- ============================================================
-- 4. 项目-仓库关联
-- ============================================================
INSERT INTO `aims_project_repos` (`project_id`, `repo_project_code`) VALUES
(1, 'huizhi-yun/account'),
(1, 'huizhi-yun/codocs'),
(2, 'product/natural-resources'),
(3, 'platform/company-platform/egret'),
(3, 'platform/company-platform/egret-ui-admin-vue3');

-- ============================================================
-- 5. 里程碑
-- ============================================================
INSERT INTO `milestones` (`id`, `project_id`, `name`, `description`, `mode`, `start_date`, `end_date`, `status`, `sort_order`, `created_by`) VALUES
(1, 1, '基础设施建设', '完成 Account 和 Codocs 两个基座模块的核心功能', 'strong_constraint', '2026-01-01', '2026-02-15', 'completed', 1, 'zhouguangying'),
(2, 1, 'Aims MVP', '完成 Aims 项目管理模块 MVP 全部功能', 'strong_constraint', '2026-03-01', '2026-04-15', 'active', 2, 'zhouguangying'),
(3, 1, 'Aims Beta', '完成 Aims 一体化联动和高级功能', 'rolling_plan', '2026-04-16', '2026-05-15', 'planning', 3, 'zhouguangying'),
(4, 2, '需求分析阶段', '完成需求调研、系统设计和原型评审', 'strong_constraint', '2026-02-01', '2026-02-28', 'completed', 1, 'shiweijia'),
(5, 2, '核心开发阶段', '完成不动产登记核心模块开发', 'strong_constraint', '2026-03-01', '2026-04-30', 'active', 2, 'shiweijia'),
(6, 3, '部署上线', '完成环境部署、数据迁移、培训和验收', 'strong_constraint', '2026-03-01', '2026-04-30', 'active', 1, 'caoqian'),
(7, 4, '2026年3月度维护', '3月度运维保障任务', 'periodic', '2026-03-01', '2026-03-31', 'active', 1, 'lubo');

-- ============================================================
-- 6. 工作项 — 项目1 汇智云 v2.0
-- ============================================================

-- 需求（requirement）— milestone_id: 2=Aims MVP, 3=Aims Beta
INSERT INTO `work_items` (`id`, `project_id`, `milestone_id`, `item_number`, `item_key`, `type`, `title`, `description`, `status`, `priority`, `assignee_uid`, `reporter_uid`, `due_date`, `estimated_hours`, `parent_id`) VALUES
(1, 1, 2, 1, 'HZY-1', 'requirement', '项目管理模块', 'Aims MVP 全部功能实现，包含项目管理、工作项和看板。', 'developing', 'P0', 'zhouguangying', 'zhouguangying', '2026-04-15', 120, NULL),
(2, 1, 2, 2, 'HZY-2', 'requirement', '项目 CRUD 与成员管理', '作为项目经理，我需要创建和管理项目，添加项目成员并分配角色。', 'completed', 'P0', 'shiweijia', 'zhouguangying', '2026-03-22', 16, 1),
(3, 1, 2, 3, 'HZY-3', 'requirement', '里程碑看板管理', '作为项目经理，我需要按里程碑规划工作项，并通过看板视图管理状态。', 'developing', 'P0', 'caoqian', 'zhouguangying', '2026-03-25', 24, 1),
(4, 1, 2, 4, 'HZY-4', 'requirement', '工作项统一模型', '支持需求/任务/缺陷三种类型，支持层级拆分和状态流转。', 'developing', 'P0', 'chenyiming', 'zhouguangying', '2026-03-28', 20, 1),
(5, 1, 3, 5, 'HZY-5', 'requirement', 'GitLab commit 自动关联', '通过 commit message 中的 #HZY-N 自动关联工作项。', 'draft', 'P1', NULL, 'zhouguangying', NULL, 8, NULL),
(6, 1, 3, 6, 'HZY-6', 'requirement', '企业微信通知集成', '任务指派、截止提醒、状态变更自动推送企业微信消息。', 'draft', 'P1', NULL, 'zhouguangying', NULL, 6, NULL);

-- 任务（task）— 全部归属 milestone 2 (Aims MVP)
INSERT INTO `work_items` (`id`, `project_id`, `milestone_id`, `item_number`, `item_key`, `type`, `title`, `description`, `status`, `priority`, `assignee_uid`, `reporter_uid`, `due_date`, `estimated_hours`) VALUES
(7, 1, 2, 7, 'HZY-7', 'task', '设计数据库表结构', '设计 aims_schema.sql，包含核心业务表和种子数据。', 'done', 'P0', 'zhouguangying', 'zhouguangying', '2026-03-18', 4),
(8, 1, 2, 8, 'HZY-8', 'task', '搭建开发测试环境', '配置 MySQL hzy_aims 库、配置 .env.dev、验证 Account API 连通性。', 'done', 'P0', 'shiweijia', 'zhouguangying', '2026-03-19', 2),
(9, 1, 2, 9, 'HZY-9', 'task', '实现项目列表 API 和页面', '包含卡片视图和列表视图切换，支持筛选排序。', 'done', 'P0', 'shiweijia', 'zhouguangying', '2026-03-20', 6),
(10, 1, 2, 10, 'HZY-10', 'task', '实现里程碑看板页面', '支持 Kanban 视图，拖拽状态变更，WIP 限制。', 'in_progress', 'P0', 'caoqian', 'zhouguangying', '2026-03-24', 8),
(11, 1, 2, 11, 'HZY-11', 'task', '实现工作项 CRUD API', '包含创建、更新、删除、列表查询，支持批量操作。', 'in_progress', 'P0', 'chenyiming', 'zhouguangying', '2026-03-26', 8),
(12, 1, 2, 12, 'HZY-12', 'task', '编写 API 单元测试', '使用 vitest 覆盖核心 CRUD 和状态流转。', 'todo', 'P1', 'lubo', 'zhouguangying', '2026-03-29', 6),
(13, 1, 2, 13, 'HZY-13', 'task', '为客户XX演示项目管理功能', '准备演示环境和数据，展示看板和需求管理。', 'todo', 'P2', 'zhouguangying', 'zhouguangying', '2026-04-01', 3);

-- 缺陷（bug）— 归属 milestone 2 (Aims MVP)
INSERT INTO `work_items` (`id`, `project_id`, `milestone_id`, `item_number`, `item_key`, `type`, `title`, `description`, `status`, `priority`, `assignee_uid`, `reporter_uid`, `due_date`, `estimated_hours`) VALUES
(14, 1, 2, 14, 'HZY-14', 'bug', '看板拖拽后状态未更新', '在看板视图中拖拽卡片到新列后，数据库中的状态字段没有同步更新。', 'fixing', 'P0', 'caoqian', 'renjianwei', '2026-03-23', 2),
(15, 1, 2, 15, 'HZY-15', 'bug', '项目列表搜索不支持中文', '在项目列表页面搜索框输入中文关键字后，返回空结果。', 'new', 'P1', NULL, 'renjianwei', '2026-03-25', 1);
UPDATE `work_items` SET `severity` = 'critical' WHERE `id` = 14;
UPDATE `work_items` SET `severity` = 'medium' WHERE `id` = 15;

-- ============================================================
-- 7. 工作项 — 项目2 自然资源定制
-- ============================================================
INSERT INTO `work_items` (`project_id`, `milestone_id`, `item_number`, `item_key`, `type`, `title`, `description`, `status`, `priority`, `assignee_uid`, `reporter_uid`, `due_date`, `estimated_hours`, `parent_id`) VALUES
(2, 5, 1, 'NR-1', 'requirement', '不动产登记模块', '不动产统一登记核心功能，含首次登记、转移登记、注销登记。', 'developing', 'P0', 'shiweijia', 'shiweijia', '2026-04-30', 160, NULL),
(2, 5, 2, 'NR-2', 'requirement', '首次登记流程', '完成不动产首次登记全流程，包含表单录入、材料上传、审核。', 'developing', 'P0', 'caoqian', 'shiweijia', '2026-03-31', 40, NULL);

INSERT INTO `work_items` (`project_id`, `milestone_id`, `item_number`, `item_key`, `type`, `title`, `status`, `priority`, `assignee_uid`, `reporter_uid`, `due_date`, `estimated_hours`) VALUES
(2, 5, 3, 'NR-3', 'task', '设计登记表单页面', 'done', 'P0', 'caoqian', 'shiweijia', '2026-03-15', 8),
(2, 5, 4, 'NR-4', 'task', '实现登记数据校验逻辑', 'in_progress', 'P0', 'chenyiming', 'shiweijia', '2026-03-25', 6),
(2, 5, 5, 'NR-5', 'task', '对接不动产数据交换平台', 'todo', 'P1', 'pengbukun', 'shiweijia', '2026-04-10', 12);

INSERT INTO `work_items` (`project_id`, `milestone_id`, `item_number`, `item_key`, `type`, `title`, `description`, `status`, `priority`, `assignee_uid`, `reporter_uid`, `due_date`, `estimated_hours`) VALUES
(2, 5, 6, 'NR-6', 'bug', '登记编号生成重复', '并发提交时偶尔出现登记编号重复的问题。', 'confirmed', 'P0', 'chenyiming', 'renjianwei', '2026-03-22', 3);
UPDATE `work_items` SET `severity` = 'high' WHERE `item_key` = 'NR-6';

-- 关联开发任务务的 parent_id
UPDATE `work_items` SET `parent_id` = (SELECT id FROM (SELECT id FROM `work_items` WHERE `item_key` = 'NR-1') t) WHERE `item_key` = 'NR-2';

-- ============================================================
-- 8. 工作项 — 项目3 底座交付（全部是任务）
-- ============================================================
INSERT INTO `work_items` (`project_id`, `milestone_id`, `item_number`, `item_key`, `type`, `title`, `status`, `priority`, `assignee_uid`, `reporter_uid`, `due_date`, `estimated_hours`) VALUES
(3, 6, 1, 'DEP-1', 'task', '服务器环境准备', 'done', 'P0', 'weishanming', 'caoqian', '2026-03-05', 8),
(3, 6, 2, 'DEP-2', 'task', '数据库部署与初始化', 'done', 'P0', 'weishanming', 'caoqian', '2026-03-08', 4),
(3, 6, 3, 'DEP-3', 'task', '应用部署与配置', 'done', 'P0', 'guopeipei', 'caoqian', '2026-03-12', 6),
(3, 6, 4, 'DEP-4', 'task', '历史数据清洗与迁移', 'in_progress', 'P0', 'weishanming', 'caoqian', '2026-03-25', 16),
(3, 6, 5, 'DEP-5', 'task', '用户培训（管理员）', 'todo', 'P1', 'guopeipei', 'caoqian', '2026-04-01', 8),
(3, 6, 6, 'DEP-6', 'task', '用户培训（普通用户）', 'todo', 'P1', 'guopeipei', 'caoqian', '2026-04-08', 8),
(3, 6, 7, 'DEP-7', 'task', '验收测试', 'todo', 'P0', 'caoqian', 'caoqian', '2026-04-15', 8),
(3, 6, 8, 'DEP-8', 'task', '编写运维文档', 'todo', 'P2', 'weishanming', 'caoqian', '2026-04-20', 6);

-- ============================================================
-- 9. 工作项 — 项目4 运维保障（任务+缺陷）
-- ============================================================
INSERT INTO `work_items` (`project_id`, `milestone_id`, `item_number`, `item_key`, `type`, `title`, `status`, `priority`, `assignee_uid`, `reporter_uid`, `estimated_hours`) VALUES
(4, 7, 1, 'OPS-1', 'bug', 'XX客户系统登录异常', 'fixing', 'P0', 'wangguanghui', 'lubo', 2),
(4, 7, 2, 'OPS-2', 'task', '月度系统巡检 - 3月', 'in_progress', 'P1', 'douyanqun', 'lubo', 4),
(4, 7, 3, 'OPS-3', 'bug', 'YY客户报表导出超时', 'new', 'P1', NULL, 'lubo', 3),
(4, 7, 4, 'OPS-4', 'task', '更新 SSL 证书（4月到期）', 'todo', 'P1', 'wangguanghui', 'lubo', 2),
(4, 7, 5, 'OPS-5', 'task', '数据库备份策略优化', 'done', 'P2', 'douyanqun', 'lubo', 6);
UPDATE `work_items` SET `severity` = 'critical' WHERE `item_key` = 'OPS-1';
UPDATE `work_items` SET `severity` = 'medium' WHERE `item_key` = 'OPS-3';

-- ============================================================
-- 10. 工作项评论
-- ============================================================
INSERT INTO `work_item_comments` (`work_item_id`, `author_uid`, `content`) VALUES
(14, 'renjianwei', '复现步骤：\n1. 打开看板页面\n2. 拖拽卡片从"待办"到"进行中"\n3. 刷新页面，卡片回到"待办"列'),
(14, 'caoqian', '已定位问题，正在修复拖拽事件处理函数。'),
(11, 'chenyiming', '批量操作的 API 已完成，支持批量修改状态、优先级和指派人。'),
(4, 'zhouguangying', '工作项模型已确认，采用 requirement/task/bug 三种类型。'),
(1, 'zhouguangying', 'Aims MVP 功能按计划推进中，当前里程碑进展顺利。');

-- ============================================================
-- 11. 工作项变更日志
-- ============================================================
INSERT INTO `work_item_changelog` (`work_item_id`, `field_name`, `old_value`, `new_value`, `changed_by`, `changed_at`) VALUES
(2, 'status', 'developing', 'completed', 'shiweijia', '2026-03-22 14:00:00'),
(9, 'status', 'todo', 'in_progress', 'shiweijia', '2026-03-19 09:00:00'),
(9, 'status', 'in_progress', 'done', 'shiweijia', '2026-03-20 17:00:00'),
(10, 'status', 'todo', 'in_progress', 'caoqian', '2026-03-20 09:00:00'),
(11, 'status', 'todo', 'in_progress', 'chenyiming', '2026-03-21 09:00:00'),
(14, 'status', 'new', 'confirmed', 'caoqian', '2026-03-22 10:00:00'),
(14, 'status', 'confirmed', 'fixing', 'caoqian', '2026-03-22 14:00:00'),
(7, 'status', 'todo', 'in_progress', 'zhouguangying', '2026-03-17 09:00:00'),
(7, 'status', 'in_progress', 'done', 'zhouguangying', '2026-03-18 17:00:00'),
(8, 'status', 'todo', 'in_progress', 'shiweijia', '2026-03-18 09:00:00'),
(8, 'status', 'in_progress', 'done', 'shiweijia', '2026-03-19 15:00:00'),
(3, 'status', 'confirmed', 'developing', 'caoqian', '2026-03-20 09:00:00'),
(4, 'status', 'confirmed', 'developing', 'chenyiming', '2026-03-21 09:00:00');

-- ============================================================
-- 12. 工时记录
-- ============================================================
INSERT INTO `time_entries` (`work_item_id`, `uid`, `entry_date`, `hours`, `description`) VALUES
(7, 'zhouguangying', '2026-03-17', 4.00, '设计数据库表结构'),
(7, 'zhouguangying', '2026-03-18', 3.50, '完善表结构，添加索引和种子数据'),
(9, 'shiweijia', '2026-03-19', 6.00, '实现项目列表 API 和前端页面'),
(9, 'shiweijia', '2026-03-20', 4.00, '完善项目创建表单和卡片视图'),
(10, 'caoqian', '2026-03-20', 5.00, '实现看板页面基础布局'),
(10, 'caoqian', '2026-03-21', 6.00, '完成看板列渲染和卡片组件'),
(10, 'caoqian', '2026-03-22', 4.00, '调试拖拽交互'),
(11, 'chenyiming', '2026-03-21', 7.00, '实现工作项 CRUD API'),
(11, 'chenyiming', '2026-03-22', 5.00, '实现工作项更新和删除 API'),
(8, 'shiweijia', '2026-03-18', 2.00, '搭建开发测试环境');

-- ============================================================
-- 13. 通知规则
-- ============================================================
INSERT INTO `notification_rules` (`project_id`, `event_type`, `enabled`, `config`) VALUES
(1, 'task_assigned', 1, '{"channels": ["wecom"]}'),
(1, 'status_changed', 1, '{"channels": ["wecom"]}'),
(1, 'due_reminder', 1, '{"channels": ["wecom"], "daysBefore": [1, 3]}'),
(2, 'task_assigned', 1, '{"channels": ["wecom"]}'),
(2, 'due_reminder', 1, '{"channels": ["wecom"], "daysBefore": [1, 7]}');
