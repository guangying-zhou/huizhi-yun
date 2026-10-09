# 汇智云一体化经营交付平台 (PMS) 数据库整合脚本

> 当前状态：**远期统一主库参考稿，不是 V1 实施脚本**
>
> 说明：
>
> - 当前推荐实施方案是保留 `hzy_altoc` 与 `hzy_aims` 双库，通过桥接字段和应用层联动实现整合
> - 本文档描述的是未来若要建设统一 `hzy_pms` 主库时可参考的目标态草案
> - 本文脚本 **不能直接替换当前 Aims / Altoc 运行中的 schema**
> - 若误将本脚本作为现网补丁执行，会与当前 Aims 的表名、日志表、计数器表、迭代表等运行时依赖产生冲突

以下内容仅作为未来统一主库方案的结构参考。

---

```sql
-- ============================================================
-- 汇智云·一体化经营交付平台 (PMS) 完整数据库脚本
-- 数据库名: hzy_pms
-- 版本: v1.5 (Integrated LTC-PIVR)
-- 创建日期: 2026-03-26
-- 说明:
--   1. 整合了经营侧(Altoc)与交付侧(Aims)的业务实体。
--   2. 采用 PIVR (Preparation, Implementation, Validation, Refinement) 生命周期。
--   3. 5层结构: 项目集 -> 项目 -> 阶段(里程碑) -> 工作项 -> 任务。
--   4. 人员与组织架构通过 Account 模块接口关联(uid/dept_code)。
-- ============================================================

CREATE DATABASE IF NOT EXISTS `hzy_c000001` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `hzy_c000001`;

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- 一、 全局基础配置表 (共享维度)
-- ============================================================

-- 行业与区域配置
CREATE TABLE `industry` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `code` VARCHAR(50) UNIQUE NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `sort_no` INT DEFAULT 0,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='行业配置';

CREATE TABLE `region` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `code` VARCHAR(50) UNIQUE NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `parent_id` BIGINT DEFAULT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='区域配置';

-- 客户表 (经营与交付的核心关联点)
CREATE TABLE `customer` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `code` VARCHAR(30) UNIQUE NOT NULL COMMENT '客户编号(CU-xxxxxx)',
    `name` VARCHAR(200) NOT NULL,
    `industry_id` BIGINT,
    `region_id` BIGINT,
    `owner_user_id` VARCHAR(64) NOT NULL COMMENT '归属人(Account uid)',
    `status` VARCHAR(20) DEFAULT 'active',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_cust_industry` FOREIGN KEY (`industry_id`) REFERENCES `industry` (`id`)
) ENGINE=InnoDB COMMENT='客户主表';

-- ============================================================
-- 二、 经营管理模块 (Altoc 核心)
-- ============================================================

-- 商机阶段配置
CREATE TABLE `opportunity_stage` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `code` VARCHAR(50) UNIQUE NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `win_rate` DECIMAL(5,2) DEFAULT 0.00,
    `sort_no` INT DEFAULT 0
) ENGINE=InnoDB COMMENT='商机阶段配置';

-- 商机表
CREATE TABLE `opportunity` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `code` VARCHAR(30) UNIQUE NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `customer_id` BIGINT NOT NULL,
    `stage_id` BIGINT NOT NULL,
    `amount` DECIMAL(18,2) COMMENT '预计金额',
    `status` VARCHAR(20) DEFAULT 'active' COMMENT 'active/won/lost',
    `owner_user_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_opp_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer` (`id`),
    CONSTRAINT `fk_opp_stage` FOREIGN KEY (`stage_id`) REFERENCES `opportunity_stage` (`id`)
) ENGINE=InnoDB COMMENT='商机表';

-- 合同表
CREATE TABLE `contract` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `code` VARCHAR(30) UNIQUE NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `customer_id` BIGINT NOT NULL,
    `opportunity_id` BIGINT,
    `amount` DECIMAL(18,2) NOT NULL,
    `status` VARCHAR(20) DEFAULT 'draft',
    `owner_user_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_ct_opp` FOREIGN KEY (`opportunity_id`) REFERENCES `opportunity` (`id`)
) ENGINE=InnoDB COMMENT='合同表';

-- 合同付款条款
CREATE TABLE `contract_payment_terms` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `contract_id` BIGINT NOT NULL,
    `term_name` VARCHAR(100) NOT NULL,
    `ratio` DECIMAL(5,2) COMMENT '占比',
    `amount` DECIMAL(18,2) NOT NULL,
    `condition_desc` TEXT COMMENT '触发条件(如验收后付款)',
    CONSTRAINT `fk_term_contract` FOREIGN KEY (`contract_id`) REFERENCES `contract` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='合同付款条款';

-- ============================================================
-- 三、 项目交付模块 (Aims 核心 - 5层结构)
-- ============================================================

-- 1. 项目集
CREATE TABLE `project_portfolios` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `name` VARCHAR(200) NOT NULL,
    `owner_uid` VARCHAR(64) NOT NULL,
    `status` ENUM('active','archived') DEFAULT 'active'
) ENGINE=InnoDB COMMENT='项目集(L1)';

