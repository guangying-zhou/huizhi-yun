-- ============================================================================
-- 汇智云平台第二批 SQL Migration 草案
-- 目标范围：
--   1. permission_templates
--   2. template_roles
--   3. template_bindings
--   4. template_overrides
--   5. role_scopes
--
-- 前置依赖：
--   - Batch-1-SQL-Migration-Draft.sql 已完成
--   - roles / resources 表结构已具备第一批扩展字段
--   - MySQL 8.x
-- ============================================================================

-- ============================================================================
-- 0. Preflight Check
-- ============================================================================

SELECT COUNT(*) AS roles_count FROM roles;
SELECT COUNT(*) AS resources_count FROM resources;

-- 建议执行前确认：
-- 1. roles.role_type / roles.app_code 已存在
-- 2. 现网未存在同名新表
-- 3. 角色分类已至少完成第一轮回填


-- ============================================================================
-- 1. permission_templates
-- 目的：
--   - 定义模板本体
--   - 为岗位模板、职责模板、运营模板提供承载
-- ============================================================================

CREATE TABLE permission_templates (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) NULL COMMENT '所属公司编码(NULL=系统模板)',
    template_code   VARCHAR(100) NOT NULL COMMENT '模板编码',
    template_name   VARCHAR(100) NOT NULL COMMENT '模板名称',
    template_type   VARCHAR(20) NOT NULL DEFAULT 'job' COMMENT '模板类型：job/duty/ops/custom',
    description     TEXT NULL COMMENT '模板描述',
    status          TINYINT NOT NULL DEFAULT 1 COMMENT '状态：1启用 0禁用',
    sort_order      INT NOT NULL DEFAULT 0 COMMENT '排序',
    created_by      VARCHAR(50) NULL COMMENT '创建人 uid',
    updated_by      VARCHAR(50) NULL COMMENT '更新人 uid',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_permission_templates_company_code (company_code, template_code),
    KEY idx_permission_templates_type (template_type),
    KEY idx_permission_templates_status (status),
    KEY idx_permission_templates_company_code (company_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='权限模板表';


-- ============================================================================
-- 2. template_roles
-- 目的：
--   - 定义模板包含哪些角色
--   - 模板只挂角色，不直接挂原始权限点
-- ============================================================================

CREATE TABLE template_roles (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) NULL COMMENT '所属公司编码(NULL=系统模板角色关系)',
    template_id     BIGINT NOT NULL COMMENT '模板ID',
    role_id         BIGINT NOT NULL COMMENT '角色ID',
    sort_order      INT NOT NULL DEFAULT 0 COMMENT '模板内排序',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_template_roles_template_role (template_id, role_id),
    KEY idx_template_roles_company_code (company_code),
    KEY idx_template_roles_template_id (template_id),
    KEY idx_template_roles_role_id (role_id),
    CONSTRAINT fk_template_roles_template
        FOREIGN KEY (template_id) REFERENCES permission_templates(id) ON DELETE CASCADE,
    CONSTRAINT fk_template_roles_role
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模板角色关联表';


-- ============================================================================
-- 3. template_bindings
-- 目的：
--   - 定义模板绑定到谁
--   - 支撑岗位默认、部门补充、用户例外三类模板分配
-- ============================================================================

CREATE TABLE template_bindings (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) NULL COMMENT '所属公司编码(NULL=系统级绑定)',
    template_id     BIGINT NOT NULL COMMENT '模板ID',
    subject_type    VARCHAR(20) NOT NULL COMMENT '绑定对象类型：user/department/job',
    subject_id      VARCHAR(100) NOT NULL COMMENT '绑定对象ID(uid/部门编码/岗位编码)',
    priority        INT NOT NULL DEFAULT 0 COMMENT '同类绑定优先级',
    status          TINYINT NOT NULL DEFAULT 1 COMMENT '状态：1启用 0禁用',
    start_at        DATETIME NULL COMMENT '生效开始时间',
    end_at          DATETIME NULL COMMENT '生效结束时间',
    created_by      VARCHAR(50) NULL COMMENT '创建人 uid',
    updated_by      VARCHAR(50) NULL COMMENT '更新人 uid',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_template_bindings_template_subject (template_id, subject_type, subject_id),
    KEY idx_template_bindings_company_subject (company_code, subject_type, subject_id, status),
    KEY idx_template_bindings_template_id (template_id),
    KEY idx_template_bindings_priority (priority),
    CONSTRAINT fk_template_bindings_template
        FOREIGN KEY (template_id) REFERENCES permission_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模板绑定表';


-- ============================================================================
-- 4. template_overrides
-- 目的：
--   - 表达模板展开结果上的例外调整
--   - 第一阶段只做角色级 grant / exclude
-- ============================================================================

CREATE TABLE template_overrides (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code        VARCHAR(7) NULL COMMENT '所属公司编码(NULL=系统级覆盖)',
    subject_type        VARCHAR(20) NOT NULL COMMENT '对象类型：user/department/job',
    subject_id          VARCHAR(100) NOT NULL COMMENT '对象ID(uid/部门编码/岗位编码)',
    role_id             BIGINT NOT NULL COMMENT '目标角色ID',
    override_type       VARCHAR(20) NOT NULL COMMENT '覆盖类型：grant/exclude',
    source_template_id  BIGINT NULL COMMENT '来源模板ID，可为空',
    reason              VARCHAR(500) NULL COMMENT '覆盖原因',
    status              TINYINT NOT NULL DEFAULT 1 COMMENT '状态：1启用 0禁用',
    created_by          VARCHAR(50) NULL COMMENT '创建人 uid',
    updated_by          VARCHAR(50) NULL COMMENT '更新人 uid',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_template_overrides_subject_role_type (subject_type, subject_id, role_id, override_type),
    KEY idx_template_overrides_company_subject (company_code, subject_type, subject_id, status),
    KEY idx_template_overrides_role_id (role_id),
    KEY idx_template_overrides_override_type (override_type),
    KEY idx_template_overrides_template_id (source_template_id),
    CONSTRAINT fk_template_overrides_role
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_template_overrides_template
        FOREIGN KEY (source_template_id) REFERENCES permission_templates(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模板覆盖表';


-- ============================================================================
-- 5. role_scopes
-- 目的：
--   - 定义角色在某资源动作上的范围规则
--   - 第一阶段采用 (role_id, resource_id, action) 粒度
-- ============================================================================

CREATE TABLE role_scopes (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) NULL COMMENT '所属公司编码(NULL=系统级范围规则)',
    role_id         BIGINT NOT NULL COMMENT '角色ID',
    resource_id     BIGINT NOT NULL COMMENT '资源ID',
    action          ENUM('view', 'edit', 'admin') NOT NULL COMMENT '动作类型',
    scope_type      VARCHAR(20) NOT NULL COMMENT '范围类型：all/org/relation/attribute',
    scope_value     VARCHAR(100) NOT NULL COMMENT '范围值，如 all/self/department',
    status          TINYINT NOT NULL DEFAULT 1 COMMENT '状态：1启用 0禁用',
    created_by      VARCHAR(50) NULL COMMENT '创建人 uid',
    updated_by      VARCHAR(50) NULL COMMENT '更新人 uid',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_role_scopes_company_role_resource_action_scope (
        company_code, role_id, resource_id, action, scope_type, scope_value
    ),
    KEY idx_role_scopes_role_resource_action (role_id, resource_id, action),
    KEY idx_role_scopes_company_code (company_code),
    KEY idx_role_scopes_scope_type (scope_type),
    CONSTRAINT fk_role_scopes_role
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_role_scopes_resource
        FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色范围规则表';


-- ============================================================================
-- 6. Seed Draft
-- 说明：
--   - 只放极少量系统模板示例
--   - 实际生产可拆到独立 seed 文件执行
-- ============================================================================

INSERT INTO permission_templates (
    company_code, template_code, template_name, template_type, description, created_by, updated_by
) VALUES
    (NULL, 'tpl:internal_basic', '内部员工基础模板', 'job', '内部员工默认基础模板', 'system', 'system'),
    (NULL, 'tpl:guest_basic', '访客基础模板', 'job', '访客默认基础模板', 'system', 'system')
ON DUPLICATE KEY UPDATE
    template_name = VALUES(template_name),
    template_type = VALUES(template_type),
    description = VALUES(description),
    updated_by = VALUES(updated_by);


-- ============================================================================
-- 7. Post Migration Validation
-- ============================================================================

SELECT COUNT(*) AS templates_count FROM permission_templates;
SELECT COUNT(*) AS template_roles_count FROM template_roles;
SELECT COUNT(*) AS template_bindings_count FROM template_bindings;
SELECT COUNT(*) AS template_overrides_count FROM template_overrides;
SELECT COUNT(*) AS role_scopes_count FROM role_scopes;

SELECT template_code, template_name, template_type, status
FROM permission_templates
ORDER BY template_code;

SELECT DISTINCT subject_type
FROM template_bindings
ORDER BY subject_type;

SELECT DISTINCT override_type
FROM template_overrides
ORDER BY override_type;

SELECT DISTINCT scope_type, scope_value
FROM role_scopes
ORDER BY scope_type, scope_value;


-- ============================================================================
-- 8. Manual Review Checklist
-- ============================================================================

-- 1. 复核系统模板编码是否与角色字典命名一致
-- 2. 复核 template_overrides 目前只做角色级覆盖是否满足第一阶段需要
-- 3. 复核 role_scopes 的 scope_type/scope_value 枚举是否和 SDK 契约一致
-- 4. 复核是否需要在服务端增加跨租户 template / role 引用校验
-- 5. 复核用户/部门/岗位绑定的默认优先级常量取值
