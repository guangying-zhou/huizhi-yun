-- ============================================================
-- huizhi-yun Account 模块完整数据库脚本
-- 数据库名: hzy_account
-- 版本: v3.0 (SaaS)
-- 创建日期: 2026-03-07
-- 更新日期: 2026-03-25
-- 说明: 整合 init.sql, permissions.sql, git_projects.sql
--       v3.0: SaaS化改造 - 新增公司/平台用户/业务领域/区域表，
--             现有表增加 company_code 多租户隔离字段
-- ============================================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS hzy_account
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE hzy_account;

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- 0. 公司表（租户）
-- ============================================================

DROP TABLE IF EXISTS companies;
CREATE TABLE companies (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) UNIQUE NOT NULL COMMENT '公司编码(C+6位数字，如C000001)',
    company_name    VARCHAR(200) NOT NULL COMMENT '公司全称',
    short_name      VARCHAR(100) COMMENT '简称',
    logo            VARCHAR(500) COMMENT 'Logo URL',
    industry        VARCHAR(100) COMMENT '所属行业',
    scale           VARCHAR(20) COMMENT '规模：micro微型/small小型/medium中型/large大型',
    province        VARCHAR(50) COMMENT '所在省',
    city            VARCHAR(50) COMMENT '所在市',
    address         VARCHAR(500) COMMENT '详细地址',
    contact_name    VARCHAR(50) COMMENT '联系人',
    contact_phone   VARCHAR(20) COMMENT '联系电话',
    contact_email   VARCHAR(100) COMMENT '联系邮箱',
    website         VARCHAR(500) COMMENT '官网',
    description     TEXT COMMENT '公司简介',
    status          TINYINT DEFAULT 1 COMMENT '状态：1启用 0禁用',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司表';

-- ============================================================
-- 0.1 平台注册用户表
-- ============================================================

