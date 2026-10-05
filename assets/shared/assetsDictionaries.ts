export interface AssetDictionaryOption {
  label: string
  value: string
  description?: string
  enabled?: boolean
  sortOrder?: number
}

export interface AssetDictionaryDefinition {
  code: string
  name: string
  description: string
  options: AssetDictionaryOption[]
}

export const assetDictionaryDefinitions: AssetDictionaryDefinition[] = [
  {
    code: 'asset_resource_subtype',
    name: '资源资产子类',
    description: '资源资产录入时可选的子类',
    options: [
      { label: '云主机', value: '云主机', sortOrder: 1 },
      { label: '数据库', value: '数据库', sortOrder: 2 },
      { label: '容器集群', value: '容器集群', sortOrder: 3 },
      { label: 'SSL证书', value: 'SSL证书', sortOrder: 4 },
      { label: '模型额度', value: '模型额度', sortOrder: 5 },
      { label: 'SaaS订阅', value: 'SaaS订阅', sortOrder: 6 }
    ]
  },
  {
    code: 'asset_status_physical',
    name: '实物资产状态',
    description: '实物资产主状态',
    options: [
      { label: '待入库', value: 'pending_stock_in', sortOrder: 1 },
      { label: '库存中', value: 'in_stock', sortOrder: 2 },
      { label: '使用中', value: 'in_use', sortOrder: 3 },
      { label: '闲置', value: 'idle', sortOrder: 4 },
      { label: '维修中', value: 'repairing', sortOrder: 5 },
      { label: '已报废', value: 'scrapped', sortOrder: 6 }
    ]
  },
  {
    code: 'asset_status_resource',
    name: '资源资产状态',
    description: '资源资产主状态',
    options: [
      { label: '有效', value: 'active', sortOrder: 1 },
      { label: '待开通', value: 'pending', sortOrder: 2 },
      { label: '已停用', value: 'inactive', sortOrder: 3 },
      { label: '已过期', value: 'expired', sortOrder: 4 }
    ]
  },
  {
    code: 'asset_purpose',
    name: '资产归因目的',
    description: '资产建账后的当前归因口径',
    options: [
      { label: '自用', value: 'self_use', sortOrder: 1 },
      { label: '项目采购', value: 'project_procurement', sortOrder: 2 },
      { label: '销售备货', value: 'sales_stock', sortOrder: 3 }
    ]
  },
  {
    code: 'resource_type',
    name: '资源类型',
    description: '资源资产的资源类型',
    options: [
      { label: '基础设施', value: 'infrastructure', sortOrder: 1 },
      { label: '平台服务', value: 'platform', sortOrder: 2 },
      { label: '订阅服务', value: 'subscription', sortOrder: 3 },
      { label: '配额/API', value: 'quota_api', sortOrder: 4 },
      { label: 'AI 资源', value: 'ai', sortOrder: 5 },
      { label: '安全接入', value: 'security_access', sortOrder: 6 }
    ]
  },
  {
    code: 'environment_type',
    name: '环境类型',
    description: '环境视图的环境类型',
    options: [
      { label: '开发环境', value: 'dev', sortOrder: 1 },
      { label: '测试环境', value: 'test', sortOrder: 2 },
      { label: '预发布环境', value: 'staging', sortOrder: 3 },
      { label: '内部生产', value: 'internal_prod', sortOrder: 4 },
      { label: '客户测试', value: 'customer_test', sortOrder: 5 },
      { label: '客户生产', value: 'customer_prod', sortOrder: 6 }
    ]
  },
  {
    code: 'environment_status',
    name: '环境状态',
    description: '环境视图状态',
    options: [
      { label: '规划中', value: 'planning', sortOrder: 1 },
      { label: '运行中', value: 'active', sortOrder: 2 },
      { label: '冻结', value: 'frozen', sortOrder: 3 },
      { label: '已退役', value: 'retired', sortOrder: 4 }
    ]
  },
  {
    code: 'product_line',
    name: '产品线',
    description: '产品资产所属产品线',
    options: [
      { label: '智慧房产 FC', value: 'FC', sortOrder: 1 },
      { label: '不动产登记 BDC', value: 'BDC', sortOrder: 2 },
      { label: '通用领域 TY', value: 'TY', sortOrder: 3 },
      { label: '特定领域 JD', value: 'JD', sortOrder: 4 },
      { label: '农业农村 NY', value: 'NY', sortOrder: 5 },
      { label: '公证处 GZ', value: 'GZ', sortOrder: 6 }
    ]
  },
  {
    code: 'customer_domain',
    name: '业务域',
    description: '产品面向的业务域，可多选',
    options: [
      { label: 'G 端', value: 'G', sortOrder: 1 },
      { label: 'B 端', value: 'B', sortOrder: 2 },
      { label: 'C 端', value: 'C', sortOrder: 3 }
    ]
  },
  {
    code: 'business_domain',
    name: '业务域分类',
    description: '产品资产所属业务域分类',
    options: [
      { label: '交易监管 JY', value: 'JY', sortOrder: 1 },
      { label: '登记服务 DJ', value: 'DJ', sortOrder: 2 },
      { label: '物业管理 WY', value: 'WY', sortOrder: 3 },
      { label: '住房保障 BZ', value: 'BZ', sortOrder: 4 },
      { label: '资金监管 ZJ', value: 'ZJ', sortOrder: 5 },
      { label: '分析决策 FX', value: 'FX', sortOrder: 6 },
      { label: '基础支撑 JC', value: 'JC', sortOrder: 7 },
      { label: '共享服务 GX', value: 'GX', sortOrder: 8 },
      { label: '待分类', value: 'pending', sortOrder: 99 }
    ]
  },
  {
    code: 'product_level',
    name: '产品投资策略',
    description: '产品后续资源投入、经营和退出策略',
    options: [
      { label: '重点投入', value: 'focus_invest', sortOrder: 1 },
      { label: '持续经营', value: 'continue_operate', sortOrder: 2 },
      { label: '控制维护', value: 'control_maintain', sortOrder: 3 },
      { label: '有序退出', value: 'orderly_exit', sortOrder: 4 },
      { label: '待评估', value: 'pending_eval', sortOrder: 99 }
    ]
  },
  {
    code: 'product_asset_value_type',
    name: '产品资产价值类型',
    description: '产品资产现状价值类型，写入 product_assets.asset_level 字段',
    options: [
      { label: '核心资产', value: 'core_asset', sortOrder: 1 },
      { label: '经营资产', value: 'operating_asset', sortOrder: 2 },
      { label: '沉淀资产', value: 'deposited_asset', sortOrder: 3 },
      { label: '待评估', value: 'pending_eval', sortOrder: 99 }
    ]
  },
  {
    code: 'asset_level',
    name: '资产分级',
    description: '产品或技术底座的资产重要度分级',
    options: [
      { label: 'A 级', value: 'A', sortOrder: 1 },
      { label: 'B 级', value: 'B', sortOrder: 2 },
      { label: 'C 级', value: 'C', sortOrder: 3 },
      { label: 'D 级', value: 'D', sortOrder: 4 }
    ]
  },
  {
    code: 'product_status',
    name: '产品生命周期状态',
    description: '产品主档生命周期状态',
    options: [
      { label: '规划POC', value: 'poc', sortOrder: 1 },
      { label: '核心MVP', value: 'mvp', sortOrder: 2 },
      { label: '商用MMP', value: 'mmp', sortOrder: 3 },
      { label: '市场PMF', value: 'pmf', sortOrder: 4 },
      { label: '退市EOL', value: 'eol', sortOrder: 5 }
    ]
  },
  {
    code: 'build_stage',
    name: '建设阶段',
    description: '产品建设交付阶段',
    options: [
      { label: '规划', value: 'planned', sortOrder: 1 },
      { label: '在建', value: 'building', sortOrder: 2 },
      { label: '已建', value: 'built', sortOrder: 3 }
    ]
  },
  {
    code: 'productization_value_level',
    name: '产品化价值等级',
    description: '产品标准化、复用和规模推广价值等级',
    options: [
      { label: '高', value: 'high', sortOrder: 1 },
      { label: '中', value: 'medium', sortOrder: 2 },
      { label: '低', value: 'low', sortOrder: 3 }
    ]
  },
  {
    code: 'supported_terminal',
    name: '支持终端',
    description: '产品支持的终端或交付形态',
    options: [
      { label: 'WEB', value: 'web', sortOrder: 1 },
      { label: '小程序', value: 'mini_program', sortOrder: 2 },
      { label: 'APP', value: 'app', sortOrder: 3 },
      { label: '爱山东 APP', value: 'shandong_app', sortOrder: 4 },
      { label: '自助终端', value: 'kiosk', sortOrder: 5 },
      { label: '单机版', value: 'standalone', sortOrder: 6 },
      { label: '接口服务', value: 'api_service', sortOrder: 7 },
      { label: '数据及接口服务', value: 'data_interface', sortOrder: 8 },
      { label: '工位一体机', value: 'workstation_terminal', sortOrder: 9 },
      { label: 'PAD', value: 'pad', sortOrder: 10 }
    ]
  },
  {
    code: 'technology_base_type',
    name: '技术底座类型',
    description: '技术底座分类',
    options: [
      { label: '基础平台', value: 'platform', sortOrder: 1 },
      { label: '中台能力', value: 'middle_platform', sortOrder: 2 },
      { label: '共用模块', value: 'shared_module', sortOrder: 3 },
      { label: '工具模块', value: 'tool_module', sortOrder: 4 },
      { label: '公共服务', value: 'public_service', sortOrder: 5 }
    ]
  },
  {
    code: 'technology_base_status',
    name: '技术底座状态',
    description: '技术底座当前状态',
    options: [
      { label: '规划中', value: 'planning', sortOrder: 1 },
      { label: '在用', value: 'active', sortOrder: 2 },
      { label: '维护中', value: 'maintenance', sortOrder: 3 },
      { label: '待替换', value: 'replacement_pending', sortOrder: 4 },
      { label: '待下线', value: 'retire_pending', sortOrder: 5 }
    ]
  },
  {
    code: 'ip_asset_type',
    name: '知识产权类型',
    description: '知识产权资产分类',
    options: [
      { label: '软件著作权', value: 'software_copyright', sortOrder: 1 },
      { label: '商标', value: 'trademark', sortOrder: 2 },
      { label: '专利', value: 'patent', sortOrder: 3 },
      { label: '版权/著作权', value: 'copyright', sortOrder: 4 },
      { label: '资质证照', value: 'qualification', sortOrder: 5 }
    ]
  },
  {
    code: 'ip_asset_status',
    name: '知识产权状态',
    description: '知识产权资产当前状态',
    options: [
      { label: '有效', value: 'active', sortOrder: 1 },
      { label: '申请中', value: 'applying', sortOrder: 2 },
      { label: '已过期', value: 'expired', sortOrder: 3 },
      { label: '已放弃', value: 'abandoned', sortOrder: 4 }
    ]
  },
  {
    code: 'digital_asset_type',
    name: '数字资产类型',
    description: '数字资产子类',
    options: [
      { label: '代码资产', value: 'code', sortOrder: 1 },
      { label: '文档资产', value: 'document', sortOrder: 2 },
      { label: '数据资产', value: 'data', sortOrder: 3 },
      { label: '设计资产', value: 'design', sortOrder: 4 },
      { label: '模型资产', value: 'model', sortOrder: 5 },
      { label: '交付物资产', value: 'artifact', sortOrder: 6 }
    ]
  },
  {
    code: 'digital_asset_status',
    name: '数字资产状态',
    description: '数字资产当前状态',
    options: [
      { label: '活跃', value: 'active', sortOrder: 1 },
      { label: '已归档', value: 'archived', sortOrder: 2 },
      { label: '已废弃', value: 'deprecated', sortOrder: 3 }
    ]
  },
  {
    code: 'digital_access_scope',
    name: '数字资产访问权限',
    description: '数字资产访问范围',
    options: [
      { label: '公开', value: 'public', sortOrder: 1 },
      { label: '部门', value: 'department', sortOrder: 2 },
      { label: '项目', value: 'project', sortOrder: 3 },
      { label: '私有', value: 'private', sortOrder: 4 }
    ]
  },
  {
    code: 'delivery_status',
    name: '交付状态',
    description: '客户交付视图状态',
    options: [
      { label: '准备中', value: 'preparing', sortOrder: 1 },
      { label: '交付中', value: 'delivering', sortOrder: 2 },
      { label: '已上线', value: 'online', sortOrder: 3 },
      { label: '已验收', value: 'accepted', sortOrder: 4 },
      { label: '已终止', value: 'terminated', sortOrder: 5 }
    ]
  },
  {
    code: 'supplier_type',
    name: '供应商类型',
    description: '供应商基础类型',
    options: [
      { label: '硬件', value: 'hardware', sortOrder: 1 },
      { label: '软件', value: 'software', sortOrder: 2 },
      { label: '云服务', value: 'cloud', sortOrder: 3 },
      { label: 'AI 服务', value: 'ai', sortOrder: 4 },
      { label: '安全服务', value: 'security', sortOrder: 5 },
      { label: '通用服务', value: 'service', sortOrder: 6 },
      { label: '其他', value: 'other', sortOrder: 7 }
    ]
  },
  {
    code: 'supplier_status',
    name: '供应商状态',
    description: '供应商启用状态',
    options: [
      { label: '启用', value: 'active', sortOrder: 1 },
      { label: '停用', value: 'disabled', sortOrder: 2 }
    ]
  },
  {
    code: 'purchase_type',
    name: '采购类型',
    description: '采购单采购类型',
    options: [
      { label: '实物采购', value: 'physical', sortOrder: 1 },
      { label: '资源采购', value: 'resource', sortOrder: 2 },
      { label: '混合采购', value: 'mixed', sortOrder: 3 }
    ]
  },
  {
    code: 'purchase_purpose_type',
    name: '采购目的类型',
    description: '采购单采购目的',
    options: [
      { label: '自用', value: 'self_use', sortOrder: 1 },
      { label: '项目采购', value: 'project_procurement', sortOrder: 2 },
      { label: '销售备货', value: 'sales_stock', sortOrder: 3 }
    ]
  },
  {
    code: 'purchase_status',
    name: '采购单状态',
    description: '采购单业务状态',
    options: [
      { label: '草稿', value: 'draft', sortOrder: 1 },
      { label: '待审批', value: 'pending_approval', sortOrder: 2 },
      { label: '已批准', value: 'approved', sortOrder: 3 },
      { label: '已下单', value: 'ordered', sortOrder: 4 },
      { label: '已到货', value: 'received', sortOrder: 5 },
      { label: '已入库', value: 'stocked', sortOrder: 6 },
      { label: '已完成', value: 'completed', sortOrder: 7 },
      { label: '已驳回', value: 'rejected', sortOrder: 8 },
      { label: '已关闭', value: 'closed', sortOrder: 9 }
    ]
  },
  {
    code: 'receipt_type',
    name: '入库记录类型',
    description: '入库、激活、登记记录类型',
    options: [
      { label: '实物入库', value: 'physical_stock_in', sortOrder: 1 },
      { label: '资源激活', value: 'resource_activation', sortOrder: 2 },
      { label: '资源登记', value: 'resource_registration', sortOrder: 3 }
    ]
  },
  {
    code: 'receipt_status',
    name: '入库记录状态',
    description: '入库、激活、登记处理状态',
    options: [
      { label: '草稿', value: 'draft', sortOrder: 1 },
      { label: '已处理', value: 'processed', sortOrder: 2 },
      { label: '已取消', value: 'cancelled', sortOrder: 3 }
    ]
  },
  {
    code: 'assignment_action_type',
    name: '资产操作类型',
    description: '分配、领用、转移、归还、释放、续费、报废等动作',
    options: [
      { label: '分配', value: 'assign', sortOrder: 1 },
      { label: '领用', value: 'claim', sortOrder: 2 },
      { label: '转移', value: 'transfer', sortOrder: 3 },
      { label: '归还', value: 'return', sortOrder: 4 },
      { label: '释放', value: 'release', sortOrder: 5 },
      { label: '续费', value: 'renew', sortOrder: 6 },
      { label: '报废', value: 'scrap', sortOrder: 7 }
    ]
  },
  {
    code: 'assignment_target_type',
    name: '资产操作目标类型',
    description: '操作目标所归属的对象类型',
    options: [
      { label: '无', value: 'none', sortOrder: 1 },
      { label: '用户', value: 'user', sortOrder: 2 },
      { label: '部门', value: 'dept', sortOrder: 3 },
      { label: '项目', value: 'project', sortOrder: 4 },
      { label: '环境', value: 'environment', sortOrder: 5 },
      { label: '系统', value: 'system', sortOrder: 6 }
    ]
  },
  {
    code: 'assignment_status',
    name: '资产操作状态',
    description: '资产操作流转状态',
    options: [
      { label: '草稿', value: 'draft', sortOrder: 1 },
      { label: '待处理', value: 'pending', sortOrder: 2 },
      { label: '进行中', value: 'active', sortOrder: 3 },
      { label: '已完成', value: 'completed', sortOrder: 4 },
      { label: '已取消', value: 'cancelled', sortOrder: 5 }
    ]
  },
  {
    code: 'product_asset_relation_type',
    name: '产品关联资产类型',
    description: '产品与资产的关联口径',
    options: [
      { label: '运行资源', value: 'runtime', sortOrder: 1 },
      { label: '交付资源', value: 'delivery', sortOrder: 2 },
      { label: '研发支撑', value: 'support', sortOrder: 3 },
      { label: '依赖资源', value: 'dependency', sortOrder: 4 }
    ]
  },
  {
    code: 'alert_status',
    name: '预警状态',
    description: '预警闭环状态',
    options: [
      { label: '待处理', value: 'pending', sortOrder: 1 },
      { label: '已确认', value: 'acknowledged', sortOrder: 2 },
      { label: '已暂缓', value: 'snoozed', sortOrder: 3 },
      { label: '已解决', value: 'resolved', sortOrder: 4 },
      { label: '已忽略', value: 'ignored', sortOrder: 5 }
    ]
  }
]

export const assetDictionaryMap = assetDictionaryDefinitions.reduce<Record<string, AssetDictionaryDefinition>>((acc, item) => {
  acc[item.code] = item
  return acc
}, {})
