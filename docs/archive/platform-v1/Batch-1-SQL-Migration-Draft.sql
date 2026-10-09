-- ============================================================================
-- 汇智云平台第一批 SQL Migration 草案
-- 目标范围：
--   1. roles 扩字段
--   2. user_roles 扩字段
--   3. resources 扩字段
--   4. applications 扩字段
--
-- 使用前提：
--   - 目标数据库为当前 account 主库
--   - 当前基线接近 account/docs/account_schema.sql
--   - MySQL 8.x
--
-- 说明：
--   - 本文件是第一批 migration draft，不直接包含模板、scope、subjects 等新表
--   - 本文件优先解决角色分类、授权来源、manifest 元数据、资源同步来源四类问题
--   - 执行前请先在测试库验证索引名和字段名是否与现网一致
-- ============================================================================

-- ============================================================================
-- 0. Preflight Check
-- ============================================================================

SELECT 'roles' AS table_name, COUNT(*) AS row_count FROM roles
UNION ALL
SELECT 'user_roles' AS table_name, COUNT(*) AS row_count FROM user_roles
UNION ALL
SELECT 'resources' AS table_name, COUNT(*) AS row_count FROM resources
UNION ALL
SELECT 'applications' AS table_name, COUNT(*) AS row_count FROM applications;

-- 建议额外确认：
-- 1. roles / user_roles / resources / applications 是否存在历史同名扩展字段
-- 2. 索引名是否已占用
-- 3. 当前应用与资源数量，评估回填耗时


-- ============================================================================
-- 1. roles
-- 目的：
--   - 引入角色分类（system/base/job/app）
--   - 引入应用归属 app_code
--   - 引入是否允许直接分配 is_assignable
-- ============================================================================

ALTER TABLE roles
    ADD COLUMN role_type VARCHAR(20) NOT NULL DEFAULT 'app' COMMENT '角色类型：system/base/job/app' AFTER description,
    ADD COLUMN app_code VARCHAR(50) NULL COMMENT '所属应用编码，system/base/job 角色可为空' AFTER role_type,
    ADD COLUMN is_assignable TINYINT NOT NULL DEFAULT 1 COMMENT '是否允许直接分配：1允许 0不允许' AFTER is_system;

CREATE INDEX idx_role_type ON roles (role_type);
CREATE INDEX idx_role_app_code ON roles (app_code);
CREATE INDEX idx_role_assignable ON roles (is_assignable);

-- 第一轮保守回填：
-- 1. 显式系统角色归为 system
-- 2. internal_user / guest 归为 base
-- 3. job:* 和历史 user:* 归为 job
-- 4. aims:* / codocs:* / account:* 归为 app
-- 5. 未命中的角色先保留默认 app，后续人工复核
UPDATE roles
SET
    role_type = CASE
        WHEN role_code IN ('super_admin', 'org_admin') THEN 'system'
        WHEN role_code IN ('internal_user', 'guest') THEN 'base'
        WHEN role_code LIKE 'job:%' THEN 'job'
        WHEN role_code LIKE 'user:%' THEN 'job'
        WHEN role_code LIKE 'aims:%' THEN 'app'
        WHEN role_code LIKE 'codocs:%' THEN 'app'
        WHEN role_code LIKE 'account:%' THEN 'app'
        ELSE role_type
    END,
    app_code = CASE
        WHEN role_code LIKE 'aims:%' THEN 'aims'
        WHEN role_code LIKE 'codocs:%' THEN 'codocs'
        WHEN role_code LIKE 'account:%' THEN 'account'
        ELSE app_code
    END
WHERE role_type = 'app'
   OR app_code IS NULL;

-- 可选：对极少数不应直接分配的系统级角色做收口
UPDATE roles
SET is_assignable = 0
WHERE role_code IN ('super_admin');


-- ============================================================================
-- 2. user_roles
-- 目的：
--   - 记录授权来源
--   - 为后续 manual / job / template / override 留出可追踪空间
--   - 第一阶段仍不将模板展开结果物化写回本表
-- ============================================================================

ALTER TABLE user_roles
    ADD COLUMN source_type VARCHAR(20) NOT NULL DEFAULT 'legacy' COMMENT '来源类型：legacy/manual/job' AFTER role_id,
    ADD COLUMN source_id VARCHAR(100) NULL COMMENT '来源ID，如岗位编码、导入批次、审批单号' AFTER source_type,
    ADD COLUMN granted_by VARCHAR(50) NULL COMMENT '授予人 uid' AFTER source_id,
    ADD COLUMN granted_at DATETIME NULL COMMENT '授予时间' AFTER granted_by,
    ADD COLUMN expired_at DATETIME NULL COMMENT '失效时间，为空表示长期有效' AFTER granted_at;

CREATE INDEX idx_user_roles_source_type ON user_roles (source_type);
CREATE INDEX idx_user_roles_source_id ON user_roles (source_id);
CREATE INDEX idx_user_roles_expired_at ON user_roles (expired_at);

