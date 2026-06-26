-- ============================================
-- Assets MVP - 联调种子数据
-- 用途:
-- 1. 覆盖工作台、资产、环境、交付、采购、入库、操作、预警、报表页面
-- 2. 对应 assets_schema.sql 的统一数据库结构
-- 3. 支持重复执行
-- ============================================

SET NAMES utf8mb4;

SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM `asset_events`;
DELETE FROM `asset_monthly_costs`;
DELETE FROM `asset_alerts`;
DELETE FROM `asset_assignments`;
DELETE FROM `asset_receipts`;
DELETE FROM `purchase_order_items`;
DELETE FROM `purchase_orders`;
DELETE FROM `asset_documents`;
DELETE FROM `asset_delivery_products`;
DELETE FROM `asset_category_items`;
DELETE FROM `asset_category_groups`;
DELETE FROM `ip_asset_products`;
DELETE FROM `ip_assets`;
DELETE FROM `digital_asset_products`;
DELETE FROM `digital_assets`;
DELETE FROM `product_asset_resources`;
DELETE FROM `product_asset_bases`;
DELETE FROM `technology_bases`;
DELETE FROM `product_assets`;
DELETE FROM `asset_delivery_environments`;
DELETE FROM `asset_delivery_views`;
DELETE FROM `asset_environment_assets`;
DELETE FROM `asset_resource_details`;
DELETE FROM `asset_physical_details`;
DELETE FROM `asset_items`;
DELETE FROM `asset_environments`;
DELETE FROM `suppliers`;
DELETE FROM `system_parameters`;

ALTER TABLE `system_parameters` AUTO_INCREMENT = 1;
ALTER TABLE `asset_category_groups` AUTO_INCREMENT = 1;
ALTER TABLE `asset_category_items` AUTO_INCREMENT = 1;
ALTER TABLE `suppliers` AUTO_INCREMENT = 1;
ALTER TABLE `asset_environments` AUTO_INCREMENT = 1;
ALTER TABLE `asset_items` AUTO_INCREMENT = 1;
ALTER TABLE `asset_delivery_views` AUTO_INCREMENT = 1;
ALTER TABLE `asset_documents` AUTO_INCREMENT = 1;
ALTER TABLE `asset_delivery_products` AUTO_INCREMENT = 1;
ALTER TABLE `ip_assets` AUTO_INCREMENT = 1;
ALTER TABLE `ip_asset_products` AUTO_INCREMENT = 1;
ALTER TABLE `digital_assets` AUTO_INCREMENT = 1;
ALTER TABLE `digital_asset_products` AUTO_INCREMENT = 1;
ALTER TABLE `product_assets` AUTO_INCREMENT = 1;
ALTER TABLE `technology_bases` AUTO_INCREMENT = 1;
ALTER TABLE `product_asset_bases` AUTO_INCREMENT = 1;
ALTER TABLE `product_asset_resources` AUTO_INCREMENT = 1;
ALTER TABLE `purchase_orders` AUTO_INCREMENT = 1;
ALTER TABLE `purchase_order_items` AUTO_INCREMENT = 1;
ALTER TABLE `asset_receipts` AUTO_INCREMENT = 1;
ALTER TABLE `asset_assignments` AUTO_INCREMENT = 1;
ALTER TABLE `asset_alerts` AUTO_INCREMENT = 1;
ALTER TABLE `asset_monthly_costs` AUTO_INCREMENT = 1;
ALTER TABLE `asset_events` AUTO_INCREMENT = 1;

SET FOREIGN_KEY_CHECKS = 1;

SET @current_month = STR_TO_DATE(DATE_FORMAT(CURDATE(), '%Y-%m-01'), '%Y-%m-%d');

INSERT INTO `system_parameters` (`id`, `param_key`, `param_value`, `description`) VALUES
  (1, 'seed.version', 'assets-mvp-v8', 'Assets MVP 联调种子版本'),
  (2, 'seed.operator_uid', 'U1001', '默认联调操作者');

INSERT INTO `asset_category_groups` (
  `id`, `category_scope`, `category_value`, `category_label`, `short_code`, `description`, `enabled`, `sort_order`, `created_by`, `updated_by`
) VALUES
  (1, 'physical', '办公设备', '办公设备', 'OFF', NULL, 1, 1, 'U1001', 'U1001'),
  (2, 'physical', '办公家具与设施', '办公家具与设施', 'FAC', NULL, 1, 2, 'U1001', 'U1001'),
  (3, 'physical', 'IT基础设施资产', 'IT基础设施资产', 'ITI', NULL, 1, 3, 'U1001', 'U1001'),
  (4, 'physical', '交通运输资产', '交通运输资产', 'TRN', NULL, 1, 4, 'U1001', 'U1001'),
  (5, 'physical', '其他专业资产', '其他专业资产', 'PRO', NULL, 1, 5, 'U1001', 'U1001'),
  (6, 'physical', '低值物资', '低值物资', 'CON', NULL, 1, 6, 'U1001', 'U1001'),
  (7, 'resource', '云主机', '云主机', 'ECS', NULL, 1, 1, 'U1001', 'U1001'),
  (8, 'resource', '数据库', '数据库', 'DB', NULL, 1, 2, 'U1001', 'U1001'),
  (9, 'resource', '容器集群', '容器集群', 'K8S', NULL, 1, 3, 'U1001', 'U1001'),
  (10, 'resource', 'SSL证书', 'SSL证书', 'SSL', NULL, 1, 4, 'U1001', 'U1001'),
  (11, 'resource', '模型额度', '模型额度', 'LLM', NULL, 1, 5, 'U1001', 'U1001'),
  (12, 'resource', 'SaaS订阅', 'SaaS订阅', 'SAAS', NULL, 1, 6, 'U1001', 'U1001'),
  (13, 'product', 'real_estate', '智慧房产', 'REA', NULL, 1, 1, 'U1001', 'U1001'),
  (14, 'product', 'registration', '不动产登记', 'REG', NULL, 1, 2, 'U1001', 'U1001'),
  (15, 'product', 'agriculture', '农业农村', 'AGR', NULL, 1, 3, 'U1001', 'U1001'),
  (16, 'product', 'platform', '平台产品', 'PLT', NULL, 1, 4, 'U1001', 'U1001'),
  (17, 'product', 'internal', '内部产品', 'INT', NULL, 1, 5, 'U1001', 'U1001'),
  (18, 'ip', 'software_copyright', '软件著作权', 'SWC', NULL, 1, 1, 'U1001', 'U1001'),
  (19, 'ip', 'trademark', '商标', 'TM', NULL, 1, 2, 'U1001', 'U1001'),
  (20, 'ip', 'patent', '专利', 'PAT', NULL, 1, 3, 'U1001', 'U1001'),
  (21, 'ip', 'copyright', '版权/著作权', 'CPY', NULL, 1, 4, 'U1001', 'U1001'),
  (22, 'ip', 'qualification', '资质证照', 'QLF', NULL, 1, 5, 'U1001', 'U1001'),
  (23, 'digital', 'code', '代码资产', 'CODE', NULL, 1, 1, 'U1001', 'U1001'),
  (24, 'digital', 'document', '文档资产', 'DOC', NULL, 1, 2, 'U1001', 'U1001'),
  (25, 'digital', 'data', '数据资产', 'DATA', NULL, 1, 3, 'U1001', 'U1001'),
  (26, 'digital', 'design', '设计资产', 'DSGN', NULL, 1, 4, 'U1001', 'U1001'),
  (27, 'digital', 'model', '模型资产', 'ML', NULL, 1, 5, 'U1001', 'U1001'),
  (28, 'digital', 'artifact', '交付物资产', 'ARTF', NULL, 1, 6, 'U1001', 'U1001');