DROP TABLE IF EXISTS platform_users;
CREATE TABLE platform_users (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    username        VARCHAR(50) UNIQUE NOT NULL COMMENT '登录用户名',
    password_hash   VARCHAR(255) NOT NULL COMMENT '密码哈希(bcrypt)',
    real_name       VARCHAR(50) COMMENT '真实姓名',
    mobile          VARCHAR(20) UNIQUE COMMENT '手机号',
    email           VARCHAR(100) UNIQUE COMMENT '邮箱',
    avatar          VARCHAR(500) COMMENT '头像URL',
    company_code    VARCHAR(7) COMMENT '所属公司编码',
    is_company_admin TINYINT DEFAULT 0 COMMENT '是否公司管理员：0否 1是',
    last_login_at   DATETIME COMMENT '最后登录时间',
    last_login_ip   VARCHAR(50) COMMENT '最后登录IP',
    status          TINYINT DEFAULT 1 COMMENT '状态：1启用 0禁用 -1注销',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_company_code (company_code),
    INDEX idx_mobile (mobile),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='平台注册用户表';

-- ============================================================
-- 1. 部门管理表
-- ============================================================

DROP TABLE IF EXISTS departments;
CREATE TABLE departments (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) COMMENT '所属公司编码',
    dept_code       VARCHAR(50) NOT NULL UNIQUE COMMENT '部门编码(英文标识)',
    name            VARCHAR(100) NOT NULL COMMENT '部门名称(中文)',
    parent_id       BIGINT DEFAULT NULL COMMENT '父级部门ID',
    path            VARCHAR(500) COMMENT '部门路径，如：/1/5/12/',
    level           INT DEFAULT 1 COMMENT '层级深度',
    sort_order      INT DEFAULT 0 COMMENT '排序顺序',
    manager_uid     VARCHAR(50) COMMENT '部门经理(LDAP uid)',
    leader_uid      VARCHAR(50) COMMENT '分管领导(LDAP uid)',
    description     TEXT COMMENT '部门描述',
    org_type        VARCHAR(20) DEFAULT 'department' COMMENT '机构类型：department部门 committee委员会',
    dept_category   TINYINT UNSIGNED DEFAULT NULL COMMENT '部门类别：1行政 2业务支撑 3业务 4核心管理',
    status          TINYINT DEFAULT 1 COMMENT '状态：1启用 0禁用',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_dept_code (dept_code),
    INDEX idx_dept_company_code (company_code),
    INDEX idx_parent_id (parent_id),
    INDEX idx_path (path),
    INDEX idx_dept_category (dept_category),
    INDEX idx_status (status),
    CONSTRAINT fk_dept_parent FOREIGN KEY (parent_id) REFERENCES departments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门表';

-- ============================================================
-- 2. 用户相关表 (配合 LDAP 存储)
-- ============================================================

-- 用户扩展信息表 (通过 uid 关联 LDAP 用户)
DROP TABLE IF EXISTS system_users;
CREATE TABLE system_users (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) COMMENT '所属公司编码',
    platform_user_id BIGINT COMMENT '关联平台用户ID(非LDAP用户时使用)',
    uid             VARCHAR(50) UNIQUE NOT NULL COMMENT '用户名关联uid',
    dept_code       VARCHAR(50) COMMENT '所属部门编码',
    real_name       VARCHAR(50) COMMENT '真实姓名',
    nickname        VARCHAR(50) COMMENT '昵称',
    avatar          VARCHAR(500) COMMENT '头像URL',
    mobile          VARCHAR(20) COMMENT '手机号',
    email           VARCHAR(100) UNIQUE COMMENT '邮箱',
    position        VARCHAR(100) COMMENT '职位',
    gender          TINYINT DEFAULT 0 COMMENT '性别：0未知 1男 2女',
    birthday        DATE COMMENT '生日',
    address         VARCHAR(500) COMMENT '地址',
    bio             TEXT COMMENT '个人简介',
    timezone        VARCHAR(50) DEFAULT 'Asia/Shanghai' COMMENT '时区',
    language        VARCHAR(10) DEFAULT 'zh-CN' COMMENT '语言偏好',
    wecom_id        VARCHAR(50) UNIQUE COMMENT '企业微信ID',
    dingtalk_id     VARCHAR(50) UNIQUE COMMENT '钉钉ID',
    last_login_at   DATETIME COMMENT '最后登录时间',
    last_login_ip   VARCHAR(50) COMMENT '最后登录IP',
    user_type       TINYINT DEFAULT 1 COMMENT '用户类型：0-系统用户 1-普通用户 2-外部用户',
    status          TINYINT DEFAULT 1 COMMENT '状态：1启用 0禁用 -1删除',
    remark          VARCHAR(500) COMMENT '备注',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_uid (uid),
    INDEX idx_su_company_code (company_code),
    INDEX idx_su_platform_user_id (platform_user_id),
    INDEX idx_dept_code (dept_code),
    CONSTRAINT fk_profile_dept FOREIGN KEY (dept_code) REFERENCES departments(dept_code) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- 用户状态缓存表 (同步 LDAP 状态，用于快速查询)
DROP TABLE IF EXISTS user_status_cache;
CREATE TABLE user_status_cache (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    ldap_uid        VARCHAR(50) UNIQUE NOT NULL COMMENT '关联 LDAP uid',
    ldap_dn         VARCHAR(500) COMMENT 'LDAP DN',
    ldap_cn         VARCHAR(50) COMMENT '缓存用户名',
    email           VARCHAR(100) COMMENT '缓存邮箱',
    ldap_sn         VARCHAR(50) COMMENT '缓存姓名',
    dept_code       VARCHAR(50) COMMENT '所属部门编码',
    status          TINYINT DEFAULT 1 COMMENT '状态：0禁用 1正常 2待验证',
    synced_at       DATETIME COMMENT '最后同步时间',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_ldap_uid (ldap_uid),
    INDEX idx_email (email),
    INDEX idx_dept_code (dept_code),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户状态缓存表';

-- 用户部门关联表 (支持用户属于多个部门)
DROP TABLE IF EXISTS user_departments;
CREATE TABLE user_departments (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    uid             VARCHAR(50) NOT NULL COMMENT 'LDAP uid',
    dept_code       VARCHAR(50) NOT NULL COMMENT '部门编码',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_user_dept (uid, dept_code),
    INDEX idx_uid (uid),
    INDEX idx_dept_code (dept_code),
    CONSTRAINT fk_user_dept FOREIGN KEY (dept_code) REFERENCES departments(dept_code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户部门关联表';

-- ============================================================
-- 3. 角色与权限表 (RBAC)
-- ============================================================

-- 角色表
DROP TABLE IF EXISTS roles;
CREATE TABLE roles (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) COMMENT '所属公司编码(NULL=系统内置角色)',
    role_code       VARCHAR(50) UNIQUE NOT NULL COMMENT '角色编码',
    role_name       VARCHAR(100) NOT NULL COMMENT '角色名称',
    description     TEXT COMMENT '角色描述',
    parent_id       BIGINT COMMENT '父角色ID（角色继承）',
    is_system       TINYINT DEFAULT 0 COMMENT '是否系统内置角色：0否 1是',
    status          TINYINT DEFAULT 1 COMMENT '状态：1启用 0禁用',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_role_code (role_code),
    INDEX idx_role_company_code (company_code),
    INDEX idx_parent_id (parent_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色表';

-- 用户角色关联表
DROP TABLE IF EXISTS user_roles;
CREATE TABLE user_roles (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    uid             VARCHAR(50) NOT NULL COMMENT 'LDAP uid',
    role_id         BIGINT NOT NULL COMMENT '角色ID',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_user_role (uid, role_id),
    INDEX idx_uid (uid),
    INDEX idx_role_id (role_id),
    CONSTRAINT fk_user_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户角色关联表';

-- 应用表
DROP TABLE IF EXISTS applications;
CREATE TABLE applications (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) COMMENT '所属公司编码(NULL=平台级应用)',
    app_code        VARCHAR(50) UNIQUE NOT NULL COMMENT '应用唯一标识',
    app_name        VARCHAR(100) NOT NULL COMMENT '应用名称',
    description     TEXT COMMENT '应用描述',
    icon            VARCHAR(500) COMMENT '应用图标URL',
    home_url        VARCHAR(500) COMMENT '应用首页URL',
    callback_url    VARCHAR(500) COMMENT 'SSO回调地址',
    logout_url      VARCHAR(500) COMMENT '登出回调地址',
    app_secret      VARCHAR(255) COMMENT '应用密钥',
    app_type        VARCHAR(20) DEFAULT 'internal' COMMENT '应用类型：internal内部/external外部',
    sso_type        VARCHAR(20) COMMENT 'SSO类型：CAS/OAuth/OIDC',
    access_scope    VARCHAR(20) DEFAULT 'all' COMMENT '访问范围：all全部/department部门/user用户',
    status          TINYINT DEFAULT 1 COMMENT '状态：0禁用 1启用',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_app_code (app_code),
    INDEX idx_app_company_code (company_code),
    INDEX idx_app_type (app_type),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='应用表';

-- 资源表 (RBAC 2.0)
DROP TABLE IF EXISTS resources;
CREATE TABLE resources (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    app_id          BIGINT NOT NULL COMMENT '所属应用ID',
    resource_code   VARCHAR(50) NOT NULL COMMENT '资源编码 (如 user, department)',
    resource_name   VARCHAR(100) NOT NULL COMMENT '资源名称',
    description     TEXT COMMENT '描述',
    sort_order      INT DEFAULT 0 COMMENT '排序',
    status          TINYINT DEFAULT 1 COMMENT '状态：1启用 0禁用',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_app_resource (app_id, resource_code),
    INDEX idx_app_id (app_id),
    INDEX idx_status (status),
    CONSTRAINT fk_resource_app FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='应用资源表';

-- 角色权限关联表 (RBAC 2.0: 角色-资源-操作)
DROP TABLE IF EXISTS role_permissions;
CREATE TABLE role_permissions (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    role_id         BIGINT NOT NULL COMMENT '角色ID',
    resource_id     BIGINT NOT NULL COMMENT '资源ID',
    action          ENUM('view', 'edit', 'admin') NOT NULL COMMENT '操作类型：view查看/edit编辑/admin管理',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_role_resource_action (role_id, resource_id, action),
    INDEX idx_role_id (role_id),
    INDEX idx_resource_id (resource_id),
    CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_rp_resource FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色权限关联表';

-- ============================================================
-- 4. 应用访问授权与项目管理
-- ============================================================

-- 应用访问授权表
DROP TABLE IF EXISTS app_access_rules;
CREATE TABLE app_access_rules (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    app_id          BIGINT NOT NULL COMMENT '应用ID',
    rule_type       VARCHAR(20) NOT NULL COMMENT '规则类型：department部门/user用户',
    target_id       VARCHAR(100) NOT NULL COMMENT '目标ID（部门ID或LDAP uid）',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_app_rule (app_id, rule_type, target_id),
    INDEX idx_app_id (app_id),
    INDEX idx_rule_type (rule_type),
    CONSTRAINT fk_app_rule_app FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='应用访问授权表';

-- 项目表
DROP TABLE IF EXISTS git_projects;
CREATE TABLE git_projects (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) COMMENT '所属公司编码',
    project_code    VARCHAR(100) UNIQUE NOT NULL COMMENT 'git项目编码(小写字母与-组合)',
    project_code    VARCHAR(100) COMMENT 'AIMS项目编码(大写字母与数字组合)',
    parent_code     VARCHAR(100) COMMENT '父git项目编码',
    name            VARCHAR(100) NOT NULL COMMENT '项目名称',
    dept_code       VARCHAR(50) NOT NULL COMMENT '所属部门编码 (关联 departments.dept_code)',
    leader_uid      VARCHAR(50) COMMENT '项目负责人 (关联 system_users.uid)',
    description     TEXT COMMENT '项目描述',
    start_date      DATE COMMENT '项目开始时间',
    end_date        DATE COMMENT '项目结束时间',
    repo_url        VARCHAR(255) COMMENT '项目仓库地址',
    is_group        TINYINT DEFAULT 1 COMMENT '是否为组项目',
    is_template     TINYINT DEFAULT 0 COMMENT '是否为模板',
    status          TINYINT DEFAULT 1 COMMENT '状态：1启用 0禁用',
    docs_synced_at  DATETIME COMMENT '文档同步时间',
    docs_committed_at DATETIME COMMENT '文档提交时间',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_proj_company_code (company_code),
    INDEX idx_dept_code (dept_code),
    INDEX idx_leader_uid (leader_uid),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目表';

-- 项目成员关联表
DROP TABLE IF EXISTS git_project_members;
CREATE TABLE git_project_members (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    project_code    VARCHAR(100) NOT NULL COMMENT 'git项目编码',
    uid             VARCHAR(50) NOT NULL COMMENT '成员用户名 (LDAP uid)',
    role            VARCHAR(20) DEFAULT 'member' COMMENT '角色：member成员/admin管理员',
    joined_at       DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '加入时间',

    UNIQUE KEY uk_project_user (project_code, uid),
    INDEX idx_git_project_code (project_code),
    INDEX idx_uid (uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目成员表';

-- ============================================================
-- 5. API 管理、日志与会话
-- ============================================================

-- API 密钥表
DROP TABLE IF EXISTS api_keys;
CREATE TABLE api_keys (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) COMMENT '所属公司编码',
    key_name        VARCHAR(100) NOT NULL COMMENT '密钥名称',
    api_key         VARCHAR(100) UNIQUE NOT NULL COMMENT 'API Key',
    api_secret      VARCHAR(255) NOT NULL COMMENT 'API Secret',
    scopes          JSON COMMENT 'API权限范围',
    rate_limit      INT DEFAULT 1000 COMMENT '每分钟调用限制',
    ip_whitelist    JSON COMMENT 'IP白名单',
    expires_at      DATETIME COMMENT '过期时间',
    status          TINYINT DEFAULT 1 COMMENT '状态：0禁用 1启用',
    last_used_at    DATETIME COMMENT '最后使用时间',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_api_key (api_key),
    INDEX idx_ak_company_code (company_code),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='API密钥表';

INSERT INTO `api_keys` VALUES (1,'codocs','ak_b9051a45ac91ea99faac44fb9316c034','sk_1d07b9057d1cad11996cb26269802dc0906dcdeba6d3d691f885c16e7def94ee',NULL,1000,NULL,NULL,1,'2026-03-12 02:56:52','2026-01-20 10:27:23','2026-03-12 02:56:52');

-- API 调用日志表
DROP TABLE IF EXISTS api_logs;
CREATE TABLE api_logs (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    api_key_id      BIGINT COMMENT 'API密钥ID',
    endpoint        VARCHAR(200) COMMENT '接口路径',
    method          VARCHAR(10) COMMENT '请求方法',
    request_body    TEXT COMMENT '请求体',
    response_code   INT COMMENT '响应状态码',
    response_time   INT COMMENT '响应时间(ms)',
    ip_address      VARCHAR(50) COMMENT 'IP地址',
    user_agent      VARCHAR(500) COMMENT 'User Agent',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_api_key_id (api_key_id),
    INDEX idx_endpoint (endpoint),
    INDEX idx_created_at (created_at),
    INDEX idx_ip_address (ip_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='API调用日志表';

-- 登录日志表
DROP TABLE IF EXISTS login_logs;
CREATE TABLE login_logs (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    uid             VARCHAR(50) COMMENT 'LDAP uid',
    target_app      VARCHAR(50) COMMENT '登录目标应用编码',
    login_type      VARCHAR(20) COMMENT '登录类型：password密码/sso单点登录/oauth第三方',
    login_result    TINYINT COMMENT '登录结果：0失败 1成功',
    failure_reason  VARCHAR(200) COMMENT '失败原因',
    ip_address      VARCHAR(50) COMMENT 'IP地址',
    location        VARCHAR(100) COMMENT '登录地点',
    device          VARCHAR(200) COMMENT '设备信息',
    browser         VARCHAR(100) COMMENT '浏览器',
    os              VARCHAR(50) COMMENT '操作系统',
    session_id      VARCHAR(100) COMMENT '会话ID',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_uid (uid),
    INDEX idx_target_app_created_at (target_app, created_at),
    INDEX idx_login_result (login_result),
    INDEX idx_created_at (created_at),
    INDEX idx_ip_address (ip_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录日志表';

-- 用户会话表 (SSO)
DROP TABLE IF EXISTS user_sessions;
CREATE TABLE user_sessions (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    session_id      VARCHAR(100) UNIQUE NOT NULL COMMENT '会话ID',
    uid             VARCHAR(50) NOT NULL COMMENT 'LDAP uid',
    ip_address      VARCHAR(50) COMMENT 'IP地址',
    user_agent      VARCHAR(500) COMMENT 'User Agent',
    device          VARCHAR(200) COMMENT '设备信息',
    expires_at      DATETIME NOT NULL COMMENT '过期时间',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_session_id (session_id),
    INDEX idx_uid (uid),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户会话表';

-- OAuth Token 表
DROP TABLE IF EXISTS oauth_tokens;
CREATE TABLE oauth_tokens (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    access_token    VARCHAR(255) UNIQUE NOT NULL COMMENT '访问令牌',
    refresh_token   VARCHAR(255) COMMENT '刷新令牌',
    uid             VARCHAR(50) NOT NULL COMMENT 'LDAP uid',
    app_id          BIGINT NOT NULL COMMENT '应用ID',
    scopes          JSON COMMENT '授权范围',
    access_expires_at   DATETIME NOT NULL COMMENT '访问令牌过期时间',
    refresh_expires_at  DATETIME COMMENT '刷新令牌过期时间',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_access_token (access_token),
    INDEX idx_refresh_token (refresh_token),
    INDEX idx_uid (uid),
    INDEX idx_app_id (app_id),
    INDEX idx_access_expires_at (access_expires_at),
    CONSTRAINT fk_oauth_app FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OAuth令牌表';

-- 系统配置表
DROP TABLE IF EXISTS system_configs;
CREATE TABLE system_configs (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    config_key      VARCHAR(100) UNIQUE NOT NULL COMMENT '配置键',
    config_value    TEXT COMMENT '配置值',
    config_type     VARCHAR(20) DEFAULT 'string' COMMENT '配置类型：string/number/boolean/json',
    description     VARCHAR(500) COMMENT '配置描述',
    is_public       TINYINT DEFAULT 0 COMMENT '是否公开：0否 1是',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_config_key (config_key),
    INDEX idx_is_public (is_public)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';

-- 操作日志表
DROP TABLE IF EXISTS operation_logs;
CREATE TABLE operation_logs (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    user_id         BIGINT COMMENT '操作用户ID',
    uid             VARCHAR(50) COMMENT '操作用户名',
    source_app      VARCHAR(50) COMMENT '来源应用编码',
    session_id      VARCHAR(100) COMMENT '会话ID',
    action          VARCHAR(50) NOT NULL COMMENT '操作类型',
    detail          TEXT COMMENT '操作详情',
    ip_address      VARCHAR(50) COMMENT 'IP地址',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_user_id (user_id),
    INDEX idx_source_app_created_at (source_app, created_at),
    INDEX idx_session_id_created_at (session_id, created_at),
    INDEX idx_action (action),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作日志表';

-- ============================================================
-- 6. 初始化数据
-- ============================================================

-- 6.1 初始化系统角色
INSERT INTO `roles` VALUES
(1,'super_admin','超级管理员','系统最高权限管理者，拥有所有权限',NULL,1,1,'2026-01-20 02:24:41','2026-01-20 02:24:41'),
(2,'org_admin','组织管理员','企业/组织的管理者，负责用户和部门管理',NULL,1,1,'2026-01-20 02:24:41','2026-01-20 02:24:41'),
(3,'app_admin','应用管理员','应用模块的管理员，负责进行模块设置',NULL,1,1,'2026-01-26 09:24:28','2026-01-27 10:53:21'),
(4,'developer','开发者','第三方应用集成开发者',NULL,1,1,'2026-01-20 02:24:41','2026-01-20 02:24:41'),
(5,'user','内部用户','公司内部平台服务的使用者',NULL,1,1,'2026-01-20 02:24:41','2026-01-26 23:11:23'),
(6,'guest','访客用户','公司外部访问者',NULL,1,1,'2026-01-26 23:12:22','2026-01-26 23:12:22'),
(7,'user:leader','分管副总',NULL,5,0,1,'2026-01-26 23:07:13','2026-01-26 23:12:50'),
(8,'user:dm','部门经理',NULL,5,0,1,'2026-01-26 23:08:20','2026-01-26 23:08:20'),
(9,'user:pm','项目经理',NULL,5,0,1,'2026-01-26 23:08:41','2026-01-26 23:08:41'),
(11,'user:developer','开发人员',NULL,5,0,1,'2026-01-27 11:00:51','2026-01-27 11:00:51'),
(12,'seal_admin','公章管理员','负责对外发文发布后的盖章确认',5,0,1,'2026-03-30 00:00:00','2026-03-30 00:00:00');

-- 6.2 初始化根部门
INSERT INTO departments (dept_code, name, parent_id, path, level, sort_order, status) VALUES
('root', '汇智', NULL, '/1/', 1, 0, 1);

-- 6.3 初始化应用 (Account)
INSERT INTO `applications` VALUES (1,'account','账号中心','统一身份认证与权限管理系统',NULL,'https://account.wiztek.cn',NULL,NULL,NULL,'internal','CAS','all',1,'2026-01-26 11:21:32','2026-03-10 02:33:54'),(2,'codocs','汇智云文档','基于Markdown的文档协同系统',NULL,'https://codocs.wiztek.cn',NULL,NULL,'e8608dfadb3ec112b6317bc7fe8e1689a821558ca64a22ca91e48a700e8ac005','internal','CAS','all',1,'2026-01-20 09:55:02','2026-03-10 02:41:35');


-- 6.4 初始化资源 (Account 应用)
INSERT INTO resources (app_id, resource_code, resource_name, description, sort_order) VALUES
((SELECT id FROM applications WHERE app_code = 'account'), 'user', '用户管理', '系统用户的增删改查', 1),
((SELECT id FROM applications WHERE app_code = 'account'), 'department', '部门管理', '组织架构部门管理', 2),
((SELECT id FROM applications WHERE app_code = 'account'), 'role', '角色管理', '角色与权限分配', 3),
((SELECT id FROM applications WHERE app_code = 'account'), 'app', '应用管理', '应用注册与配置', 4),
((SELECT id FROM applications WHERE app_code = 'account'), 'resource', '资源管理', '应用资源定义', 5),
((SELECT id FROM applications WHERE app_code = 'account'), 'project', '项目管理', '项目信息管理', 6),
((SELECT id FROM applications WHERE app_code = 'account'), 'api', 'API管理', 'API密钥与日志', 7),
((SELECT id FROM applications WHERE app_code = 'account'), 'config', '系统配置', '系统参数配置', 8);

INSERT INTO resources (app_id, resource_code, resource_name, description, sort_order) VALUES
((SELECT id FROM applications WHERE app_code = 'codocs'), 'documents','文档管理','个人文档、收藏、共享、回收站',1),
((SELECT id FROM applications WHERE app_code = 'codocs'), 'info','资讯中心','前沿资讯、推荐文章',2),
((SELECT id FROM applications WHERE app_code = 'codocs'), 'git_projects','项目文档','项目组文档、代码库文档、需求与Bug',3),
((SELECT id FROM applications WHERE app_code = 'codocs'), 'departments','部门文档','协同文档、会议记录、部门知识库',4),
((SELECT id FROM applications WHERE app_code = 'codocs'), 'company','发布文档','对外发文、公司规章、技术规范、产品文档、知识库',5),
((SELECT id FROM applications WHERE app_code = 'codocs'), 'reviews','审阅中心','文档审阅、审批流程、归档管理',6),
((SELECT id FROM applications WHERE app_code = 'codocs'), 'admin','系统管理','发文流程、模板管理、系统设置、资讯管理',7);

-- 6.5 为超级管理员分配所有权限
INSERT INTO role_permissions (role_id, resource_id, action)
SELECT
    (SELECT id FROM roles WHERE role_code = 'super_admin'),
    r.id,
    a.action
FROM resources r
CROSS JOIN (SELECT 'view' AS action UNION SELECT 'edit' UNION SELECT 'admin') a
WHERE r.app_id = (SELECT id FROM applications);


-- 6.7 初始化 AI 资源
INSERT INTO resources (app_id, resource_code, resource_name, description, sort_order) VALUES
((SELECT id FROM applications WHERE app_code = 'account'), 'ai', 'AI服务管理', 'AI网关配置与用量管理', 9);

-- 6.8 初始化系统配置
INSERT INTO system_configs (config_key, config_value, config_type, description, is_public) VALUES
('site_name', '汇智云', 'string', '站点名称', 1),
('site_logo', '/logo.png', 'string', '站点Logo', 1),
('site_favicon', '/favicon.ico', 'string', '站点Favicon', 1),
('company_name', '山东汇智科技发展有限公司', 'string', '公司名称', 1),
('company_short_name', '汇智科技', 'string', '公司简称', 1),
('login_captcha_threshold', '3', 'number', '登录失败多少次后显示验证码', 0),
('login_lock_threshold', '5', 'number', '登录失败多少次后锁定账号', 0),
('login_lock_minutes', '30', 'number', '账号锁定时间（分钟）', 0),
('password_min_length', '8', 'number', '密码最小长度', 0),
('password_require_uppercase', 'true', 'boolean', '密码需要大写字母', 0),
('password_require_lowercase', 'true', 'boolean', '密码需要小写字母', 0),
('password_require_number', 'true', 'boolean', '密码需要数字', 0),
('password_require_special', 'true', 'boolean', '密码需要特殊字符', 0),
('password_expire_days', '90', 'number', '密码有效期（天）', 0),
('session_expire_hours', '24', 'number', '会话有效期（小时）', 0),
('oauth_access_token_expire_hours', '2', 'number', 'OAuth访问令牌有效期（小时）', 0),
('oauth_refresh_token_expire_days', '30', 'number', 'OAuth刷新令牌有效期（天）', 0);

-- ============================================================
-- 7. AI 网关相关表
-- ============================================================

-- AI 服务提供商配置表
DROP TABLE IF EXISTS ai_providers;
CREATE TABLE ai_providers (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) COMMENT '所属公司编码(NULL=平台默认)',
    provider_code   VARCHAR(50) UNIQUE NOT NULL COMMENT '提供商编码(如 qwen, deepseek, openai)',
    provider_name   VARCHAR(100) NOT NULL COMMENT '提供商名称',
    api_base_url    VARCHAR(500) NOT NULL COMMENT 'API 基础地址',
    api_key         VARCHAR(500) NOT NULL COMMENT 'API 密钥(加密存储)',
    api_format      VARCHAR(20) DEFAULT 'openai' COMMENT 'API 协议格式: openai',
    default_model   VARCHAR(100) NOT NULL COMMENT '默认模型ID(如 qwen-plus)',
    available_models JSON COMMENT '可用模型列表 [{id,name,maxTokens}]',
    max_tokens      INT DEFAULT 4096 COMMENT '默认最大输出token数',
    temperature     DECIMAL(3,2) DEFAULT 0.70 COMMENT '默认温度参数',
    is_default      TINYINT DEFAULT 0 COMMENT '是否为默认提供商: 0否 1是',
    status          TINYINT DEFAULT 1 COMMENT '状态: 0禁用 1启用',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_provider_code (provider_code),
    INDEX idx_aip_company_code (company_code),
    INDEX idx_is_default (is_default),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI服务提供商配置表';

-- AI 调用配额表 (按应用维度限制)
DROP TABLE IF EXISTS ai_quotas;
CREATE TABLE ai_quotas (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) COMMENT '所属公司编码',
    app_code        VARCHAR(50) NOT NULL COMMENT '应用编码(如 codocs)',
    daily_limit     INT DEFAULT 1000 COMMENT '每日调用次数上限',
    monthly_limit   INT DEFAULT 20000 COMMENT '每月调用次数上限',
    max_tokens_per_request INT DEFAULT 4096 COMMENT '单次请求最大token数',
    allowed_models  JSON COMMENT '允许使用的模型列表(为空则不限制)',
    status          TINYINT DEFAULT 1 COMMENT '状态: 0禁用 1启用',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_app_code (app_code),
    INDEX idx_aiq_company_code (company_code),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI调用配额表';

-- AI 调用日志表
DROP TABLE IF EXISTS ai_usage_logs;
CREATE TABLE ai_usage_logs (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    app_code        VARCHAR(50) NOT NULL COMMENT '调用来源应用编码',
    uid             VARCHAR(50) COMMENT '调用用户UID',
    provider_code   VARCHAR(50) NOT NULL COMMENT '提供商编码',
    model           VARCHAR(100) NOT NULL COMMENT '使用的模型ID',
    action          VARCHAR(50) NOT NULL COMMENT '调用场景(如 chat, completions, format_fix)',
    prompt_tokens   INT DEFAULT 0 COMMENT '输入token数',
    completion_tokens INT DEFAULT 0 COMMENT '输出token数',
    total_tokens    INT DEFAULT 0 COMMENT '总token数',
    stream          TINYINT DEFAULT 0 COMMENT '是否流式请求: 0否 1是',
    latency_ms      INT COMMENT '响应耗时(毫秒)',
    status          VARCHAR(20) DEFAULT 'success' COMMENT '调用状态: success/failed/timeout',
    error_message   TEXT COMMENT '错误信息',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_app_code (app_code),
    INDEX idx_uid (uid),
    INDEX idx_provider_model (provider_code, model),
    INDEX idx_action (action),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI调用日志表';

-- 7.1 初始化通义千问提供商
INSERT INTO ai_providers (provider_code, provider_name, api_base_url, api_key, api_format, default_model, available_models, max_tokens, temperature, is_default) VALUES
('qwen', '通义千问', 'https://dashscope.aliyuncs.com/compatible-mode/v1', '待配置', 'openai', 'qwen-plus', '[{"id":"qwen-turbo","name":"通义千问-Turbo","maxTokens":8192},{"id":"qwen-plus","name":"通义千问-Plus","maxTokens":32768},{"id":"qwen-max","name":"通义千问-Max","maxTokens":32768}]', 4096, 0.70, 1);

-- 7.2 初始化 codocs 配额
INSERT INTO ai_quotas (app_code, daily_limit, monthly_limit, max_tokens_per_request, allowed_models) VALUES
('codocs', 2000, 50000, 4096, NULL);

-- 7.3 初始化 AI 相关系统配置
INSERT INTO system_configs (config_key, config_value, config_type, description, is_public) VALUES
('ai_enabled', 'true', 'boolean', 'AI服务总开关', 0),
('ai_default_provider', 'qwen', 'string', '默认AI服务提供商', 0);

-- -----------------------------------------------------------
-- 8. 用户在线心跳表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `user_heartbeats`;
CREATE TABLE `user_heartbeats` (
    `uid` VARCHAR(50) NOT NULL COMMENT '用户UID',
    `source_app` VARCHAR(50) NOT NULL COMMENT '来源模块编码',
    `page` VARCHAR(255) NULL COMMENT '当前页面路径',
    `status` ENUM('active', 'idle') NOT NULL DEFAULT 'active' COMMENT '状态: active-活跃 idle-空闲',
    `last_seen` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后活跃时间',

    PRIMARY KEY (`uid`, `source_app`),
    INDEX `idx_heartbeat_last_seen` (`last_seen`),
    INDEX `idx_heartbeat_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户在线心跳表';

-- ============================================================
-- 9. 业务领域表
-- ============================================================

-- 业务领域字典表（系统预置，只读）
DROP TABLE IF EXISTS business_domains;
CREATE TABLE business_domains (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    domain_code     VARCHAR(50) UNIQUE NOT NULL COMMENT '领域编码',
    domain_name     VARCHAR(100) NOT NULL COMMENT '领域名称',
    category        ENUM('2G', '2B', '2C') NOT NULL COMMENT '大类：2G政务/2B企业/2C个人',
    parent_code     VARCHAR(50) DEFAULT NULL COMMENT '父级编码(仅一层)',
    description     VARCHAR(500) COMMENT '描述',
    sort_order      INT DEFAULT 0 COMMENT '排序',
    status          TINYINT DEFAULT 1 COMMENT '状态：1启用 0禁用',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_category (category),
    INDEX idx_parent_code (parent_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='业务领域字典表(系统预置)';

-- 公司业务领域表
DROP TABLE IF EXISTS company_business_domains;
CREATE TABLE company_business_domains (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) NOT NULL COMMENT '公司编码',
    domain_code     VARCHAR(50) NOT NULL COMMENT '领域编码(来自字典或自建)',
    domain_name     VARCHAR(100) NOT NULL COMMENT '领域名称(选字典时复制，自建时填写)',
    category        ENUM('2G', '2B', '2C') NOT NULL COMMENT '大类：2G政务/2B企业/2C个人',
    alias_name      VARCHAR(100) COMMENT '自定义别名(空则用domain_name)',
    source          ENUM('preset', 'custom') DEFAULT 'preset' COMMENT 'preset=从字典选 custom=自建',
    sort_order      INT DEFAULT 0 COMMENT '列表顺序',
    status          TINYINT DEFAULT 1 COMMENT '状态：1启用 0禁用',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_company_domain (company_code, domain_code),
    INDEX idx_company_code (company_code),
    INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司业务领域表';

-- ============================================================
-- 10. 区域表
-- ============================================================

-- 行政区划数据由前端 npm 包 lcn 提供（离线内嵌，无需联网）
-- 数据库仅存储 6 位国标行政区划编码（division_code），展示名称由前端查询 lcn 获取

-- 公司自定义区域表
DROP TABLE IF EXISTS company_regions;
CREATE TABLE company_regions (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) NOT NULL COMMENT '公司编码',
    region_code     VARCHAR(50) NOT NULL COMMENT '区域编码',
    region_name     VARCHAR(100) NOT NULL COMMENT '区域名称(如"北方大区")',
    description     VARCHAR(500) COMMENT '描述',
    sort_order      INT DEFAULT 0 COMMENT '排序',
    status          TINYINT DEFAULT 1 COMMENT '状态：1启用 0禁用',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_company_region (company_code, region_code),
    INDEX idx_company_code (company_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司自定义区域表';

-- 区域-行政区划映射表
DROP TABLE IF EXISTS company_region_divisions;
CREATE TABLE company_region_divisions (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) NOT NULL COMMENT '公司编码',
    region_code     VARCHAR(50) NOT NULL COMMENT '所属区域编码',
    division_code   VARCHAR(12) NOT NULL COMMENT '行政区划代码',
    include_children TINYINT DEFAULT 1 COMMENT '1=包含所有下级 0=仅本级',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_region_division (company_code, region_code, division_code),
    INDEX idx_company_region (company_code, region_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='区域-行政区划映射表';

-- 区域模板表（系统预置，供新公司初始化时复制）
DROP TABLE IF EXISTS region_templates;
CREATE TABLE region_templates (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    template_code   VARCHAR(50) NOT NULL COMMENT '模板编码',
    region_code     VARCHAR(50) NOT NULL COMMENT '区域编码',
    region_name     VARCHAR(100) NOT NULL COMMENT '区域名称',
    division_code   VARCHAR(12) COMMENT '行政区划代码(NULL=仅区域定义)',
    include_children TINYINT DEFAULT 1 COMMENT '1=含下级 0=仅本级',
    sort_order      INT DEFAULT 0 COMMENT '排序',

    INDEX idx_template_code (template_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='区域模板表(系统预置)';

-- ============================================================
-- 11. 预置数据：业务领域字典
-- ============================================================

-- 11.1 政务领域 (2G)
INSERT INTO business_domains (domain_code, domain_name, category, parent_code, sort_order) VALUES
('GOV',     '政务领域',     '2G', NULL,  1),
('GOV_NR',  '自然资源',     '2G', 'GOV', 1),
('GOV_HC',  '住房城乡建设', '2G', 'GOV', 2),
('GOV_AG',  '农业农村',     '2G', 'GOV', 3),
('GOV_AP',  '行政审批',     '2G', 'GOV', 4),
('GOV_EC',  '生态环境',     '2G', 'GOV', 5),
('GOV_TR',  '交通运输',     '2G', 'GOV', 6),
('GOV_WR',  '水利',         '2G', 'GOV', 7),
('GOV_ED',  '教育',         '2G', 'GOV', 8),
('GOV_HE',  '卫生健康',     '2G', 'GOV', 9),
('GOV_HR',  '人力资源和社会保障', '2G', 'GOV', 10),
('GOV_PS',  '公安',         '2G', 'GOV', 11),
('GOV_FI',  '财政',         '2G', 'GOV', 12),
('GOV_TX',  '税务',         '2G', 'GOV', 13),
('GOV_MR',  '市场监管',     '2G', 'GOV', 14),
('GOV_CA',  '民政',         '2G', 'GOV', 15),
('GOV_JU',  '司法',         '2G', 'GOV', 16);

-- 11.2 企业领域 (2B) — GB/T 4754-2017 一级门类
INSERT INTO business_domains (domain_code, domain_name, category, parent_code, sort_order) VALUES
('BIZ',     '企业领域',                              '2B', NULL,  2),
('BIZ_A',   '农、林、牧、渔业',                      '2B', 'BIZ', 1),
('BIZ_B',   '采矿业',                                '2B', 'BIZ', 2),
('BIZ_C',   '制造业',                                 '2B', 'BIZ', 3),
('BIZ_D',   '电力、热力、燃气及水生产和供应业',       '2B', 'BIZ', 4),
('BIZ_E',   '建筑业',                                 '2B', 'BIZ', 5),
('BIZ_F',   '批发和零售业',                           '2B', 'BIZ', 6),
('BIZ_G',   '交通运输、仓储和邮政业',                 '2B', 'BIZ', 7),
('BIZ_H',   '住宿和餐饮业',                           '2B', 'BIZ', 8),
('BIZ_I',   '信息传输、软件和信息技术服务业',          '2B', 'BIZ', 9),
('BIZ_J',   '金融业',                                 '2B', 'BIZ', 10),
('BIZ_K',   '房地产业',                               '2B', 'BIZ', 11),
('BIZ_L',   '租赁和商务服务业',                       '2B', 'BIZ', 12),
('BIZ_M',   '科学研究和技术服务业',                   '2B', 'BIZ', 13),
('BIZ_N',   '水利、环境和公共设施管理业',             '2B', 'BIZ', 14),
('BIZ_O',   '居民服务、修理和其他服务业',             '2B', 'BIZ', 15),
('BIZ_P',   '教育',                                   '2B', 'BIZ', 16),
('BIZ_Q',   '卫生和社会工作',                         '2B', 'BIZ', 17),
('BIZ_R',   '文化、体育和娱乐业',                     '2B', 'BIZ', 18),
('BIZ_S',   '公共管理、社会保障和社会组织',           '2B', 'BIZ', 19),
('BIZ_T',   '国际组织',                               '2B', 'BIZ', 20);

-- 11.3 个人领域 (2C)
INSERT INTO business_domains (domain_code, domain_name, category, parent_code, sort_order) VALUES
('CON',     '个人领域',     '2C', NULL,  3),
('CON_EDU', '教育培训',     '2C', 'CON', 1),
('CON_HE',  '医疗健康',     '2C', 'CON', 2),
('CON_FI',  '个人金融',     '2C', 'CON', 3),
('CON_TR',  '出行旅游',     '2C', 'CON', 4),
('CON_EC',  '电子商务',     '2C', 'CON', 5),
('CON_EN',  '文化娱乐',     '2C', 'CON', 6),
('CON_LF',  '生活服务',     '2C', 'CON', 7),
('CON_SO',  '社交通讯',     '2C', 'CON', 8);

-- ============================================================
-- 12. 预置数据：标准七大区域模板
-- ============================================================

INSERT INTO region_templates (template_code, region_code, region_name, division_code, include_children, sort_order) VALUES
-- 华北（北京、天津、河北、山西、内蒙古）
('STANDARD_7', 'NORTH_CHINA',  '华北', NULL,     1, 1),
('STANDARD_7', 'NORTH_CHINA',  '华北', '110000', 1, 1),
('STANDARD_7', 'NORTH_CHINA',  '华北', '120000', 1, 1),
('STANDARD_7', 'NORTH_CHINA',  '华北', '130000', 1, 1),
('STANDARD_7', 'NORTH_CHINA',  '华北', '140000', 1, 1),
('STANDARD_7', 'NORTH_CHINA',  '华北', '150000', 1, 1),
-- 东北（辽宁、吉林、黑龙江）
('STANDARD_7', 'NORTHEAST',    '东北', NULL,     1, 2),
('STANDARD_7', 'NORTHEAST',    '东北', '210000', 1, 2),
('STANDARD_7', 'NORTHEAST',    '东北', '220000', 1, 2),
('STANDARD_7', 'NORTHEAST',    '东北', '230000', 1, 2),
-- 华东（上海、江苏、浙江、安徽、福建、江西、山东）
('STANDARD_7', 'EAST_CHINA',   '华东', NULL,     1, 3),
('STANDARD_7', 'EAST_CHINA',   '华东', '310000', 1, 3),
('STANDARD_7', 'EAST_CHINA',   '华东', '320000', 1, 3),
('STANDARD_7', 'EAST_CHINA',   '华东', '330000', 1, 3),
('STANDARD_7', 'EAST_CHINA',   '华东', '340000', 1, 3),
('STANDARD_7', 'EAST_CHINA',   '华东', '350000', 1, 3),
('STANDARD_7', 'EAST_CHINA',   '华东', '360000', 1, 3),
('STANDARD_7', 'EAST_CHINA',   '华东', '370000', 1, 3),
-- 中南（河南、湖北、湖南、广东、广西、海南）
('STANDARD_7', 'SOUTH_CENTRAL','中南', NULL,     1, 4),
('STANDARD_7', 'SOUTH_CENTRAL','中南', '410000', 1, 4),
('STANDARD_7', 'SOUTH_CENTRAL','中南', '420000', 1, 4),
('STANDARD_7', 'SOUTH_CENTRAL','中南', '430000', 1, 4),
('STANDARD_7', 'SOUTH_CENTRAL','中南', '440000', 1, 4),
('STANDARD_7', 'SOUTH_CENTRAL','中南', '450000', 1, 4),
('STANDARD_7', 'SOUTH_CENTRAL','中南', '460000', 1, 4),
-- 西南（重庆、四川、贵州、云南、西藏）
('STANDARD_7', 'SOUTHWEST',    '西南', NULL,     1, 5),
('STANDARD_7', 'SOUTHWEST',    '西南', '500000', 1, 5),
('STANDARD_7', 'SOUTHWEST',    '西南', '510000', 1, 5),
('STANDARD_7', 'SOUTHWEST',    '西南', '520000', 1, 5),
('STANDARD_7', 'SOUTHWEST',    '西南', '530000', 1, 5),
('STANDARD_7', 'SOUTHWEST',    '西南', '540000', 1, 5),
-- 西北（陕西、甘肃、青海、宁夏、新疆）
('STANDARD_7', 'NORTHWEST',    '西北', NULL,     1, 6),
('STANDARD_7', 'NORTHWEST',    '西北', '610000', 1, 6),
('STANDARD_7', 'NORTHWEST',    '西北', '620000', 1, 6),
('STANDARD_7', 'NORTHWEST',    '西北', '630000', 1, 6),
('STANDARD_7', 'NORTHWEST',    '西北', '640000', 1, 6),
('STANDARD_7', 'NORTHWEST',    '西北', '650000', 1, 6),
-- 港澳台（香港、澳门、台湾）
('STANDARD_7', 'HK_MO_TW',    '港澳台', NULL,     1, 7),
('STANDARD_7', 'HK_MO_TW',    '港澳台', '710000', 1, 7),
('STANDARD_7', 'HK_MO_TW',    '港澳台', '810000', 1, 7),
('STANDARD_7', 'HK_MO_TW',    '港澳台', '820000', 1, 7);

-- ============================================================
-- 13. 预置数据：默认公司
-- ============================================================

INSERT INTO companies (company_code, company_name, short_name, status) VALUES
('C000001', '默认公司', '默认', 1);

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 完成
-- 行政区划数据由前端 npm 包 lcn 提供，无需数据库导入
-- ============================================================

SELECT '数据库完整脚本初始化完成！' AS message;

-- ============================================================
-- Data Migration from hzy_account.sql
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM user_departments;
DELETE FROM user_status_cache;
DELETE FROM system_users;
DELETE FROM git_project_members;
DELETE FROM git_projects;
DELETE FROM departments;

INSERT INTO departments (id, dept_code, name, parent_id, path, level, sort_order, manager_uid, leader_uid, description, org_type, dept_category, status, created_at, updated_at) VALUES
(1, 'WIZTEK', '汇智', NULL, '/', 1, 0, 'zhouguangying', NULL, NULL, 'department', NULL, 1, '2026-01-20 02:24:42', '2026-01-27 08:56:28'),
(2, 'GMO', '总经理办公室', 1, '/1/', 2, 0, 'zhouguangying', NULL, NULL, 'department', 4, 1, '2026-01-20 09:16:26', '2026-03-10 10:19:31'),
(3, 'AF', '行政财务部', 1, '/1/', 2, 0, 'liuxianmei', NULL, NULL, 'department', 1, 1, '2026-01-20 09:17:09', '2026-03-09 22:30:17'),
(4, 'HR', '人力资源部', 1, '/1/', 2, 0, 'wangmin', NULL, NULL, 'department', 1, 1, '2026-01-20 10:45:48', '2026-03-09 22:30:04'),
(5, 'BA', '商务部', 1, '/1/', 2, 0, 'wangmin', NULL, NULL, 'department', 2, 1, '2026-01-20 10:46:44', '2026-01-27 08:57:36'),
(6, 'RD', '产品研发部', 1, '/1/', 2, 0, 'caoqian', 'liuchuanxiang', NULL, 'department', 2, 1, '2026-01-21 20:34:04', '2026-03-08 12:28:28'),
(7, 'SDC', '交付中心', 1, '/1/', 2, 0, 'wangzhuang', 'xuxueying', NULL, 'department', 2, 1, '2026-01-21 20:36:56', '2026-03-08 12:40:48'),
(8, 'HFZX', '汇房智选部', 1, '/1/', 2, 0, 'renjianwei', 'liuchuanxiang', NULL, 'department', 2, 1, '2026-01-21 20:37:32', '2026-03-05 09:29:48'),
(9, 'SP', '软件项目部', 1, '/1/', 2, 0, 'wangcheng', 'xuxueying', NULL, 'department', 2, 1, '2026-01-21 20:37:57', '2026-03-05 09:30:29'),
(11, 'MC', '营销中心', 1, '/1/', 2, 0, 'yangtao', NULL, NULL, 'department', 3, 1, '2026-01-21 22:58:58', '2026-03-10 01:17:32'),
(14, 'MCMT', '营销委员会', 1, '/1/', 2, 0, 'yangtao', NULL, NULL, 'committee', NULL, 1, '2026-03-09 22:54:08', '2026-03-09 23:22:42'),
(15, 'TCMT', '技术委员会', 1, '/1/', 2, 0, 'caoqian', NULL, NULL, 'committee', NULL, 1, '2026-03-09 22:55:11', '2026-03-09 23:33:30'),
(16, 'PMCMT', '项目管理委员会', 1, '/1/', 2, 0, 'wangzhuang', NULL, NULL, 'committee', NULL, 1, '2026-03-09 22:55:56', '2026-03-09 23:37:55');

INSERT INTO system_users (id, uid, dept_code, real_name, nickname, avatar, mobile, email, position, gender, birthday, address, bio, timezone, language, wecom_id, dingtalk_id, last_login_at, last_login_ip, user_type, status, remark, created_at, updated_at) VALUES
(1, 'anzhen', NULL, '安震', NULL, NULL, '13937252309', 'anzhen@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '2748683501765086', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:36'),
(2, 'caigaoqing', NULL, '蔡高情', NULL, NULL, '17865621181', 'caigaoqing@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16451812396007437', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(3, 'caoqian', 'RD', '曹倩', NULL, NULL, '17853160911', 'caoqian@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '1152124036837712', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:35'),
(4, 'chenyiming', 'RD', '陈一明', NULL, NULL, '15615244325', 'chenyiming@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '115219435437616726', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:35'),
(5, 'dongwenchao', 'SDC', '董文超', NULL, NULL, '18764082600', 'dongwenchao@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '103305601633411201', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:38'),
(6, 'douyanqun', 'RD', '窦延群', NULL, NULL, '15628814091', 'douyanqun@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16662203537932790', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(7, 'duanyouxuan', NULL, '段佑轩', NULL, NULL, '17865609619', 'duanyouxuan@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16480319312003814', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(8, 'dulei', NULL, '杜磊', NULL, NULL, NULL, 'dulei@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, NULL, NULL, NULL, 1, -1, NULL, '2026-01-19 14:31:32', '2026-03-10 02:12:19'),
(9, 'fangshihong', NULL, '房世洪', NULL, NULL, '13325123017', 'fangshihong@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '151300105624817747', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:37'),
(10, 'fuyanfang', 'SDC', '付艳芳', NULL, NULL, '13361001541', 'fuyanfang@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '115217593520465528', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:38'),
(11, 'guopeipei', 'RD', '郭培培', NULL, NULL, '18560101682', 'guopeipei@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '124144540236374733', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(12, 'hanhuabin', NULL, '韩化斌', NULL, NULL, '13361071785', 'hanhuabin@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '120158246538057695', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(13, 'huanzhengji', 'SDC', '郇正基', NULL, NULL, NULL, 'huanzhengji@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, NULL, NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-01-21 15:32:38'),
(14, 'jilining', NULL, '纪立宁', NULL, NULL, '18561831384', 'jilining@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '213040424632159296', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(15, 'jingxu', 'SDC', '景旭', NULL, NULL, '13589026992', 'jingxu@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '0105585411839006', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(16, 'liucunshan', 'SDC', '刘存山', NULL, NULL, '17686618456', 'liucunshan@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '115223206420944945', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(17, 'liuchuanxiang', NULL, '刘传祥', NULL, NULL, '18615271750', 'liuchuanxiang@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '0312523720855389', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:35'),
(18, 'liangchao', NULL, '梁超', NULL, NULL, '15098703725', 'liangchao@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '0569291306865572', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(19, 'liguoqiang', 'SDC', '李国强', NULL, NULL, '18396885156', 'liguoqiang@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16460343338729913', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(20, 'lishuogang', 'SDC', '李朔刚', NULL, NULL, '15610162060', 'lishuogang@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '141535390026253652', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(21, 'lishuying', NULL, '李淑英', NULL, NULL, '13256123359', 'lishuying@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16448347797836168', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(22, 'liudan', NULL, '刘丹', NULL, NULL, '13698633300', 'liudan@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16360975456903544', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(23, 'liyujiang', NULL, '李昱江', NULL, NULL, '18654941765', 'liyujiang@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16450918997679451', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(24, 'lizhongzheng', 'SDC', '李中正', NULL, NULL, '18754791568', 'lizhongzheng@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '183629380626062500', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(25, 'lubo', 'RD', '卢波', NULL, NULL, '18315913992', 'lubo@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '1010064211689600', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(26, 'luhonglin', 'SDC', '路红林', NULL, NULL, '15315319297', 'luhonglin@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '213063362535949412', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(27, 'liuxianmei', 'AF', '刘先美', NULL, NULL, '13065021059', 'liuxianmei@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '111151416620874078', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:36'),
(28, 'lixianpeng', 'SDC', '李宪鹏', NULL, NULL, '15954105849', 'lixianpeng@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '115207290226182579', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(29, 'panchunlei', NULL, '潘春蕾', NULL, NULL, '18615182231', 'panchunlei@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '01292313375828237137', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(30, 'pengbukun', 'RD', '彭步坤', NULL, NULL, '13791098670', 'pengbukun@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '093731186424350924', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(31, 'renjianwei', NULL, '任建伟', NULL, NULL, '15666966389', 'renjianwei@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '083763200720204448', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:36'),
(32, 'shishoujie', 'SDC', '时守杰', NULL, NULL, '13854119853', 'shishoujie@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '162908122125836894', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(33, 'shiweijia', 'RD', '石伟佳', NULL, NULL, '18221303397', 'shiweijia@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16450919107926690', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(34, 'songzhanwei', NULL, '宋占伟', NULL, NULL, '15106972501', 'songzhanwei@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16777568632502984', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(35, 'sunda', 'SDC', '孙达', NULL, NULL, '13287100800', 'sunda@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '1058322735761733', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(36, 'sundinghua', NULL, '孙丁华', NULL, NULL, '18769578119', 'sundinghua@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '013300025923113350', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(37, 'songwenwen', NULL, '宋雯雯', NULL, NULL, '15165413955', 'songwenwen@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '022009300623757483', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(38, 'songyizhen', 'SDC', '宋义振', NULL, NULL, '15288849099', 'songyizhen@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '026769476723167697', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(39, 'tianhaiyan', 'AF', '田海燕', NULL, NULL, '13791045375', 'tianhaiyan@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '022356263429727854', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(40, 'tongli', 'SDC', '佟丽', NULL, NULL, '18663662492', 'tongli@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16161140782282733', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(41, 'wangcheng', NULL, '王成', NULL, NULL, '18678834935', 'wangcheng@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16311993767995708', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:37'),
(42, 'wangdexian', NULL, '王德贤', NULL, NULL, '17865923158', 'wangdexian@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '162111010929221144', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(43, 'wangdezhi', 'SDC', '王德智', NULL, NULL, '18678813234', 'wangdezhi@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '085667502229211246', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:38'),
(44, 'wangguanghui', 'RD', '王光辉', NULL, NULL, '15508652635', 'wangguanghui@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '172809473629107243', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:36'),
(45, 'wanghengtong', NULL, '王恒通', NULL, NULL, '18864991615', 'wanghengtong@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16481896413559345', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(46, 'wangjian', 'SDC', '王建', NULL, NULL, '13051756653', 'wangjian@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16449940318298987', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(47, 'wangmin', NULL, '王敏', NULL, NULL, '13853108578', 'wangmin@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '1111514105942884', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(48, 'wangqingmei', 'SDC', '王庆嵋', NULL, NULL, '13275389859', 'wangqingmei@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '040308042529199440', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(49, 'wangshuai', NULL, '王帅', NULL, NULL, '13506418571', 'wangshuai@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '0253531820941018', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(50, 'wangxiaoyang', 'SDC', '王晓阳', NULL, NULL, '17561520250', 'wangxiaoyang@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '210910075629275915', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(51, 'wangyanlei', NULL, '王延磊', NULL, NULL, '13681230801', 'wangyanlei@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '014155480929209951', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(52, 'wangyongheng', NULL, '王永恒', NULL, NULL, '13188889290', 'wangyongheng@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '043230405829308901', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(53, 'wangyuying', NULL, '王玉莹', NULL, NULL, '15066674691', 'wangyuying@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '022420306829376027', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(54, 'wangzhuang', 'SDC', '王壮', NULL, NULL, '15910701631', 'wangzhuang@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '0420560307939715', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:37'),
(55, 'weishanming', 'RD', '魏山明', NULL, NULL, '13065044218', 'weishanming@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16472605470083257', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(56, 'xujianfei', 'SDC', '许建飞', NULL, NULL, '15053161585', 'xujianfei@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '022021456235165916', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(57, 'xuxingxin', NULL, '许兴欣', NULL, NULL, '14763596935', 'xuxingxin@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '01284859112035046887', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(58, 'xuxueyan', NULL, '许雪艳', NULL, NULL, '18253177331', 'xuxueyan@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '115405322235604097', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(59, 'xuxueying', NULL, '许雪英', NULL, NULL, '15615517572', 'xuxueying@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '115202643435604223', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:35'),
(60, 'yangsen', 'SDC', '杨森', NULL, NULL, '15668370205', 'yangsen@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '0161230138847494', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(61, 'yangzhenzhen', 'SDC', '杨真真', NULL, NULL, '18366160278', 'yangzhenzhen@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '190258593326415432', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(62, 'yanyuanquan', 'SDC', '闫元泉', NULL, NULL, '15954930012', 'yanyuanquan@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16487012718057280', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(63, 'yuanchang', 'SDC', '袁畅', NULL, NULL, '18663777485', 'yuanchang@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '09373118651113316', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(64, 'yangtao', NULL, '杨涛', NULL, NULL, '18615181688', 'yangtao@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '0916363223848691', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:36'),
(65, 'zhangdawei', NULL, '张大伟', NULL, NULL, '15628915993', 'zhangdawei@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '023812404824130040', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(66, 'zhouguangying', NULL, '周光营', NULL, 'zhouguangying_1768928298755.png', '18660186696', 'zhouguangying@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, 'manager1561', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:25:54'),
(67, 'zhangjinzhi', NULL, '张金枝', NULL, NULL, '15069152352', 'zhangjinzhi@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '136861066324585996', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(68, 'zhangping', NULL, '张萍', NULL, NULL, '18366194601', 'zhangping@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '1262072019788717', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(69, 'zhangyan', 'RD', '张燕', NULL, NULL, '15163832010', 'zhangyan@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16880336457352114', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(70, 'zhangyang', 'SDC', '张杨', NULL, NULL, '19743007518', 'zhangyang@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16310924351695369', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(71, 'zhangzhipeng', 'SDC', '张志鹏', NULL, NULL, '15665727560', 'zhangzhipeng@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '1687169596846354', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:23'),
(72, 'zhaojing', NULL, '赵敬', NULL, NULL, '18654523855', 'zhaojing@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16522567643138413', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(73, 'qiyuchen', NULL, '亓俣辰', NULL, NULL, '18663467786', 'qiyuchen@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '01422169434920001280', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(74, 'zhaowang', NULL, '赵旺', NULL, NULL, '17601629151', 'zhaowang@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16559058067702764', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:36'),
(75, 'fengqingzhao', NULL, '冯庆召', NULL, NULL, '18253172618', 'fengqingzhao@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '6414254820867093', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:21'),
(76, 'jinanzhujian', NULL, '济南住建', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, NULL, NULL, NULL, 2, 1, NULL, '2026-01-19 14:31:32', '2026-01-21 15:29:18'),
(77, 'admin', NULL, 'admin', NULL, NULL, NULL, 'admin@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, NULL, NULL, NULL, 0, 1, NULL, '2026-01-19 14:31:32', '2026-01-21 23:23:48'),
(78, 'zhouwenqi', NULL, '周文琪', NULL, NULL, '18863487033', 'zhouwenqi@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '02026144501421600747', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:46:22'),
(79, 'tianqi', NULL, '田琦', NULL, NULL, '13256160962', 'tianqi@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '1458271101959734', NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-03-08 12:37:36'),
(80, 'test', NULL, '测试', NULL, NULL, NULL, 'test@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, NULL, NULL, NULL, 1, 1, NULL, '2026-01-19 14:31:32', '2026-01-23 11:30:33'),
(95, 'dongxin', 'AF', '董鑫', NULL, NULL, '13287390478', 'dongxin@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '17103283336131342', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:01', '2026-03-10 01:53:01'),
(96, 'chenzhongzhong', NULL, '陈重重', NULL, NULL, '13905318550', 'chenzhongzhong@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16671823535588114', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:01', '2026-03-10 01:53:01'),
(97, 'xuechao', NULL, '薛超', NULL, NULL, '15665215818', 'xuechao@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '17440204520788972', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:02', '2026-03-10 01:53:02'),
(98, 'yangyanjun', NULL, '杨延军', NULL, NULL, '18396868837', 'yangyanjun@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '176792969588465', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:02', '2026-03-10 01:53:02'),
(99, 'yanghongran', NULL, '杨红冉', NULL, NULL, '13615411571', 'yanghongran@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '17722816702198036', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:02', '2026-03-10 01:53:02'),
(100, 'wangyongjian', NULL, '王永建', NULL, NULL, '15628787937', 'wangyongjian@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '17725023419494256', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:02', '2026-03-10 01:53:02'),
(101, 'zhaowenbin', NULL, '赵文彬', NULL, NULL, '17150070371', 'zhaowenbin@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16614228786421863', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:02', '2026-03-10 01:53:02'),
(102, 'mudekun', NULL, '慕德坤', NULL, NULL, '13066056326', 'mudekun@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16451432413436300', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:02', '2026-03-10 01:53:02'),
(103, 'zhengjiayang', NULL, '郑家洋', NULL, NULL, '17662081101', 'zhengjiayang@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16348890450253012', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:02', '2026-03-10 01:53:02'),
(104, 'biyanxin', NULL, '毕彦信', NULL, NULL, '13963441000', 'biyanxin@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '226903656527305936', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:02', '2026-03-10 01:53:02'),
(105, 'wandeyue', 'SDC', '万德跃', NULL, NULL, '18560683363', 'wandeyue@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '116627050819991859', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:02', '2026-03-10 01:53:02'),
(106, 'niulijun', 'SDC', '牛丽君', NULL, NULL, '15610597930', 'niulijun@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '16451432781404046', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:02', '2026-03-10 01:53:02'),
(107, 'zhaoyanfeng', 'SDC', '赵衍峰', NULL, NULL, '15269167572', 'zhaoyanfeng@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '016620002935906168', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:03', '2026-03-10 01:53:03'),
(108, 'wushengao', 'SDC', '吴胜傲', NULL, NULL, '17852607693', 'wushengao@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '635363255321758602', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:03', '2026-03-10 01:53:03'),
(109, 'marui', 'SDC', '马睿', NULL, NULL, '18263345763', 'marui@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '1752219733796528', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:03', '2026-03-10 01:53:03'),
(111, 'zhuxicheng', 'SDC', '祝席成', NULL, NULL, '17864111707', 'zhuxicheng@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '202320410930629792', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:03', '2026-03-10 01:53:03'),
(112, 'fulei', 'SDC', '付蕾', NULL, NULL, '18006477011', 'fulei@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '2008425754659878', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:03', '2026-03-10 01:53:03'),
(113, 'limeng', 'SDC', '李猛', NULL, NULL, '15020169391', 'limeng@wiztek.cn', NULL, 0, NULL, NULL, NULL, 'Asia/Shanghai', 'zh-CN', NULL, '1524466031849293', NULL, NULL, 1, 1, NULL, '2026-03-10 01:53:03', '2026-03-10 01:53:03');

INSERT INTO user_status_cache (id, ldap_uid, ldap_dn, ldap_cn, email, ldap_sn, dept_code, status, synced_at, created_at, updated_at) VALUES
(1, 'anzhen', 'uid=anzhen,ou=People,dc=wiztek,dc=cn', 'anzhen', 'anzhen@wiztek.cn', 'anzhen', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(2, 'caigaoqing', 'uid=caigaoqing,ou=People,dc=wiztek,dc=cn', 'caigaoqing', 'caigaoqing@wiztek.cn', 'caigaoqing', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(3, 'caoqian', 'uid=caoqian,ou=People,dc=wiztek,dc=cn', 'caoqian', 'caoqian@wiztek.cn', 'caoqian', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(4, 'chenyiming', 'uid=chenyiming,ou=People,dc=wiztek,dc=cn', 'chenyiming', 'chenyiming@wiztek.cn', 'chenyiming', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(5, 'dongwenchao', 'uid=dongwenchao,ou=People,dc=wiztek,dc=cn', 'dongwenchao', 'dongwenchao@wiztek.cn', 'dongwenchao', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(6, 'douyanqun', 'uid=douyanqun,ou=People,dc=wiztek,dc=cn', 'douyanqun', 'douyanqun@wiztek.cn', 'douyanqun', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(7, 'duanyouxuan', 'uid=duanyouxuan,ou=People,dc=wiztek,dc=cn', 'duanyouxuan', 'duanyouxuan@wiztek.cn', 'duanyouxuan', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(8, 'dulei', 'uid=dulei,ou=People,dc=wiztek,dc=cn', 'dulei', 'dulei@wiztek.cn', 'dulei', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(9, 'fangshihong', 'uid=fangshihong,ou=People,dc=wiztek,dc=cn', 'fangshihong', 'fangshihong@wiztek.cn', 'fangshihong', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(10, 'fuyanfang', 'uid=fuyanfang,ou=People,dc=wiztek,dc=cn', 'fuyanfang', 'fuyanfang@wiztek.cn', 'fuyanfang', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(11, 'guopeipei', 'uid=guopeipei,ou=People,dc=wiztek,dc=cn', 'guopeipei', 'guopeipei@wiztek.cn', 'guopeipei', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(12, 'hanhuabin', 'uid=hanhuabin,ou=People,dc=wiztek,dc=cn', 'hanhuabin', 'hanhuabin@wiztek.cn', 'hanhuabin', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(13, 'huanzhengji', 'uid=huanzhengji,ou=People,dc=wiztek,dc=cn', 'huanzhengji', 'huanzhengji@wiztek.cn', 'huanzhengji', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(14, 'jilining', 'uid=jilining,ou=People,dc=wiztek,dc=cn', 'jilining', 'jilining@wiztek.cn', 'jilining', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(15, 'jingxu', 'uid=jingxu,ou=People,dc=wiztek,dc=cn', 'jingxu', 'jingxu@wiztek.cn', 'jingxu', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(16, 'liucunshan', 'uid=liucunshan,ou=People,dc=wiztek,dc=cn', 'liucunshan', 'liucunshan@wiztek.cn', 'liucunshan', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(17, 'liuchuanxiang', 'uid=liuchuanxiang,ou=People,dc=wiztek,dc=cn', 'liuchuanxiang', 'liuchuanxiang@wiztek.cn', 'liuchuanxiang', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(18, 'liangchao', 'uid=liangchao,ou=People,dc=wiztek,dc=cn', 'liangchao', 'liangchao@wiztek.cn', 'liangchao', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(19, 'liguoqiang', 'uid=liguoqiang,ou=People,dc=wiztek,dc=cn', 'liguoqiang', 'liguoqiang@wiztek.cn', 'liguoqiang', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(20, 'lishuogang', 'uid=lishuogang,ou=People,dc=wiztek,dc=cn', 'lishuogang', 'lishuogang@wiztek.cn', 'lishuogang', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(21, 'lishuying', 'uid=lishuying,ou=People,dc=wiztek,dc=cn', 'lishuying', 'lishuying@wiztek.cn', 'lishuying', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(22, 'liudan', 'uid=liudan,ou=People,dc=wiztek,dc=cn', 'liudan', 'liudan@wiztek.cn', 'liudan', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(23, 'liyujiang', 'uid=liyujiang,ou=People,dc=wiztek,dc=cn', 'liyujiang', 'liyujiang@wiztek.cn', 'liyujiang', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(24, 'lizhongzheng', 'uid=lizhongzheng,ou=People,dc=wiztek,dc=cn', 'lizhongzheng', 'lizhongzheng@wiztek.cn', 'lizhongzheng', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(25, 'lubo', 'uid=lubo,ou=People,dc=wiztek,dc=cn', 'lubo', 'lubo@wiztek.cn', 'lubo', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(26, 'luhonglin', 'uid=luhonglin,ou=People,dc=wiztek,dc=cn', 'luhonglin', 'luhonglin@wiztek.cn', 'luhonglin', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(27, 'liuxianmei', 'uid=liuxianmei,ou=People,dc=wiztek,dc=cn', 'liuxianmei', 'liuxianmei@wiztek.cn', 'liuxianmei', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(28, 'lixianpeng', 'uid=lixianpeng,ou=People,dc=wiztek,dc=cn', 'lixianpeng', 'lixianpeng@wiztek.cn', 'lixianpeng', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(29, 'panchunlei', 'uid=panchunlei,ou=People,dc=wiztek,dc=cn', 'panchunlei', 'panchunlei@wiztek.cn', 'panchunlei', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(30, 'pengbukun', 'uid=pengbukun,ou=People,dc=wiztek,dc=cn', 'pengbukun', 'pengbukun@wiztek.cn', 'pengbukun', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(31, 'renjianwei', 'uid=renjianwei,ou=People,dc=wiztek,dc=cn', 'renjianwei', 'renjianwei@wiztek.cn', 'renjianwei', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(32, 'shishoujie', 'uid=shishoujie,ou=People,dc=wiztek,dc=cn', 'shishoujie', 'shishoujie@wiztek.cn', 'shishoujie', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(33, 'shiweijia', 'uid=shiweijia,ou=People,dc=wiztek,dc=cn', 'shiweijia', 'shiweijia@wiztek.cn', 'shiweijia', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(34, 'songzhanwei', 'uid=songzhanwei,ou=People,dc=wiztek,dc=cn', 'songzhanwei', 'songzhanwei@wiztek.cn', 'songzhanwei', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(35, 'sunda', 'uid=sunda,ou=People,dc=wiztek,dc=cn', 'sunda', 'sunda@wiztek.cn', 'sunda', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(36, 'sundinghua', 'uid=sundinghua,ou=People,dc=wiztek,dc=cn', 'sundinghua', 'sundinghua@wiztek.cn', 'sundinghua', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(37, 'songwenwen', 'uid=songwenwen,ou=People,dc=wiztek,dc=cn', 'songwenwen', 'songwenwen@wiztek.cn', 'songwenwen', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(38, 'songyizhen', 'uid=songyizhen,ou=People,dc=wiztek,dc=cn', 'songyizhen', 'songyizhen@wiztek.cn', 'songyizhen', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(39, 'tianhaiyan', 'uid=tianhaiyan,ou=People,dc=wiztek,dc=cn', 'tianhaiyan', 'tianhaiyan@wiztek.cn', 'tianhaiyan', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(40, 'tongli', 'uid=tongli,ou=People,dc=wiztek,dc=cn', 'tongli', 'tongli@wiztek.cn', 'tongli', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(41, 'wangcheng', 'uid=wangcheng,ou=People,dc=wiztek,dc=cn', 'wangcheng', 'wangcheng@wiztek.cn', 'wangcheng', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(42, 'wangdexian', 'uid=wangdexian,ou=People,dc=wiztek,dc=cn', 'wangdexian', 'wangdexian@wiztek.cn', 'wangdexian', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(43, 'wangdezhi', 'uid=wangdezhi,ou=People,dc=wiztek,dc=cn', 'wangdezhi', 'wangdezhi@wiztek.cn', 'wangdezhi', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(44, 'wangguanghui', 'uid=wangguanghui,ou=People,dc=wiztek,dc=cn', 'wangguanghui', 'wangguanghui@wiztek.cn', 'wangguanghui', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(45, 'wanghengtong', 'uid=wanghengtong,ou=People,dc=wiztek,dc=cn', 'wanghengtong', 'wanghengtong@wiztek.cn', 'wanghengtong', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(46, 'wangjian', 'uid=wangjian,ou=People,dc=wiztek,dc=cn', 'wangjian', 'wangjian@wiztek.cn', 'wangjian', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(47, 'wangmin', 'uid=wangmin,ou=People,dc=wiztek,dc=cn', 'wangmin', 'wangmin@wiztek.cn', 'wangmin', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(48, 'wangqingmei', 'uid=wangqingmei,ou=People,dc=wiztek,dc=cn', 'wangqingmei', 'wangqingmei@wiztek.cn', 'wangqingmei', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(49, 'wangshuai', 'uid=wangshuai,ou=People,dc=wiztek,dc=cn', 'wangshuai', 'wangshuai@wiztek.cn', 'wangshuai', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(50, 'wangxiaoyang', 'uid=wangxiaoyang,ou=People,dc=wiztek,dc=cn', 'wangxiaoyang', 'wangxiaoyang@wiztek.cn', 'wangxiaoyang', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(51, 'wangyanlei', 'uid=wangyanlei,ou=People,dc=wiztek,dc=cn', 'wangyanlei', 'wangyanlei@wiztek.cn', 'wangyanlei', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(52, 'wangyongheng', 'uid=wangyongheng,ou=People,dc=wiztek,dc=cn', 'wangyongheng', 'wangyongheng@wiztek.cn', 'wangyongheng', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(53, 'wangyuying', 'uid=wangyuying,ou=People,dc=wiztek,dc=cn', 'wangyuying', 'wangyuying@wiztek.cn', 'wangyuying', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(54, 'wangzhuang', 'uid=wangzhuang,ou=People,dc=wiztek,dc=cn', 'wangzhuang', 'wangzhuang@wiztek.cn', 'wangzhuang', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(55, 'weishanming', 'uid=weishanming,ou=People,dc=wiztek,dc=cn', 'weishanming', 'weishanming@wiztek.cn', 'weishanming', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(56, 'xujianfei', 'uid=xujianfei,ou=People,dc=wiztek,dc=cn', 'xujianfei', 'xujianfei@wiztek.cn', 'xujianfei', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(57, 'xuxingxin', 'uid=xuxingxin,ou=People,dc=wiztek,dc=cn', 'xuxingxin', 'xuxingxin@wiztek.cn', 'xuxingxin', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(58, 'xuxueyan', 'uid=xuxueyan,ou=People,dc=wiztek,dc=cn', 'xuxueyan', 'xuxueyan@wiztek.cn', 'xuxueyan', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(59, 'xuxueying', 'uid=xuxueying,ou=People,dc=wiztek,dc=cn', 'xuxueying', 'xuxueying@wiztek.cn', 'xuxueying', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(60, 'yangsen', 'uid=yangsen,ou=People,dc=wiztek,dc=cn', 'yangsen', 'yangsen@wiztek.cn', 'yangsen', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(61, 'yangzhenzhen', 'uid=yangzhenzhen,ou=People,dc=wiztek,dc=cn', 'yangzhenzhen', 'yangzhenzhen@wiztek.cn', 'yangzhenzhen', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(62, 'yanyuanquan', 'uid=yanyuanquan,ou=People,dc=wiztek,dc=cn', 'yanyuanquan', 'yanyuanquan@wiztek.cn', 'yanyuanquan', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(63, 'yuanchang', 'uid=yuanchang,ou=People,dc=wiztek,dc=cn', 'yuanchang', 'yuanchang@wiztek.cn', 'yuanchang', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(64, 'yangtao', 'uid=yangtao,ou=People,dc=wiztek,dc=cn', 'yangtao', 'yangtao@wiztek.cn', 'yangtao', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(65, 'zhangdawei', 'uid=zhangdawei,ou=People,dc=wiztek,dc=cn', 'zhangdawei', 'zhangdawei@wiztek.cn', 'zhangdawei', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(66, 'zhouguangying', 'uid=zhouguangying,ou=People,dc=wiztek,dc=cn', 'zhouguangying', 'zhouguangying@wiztek.cn', 'zhouguangying', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(67, 'zhangjinzhi', 'uid=zhangjinzhi,ou=People,dc=wiztek,dc=cn', 'zhangjinzhi', 'zhangjinzhi@wiztek.cn', 'zhangjinzhi', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(68, 'zhangping', 'uid=zhangping,ou=People,dc=wiztek,dc=cn', 'zhangping', 'zhangping@wiztek.cn', 'zhangping', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(69, 'zhangyan', 'uid=zhangyan,ou=People,dc=wiztek,dc=cn', 'zhangyan', 'zhangyan@wiztek.cn', 'zhangyan', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(70, 'zhangyang', 'uid=zhangyang,ou=People,dc=wiztek,dc=cn', 'zhangyang', 'zhangyang@wiztek.cn', 'zhangyang', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(71, 'zhangzhipeng', 'uid=zhangzhipeng,ou=People,dc=wiztek,dc=cn', 'zhangzhipeng', 'zhangzhipeng@wiztek.cn', 'zhangzhipeng', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(72, 'zhaojing', 'uid=zhaojing,ou=People,dc=wiztek,dc=cn', 'zhaojing', 'zhaojing@wiztek.cn', 'zhaojing', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(73, 'qiyuchen', 'uid=qiyuchen,ou=People,dc=wiztek,dc=cn', 'qiyuchen', 'qiyuchen@wiztek.cn', 'qiyuchen', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(74, 'zhaowang', 'uid=zhaowang,ou=People,dc=wiztek,dc=cn', 'zhaowang', 'zhaowang@wiztek.cn', 'zhaowang', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(75, 'fengqingzhao', 'uid=fengqingzhao,ou=People,dc=wiztek,dc=cn', 'fengqingzhao', 'fengqingzhao@wiztek.cn', 'fengqingzhao', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(76, 'jinanzhujian', 'uid=jinanzhujian,ou=People,dc=wiztek,dc=cn', 'jinanzhujian', NULL, 'jinanzhujian', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(77, 'admin', 'uid=admin,ou=People,dc=wiztek,dc=cn', 'admin', 'admin@wiztek.cn', 'admin', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(78, 'zhouwenqi', 'uid=zhouwenqi,ou=People,dc=wiztek,dc=cn', 'zhouwenqi', 'zhouwenqi@wiztek.cn', 'zhouwenqi', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(79, 'tianqi', 'uid=tianqi,ou=People,dc=wiztek,dc=cn', 'tianqi', 'tianqi@wiztek.cn', 'tianqi', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57'),
(80, 'test', 'uid=test,ou=People,dc=wiztek,dc=cn', '测试', 'test@wiztek.cn', 'ceshi', NULL, 1, '2026-01-20 01:08:57', '2026-01-19 14:31:32', '2026-01-20 01:08:57');

INSERT INTO user_departments (id, uid, dept_code, created_at) VALUES
(34, 'caoqian', 'RD', '2026-03-10 00:57:16'),
(35, 'chenyiming', 'RD', '2026-03-10 00:57:16'),
(36, 'dongwenchao', 'SDC', '2026-03-10 00:57:16'),
(37, 'douyanqun', 'RD', '2026-03-10 00:57:16'),
(41, 'fuyanfang', 'SDC', '2026-03-10 00:57:16'),
(42, 'guopeipei', 'RD', '2026-03-10 00:57:16'),
(44, 'huanzhengji', 'SDC', '2026-03-10 00:57:16'),
(46, 'jingxu', 'SDC', 1, '2026-03-10 00:57:16'),
(47, 'liucunshan', 'SDC', 1, '2026-03-10 00:57:16'),
(50, 'liguoqiang', 'SDC', 1, '2026-03-10 00:57:16'),
(51, 'lishuogang', 'SDC', 1, '2026-03-10 00:57:16'),
(55, 'lizhongzheng', 'SDC', 1, '2026-03-10 00:57:16'),
(56, 'lubo', 'RD', 1, '2026-03-10 00:57:16'),
(57, 'luhonglin', 'SDC', 1, '2026-03-10 00:57:16'),
(58, 'liuxianmei', 'AF', 1, '2026-03-10 00:57:16'),
(59, 'lixianpeng', 'SDC', 1, '2026-03-10 00:57:16'),
(61, 'pengbukun', 'RD', 1, '2026-03-10 00:57:16'),
(63, 'shishoujie', 'SDC', 1, '2026-03-10 00:57:16'),
(64, 'shiweijia', 'RD', 1, '2026-03-10 00:57:16'),
(66, 'sunda', 'SDC', 1, '2026-03-10 00:57:16'),
(69, 'songyizhen', 'SDC', 1, '2026-03-10 00:57:16'),
(70, 'tianhaiyan', 'AF', 1, '2026-03-10 00:57:16'),
(71, 'tongli', 'SDC', 1, '2026-03-10 00:57:16'),
(74, 'wangdezhi', 'SDC', 1, '2026-03-10 00:57:16'),
(75, 'wangguanghui', 'RD', 1, '2026-03-10 00:57:16'),
(77, 'wangjian', 'SDC', 1, '2026-03-10 00:57:16'),
(79, 'wangqingmei', 'SDC', 1, '2026-03-10 00:57:16'),
(81, 'wangxiaoyang', 'SDC', 1, '2026-03-10 00:57:16'),
(85, 'wangzhuang', 'SDC', 1, '2026-03-10 00:57:16'),
(86, 'weishanming', 'RD', 1, '2026-03-10 00:57:16'),
(87, 'xujianfei', 'SDC', 1, '2026-03-10 00:57:16'),
(91, 'yangsen', 'SDC', 1, '2026-03-10 00:57:16'),
(92, 'yangzhenzhen', 'SDC', 1, '2026-03-10 00:57:16'),
(93, 'yanyuanquan', 'SDC', 1, '2026-03-10 00:57:16'),
(94, 'yuanchang', 'SDC', 1, '2026-03-10 00:57:16'),
(100, 'zhangyan', 'RD', 1, '2026-03-10 00:57:16'),
(101, 'zhangyang', 'SDC', 1, '2026-03-10 00:57:16'),
(102, 'zhangzhipeng', 'SDC', 1, '2026-03-10 00:57:16'),
(166, 'liuchuanxiang', 'GMO', 0, '2026-03-10 01:03:12'),
(167, 'xuxueying', 'GMO', 0, '2026-03-10 01:03:12'),
(168, 'zhouguangying', 'GMO', 0, '2026-03-10 01:03:12'),
(169, 'wangmin', 'GMO', 0, '2026-03-10 01:03:12'),
(170, 'liudan', 'BA', 0, '2026-03-10 01:06:33'),
(171, 'liyujiang', 'MCMT', 0, '2026-03-10 01:06:55'),
(172, 'liuchuanxiang', 'MCMT', 0, '2026-03-10 01:06:55'),
(173, 'renjianwei', 'MCMT', 0, '2026-03-10 01:06:55'),
(174, 'wangcheng', 'MCMT', 0, '2026-03-10 01:06:55'),
(175, 'wangmin', 'MCMT', 0, '2026-03-10 01:06:55'),
(176, 'wangyongheng', 'MCMT', 0, '2026-03-10 01:06:55'),
(177, 'wangzhuang', 'MCMT', 0, '2026-03-10 01:06:55'),
(178, 'xuxueying', 'MCMT', 0, '2026-03-10 01:06:55'),
(179, 'zhouguangying', 'MCMT', 0, '2026-03-10 01:06:55'),
(180, 'yangtao', 'MCMT', 0, '2026-03-10 01:06:55'),
(187, 'liuchuanxiang', 'PMCMT', 0, '2026-03-10 01:07:28'),
(188, 'liuxianmei', 'PMCMT', 0, '2026-03-10 01:07:28'),
(189, 'wangcheng', 'PMCMT', 0, '2026-03-10 01:07:28'),
(190, 'wangmin', 'PMCMT', 0, '2026-03-10 01:07:28'),
(191, 'xuxueying', 'PMCMT', 0, '2026-03-10 01:07:28'),
(192, 'yangtao', 'PMCMT', 0, '2026-03-10 01:07:28'),
(193, 'zhouguangying', 'PMCMT', 0, '2026-03-10 01:07:28'),
(194, 'wangzhuang', 'PMCMT', 0, '2026-03-10 01:07:28'),
(195, 'zhangping', 'HR', 0, '2026-03-10 01:08:58'),
(223, 'dongxin', 'AF', 1, '2026-03-10 01:53:01'),
(233, 'wandeyue', 'SDC', 1, '2026-03-10 01:53:02'),
(234, 'niulijun', 'SDC', 1, '2026-03-10 01:53:03'),
(235, 'zhaoyanfeng', 'SDC', 1, '2026-03-10 01:53:03'),
(236, 'wushengao', 'SDC', 1, '2026-03-10 01:53:03'),
(237, 'marui', 'SDC', 1, '2026-03-10 01:53:03'),
(238, 'xunzhengji', 'SDC', 1, '2026-03-10 01:53:03'),
(239, 'zhuxicheng', 'SDC', 1, '2026-03-10 01:53:03'),
(240, 'fulei', 'SDC', 1, '2026-03-10 01:53:03'),
(241, 'limeng', 'SDC', 1, '2026-03-10 01:53:03'),
(242, 'biyanxin', 'SP', 0, '2026-03-10 01:55:56'),
(243, 'mudekun', 'SP', 0, '2026-03-10 01:55:56'),
(244, 'zhaowenbin', 'SP', 0, '2026-03-10 01:55:56'),
(245, 'zhengjiayang', 'SP', 0, '2026-03-10 01:55:56'),
(246, 'duanyouxuan', 'SP', 0, '2026-03-10 01:55:56'),
(247, 'fangshihong', 'SP', 0, '2026-03-10 01:55:56'),
(248, 'hanhuabin', 'SP', 0, '2026-03-10 01:55:56'),
(249, 'jilining', 'SP', 0, '2026-03-10 01:55:56'),
(250, 'lishuying', 'SP', 0, '2026-03-10 01:55:56'),
(251, 'liangchao', 'SP', 0, '2026-03-10 01:55:56'),
(252, 'panchunlei', 'SP', 0, '2026-03-10 01:55:56'),
(253, 'qiyuchen', 'SP', 0, '2026-03-10 01:55:56'),
(254, 'songwenwen', 'SP', 0, '2026-03-10 01:55:56'),
(255, 'songzhanwei', 'SP', 0, '2026-03-10 01:55:56'),
(256, 'sundinghua', 'SP', 0, '2026-03-10 01:55:56'),
(257, 'wangcheng', 'SP', 0, '2026-03-10 01:55:56'),
(258, 'wangdexian', 'SP', 0, '2026-03-10 01:55:56'),
(259, 'wanghengtong', 'SP', 0, '2026-03-10 01:55:56'),
(260, 'wangyanlei', 'SP', 0, '2026-03-10 01:55:56'),
(261, 'wangyuying', 'SP', 0, '2026-03-10 01:55:56'),
(262, 'zhangdawei', 'SP', 0, '2026-03-10 01:55:56'),
(263, 'zhaojing', 'SP', 0, '2026-03-10 01:55:56'),
(264, 'chenzhongzhong', 'MC', 0, '2026-03-10 01:56:09'),
(265, 'wangyongjian', 'MC', 0, '2026-03-10 01:56:09'),
(266, 'xuechao', 'MC', 0, '2026-03-10 01:56:09'),
(267, 'yanghongran', 'MC', 0, '2026-03-10 01:56:09'),
(268, 'yangyanjun', 'MC', 0, '2026-03-10 01:56:09'),
(269, 'liyujiang', 'MC', 0, '2026-03-10 01:56:09'),
(270, 'tianqi', 'MC', 0, '2026-03-10 01:56:09'),
(271, 'wangyongheng', 'MC', 0, '2026-03-10 01:56:09'),
(272, 'yangtao', 'MC', 0, '2026-03-10 01:56:09'),
(273, 'zhangjinzhi', 'MC', 0, '2026-03-10 01:56:09'),
(274, 'zhouwenqi', 'MC', 0, '2026-03-10 01:56:09'),
(275, 'xuxueyan', 'MC', 0, '2026-03-10 01:56:09'),
(277, 'caoqian', 'TCMT', 0, '2026-03-11 08:45:27'),
(278, 'lishuogang', 'TCMT', 0, '2026-03-11 08:45:27'),
(279, 'liuchuanxiang', 'TCMT', 0, '2026-03-11 08:45:27'),
(280, 'renjianwei', 'TCMT', 0, '2026-03-11 08:45:27'),
(281, 'shiweijia', 'TCMT', 0, '2026-03-11 08:45:27'),
(282, 'zhouguangying', 'TCMT', 0, '2026-03-11 08:45:27'),
(283, 'test', 'TCMT', 0, '2026-03-11 08:45:27'),
(284, 'anzhen', 'HFZX', 0, '2026-03-11 08:52:13'),
(285, 'caigaoqing', 'HFZX', 0, '2026-03-11 08:52:13'),
(286, 'fengqingzhao', 'HFZX', 0, '2026-03-11 08:52:13'),
(287, 'renjianwei', 'HFZX', 0, '2026-03-11 08:52:13'),
(288, 'wangshuai', 'HFZX', 0, '2026-03-11 08:52:13'),
(289, 'xuxingxin', 'HFZX', 0, '2026-03-11 08:52:13'),
(290, 'zhaowang', 'HFZX', 0, '2026-03-11 08:52:13'),
(291, 'test', 'HFZX', 0, '2026-03-11 08:52:13');

INSERT INTO git_projects (id, project_code, parent_code, name, dept_code, leader_uid, description, start_date, end_date, repo_url, is_group, is_template, status, docs_synced_at, docs_committed_at, created_at, updated_at) VALUES
(1, 'huizhi-yun', NULL, 'huizhi-yun', 'GMO', 'zhouguangying', '汇智云', NULL, NULL, 'https://gitlab.wiztek.cn/huizhi-yun', 1, 0, 1, NULL, NULL, '2026-01-17 03:43:41', '2026-03-11 22:06:12'),
(19, 'platform/company-platform', 'platform', 'company-platform', 'RD', 'shiweijia', '底座核心仓库', NULL, NULL, 'https://gitlab.wiztek.cn/platform/company-platform', 1, 0, 1, NULL, NULL, '2026-03-11 01:34:02', '2026-03-11 22:06:05'),
(20, 'platform/company-template-bigdata', 'platform', 'company-template-bigdata', 'RD', 'shiweijia', '大数据', NULL, NULL, 'https://gitlab.wiztek.cn/platform/company-template-bigdata', 1, 0, 1, NULL, NULL, '2026-03-11 01:37:23', '2026-03-11 22:06:07'),
(21, 'platform/company-template-boot', 'platform', 'company-template-boot', 'RD', 'shiweijia', '单体产品脚手架模板', NULL, NULL, 'https://gitlab.wiztek.cn/platform/company-template-boot', 1, 0, 1, NULL, NULL, '2026-03-11 01:34:43', '2026-03-11 22:06:09'),
(22, 'platform/company-template-cloud', 'platform', 'company-template-cloud', 'RD', 'shiweijia', '微服务产品脚手架模板', NULL, NULL, 'https://gitlab.wiztek.cn/platform/company-template-cloud', 1, 0, 1, NULL, NULL, '2026-03-11 01:35:44', '2026-03-11 22:06:10'),
(23, 'platform/company-template-eland', 'platform', 'company-template-eland', 'RD', 'shiweijia', '政务基础平台', NULL, NULL, 'https://gitlab.wiztek.cn/platform/company-template-eland', 1, 0, 1, NULL, NULL, '2026-03-11 01:36:16', '2026-03-11 22:06:11'),
(24, 'product/natural-resources', 'product', 'natural-resources', 'RD', 'shiweijia', '领域区分-自然资源', NULL, NULL, 'https://gitlab.wiztek.cn/product/natural-resources', 1, 0, 1, NULL, NULL, '2026-03-11 01:39:21', '2026-03-11 22:06:14'),
(25, 'platform', NULL, 'platform', 'RD', 'shiweijia', '平台', NULL, NULL, 'https://gitlab.wiztek.cn/platform', 1, 0, 1, NULL, NULL, '2026-03-11 01:31:45', '2026-03-11 22:06:15'),
(26, 'product', NULL, 'product', 'RD', 'shiweijia', '产品', NULL, NULL, 'https://gitlab.wiztek.cn/product', 1, 0, 1, NULL, NULL, '2026-03-11 01:32:37', '2026-03-11 22:06:17'),
(27, 'platform/company-platform/egret-ui-admin-vue3', 'platform/company-platform', 'egret-ui-admin-vue3', 'RD', 'shiweijia', '平台前端代码', NULL, NULL, 'https://gitlab.wiztek.cn/platform/company-platform/egret-ui-admin-vue3', 1, 0, 1, NULL, NULL, '2026-03-11 02:06:33', '2026-03-11 22:06:18'),
(28, 'platform/company-platform/egret', 'platform/company-platform', 'egret', 'RD', 'shiweijia', '平台后端底座', NULL, NULL, 'https://gitlab.wiztek.cn/platform/company-platform/egret', 1, 0, 1, NULL, NULL, '2026-03-11 01:56:07', '2026-03-11 22:06:20'),
(29, 'platform/company-template-boot/egret-template-boot', 'platform/company-template-boot', 'egret-template-boot', 'RD', 'shiweijia', NULL, NULL, NULL, 'https://gitlab.wiztek.cn/platform/company-template-boot/egret-template-boot', 1, 0, 1, NULL, NULL, '2026-03-11 01:53:20', '2026-03-11 22:06:21'),
(30, 'huizhi-yun/account', 'huizhi-yun', 'account', 'GMO', 'zhouguangying', '汇智云账号', NULL, NULL, 'https://gitlab.wiztek.cn/huizhi-yun/account', 1, 0, 1, '2026-03-12 02:57:20', NULL, '2026-01-18 17:50:55', '2026-03-12 02:57:20'),
(31, 'huizhi-yun/codocs', 'huizhi-yun', 'codocs', 'GMO', 'zhouguangying', '汇智云文档', NULL, NULL, 'https://gitlab.wiztek.cn/huizhi-yun/codocs', 1, 0, 1, NULL, NULL, '2026-01-17 22:57:05', '2026-03-11 22:06:24'),
(32, 'huizhi-yun/templates', 'huizhi-yun', 'templates', 'GMO', 'zhouguangying', '汇智云模块项目模板', NULL, NULL, 'https://gitlab.wiztek.cn/huizhi-yun/templates', 1, 0, 1, NULL, NULL, '2026-01-19 14:15:35', '2026-03-11 22:06:17'),
(33, 'huizhi-yun/wecomsg', 'huizhi-yun', 'wecomsg', 'GMO', 'zhouguangying', NULL, NULL, NULL, 'https://gitlab.wiztek.cn/huizhi-yun/wecomsg', 1, 0, 1, NULL, NULL, '2026-03-07 10:44:56', '2026-03-11 22:06:22'),
(34, 'huizhi-yun/templates/nuxt-template', 'huizhi-yun/templates', 'nuxt-template', 'GMO', 'zhouguangying', NULL, NULL, NULL, 'https://gitlab.wiztek.cn/huizhi-yun/templates/nuxt-template', 1, 0, 1, NULL, NULL, '2026-01-19 14:16:07', '2026-03-11 22:06:23');

INSERT INTO git_project_members (id, project_code, uid, role, joined_at) VALUES
(902, 'platform/company-platform', 'shiweijia', 'member', '2026-03-11 22:06:06'),
(903, 'platform/company-platform', 'zhouguangying', 'member', '2026-03-11 22:06:06'),
(904, 'platform/company-platform', 'caoqian', 'member', '2026-03-11 22:06:06'),
(905, 'platform/company-platform', 'chenyiming', 'member', '2026-03-11 22:06:06'),
(906, 'platform/company-platform', 'lubo', 'member', '2026-03-11 22:06:07'),
(907, 'platform/company-platform', 'douyanqun', 'member', '2026-03-11 22:06:07'),
(908, 'platform/company-platform', 'weishanming', 'member', '2026-03-11 22:06:07'),
(909, 'platform/company-platform', 'pengbukun', 'member', '2026-03-11 22:06:07'),
(910, 'platform/company-platform', 'guopeipei', 'member', '2026-03-11 22:06:07'),
(911, 'platform/company-platform', 'wangguanghui', 'member', '2026-03-11 22:06:07'),
(912, 'platform/company-template-bigdata', 'shiweijia', 'member', '2026-03-11 22:06:08'),
(913, 'platform/company-template-bigdata', 'zhouguangying', 'member', '2026-03-11 22:06:08'),
(914, 'platform/company-template-bigdata', 'caoqian', 'member', '2026-03-11 22:06:08'),
(915, 'platform/company-template-bigdata', 'chenyiming', 'member', '2026-03-11 22:06:08'),
(916, 'platform/company-template-bigdata', 'lubo', 'member', '2026-03-11 22:06:08'),
(917, 'platform/company-template-bigdata', 'douyanqun', 'member', '2026-03-11 22:06:08'),
(918, 'platform/company-template-bigdata', 'weishanming', 'member', '2026-03-11 22:06:08'),
(919, 'platform/company-template-bigdata', 'pengbukun', 'member', '2026-03-11 22:06:08'),
(920, 'platform/company-template-bigdata', 'guopeipei', 'member', '2026-03-11 22:06:08'),
(921, 'platform/company-template-bigdata', 'wangguanghui', 'member', '2026-03-11 22:06:08'),
(922, 'platform/company-template-boot', 'shiweijia', 'member', '2026-03-11 22:06:09'),
(923, 'platform/company-template-boot', 'zhouguangying', 'member', '2026-03-11 22:06:09'),
(924, 'platform/company-template-boot', 'caoqian', 'member', '2026-03-11 22:06:09'),
(925, 'platform/company-template-boot', 'chenyiming', 'member', '2026-03-11 22:06:09'),
(926, 'platform/company-template-boot', 'lubo', 'member', '2026-03-11 22:06:09'),
(927, 'platform/company-template-boot', 'douyanqun', 'member', '2026-03-11 22:06:09'),
(928, 'platform/company-template-boot', 'weishanming', 'member', '2026-03-11 22:06:09'),
(929, 'platform/company-template-boot', 'pengbukun', 'member', '2026-03-11 22:06:09'),
(930, 'platform/company-template-boot', 'guopeipei', 'member', '2026-03-11 22:06:09'),
(931, 'platform/company-template-boot', 'wangguanghui', 'member', '2026-03-11 22:06:09'),
(932, 'platform/company-template-cloud', 'shiweijia', 'member', '2026-03-11 22:06:10'),
(933, 'platform/company-template-cloud', 'zhouguangying', 'member', '2026-03-11 22:06:10'),
(934, 'platform/company-template-cloud', 'caoqian', 'member', '2026-03-11 22:06:10'),
(935, 'platform/company-template-cloud', 'chenyiming', 'member', '2026-03-11 22:06:10'),
(936, 'platform/company-template-cloud', 'lubo', 'member', '2026-03-11 22:06:10'),
(937, 'platform/company-template-cloud', 'douyanqun', 'member', '2026-03-11 22:06:11'),
(938, 'platform/company-template-cloud', 'weishanming', 'member', '2026-03-11 22:06:11'),
(939, 'platform/company-template-cloud', 'pengbukun', 'member', '2026-03-11 22:06:11'),
(940, 'platform/company-template-cloud', 'guopeipei', 'member', '2026-03-11 22:06:11'),
(941, 'platform/company-template-cloud', 'wangguanghui', 'member', '2026-03-11 22:06:11'),
(942, 'platform/company-template-eland', 'shiweijia', 'member', '2026-03-11 22:06:12'),
(943, 'platform/company-template-eland', 'zhouguangying', 'member', '2026-03-11 22:06:12'),
(944, 'platform/company-template-eland', 'caoqian', 'member', '2026-03-11 22:06:12'),
(945, 'platform/company-template-eland', 'chenyiming', 'member', '2026-03-11 22:06:12'),
(946, 'platform/company-template-eland', 'lubo', 'member', '2026-03-11 22:06:12'),
(947, 'platform/company-template-eland', 'douyanqun', 'member', '2026-03-11 22:06:12'),
(948, 'platform/company-template-eland', 'weishanming', 'member', '2026-03-11 22:06:12'),
(949, 'platform/company-template-eland', 'pengbukun', 'member', '2026-03-11 22:06:12'),
(950, 'platform/company-template-eland', 'guopeipei', 'member', '2026-03-11 22:06:12'),
(951, 'platform/company-template-eland', 'wangguanghui', 'member', '2026-03-11 22:06:12'),
(952, 'huizhi-yun', 'zhouguangying', 'member', '2026-03-11 22:06:13'),
(953, 'huizhi-yun', 'renjianwei', 'member', '2026-03-11 22:06:13'),
(954, 'huizhi-yun', 'caoqian', 'member', '2026-03-11 22:06:13'),
(955, 'product/natural-resources', 'shiweijia', 'member', '2026-03-11 22:06:14'),
(956, 'product/natural-resources', 'zhouguangying', 'member', '2026-03-11 22:06:14'),
(957, 'product/natural-resources', 'caoqian', 'member', '2026-03-11 22:06:14'),
(958, 'platform', 'shiweijia', 'member', '2026-03-11 22:06:16'),
(959, 'platform', 'zhouguangying', 'member', '2026-03-11 22:06:16'),
(960, 'platform', 'caoqian', 'member', '2026-03-11 22:06:16'),
(961, 'platform', 'chenyiming', 'member', '2026-03-11 22:06:16'),
(962, 'platform', 'lubo', 'member', '2026-03-11 22:06:16'),
(963, 'platform', 'douyanqun', 'member', '2026-03-11 22:06:16'),
(964, 'platform', 'weishanming', 'member', '2026-03-11 22:06:16'),
(965, 'platform', 'pengbukun', 'member', '2026-03-11 22:06:16'),
(966, 'platform', 'guopeipei', 'member', '2026-03-11 22:06:16'),
(967, 'platform', 'wangguanghui', 'member', '2026-03-11 22:06:16'),
(968, 'product', 'shiweijia', 'member', '2026-03-11 22:06:17'),
(969, 'product', 'zhouguangying', 'member', '2026-03-11 22:06:17'),
(970, 'product', 'caoqian', 'member', '2026-03-11 22:06:17'),
(971, 'huizhi-yun/templates', 'zhouguangying', 'member', '2026-03-11 22:06:18'),
(972, 'huizhi-yun/templates', 'renjianwei', 'member', '2026-03-11 22:06:18'),
(973, 'huizhi-yun/templates', 'caoqian', 'member', '2026-03-11 22:06:18'),
(974, 'platform/company-platform/egret-ui-admin-vue3', 'shiweijia', 'member', '2026-03-11 22:06:20'),
(975, 'platform/company-platform/egret-ui-admin-vue3', 'zhouguangying', 'member', '2026-03-11 22:06:20'),
(976, 'platform/company-platform/egret-ui-admin-vue3', 'caoqian', 'member', '2026-03-11 22:06:20'),
(977, 'platform/company-platform/egret-ui-admin-vue3', 'chenyiming', 'member', '2026-03-11 22:06:20'),
(978, 'platform/company-platform/egret-ui-admin-vue3', 'lubo', 'member', '2026-03-11 22:06:20'),
(979, 'platform/company-platform/egret-ui-admin-vue3', 'douyanqun', 'member', '2026-03-11 22:06:20'),
(980, 'platform/company-platform/egret-ui-admin-vue3', 'weishanming', 'member', '2026-03-11 22:06:20'),
(981, 'platform/company-platform/egret-ui-admin-vue3', 'pengbukun', 'member', '2026-03-11 22:06:20'),
(982, 'platform/company-platform/egret-ui-admin-vue3', 'guopeipei', 'member', '2026-03-11 22:06:20'),
(983, 'platform/company-platform/egret-ui-admin-vue3', 'wangguanghui', 'member', '2026-03-11 22:06:20'),
(984, 'platform/company-platform/egret', 'shiweijia', 'member', '2026-03-11 22:06:21'),
(985, 'platform/company-platform/egret', 'zhouguangying', 'member', '2026-03-11 22:06:21'),
(986, 'platform/company-platform/egret', 'caoqian', 'member', '2026-03-11 22:06:21'),
(987, 'platform/company-platform/egret', 'chenyiming', 'member', '2026-03-11 22:06:21'),
(988, 'platform/company-platform/egret', 'lubo', 'member', '2026-03-11 22:06:21'),
(989, 'platform/company-platform/egret', 'douyanqun', 'member', '2026-03-11 22:06:21'),
(990, 'platform/company-platform/egret', 'weishanming', 'member', '2026-03-11 22:06:21'),
(991, 'platform/company-platform/egret', 'pengbukun', 'member', '2026-03-11 22:06:21'),
(992, 'platform/company-platform/egret', 'guopeipei', 'member', '2026-03-11 22:06:21'),
(993, 'platform/company-platform/egret', 'wangguanghui', 'member', '2026-03-11 22:06:21'),
(994, 'platform/company-template-boot/egret-template-boot', 'shiweijia', 'member', '2026-03-11 22:06:22'),
(995, 'platform/company-template-boot/egret-template-boot', 'zhouguangying', 'member', '2026-03-11 22:06:22'),
(996, 'platform/company-template-boot/egret-template-boot', 'caoqian', 'member', '2026-03-11 22:06:22'),
(997, 'platform/company-template-boot/egret-template-boot', 'chenyiming', 'member', '2026-03-11 22:06:22'),
(998, 'platform/company-template-boot/egret-template-boot', 'lubo', 'member', '2026-03-11 22:06:22'),
(999, 'platform/company-template-boot/egret-template-boot', 'douyanqun', 'member', '2026-03-11 22:06:22'),
(1000, 'platform/company-template-boot/egret-template-boot', 'weishanming', 'member', '2026-03-11 22:06:22'),
(1001, 'platform/company-template-boot/egret-template-boot', 'pengbukun', 'member', '2026-03-11 22:06:22'),
(1002, 'platform/company-template-boot/egret-template-boot', 'guopeipei', 'member', '2026-03-11 22:06:22'),
(1003, 'platform/company-template-boot/egret-template-boot', 'wangguanghui', 'member', '2026-03-11 22:06:22'),
(1004, 'huizhi-yun/wecomsg', 'zhouguangying', 'member', '2026-03-11 22:06:23'),
(1005, 'huizhi-yun/wecomsg', 'renjianwei', 'member', '2026-03-11 22:06:23'),
(1006, 'huizhi-yun/wecomsg', 'caoqian', 'member', '2026-03-11 22:06:23'),
(1007, 'huizhi-yun/templates/nuxt-template', 'zhouguangying', 'member', '2026-03-11 22:06:23'),
(1008, 'huizhi-yun/templates/nuxt-template', 'renjianwei', 'member', '2026-03-11 22:06:23'),
(1009, 'huizhi-yun/templates/nuxt-template', 'caoqian', 'member', '2026-03-11 22:06:23'),
(1010, 'huizhi-yun/account', 'zhouguangying', 'member', '2026-03-11 22:06:24'),
(1011, 'huizhi-yun/account', 'test', 'member', '2026-03-11 22:06:24'),
(1012, 'huizhi-yun/account', 'chenyiming', 'member', '2026-03-11 22:06:24'),
(1013, 'huizhi-yun/account', 'shiweijia', 'member', '2026-03-11 22:06:24'),
(1014, 'huizhi-yun/account', 'renjianwei', 'member', '2026-03-11 22:06:24'),
(1015, 'huizhi-yun/account', 'caoqian', 'member', '2026-03-11 22:06:24'),
(1016, 'huizhi-yun/codocs', 'zhouguangying', 'member', '2026-03-11 22:06:25'),
(1017, 'huizhi-yun/codocs', 'chenyiming', 'member', '2026-03-11 22:06:25'),
(1018, 'huizhi-yun/codocs', 'shiweijia', 'member', '2026-03-11 22:06:25'),
(1019, 'huizhi-yun/codocs', 'renjianwei', 'member', '2026-03-11 22:06:25'),
(1020, 'huizhi-yun/codocs', 'caoqian', 'member', '2026-03-11 22:06:25');

-- ============================================================
-- 消息发送记录表
-- ============================================================

DROP TABLE IF EXISTS message_logs;
CREATE TABLE message_logs (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    channel         VARCHAR(20) NOT NULL DEFAULT 'wecom' COMMENT '发送渠道：wecom/email/sms',
    msg_type        VARCHAR(20) NOT NULL COMMENT '消息类型：text/markdown/textcard/news/image/file',
    title           VARCHAR(200) COMMENT '消息标题',
    content         TEXT COMMENT '消息内容/描述',
    url             VARCHAR(500) COMMENT '跳转链接',
    touser          TEXT COMMENT '接收用户（uid 用 | 分隔）',
    toparty         VARCHAR(200) COMMENT '接收部门',
    totag           VARCHAR(200) COMMENT '接收标签',
    caller          VARCHAR(50) COMMENT '调用来源模块：codocs/aims/altoc',
    status          TINYINT NOT NULL DEFAULT 0 COMMENT '发送状态：0失败 1成功',
    msgid           VARCHAR(500) COMMENT '企业微信返回的 msgid',
    errcode         INT COMMENT '错误码',
    errmsg          VARCHAR(500) COMMENT '错误信息',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '发送时间',

    INDEX idx_channel (channel),
    INDEX idx_caller (caller),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='消息发送记录';

SET FOREIGN_KEY_CHECKS = 1;
