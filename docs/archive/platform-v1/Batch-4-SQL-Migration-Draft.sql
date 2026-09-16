-- ============================================================================
-- 汇智云平台第四批 SQL Migration 草案
-- 目标范围：
--   1. deployments
--   2. licenses
--   3. license_capabilities
--   4. app_manifests
--   5. policy_bundles
--   6. revocation_snapshots
--   7. deployment_heartbeats
--
-- 前置依赖：
--   - Batch-1-SQL-Migration-Draft.sql 已完成
--   - MySQL 8.x
-- ============================================================================

-- ============================================================================
-- 0. Preflight Check
-- ============================================================================

SELECT COUNT(*) AS applications_count FROM applications;

-- 建议执行前确认：
-- 1. app_code 已在 applications 中完整回填
-- 2. deployment_mode / runtime_mode 命名已和目标架构文档对齐
-- 3. policy bundle 的存储方式（DB/OSS/对象存储）已明确


-- ============================================================================
-- 1. deployments
-- 目的：
--   - 表达平台控制的部署单元
--   - 统一 Managed Control Plane / Self-Hosted Enterprise 的部署语义
-- ============================================================================

CREATE TABLE deployments (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code        VARCHAR(7) NULL COMMENT '所属公司编码',
    deployment_code     VARCHAR(100) NOT NULL COMMENT '部署编码',
    deployment_name     VARCHAR(100) NOT NULL COMMENT '部署名称',
    deployment_mode     VARCHAR(40) NOT NULL COMMENT '部署模式：managed-control-plane/self-hosted-enterprise',
    status              VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '部署状态：active/paused/disabled',
    license_status      VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '许可证状态快照：active/grace/restricted/expired/revoked',
    last_heartbeat_at   DATETIME NULL COMMENT '最近心跳时间',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_deployments_company_code (company_code, deployment_code),
    KEY idx_deployments_mode (deployment_mode),
    KEY idx_deployments_status (status),
    KEY idx_deployments_license_status (license_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部署表';


-- ============================================================================
-- 2. licenses
-- 目的：
--   - 表达部署许可证
--   - 为 capability 和 grace / restricted / revoked 状态提供主锚点
-- ============================================================================

CREATE TABLE licenses (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) NULL COMMENT '所属公司编码',
    deployment_id   BIGINT NOT NULL COMMENT '部署ID',
    license_code    VARCHAR(100) NOT NULL COMMENT '许可证编码',
    plan_code       VARCHAR(50) NOT NULL COMMENT '套餐编码',
    status          VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active/grace/restricted/expired/revoked',
    issued_at       DATETIME NOT NULL COMMENT '签发时间',
    expires_at      DATETIME NULL COMMENT '到期时间',
    grace_until     DATETIME NULL COMMENT '宽限截止时间',
    payload_hash    VARCHAR(64) NULL COMMENT '许可证负载 hash',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_licenses_code (license_code),
    KEY idx_licenses_company_code (company_code),
    KEY idx_licenses_deployment_id (deployment_id),
    KEY idx_licenses_status (status),
    CONSTRAINT fk_licenses_deployment
        FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='许可证表';


-- ============================================================================
-- 3. license_capabilities
-- 目的：
--   - 记录某 license 启用的 capability
--   - capability_value 允许承载配额/布尔/枚举值
-- ============================================================================

CREATE TABLE license_capabilities (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code        VARCHAR(7) NULL COMMENT '所属公司编码',
    license_id          BIGINT NOT NULL COMMENT '许可证ID',
    capability_code     VARCHAR(100) NOT NULL COMMENT '能力编码',
    capability_value    VARCHAR(255) NULL COMMENT '能力值',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_license_capabilities_license_code (license_id, capability_code),
    KEY idx_license_capabilities_company_code (company_code),
    KEY idx_license_capabilities_capability_code (capability_code),
    CONSTRAINT fk_license_capabilities_license
        FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='许可证能力表';


-- ============================================================================
-- 4. app_manifests
-- 目的：
--   - 持久化应用 manifest 历史版本
--   - 支撑 app registry 和 bundle 构建
-- ============================================================================

CREATE TABLE app_manifests (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) NULL COMMENT '所属公司编码(NULL=平台级 manifest)',
    app_code        VARCHAR(50) NOT NULL COMMENT '应用编码',
    version         VARCHAR(32) NOT NULL COMMENT 'manifest 版本',
    manifest_hash   VARCHAR(64) NOT NULL COMMENT 'manifest 内容 hash',
    manifest_json   JSON NOT NULL COMMENT 'manifest 原文 JSON',
    status          VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active/inactive',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_app_manifests_app_version (company_code, app_code, version),
    KEY idx_app_manifests_hash (manifest_hash),
    KEY idx_app_manifests_status (status),
    CONSTRAINT fk_app_manifests_application
        FOREIGN KEY (app_code) REFERENCES applications(app_code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='应用 manifest 表';


-- ============================================================================
-- 5. policy_bundles
-- 目的：
--   - 持久化 runtime 下发的 bundle 元数据
--   - bundle 实体可以在对象存储，本表只存索引和版本
-- ============================================================================

CREATE TABLE policy_bundles (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) NULL COMMENT '所属公司编码',
    deployment_id   BIGINT NOT NULL COMMENT '部署ID',
    bundle_version  VARCHAR(32) NOT NULL COMMENT 'bundle 版本号',
    bundle_hash     VARCHAR(64) NOT NULL COMMENT 'bundle 内容 hash',
    bundle_uri      VARCHAR(500) NOT NULL COMMENT 'bundle 下载地址或对象存储 URI',
    schema_version  VARCHAR(20) NOT NULL COMMENT 'bundle schema 版本',
    issued_at       DATETIME NOT NULL COMMENT '签发时间',
    expires_at      DATETIME NULL COMMENT '过期时间',
    status          VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active/inactive',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_policy_bundles_deployment_version (deployment_id, bundle_version),
    KEY idx_policy_bundles_hash (bundle_hash),
    KEY idx_policy_bundles_status (status),
    CONSTRAINT fk_policy_bundles_deployment
        FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='策略 bundle 表';


-- ============================================================================
-- 6. revocation_snapshots
-- 目的：
--   - 记录吊销列表版本
--   - 支撑 runtime 周期拉取 revocation
-- ============================================================================

CREATE TABLE revocation_snapshots (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code        VARCHAR(7) NULL COMMENT '所属公司编码',
    deployment_id       BIGINT NOT NULL COMMENT '部署ID',
    snapshot_version    VARCHAR(32) NOT NULL COMMENT '快照版本号',
    snapshot_hash       VARCHAR(64) NOT NULL COMMENT '快照 hash',
    snapshot_uri        VARCHAR(500) NOT NULL COMMENT '快照下载地址或对象存储 URI',
    issued_at           DATETIME NOT NULL COMMENT '签发时间',
    status              VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active/inactive',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_revocation_snapshots_deployment_version (deployment_id, snapshot_version),
    KEY idx_revocation_snapshots_hash (snapshot_hash),
    KEY idx_revocation_snapshots_status (status),
    CONSTRAINT fk_revocation_snapshots_deployment
        FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='吊销快照表';


-- ============================================================================
-- 7. deployment_heartbeats
-- 目的：
--   - 记录 runtime 心跳
--   - 跟踪 bundle / sdk / license 状态快照
-- ============================================================================

CREATE TABLE deployment_heartbeats (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code        VARCHAR(7) NULL COMMENT '所属公司编码',
    deployment_id       BIGINT NOT NULL COMMENT '部署ID',
    runtime_id          VARCHAR(100) NOT NULL COMMENT 'runtime 实例ID',
    bundle_version      VARCHAR(32) NULL COMMENT '当前使用的 bundle 版本',
    sdk_version         VARCHAR(32) NULL COMMENT '当前 SDK 版本',
    license_status_seen VARCHAR(20) NULL COMMENT 'runtime 看到的 license 状态',
    heartbeat_at        DATETIME NOT NULL COMMENT '心跳时间',
    payload_json        JSON NULL COMMENT '原始心跳负载',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    KEY idx_deployment_heartbeats_deployment_id (deployment_id),
    KEY idx_deployment_heartbeats_runtime_id (runtime_id),
    KEY idx_deployment_heartbeats_heartbeat_at (heartbeat_at),
    CONSTRAINT fk_deployment_heartbeats_deployment
        FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部署心跳表';


-- ============================================================================
-- 8. Post Migration Validation
-- ============================================================================

SELECT COUNT(*) AS deployments_count FROM deployments;
SELECT COUNT(*) AS licenses_count FROM licenses;
SELECT COUNT(*) AS license_capabilities_count FROM license_capabilities;
SELECT COUNT(*) AS app_manifests_count FROM app_manifests;
SELECT COUNT(*) AS policy_bundles_count FROM policy_bundles;
SELECT COUNT(*) AS revocation_snapshots_count FROM revocation_snapshots;
SELECT COUNT(*) AS deployment_heartbeats_count FROM deployment_heartbeats;

SELECT deployment_mode, status, COUNT(*) AS cnt
FROM deployments
GROUP BY deployment_mode, status
ORDER BY deployment_mode, status;

SELECT status, COUNT(*) AS cnt
FROM licenses
GROUP BY status
ORDER BY status;


-- ============================================================================
-- 9. Manual Review Checklist
-- ============================================================================

-- 1. 复核 deployment_mode / status / license_status 的枚举值是否与产品文档一致
-- 2. 复核 app_manifests 是否使用 app_code 外键足够稳定
-- 3. 复核 bundle / revocation 实体文件实际存储介质和 URI 规范
-- 4. 复核 deployment_heartbeats 是否需要唯一约束防止重复上报
-- 5. 复核是否需要单独的 runtime_registry 二期表