INSERT INTO `asset_category_items` (
  `group_id`, `item_value`, `item_label`, `short_code`, `description`, `enabled`, `sort_order`, `created_by`, `updated_by`
) VALUES
  (1, '笔记本', '笔记本', 'LTP', NULL, 1, 1, 'U1001', 'U1001'),
  (1, '台式机', '台式机', 'DTP', NULL, 1, 2, 'U1001', 'U1001'),
  (1, '显示器', '显示器', 'MON', NULL, 1, 3, 'U1001', 'U1001'),
  (1, '手机', '手机', 'PHN', NULL, 1, 4, 'U1001', 'U1001'),
  (1, '平板', '平板', 'PAD', NULL, 1, 5, 'U1001', 'U1001'),
  (1, '投影机', '投影机', 'PJT', NULL, 1, 6, 'U1001', 'U1001'),
  (1, '打印机', '打印机', 'PRT', NULL, 1, 7, 'U1001', 'U1001'),
  (1, '复印机', '复印机', 'CPR', NULL, 1, 8, 'U1001', 'U1001'),
  (1, '打印复印一体机', '打印复印一体机', 'AIO', NULL, 1, 9, 'U1001', 'U1001'),
  (1, '扫描仪', '扫描仪', 'SCN', NULL, 1, 10, 'U1001', 'U1001'),
  (1, '专业测试机', '专业测试机', 'TST', NULL, 1, 11, 'U1001', 'U1001'),
  (1, '视频会议设备', '视频会议设备', 'VTC', NULL, 1, 12, 'U1001', 'U1001'),
  (1, '其他办公设备', '其他办公设备', 'OTH', NULL, 1, 13, 'U1001', 'U1001'),
  (2, '办公桌', '办公桌', 'DSK', NULL, 1, 1, 'U1001', 'U1001'),
  (2, '办公椅', '办公椅', 'CHR', NULL, 1, 2, 'U1001', 'U1001'),
  (2, '文件柜', '文件柜', 'CAB', NULL, 1, 3, 'U1001', 'U1001'),
  (2, '会议桌', '会议桌', 'MTB', NULL, 1, 4, 'U1001', 'U1001'),
  (2, '投影仪', '投影仪', 'PROJ', NULL, 1, 5, 'U1001', 'U1001'),
  (2, '打印机', '打印机', 'PRT', NULL, 1, 6, 'U1001', 'U1001'),
  (2, '空调', '空调', 'AIR', NULL, 1, 7, 'U1001', 'U1001'),
  (2, '饮水设备', '饮水设备', 'WTR', NULL, 1, 8, 'U1001', 'U1001'),
  (3, '服务器', '服务器', 'SRV', NULL, 1, 1, 'U1001', 'U1001'),
  (3, 'GPU 设备', 'GPU 设备', 'GPU', NULL, 1, 2, 'U1001', 'U1001'),
  (3, '机柜', '机柜', 'RCK', NULL, 1, 3, 'U1001', 'U1001'),
  (3, 'UPS', 'UPS', 'UPS', NULL, 1, 4, 'U1001', 'U1001'),
  (3, 'NAS', 'NAS', 'NAS', NULL, 1, 5, 'U1001', 'U1001'),
  (3, '交换机', '交换机', 'SWT', NULL, 1, 6, 'U1001', 'U1001'),
  (3, '路由器', '路由器', 'RTR', NULL, 1, 7, 'U1001', 'U1001'),
  (3, '防火墙', '防火墙', 'FWL', NULL, 1, 8, 'U1001', 'U1001'),
  (4, '公务车', '公务车', 'CAR', NULL, 1, 1, 'U1001', 'U1001'),
  (4, '交付服务车', '交付服务车', 'DLV', NULL, 1, 2, 'U1001', 'U1001'),
  (4, '运维巡检车', '运维巡检车', 'OPS', NULL, 1, 3, 'U1001', 'U1001'),
  (4, '电动车', '电动车', 'EBK', NULL, 1, 4, 'U1001', 'U1001'),
  (4, '叉车', '叉车', 'FLT', NULL, 1, 5, 'U1001', 'U1001'),
  (4, '搬运车', '搬运车', 'TRC', NULL, 1, 6, 'U1001', 'U1001'),
  (5, '行业专用设备', '行业专用设备', 'IND', NULL, 1, 1, 'U1001', 'U1001'),
  (5, '客户交付专用硬件', '客户交付专用硬件', 'CUS', NULL, 1, 2, 'U1001', 'U1001'),
  (5, 'IoT 终端', 'IoT 终端', 'IOT', NULL, 1, 3, 'U1001', 'U1001'),
  (5, '研发实验设备', '研发实验设备', 'LAB', NULL, 1, 4, 'U1001', 'U1001'),
  (5, '样机', '样机', 'SMP', NULL, 1, 5, 'U1001', 'U1001'),
  (6, '鼠标', '鼠标', 'MSE', NULL, 1, 1, 'U1001', 'U1001'),
  (6, '键盘', '键盘', 'KBD', NULL, 1, 2, 'U1001', 'U1001'),
  (6, '网线', '网线', 'CBL', NULL, 1, 3, 'U1001', 'U1001'),
  (6, '转接器', '转接器', 'ADP', NULL, 1, 4, 'U1001', 'U1001'),
  (6, '小型工具', '小型工具', 'TLS', NULL, 1, 5, 'U1001', 'U1001'),
  (6, '常用备件', '常用备件', 'SPT', NULL, 1, 6, 'U1001', 'U1001'),
  (6, '办公耗材', '办公耗材', 'SUP', NULL, 1, 7, 'U1001', 'U1001');

