-- ============================================================
-- huizhi-yun Account 模块 SaaS 化改造迁移脚本
-- 版本: v1.0
-- 创建日期: 2026-03-25
-- 说明: 新增公司/平台用户/业务领域/区域表，现有表增加 company_code
-- 执行前请备份数据库！
-- ============================================================

USE hzy_account;

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- 第一部分：新建表
-- ============================================================

-- ------------------------------------------------------------
-- 1.1 公司表
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 1.2 平台注册用户表
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 1.3 业务领域字典表（系统预置，只读）
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 1.4 公司业务领域表
-- ------------------------------------------------------------
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

-- 行政区划数据由前端 npm 包 lcn 提供（离线内嵌，无需联网）
-- 数据库仅存储 6 位国标行政区划编码（division_code），展示名称由前端查询 lcn 获取

-- ------------------------------------------------------------
-- 1.5 公司自定义区域表
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 1.6 区域-行政区划映射表
-- ------------------------------------------------------------
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

-- ============================================================
-- 第二部分：现有表增加 company_code 字段
-- ============================================================

-- ------------------------------------------------------------
-- 2.1 system_users：增加 company_code + platform_user_id
-- ------------------------------------------------------------
ALTER TABLE system_users
    ADD COLUMN company_code VARCHAR(7) COMMENT '所属公司编码' AFTER id,
    ADD COLUMN platform_user_id BIGINT COMMENT '关联平台用户ID(非LDAP用户时使用)' AFTER company_code,
    ADD INDEX idx_su_company_code (company_code),
    ADD INDEX idx_su_platform_user_id (platform_user_id);

-- ------------------------------------------------------------
-- 2.2 departments：增加 company_code
-- ------------------------------------------------------------
ALTER TABLE departments
    ADD COLUMN company_code VARCHAR(7) COMMENT '所属公司编码' AFTER id,
    ADD INDEX idx_dept_company_code (company_code);

-- ------------------------------------------------------------
-- 2.3 roles：增加 company_code（NULL=系统角色，所有公司共享）
-- ------------------------------------------------------------
ALTER TABLE roles
    ADD COLUMN company_code VARCHAR(7) COMMENT '所属公司编码(NULL=系统内置角色)' AFTER id,
    ADD INDEX idx_role_company_code (company_code);

-- ------------------------------------------------------------
-- 2.4 applications：增加 company_code（NULL=平台级应用）
-- ------------------------------------------------------------
ALTER TABLE applications
    ADD COLUMN company_code VARCHAR(7) COMMENT '所属公司编码(NULL=平台级应用)' AFTER id,
    ADD INDEX idx_app_company_code (company_code);

-- ------------------------------------------------------------
-- 2.5 git_projects：增加 company_code
-- ------------------------------------------------------------
ALTER TABLE git_projects
    ADD COLUMN company_code VARCHAR(7) COMMENT '所属公司编码' AFTER id,
    ADD INDEX idx_proj_company_code (company_code);

-- ------------------------------------------------------------
-- 2.6 api_keys：增加 company_code
-- ------------------------------------------------------------
ALTER TABLE api_keys
    ADD COLUMN company_code VARCHAR(7) COMMENT '所属公司编码' AFTER id,
    ADD INDEX idx_ak_company_code (company_code);

-- ------------------------------------------------------------
-- 2.7 ai_providers：增加 company_code（NULL=平台默认配置）
-- ------------------------------------------------------------
ALTER TABLE ai_providers
    ADD COLUMN company_code VARCHAR(7) COMMENT '所属公司编码(NULL=平台默认)' AFTER id,
    ADD INDEX idx_aip_company_code (company_code);

-- ------------------------------------------------------------
-- 2.8 ai_quotas：增加 company_code
-- ------------------------------------------------------------
ALTER TABLE ai_quotas
    ADD COLUMN company_code VARCHAR(7) COMMENT '所属公司编码' AFTER id,
    ADD INDEX idx_aiq_company_code (company_code);