-- 历史数据回填策略：
-- 1. job:* / user:* 角色视为岗位映射来源
-- 2. 其他现有数据统一视为 legacy
-- 3. granted_at 回填为 created_at
UPDATE user_roles ur
INNER JOIN roles r ON r.id = ur.role_id
SET
    ur.source_type = CASE
        WHEN r.role_code LIKE 'job:%' THEN 'job'
        WHEN r.role_code LIKE 'user:%' THEN 'job'
        ELSE 'legacy'
    END,
    ur.source_id = CASE
        WHEN r.role_code LIKE 'job:%' THEN r.role_code
        WHEN r.role_code LIKE 'user:%' THEN r.role_code
        ELSE NULL
    END,
    ur.granted_at = COALESCE(ur.granted_at, ur.created_at)
WHERE ur.granted_at IS NULL
   OR ur.source_id IS NULL
   OR ur.source_type = 'legacy';


-- ============================================================================
-- 3. applications
-- 目的：
--   - 补齐 app manifest 元数据
--   - 为后续平台鉴权 rollout 留出元数据位
--   - 标记应用运行模式
-- ============================================================================

ALTER TABLE applications
    ADD COLUMN manifest_version VARCHAR(32) NULL COMMENT '当前 manifest 版本号' AFTER logout_url,
    ADD COLUMN manifest_hash VARCHAR(64) NULL COMMENT '当前 manifest 内容 hash' AFTER manifest_version,
    ADD COLUMN runtime_mode VARCHAR(30) NULL COMMENT '运行模式：platform-hosted/customer-hosted' AFTER manifest_hash,
    ADD COLUMN auth_mode VARCHAR(20) NOT NULL DEFAULT 'legacy' COMMENT '鉴权模式：legacy/platform/dual' AFTER runtime_mode,
    ADD COLUMN bundle_enabled TINYINT NOT NULL DEFAULT 0 COMMENT '是否启用 policy bundle：1启用 0禁用' AFTER auth_mode;

CREATE INDEX idx_app_runtime_mode ON applications (runtime_mode);
CREATE INDEX idx_app_auth_mode ON applications (auth_mode);
CREATE INDEX idx_app_bundle_enabled ON applications (bundle_enabled);

-- 第一阶段保守策略：
-- 1. 现有应用默认仍为 legacy
-- 2. bundle 默认关闭
-- 3. runtime_mode 暂不强制回填，待应用部署模式梳理后再补


-- ============================================================================
-- 4. resources
-- 目的：
--   - 增加 app_code 冗余字段，便于 manifest 同步和 bundle 构建
--   - 标记资源同步来源
--   - 标记最近一次 manifest 版本
-- ============================================================================

ALTER TABLE resources
    ADD COLUMN app_code VARCHAR(50) NULL COMMENT '所属应用编码，冗余自 applications.app_code' AFTER app_id,
    ADD COLUMN sync_source VARCHAR(20) NOT NULL DEFAULT 'manual' COMMENT '资源来源：manual/manifest' AFTER description,
    ADD COLUMN manifest_version VARCHAR(32) NULL COMMENT '最近一次同步该资源的 manifest 版本' AFTER sync_source;

CREATE INDEX idx_resource_app_code ON resources (app_code);
CREATE INDEX idx_resource_sync_source ON resources (sync_source);

-- 从 applications 回填 app_code
UPDATE resources r
INNER JOIN applications a ON a.id = r.app_id
SET r.app_code = a.app_code
WHERE r.app_code IS NULL;


-- ============================================================================
-- 5. Post Migration Validation
-- ============================================================================

-- 5.1 roles 校验
SELECT role_type, COUNT(*) AS cnt
FROM roles
GROUP BY role_type
ORDER BY role_type;

SELECT role_code, role_name, role_type, app_code, is_assignable
FROM roles
WHERE role_type NOT IN ('system', 'base', 'job', 'app')
   OR (role_type IN ('system', 'base', 'job') AND app_code IS NOT NULL)
ORDER BY role_code;

-- 5.2 user_roles 校验
SELECT source_type, COUNT(*) AS cnt
FROM user_roles
GROUP BY source_type
ORDER BY source_type;

SELECT ur.id, ur.uid, r.role_code, ur.source_type, ur.source_id, ur.granted_at
FROM user_roles ur
INNER JOIN roles r ON r.id = ur.role_id
WHERE ur.granted_at IS NULL
ORDER BY ur.id
LIMIT 50;

-- 5.3 applications 校验
SELECT app_code, app_name, auth_mode, bundle_enabled, runtime_mode
FROM applications
ORDER BY app_code;

-- 5.4 resources 校验
SELECT app_code, sync_source, COUNT(*) AS cnt
FROM resources
GROUP BY app_code, sync_source
ORDER BY app_code, sync_source;

SELECT r.id, r.resource_code, r.resource_name, r.app_code, a.app_code AS expected_app_code
FROM resources r
INNER JOIN applications a ON a.id = r.app_id
WHERE r.app_code <> a.app_code OR r.app_code IS NULL
ORDER BY r.id
LIMIT 50;


-- ============================================================================
-- 6. Manual Review Checklist
-- ============================================================================

-- 1. 复核 roles 中被自动归类为 job 的历史 user:* 角色是否都应保留为岗位角色
-- 2. 复核是否存在应归为 base 的内部基础角色，但未命中 internal_user / guest 规则
-- 3. 复核 applications.runtime_mode 的实际取值策略
-- 4. 复核哪些应用可以从 legacy 切到 dual，再逐步切到 platform
-- 5. 复核 resources 中哪些资源应标记为 manifest，同步完成后再批量更新 sync_source