INSERT INTO `product_assets` (
  `id`, `product_code`, `product_name`, `product_line`, `customer_domain`, `business_domain`,
  `product_level`, `asset_level`, `status`, `summary`, `built_at`, `business_owner_uid`,
  `technical_owner_uid`, `project_code`, `notes`, `created_by`, `updated_by`
) VALUES
  (
    1, 'PROD-AIOPS', 'AI 运维平台', 'internal', 'internal', 'support',
    'star', 'A', 'iterating', '面向内部运维与交付团队的 AI 运维工作平台',
    DATE_SUB(CURDATE(), INTERVAL 220 DAY), 'U1002', 'U1003', 'internal/ai-ops',
    '承载模型额度、协作 Seat 与内网运维环境', 'U1001', 'U1001'
  ),
  (
    2, 'PROD-ALIGN', 'Align 企业智能助手', 'platform', 'business', 'external_service',
    'star', 'A', 'iterating', '面向政企客户的 Copilot 产品，覆盖问答、审计与组织协同',
    DATE_SUB(CURDATE(), INTERVAL 160 DAY), 'U1006', 'U1006', 'delivery/align-pilot',
    '当前以试点客户交付视图推进商业化验证', 'U1001', 'U1001'
  );

INSERT INTO `technology_bases` (
  `id`, `base_code`, `base_name`, `base_type`, `status`, `service_targets`,
  `owner_uid`, `technical_owner_uid`, `project_code`, `asset_level`, `notes`, `created_by`, `updated_by`
) VALUES
  (
    1, 'TB-AI-RUNTIME', 'AI 推理与额度运行底座', 'middle_platform', 'active',
    '为 AI 运维平台与 Align 提供模型调用、密钥治理和额度监控能力',
    'U1002', 'U1003', 'internal/ai-ops', 'A', '内部 AI 统一运行底座', 'U1001', 'U1001'
  ),
  (
    2, 'TB-DELIVERY-CONSOLE', '交付运维控制台', 'shared_module', 'active',
    '为客户环境、证书续费、交付验收与巡检提供统一控制能力',
    'U1001', 'U1005', 'delivery/hljt-crm', 'B', '服务交付与运维团队', 'U1001', 'U1001'
  );

INSERT INTO `ip_assets` (
  `id`, `ip_code`, `ip_name`, `ip_type`, `registration_no`, `right_holder`,
  `apply_date`, `effective_date`, `expires_at`, `status`, `owner_uid`, `notes`, `created_by`, `updated_by`
) VALUES
  (
    1, 'IP-SC-AIOPS-001', 'AI 运维平台软件著作权', 'software_copyright', '2026SR000001', '汇智云科技有限公司',
    DATE_SUB(CURDATE(), INTERVAL 240 DAY), DATE_SUB(CURDATE(), INTERVAL 210 DAY), NULL, 'active', 'U1002',
    '覆盖 AI 运维平台核心软件著作权登记', 'U1001', 'U1001'
  ),
  (
    2, 'IP-TM-ALIGN-001', 'Align 商标', 'trademark', 'TM2026ALIGN001', '汇智云科技有限公司',
    DATE_SUB(CURDATE(), INTERVAL 180 DAY), DATE_SUB(CURDATE(), INTERVAL 90 DAY), DATE_ADD(CURDATE(), INTERVAL 3650 DAY), 'active', 'U1006',
    'Align 产品品牌商标，需长期维护续展计划', 'U1001', 'U1001'
  ),
  (
    3, 'IP-QL-DELIVERY-001', '高新技术企业资质证照', 'qualification', 'CERT-HNTE-2026', '汇智云科技有限公司',
    DATE_SUB(CURDATE(), INTERVAL 400 DAY), DATE_SUB(CURDATE(), INTERVAL 365 DAY), DATE_ADD(CURDATE(), INTERVAL 60 DAY), 'active', 'U1001',
    '资质证照临近到期，后续可纳入到期预警', 'U1001', 'U1001'
  );

INSERT INTO `ip_asset_products` (
  `id`, `ip_asset_id`, `product_asset_id`, `created_by`
) VALUES
  (1, 1, 1, 'U1001'),
  (2, 2, 2, 'U1001');

INSERT INTO `suppliers` (
  `id`, `supplier_code`, `supplier_name`, `credit_code`, `supplier_type`,
  `contact_name`, `contact_phone`, `contact_email`, `invoice_info`,
  `status`, `notes`, `created_by`, `updated_by`
) VALUES
  (
    1, 'SUP-ALIYUN', '阿里云智能集团', '91330100ALIYUN001', 'cloud',
    '周云', '13800000001', 'cloud@aliyun.example', '增值税专票 / 月结',
    'active', '主要云资源供应商', 'U1001', 'U1001'
  ),
  (
    2, 'SUP-OPENAI', 'OpenAI Services', 'US-OPENAI-2026', 'ai',
    'Nora Chen', '13800000002', 'finance@openai.example', '信用卡自动扣费 / 月结',
    'active', 'AI 模型额度供应商', 'U1001', 'U1001'
  ),
  (
    3, 'SUP-LENOVO', '联想企业采购', '91110108LENOVO01', 'hardware',
    '李工', '13800000003', 'sales@lenovo.example', '设备采购 / 季结',
    'active', '办公设备与服务器供应商', 'U1001', 'U1001'
  );

