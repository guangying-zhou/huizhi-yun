-- ============================================================================
-- 汇智云平台第三批 SQL Migration 草案
-- 目标范围：
--   1. subjects
--   2. subject_identities
--
-- 前置依赖：
--   - Batch-1-SQL-Migration-Draft.sql 已完成
--   - MySQL 8.x
-- ============================================================================

-- ============================================================================
-- 0. Preflight Check
-- ============================================================================

-- 建议执行前确认：
-- 1. 当前系统已有哪张表承载用户基础目录
-- 2. 当前系统已有哪张表承载部门目录
-- 3. 是否已有稳定的岗位编码来源，如果没有，先按 job:* 角色初始化


-- ============================================================================
-- 1. subjects
-- 目的：
--   - 承接最小主体目录
--   - 支撑模板绑定、身份映射、权限运营
-- ============================================================================

CREATE TABLE subjects (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code        VARCHAR(7) NULL COMMENT '所属公司编码(NULL=系统级主体)',
    subject_type        VARCHAR(20) NOT NULL COMMENT '主体类型：user/department/job',
    subject_code        VARCHAR(100) NOT NULL COMMENT '主体编码(uid/部门编码/岗位编码)',
    display_name        VARCHAR(100) NULL COMMENT '展示名称',
    external_ref        VARCHAR(255) NULL COMMENT '外部系统引用ID',
    parent_subject_id   BIGINT NULL COMMENT '父主体ID',
    status              TINYINT NOT NULL DEFAULT 1 COMMENT '状态：1启用 0禁用',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_subjects_company_type_code (company_code, subject_type, subject_code),
    KEY idx_subjects_company_type (company_code, subject_type),
    KEY idx_subjects_parent_subject_id (parent_subject_id),
    KEY idx_subjects_status (status),
    CONSTRAINT fk_subjects_parent
        FOREIGN KEY (parent_subject_id) REFERENCES subjects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='最小主体目录表';


-- ============================================================================
-- 2. subject_identities
-- 目的：
--   - 记录主体与上游身份源的映射关系
--   - 支撑 CAS / 企业微信 / GitLab OIDC / 通用 OIDC 统一映射
-- ============================================================================

CREATE TABLE subject_identities (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code            VARCHAR(7) NULL COMMENT '所属公司编码(NULL=系统级映射)',
    subject_id              BIGINT NOT NULL COMMENT '主体ID',
    provider_type           VARCHAR(30) NOT NULL COMMENT '身份源类型：cas/wecom/gitlab_oidc/oidc/saml/ldap',
    provider_subject_key    VARCHAR(255) NOT NULL COMMENT '上游身份唯一键',
    provider_metadata       JSON NULL COMMENT '上游附加元数据',
    status                  TINYINT NOT NULL DEFAULT 1 COMMENT '状态：1启用 0禁用',
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_subject_identities_provider_subject (provider_type, provider_subject_key),
    KEY idx_subject_identities_subject_id (subject_id),
    KEY idx_subject_identities_company_code (company_code),
    KEY idx_subject_identities_status (status),
    CONSTRAINT fk_subject_identities_subject
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='主体身份映射表';


-- ============================================================================
-- 3. Initialization Draft
-- 说明：
--   - 第一阶段只做最小初始化建议
--   - 实际导入 SQL 需按现网用户表/部门表结构调整
-- ============================================================================

-- 3.1 从 roles 中的 job 角色初始化岗位主体
INSERT INTO subjects (
    company_code, subject_type, subject_code, display_name, external_ref, status
)
SELECT
    company_code,
    'job' AS subject_type,
    role_code AS subject_code,
    role_name AS display_name,
    CAST(id AS CHAR) AS external_ref,
    status
FROM roles
WHERE role_type = 'job'
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    external_ref = VALUES(external_ref),
    status = VALUES(status);

-- 3.2 用户 / 部门主体初始化
-- 请根据现网真实表结构替换下面的示例 SQL。
--
-- INSERT INTO subjects (company_code, subject_type, subject_code, display_name, external_ref, status)
-- SELECT company_code, 'user', uid, cn, uid, 1
-- FROM users;
--
-- INSERT INTO subjects (company_code, subject_type, subject_code, display_name, external_ref, status)
-- SELECT company_code, 'department', dept_code, dept_name, dept_code, 1
-- FROM departments;


-- ============================================================================
-- 4. Post Migration Validation
-- ============================================================================

SELECT subject_type, COUNT(*) AS cnt
FROM subjects
GROUP BY subject_type
ORDER BY subject_type;

SELECT provider_type, COUNT(*) AS cnt
FROM subject_identities
GROUP BY provider_type
ORDER BY provider_type;

SELECT id, company_code, subject_type, subject_code, display_name, parent_subject_id
FROM subjects
ORDER BY subject_type, subject_code
LIMIT 50;


-- ============================================================================
-- 5. Manual Review Checklist
-- ============================================================================

-- 1. 复核 subject_code 的唯一性策略是否和现网用户/部门编码一致
-- 2. 复核是否允许 company_code = NULL 的系统级 subject
-- 3. 复核 parent_subject_id 是否足够表达部门树，如果不足再做二期增强
-- 4. 复核各身份源 provider_subject_key 的标准化格式
-- 5. 复核是否需要对 subject_identities.provider_type 建枚举约束