-- 2. 项目主表 (集成经营侧 ID)
CREATE TABLE `projects` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `portfolio_id` BIGINT,
    `project_code` VARCHAR(50) UNIQUE NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `category` ENUM('product_dev','custom_dev','delivery','maintenance','sales','presales') NOT NULL,
    `opp_id` BIGINT COMMENT '关联商机',
    `contract_id` BIGINT COMMENT '关联合同',
    `customer_id` BIGINT COMMENT '关联客户',
    `leader_uid` VARCHAR(64) NOT NULL COMMENT '项目负责人(PM)',
    `lifecycle_status` VARCHAR(20) DEFAULT 'active',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_proj_portfolio` FOREIGN KEY (`portfolio_id`) REFERENCES `project_portfolios` (`id`),
    CONSTRAINT `fk_proj_opp` FOREIGN KEY (`opp_id`) REFERENCES `opportunity` (`id`),
    CONSTRAINT `fk_proj_cust` FOREIGN KEY (`customer_id`) REFERENCES `customer` (`id`)
) ENGINE=InnoDB COMMENT='项目表(L2)';

-- 3. 项目成员表 (记录业务上下文角色)
CREATE TABLE `project_members` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `uid` VARCHAR(64) NOT NULL,
    `biz_role` ENUM('manager','developer','tester','presales','owner') DEFAULT 'developer',
    `joined_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_proj_user` (`project_id`, `uid`),
    CONSTRAINT `fk_mem_proj` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='项目成员';

-- 4. 里程碑/阶段表 (PIVR 生命周期)
CREATE TABLE `milestones` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `parent_id` BIGINT DEFAULT NULL COMMENT '支持嵌套',
    `pivr_stage` ENUM('P','I','V','R') NOT NULL DEFAULT 'I',
    `name` VARCHAR(200) NOT NULL,
    `payment_term_id` BIGINT DEFAULT NULL COMMENT '关联回款条款',
    `status` ENUM('planning','active','completed') DEFAULT 'planning',
    `end_date` DATE,
    `actual_end_date` DATE COMMENT '用于AI进度分析',
    CONSTRAINT `fk_ms_proj` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_ms_term` FOREIGN KEY (`payment_term_id`) REFERENCES `contract_payment_terms` (`id`)
) ENGINE=InnoDB COMMENT='里程碑/阶段(L3)';

-- 交付物清单表 (针对V阶段合规审计)
CREATE TABLE `milestone_deliverables` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `milestone_id` BIGINT NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `is_required` TINYINT(1) DEFAULT 1,
    `status` ENUM('pending','uploaded','approved') DEFAULT 'pending',
    `attachment_id` BIGINT,
    CONSTRAINT `fk_deliv_ms` FOREIGN KEY (`milestone_id`) REFERENCES `milestones` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='阶段交付物清单';

-- 5. 工作项表 (需求/任务/缺陷)
CREATE TABLE `work_items` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `milestone_id` BIGINT NOT NULL,
    `parent_id` BIGINT DEFAULT NULL COMMENT '需求->任务->子任务结构',
    `type` ENUM('requirement','task','bug') NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `status` VARCHAR(64) DEFAULT 'todo',
    `is_blocked` TINYINT(1) DEFAULT 0,
    `block_reason` TEXT,
    `assignee_uid` VARCHAR(64),
    `weight` INT DEFAULT 1 COMMENT '权重(进度Roll-up)',
    `progress_rate` TINYINT DEFAULT 0 COMMENT '0-100',
    CONSTRAINT `fk_item_proj` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_item_ms` FOREIGN KEY (`milestone_id`) REFERENCES `milestones` (`id`),
    CONSTRAINT `fk_item_parent` FOREIGN KEY (`parent_id`) REFERENCES `work_items` (`id`)
) ENGINE=InnoDB COMMENT='工作项/任务(L4/L5)';

-- ============================================================
-- 四、 财务与结算 (经营侧反馈)
-- ============================================================

-- 回款计划表 (由 Aims 交付阶段驱动状态)
CREATE TABLE `receivable_plan` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `contract_id` BIGINT NOT NULL,
    `payment_term_id` BIGINT NOT NULL,
    `status` ENUM('pending','to_invoice','received','overdue') DEFAULT 'pending',
    `amount` DECIMAL(18,2) NOT NULL,
    `planned_date` DATE,
    CONSTRAINT `fk_rp_contract` FOREIGN KEY (`contract_id`) REFERENCES `contract` (`id`),
    CONSTRAINT `fk_rp_term` FOREIGN KEY (`payment_term_id`) REFERENCES `contract_payment_terms` (`id`)
) ENGINE=InnoDB COMMENT='回款计划';

-- ============================================================
-- 五、 AI 辅助与分析
-- ============================================================

-- 商机/项目风险分析
CREATE TABLE `ai_risk_analysis` (
    `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
    `entity_type` ENUM('opportunity','project','milestone') NOT NULL,
    `entity_id` BIGINT NOT NULL,
    `risk_level` ENUM('low','medium','high'),
    `risk_reason` TEXT,
    `suggestion` TEXT,
    `generated_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='AI风险分析';

SET FOREIGN_KEY_CHECKS = 1;
```

## 整合要点说明：

1. **PIVR 显式化**：在 `milestones` 表中通过 `pivr_stage` 明确了项目阶段，这是系统进行横向效能分析（AI 预测）的基石。
2. **LTC 全链路闭环**：`opportunity` → `projects` → `milestones` → `receivable_plan`。当 Aims 中的“验证交付 (V)”里程碑完成时，应用层可根据 `payment_term_id` 自动将财务侧的 `receivable_plan` 设为“待开票”。
3. **5 层结构落地**：
   * **L1-项目集**：`project_portfolios`
   * **L2-项目**：`projects`
   * **L3-阶段**：`milestones` (带 PIVR 枚举)
   * **L4/L5-工作项/任务**：由 `work_items` 表通过 `parent_id` 统一管理需求、任务和子任务。
4. **业务角色分离**：`project_members` 表通过 `biz_role` 记录用户在项目中的业务身份（如售前、PM），不再依赖 Account 的全局角色，实现了“一人多项目多角色”的灵活性。
5. **AI 预警埋点**：在 `work_items` 中增加了 `is_blocked` 和 `block_reason` 字段，专门为 AI 进度预测提供负面诱因数据。