INSERT INTO `asset_environments` (
  `id`, `environment_code`, `environment_name`, `environment_type`, `project_code`,
  `customer_code`, `contract_code`, `status`, `dept_code`, `owner_uid`,
  `maintainer_uid`, `topology_summary`, `notes`, `created_by`, `updated_by`
) VALUES
  (
    1, 'ENV-HLJT-PROD', '华联交通 CRM 生产环境', 'customer_prod', 'delivery/hljt-crm',
    'CUST-HLJT', 'CONT-HLJT-2026', 'active', 'DELIVERY', 'U1001',
    'U1005', '阿里云双可用区 ECS + RDS + SLB + 证书链路', '客户正式生产环境', 'U1001', 'U1001'
  ),
  (
    2, 'ENV-HLJT-UAT', '华联交通 CRM 验收环境', 'customer_test', 'delivery/hljt-crm',
    'CUST-HLJT', 'CONT-HLJT-2026', 'active', 'DELIVERY', 'U1001',
    'U1005', '与生产接近的 UAT 验收环境', '用于上线前验证与客户验收', 'U1001', 'U1001'
  ),
  (
    3, 'ENV-AIOPS-PROD', 'AI 运维内网生产环境', 'internal_prod', 'internal/ai-ops',
    NULL, NULL, 'active', 'RND', 'U1002',
    'U1003', '内网 GPU / 向量库 / Seat 与 API Key 管理环境', '内部 AI 运维平台', 'U1001', 'U1001'
  ),
  (
    4, 'ENV-ALIGN-PILOT', 'Align 试点客户环境', 'customer_prod', 'delivery/align-pilot',
    'CUST-WIZ', 'CONT-WIZ-2026', 'active', 'DELIVERY', 'U1006',
    'U1006', '试点客户专用环境，承载 AI 助手与审计链路', '用于首批客户试点', 'U1001', 'U1001'
  );

INSERT INTO `digital_assets` (
  `id`, `digital_code`, `digital_name`, `digital_type`, `storage_location`, `owner_uid`,
  `access_scope`, `project_code`, `environment_id`, `status`, `notes`, `created_by`, `updated_by`
) VALUES
  (
    1, 'DA-REPO-AIOPS-001', 'AI 运维平台主代码仓', 'code', 'git@gitlab.example.com:internal/ai-ops.git', 'U1003',
    'project', 'internal/ai-ops', 3, 'active', '内部 AI 运维平台核心代码仓库', 'U1001', 'U1001'
  ),
  (
    2, 'DA-DOC-ALIGN-001', 'Align 产品方案文档集', 'document', 'https://codocs.example.com/docs/align', 'U1006',
    'project', 'delivery/align-pilot', 4, 'active', '试点客户方案、设计与交付说明文档集合', 'U1001', 'U1001'
  ),
  (
    3, 'DA-ART-HLJT-001', '华联交通交付安装包', 'artifact', 'oss://delivery/hljt-crm/release-202603', 'U1005',
    'department', 'delivery/hljt-crm', 1, 'archived', '客户交付安装包与初始化脚本归档', 'U1001', 'U1001'
  );

INSERT INTO `digital_asset_products` (
  `id`, `digital_asset_id`, `product_asset_id`, `created_by`
) VALUES
  (1, 1, 1, 'U1001'),
  (2, 2, 2, 'U1001');

INSERT INTO `asset_items` (
  `id`, `public_id`, `asset_code`, `asset_name`, `asset_category`, `asset_subtype`, `asset_purpose`, `ownership_type`,
  `dept_code`, `project_code`, `customer_code`, `contract_code`, `environment_id`,
  `owner_uid`, `user_uid`, `custodian_uid`, `status`, `source_type`, `source_no`,
  `cost_bearer`, `finance_subject`, `sensitivity_level`, `is_external_exposed`,
  `is_key_business_asset`, `tags`, `notes`, `created_by`, `updated_by`
) VALUES
  (
    1, '8c486450-0d79-4c0d-85f5-59575e490001', 'PH-LT-001', '产品经理笔记本电脑', 'physical', '办公设备', 'self_use', 'internal',
    'RND', 'internal/ai-ops', NULL, NULL, 3,
    'U1002', 'U1004', 'U1003', 'in_use', 'purchase_order', 'PO-202603-001',
    'company', '固定资产', 'normal', 0,
    0, JSON_ARRAY('laptop', 'office'), '已发放给产品经理使用', 'U1001', 'U1001'
  ),
  (
    2, '8c486450-0d79-4c0d-85f5-59575e490002', 'PH-SRV-001', '华联交通交付服务器', 'physical', 'IT基础设施资产', 'project_procurement', 'customer_delivery',
    'DELIVERY', 'delivery/hljt-crm', 'CUST-HLJT', 'CONT-HLJT-2026', 1,
    'U1001', NULL, 'U1005', 'in_use', 'purchase_order', 'PO-202603-002',
    'customer', '交付硬件', 'important', 0,
    1, JSON_ARRAY('delivery', 'server'), '客户项目交付物理服务器', 'U1001', 'U1001'
  ),
  (
    3, '8c486450-0d79-4c0d-85f5-59575e490003', 'PH-NAS-001', '研发共享 NAS 存储', 'physical', 'IT基础设施资产', 'project_procurement', 'internal',
    'RND', 'internal/ai-ops', NULL, NULL, 3,
    'U1002', NULL, 'U1003', 'in_stock', 'purchase_order', 'PO-202603-001',
    'company', '固定资产', 'important', 0,
    1, JSON_ARRAY('nas', 'shared'), '用于研发共享交付包与备份', 'U1001', 'U1001'
  ),
  (
    4, '8c486450-0d79-4c0d-85f5-59575e490004', 'RS-ALI-ECS-001', '华联交通生产 ECS', 'resource', '云主机', 'project_procurement', 'customer_delivery',
    'DELIVERY', 'delivery/hljt-crm', 'CUST-HLJT', 'CONT-HLJT-2026', 1,
    'U1001', NULL, 'U1005', 'active', 'purchase_order', 'PO-202603-002',
    'customer', '云资源成本', 'important', 1,
    1, JSON_ARRAY('prod', 'ecs'), '生产核心计算资源', 'U1001', 'U1001'
  ),
  (
    5, '8c486450-0d79-4c0d-85f5-59575e490005', 'RS-ALI-RDS-001', '华联交通生产 RDS', 'resource', '数据库', 'project_procurement', 'customer_delivery',
    'DELIVERY', 'delivery/hljt-crm', 'CUST-HLJT', 'CONT-HLJT-2026', 1,
    'U1001', NULL, 'U1005', 'active', 'purchase_order', 'PO-202603-002',
    'customer', '云资源成本', 'critical', 0,
    1, JSON_ARRAY('prod', 'database'), '生产主数据库', 'U1001', 'U1001'
  ),
  (
    6, '8c486450-0d79-4c0d-85f5-59575e490006', 'RS-SSL-001', '华联交通 UAT 通配证书', 'resource', 'SSL证书', 'project_procurement', 'customer_delivery',
    'DELIVERY', 'delivery/hljt-crm', 'CUST-HLJT', 'CONT-HLJT-2026', 2,
    'U1001', NULL, 'U1005', 'active', 'manual', 'MANUAL-CERT-001',
    'customer', '证书费用', 'important', 1,
    1, JSON_ARRAY('cert', 'uat'), 'UAT 环境通配证书，临近到期', 'U1001', 'U1001'
  ),
  (
    7, '8c486450-0d79-4c0d-85f5-59575e490007', 'RS-OPENAI-001', 'AI 运维 OpenAI 额度池', 'resource', '模型额度', 'project_procurement', 'internal',
    'RND', 'internal/ai-ops', NULL, NULL, 3,
    'U1002', NULL, 'U1003', 'active', 'purchase_order', 'PO-202603-003',
    'company', 'AI 成本', 'sensitive', 1,
    1, JSON_ARRAY('ai', 'quota'), '内部 AI 运维平台的模型额度池', 'U1001', 'U1001'
  ),
  (
    8, '8c486450-0d79-4c0d-85f5-59575e490008', 'RS-FEISHU-001', '研发协作 Seat 池', 'resource', 'SaaS订阅', 'self_use', 'internal',
    'RND', 'internal/ai-ops', NULL, NULL, 3,
    'U1002', NULL, 'U1003', 'active', 'manual', 'SEAT-2026-001',
    'company', 'SaaS 订阅', 'normal', 0,
    0, JSON_ARRAY('seat', 'collaboration'), 'Seat 已接近超分配', 'U1001', 'U1001'
  ),
  (
    9, '8c486450-0d79-4c0d-85f5-59575e490009', 'RS-TKE-001', 'Align 试点容器集群', 'resource', '容器集群', 'project_procurement', 'customer_delivery',
    'DELIVERY', 'delivery/align-pilot', 'CUST-WIZ', 'CONT-WIZ-2026', 4,
    'U1006', NULL, 'U1006', 'active', 'manual', 'PILOT-CLUSTER-001',
    'customer', '云资源成本', 'important', 1,
    1, JSON_ARRAY('pilot', 'k8s'), '试点客户容器集群', 'U1001', 'U1001'
  );