-- ============================================================
-- 第三部分：初始化默认公司并回填数据
-- ============================================================

-- 3.1 插入默认公司
INSERT INTO companies (company_code, company_name, short_name, status) VALUES
('C000001', '默认公司', '默认', 1);

-- 3.2 回填现有数据的 company_code
UPDATE system_users SET company_code = 'C000001' WHERE company_code IS NULL;
UPDATE departments SET company_code = 'C000001' WHERE company_code IS NULL;
UPDATE git_projects SET company_code = 'C000001' WHERE company_code IS NULL;
UPDATE api_keys SET company_code = 'C000001' WHERE company_code IS NULL;
UPDATE ai_quotas SET company_code = 'C000001' WHERE company_code IS NULL;
-- roles: 系统内置角色保持 NULL，非内置角色归默认公司
UPDATE roles SET company_code = 'C000001' WHERE is_system = 0 AND company_code IS NULL;
-- applications: 根据实际情况决定，这里暂不回填
-- ai_providers: 平台级保持 NULL

-- ============================================================
-- 第四部分：预置业务领域字典数据
-- ============================================================

-- 4.1 政务领域 (2G) 大类
INSERT INTO business_domains (domain_code, domain_name, category, parent_code, sort_order) VALUES
('GOV',     '政务领域',     '2G', NULL,  1);

-- 4.1.1 政务子领域
INSERT INTO business_domains (domain_code, domain_name, category, parent_code, sort_order) VALUES
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

-- 4.2 企业领域 (2B) 大类
INSERT INTO business_domains (domain_code, domain_name, category, parent_code, sort_order) VALUES
('BIZ',     '企业领域',     '2B', NULL,  2);

-- 4.2.1 企业子领域（GB/T 4754-2017 一级门类）
INSERT INTO business_domains (domain_code, domain_name, category, parent_code, sort_order) VALUES
('BIZ_A',   '农、林、牧、渔业',                     '2B', 'BIZ', 1),
('BIZ_B',   '采矿业',                               '2B', 'BIZ', 2),
('BIZ_C',   '制造业',                                '2B', 'BIZ', 3),
('BIZ_D',   '电力、热力、燃气及水生产和供应业',       '2B', 'BIZ', 4),
('BIZ_E',   '建筑业',                                '2B', 'BIZ', 5),
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

-- 4.3 个人领域 (2C) 大类
INSERT INTO business_domains (domain_code, domain_name, category, parent_code, sort_order) VALUES
('CON',     '个人领域',     '2C', NULL,  3);

-- 4.3.1 个人子领域
INSERT INTO business_domains (domain_code, domain_name, category, parent_code, sort_order) VALUES
('CON_EDU', '教育培训',     '2C', 'CON', 1),
('CON_HE',  '医疗健康',     '2C', 'CON', 2),
('CON_FI',  '个人金融',     '2C', 'CON', 3),
('CON_TR',  '出行旅游',     '2C', 'CON', 4),
('CON_EC',  '电子商务',     '2C', 'CON', 5),
('CON_EN',  '文化娱乐',     '2C', 'CON', 6),
('CON_LF',  '生活服务',     '2C', 'CON', 7),
('CON_SO',  '社交通讯',     '2C', 'CON', 8);

-- ============================================================
-- 第五部分：预置标准大区数据（7大地理分区）
-- ============================================================

-- 行政区划数据由前端 npm 包 lcn 提供（离线内嵌，无需联网）
-- 以下仅创建标准大区模板，供新公司初始化时复制

-- 标准大区模板表（系统级，非公司级）
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='区域模板表(系统预置，供公司初始化复制)';

-- 标准七大区模板
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

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 完成
-- 后续步骤：
-- 1. 前端安装 lcn 包：pnpm add lcn（行政区划数据）
-- 2. 为默认公司初始化标准大区（调用初始化接口或脚本）
-- ============================================================