INSERT INTO `asset_physical_details` (
  `asset_id`, `physical_type`, `brand`, `model`, `config_detail`, `serial_number`, `location`,
  `purchased_at`, `purchase_amount`, `expected_service_years`, `inventory_status`,
  `claim_status`, `qr_code`
) VALUES
  (
    1, '笔记本', 'Lenovo', 'ThinkPad X1 Carbon Gen 12', 'Ultra 7 / 32GB / 1TB SSD / 14英寸 / 含扩展坞', 'SN-LT-001',
    '深圳研发中心 7F', DATE_SUB(CURDATE(), INTERVAL 20 DAY), 12888.00, 4,
    'in_use', 'claimed', 'HZY-ASSET:8c486450-0d79-4c0d-85f5-59575e490001'
  ),
  (
    2, '服务器', 'Lenovo', 'SR650 V3', '双路至强 / 256GB / 4*3.84TB SSD / RAID 卡', 'SN-SRV-001',
    '华联交通机房 A 柜', DATE_SUB(CURDATE(), INTERVAL 12 DAY), 36800.00, 5,
    'in_use', 'claimed', 'HZY-ASSET:8c486450-0d79-4c0d-85f5-59575e490002'
  ),
  (
    3, 'NAS', 'Synology', 'RS3621RPxs', '12盘位 / 8TB 企业盘 * 6 / 双电源', 'SN-NAS-001',
    '深圳研发中心机柜 B-02', DATE_SUB(CURDATE(), INTERVAL 18 DAY), 14999.00, 5,
    'in_stock', 'unclaimed', 'HZY-ASSET:8c486450-0d79-4c0d-85f5-59575e490003'
  );

INSERT INTO `asset_resource_details` (
  `asset_id`, `resource_type`, `provider`, `instance_identifier`, `spec_summary`,
  `deployment_mode`, `billing_mode`, `billing_cycle`, `effective_at`, `expires_at`,
  `auto_renew`, `monthly_cost`, `usage_mode`, `purchased_quantity`, `assigned_quantity`,
  `available_quantity`, `tenant_account`, `credential_ciphertext`, `credential_masked`,
  `credential_updated_at`, `last_synced_at`
) VALUES
  (
    4, 'infrastructure', 'Alibaba Cloud', 'i-bp1ecs001', '4C8G / ESSD / 双可用区',
    'public_cloud', 'subscription', 'monthly', DATE_SUB(CURDATE(), INTERVAL 30 DAY),
    DATE_ADD(CURDATE(), INTERVAL 180 DAY), 1, 850.00, 'resource', 1, 1, 0,
    'aliyun-prod-hljt', NULL, 'AKIA****ECS', DATE_SUB(NOW(), INTERVAL 7 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)
  ),
  (
    5, 'platform', 'Alibaba Cloud', 'rm-bp1rds001', 'MySQL 8.0 / 高可用 / 200GB',
    'public_cloud', 'subscription', 'monthly', DATE_SUB(CURDATE(), INTERVAL 30 DAY),
    DATE_ADD(CURDATE(), INTERVAL 120 DAY), 1, 620.00, 'resource', 1, 1, 0,
    'aliyun-prod-hljt', NULL, 'MYSQL****RDS', DATE_SUB(NOW(), INTERVAL 10 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)
  ),
  (
    6, 'security_access', 'TrustAsia', 'cert-hljt-uat-001', '*.uat.hljt.example / RSA2048',
    'public_cloud', 'annual', 'yearly', DATE_SUB(CURDATE(), INTERVAL 350 DAY),
    DATE_ADD(CURDATE(), INTERVAL 15 DAY), 0, 80.00, 'key', 1, 1, 0,
    'trustasia-hljt', NULL, 'CERT****001', DATE_SUB(NOW(), INTERVAL 30 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)
  ),
  (
    7, 'ai', 'OpenAI', 'quota-openai-team-01', 'GPT-5 / Embeddings / 月度额度池',
    'public_cloud', 'usage', 'monthly', DATE_SUB(CURDATE(), INTERVAL 20 DAY),
    DATE_ADD(CURDATE(), INTERVAL 45 DAY), 1, 3600.00, 'quota', 1000000, 820000, 180000,
    'openai-rnd-team', NULL, 'sk-****team', DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)
  ),
  (
    8, 'subscription', 'Feishu', 'seat-feishu-rnd-01', '研发协作 Seat / Enterprise',
    'public_cloud', 'subscription', 'monthly', DATE_SUB(CURDATE(), INTERVAL 60 DAY),
    DATE_ADD(CURDATE(), INTERVAL 25 DAY), 1, 299.00, 'seat', 40, 38, 2,
    'feishu-rnd', NULL, 'seat-****-rnd', DATE_SUB(NOW(), INTERVAL 15 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)
  ),
  (
    9, 'infrastructure', 'Tencent Cloud', 'cls-align-001', 'TKE 集群 / 6 节点',
    'public_cloud', 'subscription', 'monthly', DATE_SUB(CURDATE(), INTERVAL 10 DAY),
    DATE_ADD(CURDATE(), INTERVAL 90 DAY), 1, 1200.00, 'resource', 1, 1, 0,
    'tencent-align', NULL, 'TKE****001', DATE_SUB(NOW(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)
  );

INSERT INTO `asset_environment_assets` (
  `id`, `environment_id`, `asset_id`, `relation_type`, `is_primary`, `created_by`
) VALUES
  (1, 1, 2, 'compute', 0, 'U1001'),
  (2, 1, 4, 'compute', 1, 'U1001'),
  (3, 1, 5, 'database', 0, 'U1001'),
  (4, 2, 6, 'domain_cert', 1, 'U1001'),
  (5, 3, 1, 'other', 0, 'U1001'),
  (6, 3, 3, 'delivery_artifact', 0, 'U1001'),
  (7, 3, 7, 'quota', 1, 'U1001'),
  (8, 3, 8, 'seat', 0, 'U1001'),
  (9, 4, 9, 'compute', 1, 'U1001');

INSERT INTO `product_asset_bases` (
  `id`, `product_asset_id`, `technology_base_id`, `created_by`
) VALUES
  (1, 1, 1, 'U1001'),
  (2, 1, 2, 'U1001'),
  (3, 2, 1, 'U1001');

INSERT INTO `product_asset_resources` (
  `id`, `product_asset_id`, `asset_id`, `relation_type`, `is_primary`, `created_by`
) VALUES
  (1, 1, 7, 'runtime', 1, 'U1001'),
  (2, 1, 8, 'support', 0, 'U1001'),
  (3, 2, 9, 'delivery', 1, 'U1001');

INSERT INTO `asset_delivery_views` (
  `id`, `delivery_code`, `delivery_name`, `customer_code`, `contract_code`,
  `project_code`, `status`, `owner_uid`, `go_live_at`, `accepted_at`,
  `notes`, `created_by`, `updated_by`
) VALUES
  (
    1, 'DLV-HLJT-CRM', '华联交通 CRM 交付视图', 'CUST-HLJT', 'CONT-HLJT-2026',
    'delivery/hljt-crm', 'delivering', 'U1001', DATE_ADD(CURDATE(), INTERVAL 7 DAY), NULL,
    '当前处于上线准备阶段', 'U1001', 'U1001'
  ),
  (
    2, 'DLV-ALIGN-PILOT', 'Align 试点客户交付视图', 'CUST-WIZ', 'CONT-WIZ-2026',
    'delivery/align-pilot', 'online', 'U1006', DATE_SUB(CURDATE(), INTERVAL 20 DAY), DATE_SUB(CURDATE(), INTERVAL 5 DAY),
    '试点客户已验收并在线运行', 'U1001', 'U1001'
  );

INSERT INTO `asset_delivery_environments` (
  `id`, `delivery_view_id`, `environment_id`, `relation_type`
) VALUES
  (1, 1, 1, 'primary'),
  (2, 1, 2, 'test'),
  (3, 2, 4, 'primary');

INSERT INTO `asset_delivery_products` (
  `id`, `delivery_view_id`, `product_asset_id`, `relation_type`, `created_by`
) VALUES
  (1, 1, 1, 'supporting_product', 'U1001'),
  (2, 2, 2, 'delivered_product', 'U1001');

INSERT INTO `asset_documents` (
  `id`, `object_type`, `object_id`, `document_id`, `document_type`, `remark`, `linked_by`
) VALUES
  (1, 'asset', 2, 'DOC-ASSET-SRV-001', 'delivery', '交付服务器安装与验收说明', 'U1001'),
  (2, 'asset', 6, 'DOC-CERT-RENEW-001', 'ops', '证书续费与更换 SOP', 'U1001'),
  (3, 'purchase_order', 1, 'DOC-PO-001', 'attachment', '采购审批附件', 'U1002'),
  (4, 'product_asset', 1, 'DOC-PROD-AIOPS-001', 'design', 'AI 运维平台总体设计', 'U1001'),
  (5, 'technology_base', 1, 'DOC-TB-AI-001', 'api', 'AI 推理底座接入说明', 'U1001'),
  (6, 'product_asset', 2, 'DOC-PROD-ALIGN-001', 'requirement', 'Align 产品需求总览', 'U1001'),
  (7, 'ip_asset', 1, 'DOC-IP-AIOPS-001', 'attachment', 'AI 运维平台软著登记材料', 'U1001'),
  (8, 'digital_asset', 1, 'DOC-DA-AIOPS-001', 'api', 'AI 运维平台仓库接入说明', 'U1001');

INSERT INTO `purchase_orders` (
  `id`, `order_no`, `purchase_type`, `purpose_type`, `applicant_uid`, `applicant_dept_code`,
  `project_code`, `customer_code`, `contract_code`, `environment_id`, `supplier_id`,
  `budget_amount`, `actual_amount`, `status`, `workflow_instance_id`, `reason`, `attachments`
) VALUES
  (
    1, 'PO-202603-001', 'physical', 'project_procurement', 'U1002', 'RND',
    'internal/ai-ops', NULL, NULL, 3, 3,
    30000.00, 27887.00, 'received', 'WF-PO-202603-001', '为 AI 运维平台采购办公与存储设备',
    JSON_ARRAY(JSON_OBJECT('name', '比价单.pdf', 'url', '/mock/po/001/quote.pdf'))
  ),
  (
    2, 'PO-202603-002', 'resource', 'project_procurement', 'U1001', 'DELIVERY',
    'delivery/hljt-crm', 'CUST-HLJT', 'CONT-HLJT-2026', 1, 1,
    1500.00, 1470.00, 'approved', 'WF-PO-202603-002', '华联交通生产环境云资源与数据库续费',
    JSON_ARRAY(JSON_OBJECT('name', '客户确认单.pdf', 'url', '/mock/po/002/customer-confirm.pdf'))
  ),
  (
    3, 'PO-202603-003', 'resource', 'project_procurement', 'U1002', 'RND',
    'internal/ai-ops', NULL, NULL, 3, 2,
    5000.00, NULL, 'pending_approval', 'WF-PO-202603-003', '补充内部 AI 平台模型额度',
    JSON_ARRAY(JSON_OBJECT('name', '额度申请说明.md', 'url', '/mock/po/003/request.md'))
  );

INSERT INTO `purchase_order_items` (
  `id`, `purchase_order_id`, `line_no`, `asset_category`, `asset_subtype`, `item_name`,
  `specification`, `quantity`, `unit`, `unit_price`, `total_price`, `effective_at`,
  `expires_at`, `target_type`, `target_ref`, `remark`
) VALUES
  (
    1, 1, 1, 'physical', '办公设备', 'ThinkPad X1 Carbon',
    '32GB / 1TB / 14英寸', 1, '台', 12888.00, 12888.00, NULL,
    NULL, 'user', 'U1004', '发放给产品经理'
  ),
  (
    2, 1, 2, 'physical', 'IT基础设施资产', 'Synology RS3621RPxs',
    '12盘位 / 8TB 企业盘', 1, '台', 14999.00, 14999.00, NULL,
    NULL, 'system', 'ENV-AIOPS-PROD', '共享交付物存储'
  ),
  (
    3, 2, 1, 'resource', '云主机', '生产 ECS 续费',
    '4C8G / 1个月', 1, '份', 850.00, 850.00, CURDATE(),
    DATE_ADD(CURDATE(), INTERVAL 30 DAY), 'environment', 'ENV-HLJT-PROD', '客户生产环境'
  ),
  (
    4, 2, 2, 'resource', '数据库', '生产 RDS 续费',
    'MySQL 高可用 / 1个月', 1, '份', 620.00, 620.00, CURDATE(),
    DATE_ADD(CURDATE(), INTERVAL 30 DAY), 'environment', 'ENV-HLJT-PROD', '客户生产数据库'
  ),
  (
    5, 3, 1, 'resource', '模型额度', 'OpenAI 月度额度包',
    '100万 Tokens / 批量采购', 1, '份', 5000.00, 5000.00, CURDATE(),
    DATE_ADD(CURDATE(), INTERVAL 30 DAY), 'project', 'internal/ai-ops', '内部 AI 平台'
  );

INSERT INTO `asset_receipts` (
  `id`, `receipt_no`, `purchase_order_id`, `receipt_type`, `status`,
  `operator_uid`, `processed_at`, `note`
) VALUES
  (
    1, 'RC-202603-001', 1, 'physical_stock_in', 'processed',
    'U1003', DATE_SUB(NOW(), INTERVAL 5 DAY), '设备已入库并完成编号粘贴'
  ),
  (
    2, 'RC-202603-002', 2, 'resource_activation', 'draft',
    'U1001', NULL, '等待客户最终确认后正式激活'
  );

INSERT INTO `asset_assignments` (
  `id`, `assignment_no`, `asset_id`, `action_type`, `source_type`, `source_ref`,
  `target_type`, `target_ref`, `quantity`, `status`, `workflow_instance_id`,
  `requested_by`, `approved_by`, `effective_at`, `ended_at`, `note`
) VALUES
  (
    1, 'OP-202603-001', 1, 'assign', 'stock', 'WAREHOUSE-SZ',
    'user', 'U1004', 1, 'active', 'WF-ASSIGN-001',
    'U1002', 'U1003', DATE_SUB(NOW(), INTERVAL 4 DAY), NULL, '产品经理设备发放'
  ),
  (
    2, 'OP-202603-002', 6, 'renew', 'vendor', 'TrustAsia',
    'environment', 'ENV-HLJT-UAT', 1, 'pending', 'WF-RENEW-SSL-001',
    'U1001', NULL, DATE_ADD(NOW(), INTERVAL 2 DAY), NULL, '证书临近到期，待续费'
  ),
  (
    3, 'OP-202603-003', 7, 'rotate_secret', 'system', 'OPENAI',
    'system', 'AIOPS', 1, 'completed', NULL,
    'U1002', 'U1003', DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY), '已完成密钥轮换'
  );

INSERT INTO `asset_alerts` (
  `id`, `alert_no`, `alert_type`, `severity`, `asset_id`, `environment_id`,
  `delivery_view_id`, `project_code`, `status`, `title`, `description`,
  `triggered_at`, `due_at`, `next_remind_at`, `handled_by`, `handled_at`, `resolution`
) VALUES
  (
    1, 'ALT-202603-001', 'resource_expiring', 'high', 6, 2,
    1, 'delivery/hljt-crm', 'pending', '华联交通 UAT 证书 15 天后到期',
    'UAT 域名证书未开启自动续费，需要在正式上线前完成更换',
    DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_ADD(NOW(), INTERVAL 10 DAY), DATE_ADD(NOW(), INTERVAL 1 DAY),
    NULL, NULL, NULL
  ),
  (
    2, 'ALT-202603-002', 'seat_over_allocated', 'medium', 8, 3,
    NULL, 'internal/ai-ops', 'acknowledged', '研发协作 Seat 池余量不足',
    '当前 Seat 仅剩 2 个，需提前扩容或清理离职账号',
    DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_ADD(NOW(), INTERVAL 7 DAY), DATE_ADD(NOW(), INTERVAL 2 DAY),
    'U1003', DATE_SUB(NOW(), INTERVAL 12 HOUR), '已安排本周盘点账号'
  ),
  (
    3, 'ALT-202603-003', 'ai_quota_low', 'critical', 7, 3,
    NULL, 'internal/ai-ops', 'pending', 'OpenAI 额度池低于安全阈值',
    '按最近 7 日消耗趋势，5 天内可能触发额度不足',
    DATE_SUB(NOW(), INTERVAL 6 HOUR), DATE_ADD(NOW(), INTERVAL 3 DAY), DATE_ADD(NOW(), INTERVAL 12 HOUR),
    NULL, NULL, NULL
  ),
  (
    4, 'ALT-202603-004', 'physical_overdue', 'low', 1, 3,
    NULL, 'internal/ai-ops', 'resolved', '产品经理笔记本未完成盘点确认',
    '上周盘点已补录，预警可关闭',
    DATE_SUB(NOW(), INTERVAL 8 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY), NULL,
    'U1003', DATE_SUB(NOW(), INTERVAL 2 DAY), '已补录盘点结果'
  );

INSERT INTO `asset_monthly_costs` (
  `id`, `asset_id`, `cost_month`, `amount`, `cost_source`, `project_code`,
  `customer_code`, `contract_code`, `environment_id`, `remark`
) VALUES
  (
    1, 4, @current_month, 850.00, 'manual', 'delivery/hljt-crm',
    'CUST-HLJT', 'CONT-HLJT-2026', 1, 'ECS 月度成本'
  ),
  (
    2, 5, @current_month, 620.00, 'manual', 'delivery/hljt-crm',
    'CUST-HLJT', 'CONT-HLJT-2026', 1, 'RDS 月度成本'
  ),
  (
    3, 6, @current_month, 80.00, 'manual', 'delivery/hljt-crm',
    'CUST-HLJT', 'CONT-HLJT-2026', 2, '证书摊销成本'
  ),
  (
    4, 7, @current_month, 3600.00, 'manual', 'internal/ai-ops',
    NULL, NULL, 3, 'OpenAI 模型额度成本'
  ),
  (
    5, 8, @current_month, 299.00, 'manual', 'internal/ai-ops',
    NULL, NULL, 3, 'Seat 月度成本'
  ),
  (
    6, 9, @current_month, 1200.00, 'manual', 'delivery/align-pilot',
    'CUST-WIZ', 'CONT-WIZ-2026', 4, '试点容器集群月度成本'
  );

INSERT INTO `asset_events` (
  `id`, `object_type`, `object_id`, `event_type`, `event_data`, `operator_uid`, `occurred_at`
) VALUES
  (1, 'asset', 1, 'created', JSON_OBJECT('summary', '资产已创建'), 'U1001', DATE_SUB(NOW(), INTERVAL 20 DAY)),
  (2, 'asset', 1, 'assigned', JSON_OBJECT('summary', '已分配给 U1004'), 'U1003', DATE_SUB(NOW(), INTERVAL 4 DAY)),
  (3, 'asset', 2, 'created', JSON_OBJECT('summary', '交付服务器已登记'), 'U1001', DATE_SUB(NOW(), INTERVAL 12 DAY)),
  (4, 'asset', 2, 'environment_bound', JSON_OBJECT('summary', '已绑定到生产环境'), 'U1001', DATE_SUB(NOW(), INTERVAL 11 DAY)),
  (5, 'asset', 6, 'renew_pending', JSON_OBJECT('summary', '证书续费流程已发起'), 'U1001', DATE_SUB(NOW(), INTERVAL 2 DAY)),
  (6, 'asset', 7, 'quota_warning', JSON_OBJECT('summary', 'AI 额度使用接近阈值'), 'U1002', DATE_SUB(NOW(), INTERVAL 6 HOUR)),
  (7, 'environment', 1, 'created', JSON_OBJECT('summary', '生产环境已创建'), 'U1001', DATE_SUB(NOW(), INTERVAL 30 DAY)),
  (8, 'environment', 3, 'asset_bound', JSON_OBJECT('summary', 'AI 额度池已绑定环境'), 'U1001', DATE_SUB(NOW(), INTERVAL 20 DAY)),
  (9, 'delivery_view', 1, 'created', JSON_OBJECT('summary', '交付视图已创建'), 'U1001', DATE_SUB(NOW(), INTERVAL 15 DAY)),
  (10, 'purchase_order', 1, 'created', JSON_OBJECT('summary', '采购单已创建'), 'U1002', DATE_SUB(NOW(), INTERVAL 7 DAY)),
  (11, 'purchase_order', 1, 'receipt_created', JSON_OBJECT('summary', '入库记录已创建'), 'U1003', DATE_SUB(NOW(), INTERVAL 5 DAY)),
  (12, 'assignment', 1, 'assign', JSON_OBJECT('summary', '设备发放已生效'), 'U1003', DATE_SUB(NOW(), INTERVAL 4 DAY)),
  (13, 'alert', 1, 'triggered', JSON_OBJECT('summary', '证书到期预警触发'), 'system', DATE_SUB(NOW(), INTERVAL 2 DAY)),
  (14, 'supplier', 1, 'created', JSON_OBJECT('summary', '供应商台账已建立'), 'U1001', DATE_SUB(NOW(), INTERVAL 40 DAY)),
  (15, 'product_asset', 1, 'created', JSON_OBJECT('summary', 'AI 运维平台产品主档已建立'), 'U1001', DATE_SUB(NOW(), INTERVAL 220 DAY)),
  (16, 'product_asset', 1, 'asset_bound', JSON_OBJECT('summary', '已关联 OpenAI 额度池'), 'U1001', DATE_SUB(NOW(), INTERVAL 20 DAY)),
  (17, 'technology_base', 1, 'created', JSON_OBJECT('summary', 'AI 推理与额度运行底座已建立'), 'U1001', DATE_SUB(NOW(), INTERVAL 210 DAY)),
  (18, 'ip_asset', 1, 'created', JSON_OBJECT('summary', 'AI 运维平台软著已登记'), 'U1001', DATE_SUB(NOW(), INTERVAL 210 DAY)),
  (19, 'ip_asset', 3, 'expiry_notice', JSON_OBJECT('summary', '高新资质 60 天后到期'), 'system', DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (20, 'digital_asset', 1, 'created', JSON_OBJECT('summary', 'AI 运维平台代码仓已登记'), 'U1001', DATE_SUB(NOW(), INTERVAL 200 DAY)),
  (21, 'digital_asset', 3, 'archived', JSON_OBJECT('summary', '华联交通交付安装包已归档'), 'U1005', DATE_SUB(NOW(), INTERVAL 10 DAY));
