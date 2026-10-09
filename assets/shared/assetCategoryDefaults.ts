export type AssetCategoryScope = 'physical' | 'resource' | 'product' | 'ip' | 'digital'

export interface AssetCategoryItemDefault {
  label: string
  value: string
  shortCode: string
  description?: string
  enabled?: boolean
  sortOrder?: number
}

export interface AssetCategoryGroupDefault {
  label: string
  value: string
  shortCode: string
  description?: string
  enabled?: boolean
  sortOrder?: number
  items: AssetCategoryItemDefault[]
}

export interface AssetCategoryScopeDefinition {
  scope: AssetCategoryScope
  label: string
  description: string
  dictionaryCode: string
  groupLabel: string
  itemLabel: string
  itemsSupported: boolean
}

export const assetCategoryScopeDefinitions: AssetCategoryScopeDefinition[] = [
  {
    scope: 'physical',
    label: '实物资产',
    description: '维护实物资产子类和适用的实物细类。补录资产、编辑资产、采购明细会直接使用这些分类。',
    dictionaryCode: 'asset_physical_subtype',
    groupLabel: '资产子类',
    itemLabel: '资产细类',
    itemsSupported: true
  },
  {
    scope: 'resource',
    label: '资源资产',
    description: '维护资源资产子类。资源资产当前只使用一级分类，不拆细类。',
    dictionaryCode: 'asset_resource_subtype',
    groupLabel: '资源子类',
    itemLabel: '细类',
    itemsSupported: false
  },
  {
    scope: 'product',
    label: '产品资产',
    description: '维护产品资产的产品线分类。客户域、业务域等其它维度仍在字典体系中单独维护。',
    dictionaryCode: 'product_line',
    groupLabel: '产品线',
    itemLabel: '细类',
    itemsSupported: false
  },
  {
    scope: 'ip',
    label: '知识产权资产',
    description: '维护知识产权资产类型。当前按一级类型管理，不拆细类。',
    dictionaryCode: 'ip_asset_type',
    groupLabel: '资产类型',
    itemLabel: '细类',
    itemsSupported: false
  },
  {
    scope: 'digital',
    label: '数字资产',
    description: '维护数字资产类型。当前按一级类型管理，不拆细类。',
    dictionaryCode: 'digital_asset_type',
    groupLabel: '资产类型',
    itemLabel: '细类',
    itemsSupported: false
  }
]

export const assetCategoryScopeMap = Object.fromEntries(
  assetCategoryScopeDefinitions.map(item => [item.scope, item])
) as Record<AssetCategoryScope, AssetCategoryScopeDefinition>

const physicalAssetCategoryDefaults: AssetCategoryGroupDefault[] = [
  {
    label: '办公设备',
    value: '办公设备',
    shortCode: 'OFF',
    sortOrder: 1,
    items: [
      { label: '笔记本', value: '笔记本', shortCode: 'LTP', sortOrder: 1 },
      { label: '台式机', value: '台式机', shortCode: 'DTP', sortOrder: 2 },
      { label: '显示器', value: '显示器', shortCode: 'MON', sortOrder: 3 },
      { label: '手机', value: '手机', shortCode: 'PHN', sortOrder: 4 },
      { label: '平板', value: '平板', shortCode: 'PAD', sortOrder: 5 },
      { label: '投影机', value: '投影机', shortCode: 'PJT', sortOrder: 6 },
      { label: '打印机', value: '打印机', shortCode: 'PRT', sortOrder: 7 },
      { label: '复印机', value: '复印机', shortCode: 'CPR', sortOrder: 8 },
      { label: '打印复印一体机', value: '打印复印一体机', shortCode: 'AIO', sortOrder: 9 },
      { label: '扫描仪', value: '扫描仪', shortCode: 'SCN', sortOrder: 10 },
      { label: '专业测试机', value: '专业测试机', shortCode: 'TST', sortOrder: 11 },
      { label: '视频会议设备', value: '视频会议设备', shortCode: 'VTC', sortOrder: 12 },
      { label: '其他办公设备', value: '其他办公设备', shortCode: 'OTH', sortOrder: 13 }
    ]
  },
  {
    label: '办公家具与设施',
    value: '办公家具与设施',
    shortCode: 'FAC',
    sortOrder: 2,
    items: [
      { label: '办公桌', value: '办公桌', shortCode: 'DSK', sortOrder: 1 },
      { label: '办公椅', value: '办公椅', shortCode: 'CHR', sortOrder: 2 },
      { label: '文件柜', value: '文件柜', shortCode: 'CAB', sortOrder: 3 },
      { label: '会议桌', value: '会议桌', shortCode: 'MTB', sortOrder: 4 },
      { label: '投影仪', value: '投影仪', shortCode: 'PROJ', sortOrder: 5 },
      { label: '打印机', value: '打印机', shortCode: 'PRT', sortOrder: 6 },
      { label: '空调', value: '空调', shortCode: 'AIR', sortOrder: 7 },
      { label: '饮水设备', value: '饮水设备', shortCode: 'WTR', sortOrder: 8 }
    ]
  },
  {
    label: 'IT基础设施资产',
    value: 'IT基础设施资产',
    shortCode: 'ITI',
    sortOrder: 3,
    items: [
      { label: '服务器', value: '服务器', shortCode: 'SRV', sortOrder: 1 },
      { label: 'GPU 设备', value: 'GPU 设备', shortCode: 'GPU', sortOrder: 2 },
      { label: '机柜', value: '机柜', shortCode: 'RCK', sortOrder: 3 },
      { label: 'UPS', value: 'UPS', shortCode: 'UPS', sortOrder: 4 },
      { label: 'NAS', value: 'NAS', shortCode: 'NAS', sortOrder: 5 },
      { label: '交换机', value: '交换机', shortCode: 'SWT', sortOrder: 6 },
      { label: '路由器', value: '路由器', shortCode: 'RTR', sortOrder: 7 },
      { label: '防火墙', value: '防火墙', shortCode: 'FWL', sortOrder: 8 }
    ]
  },
  {
    label: '交通运输资产',
    value: '交通运输资产',
    shortCode: 'TRN',
    sortOrder: 4,
    items: [
      { label: '公务车', value: '公务车', shortCode: 'CAR', sortOrder: 1 },
      { label: '交付服务车', value: '交付服务车', shortCode: 'DLV', sortOrder: 2 },
      { label: '运维巡检车', value: '运维巡检车', shortCode: 'OPS', sortOrder: 3 },
      { label: '电动车', value: '电动车', shortCode: 'EBK', sortOrder: 4 },
      { label: '叉车', value: '叉车', shortCode: 'FLT', sortOrder: 5 },
      { label: '搬运车', value: '搬运车', shortCode: 'TRC', sortOrder: 6 }
    ]
  },
  {
    label: '其他专业资产',
    value: '其他专业资产',
    shortCode: 'PRO',
    sortOrder: 5,
    items: [
      { label: '行业专用设备', value: '行业专用设备', shortCode: 'IND', sortOrder: 1 },
      { label: '客户交付专用硬件', value: '客户交付专用硬件', shortCode: 'CUS', sortOrder: 2 },
      { label: 'IoT 终端', value: 'IoT 终端', shortCode: 'IOT', sortOrder: 3 },
      { label: '研发实验设备', value: '研发实验设备', shortCode: 'LAB', sortOrder: 4 },
      { label: '样机', value: '样机', shortCode: 'SMP', sortOrder: 5 }
    ]
  },
  {
    label: '低值物资',
    value: '低值物资',
    shortCode: 'CON',
    sortOrder: 6,
    items: [
      { label: '鼠标', value: '鼠标', shortCode: 'MSE', sortOrder: 1 },
      { label: '键盘', value: '键盘', shortCode: 'KBD', sortOrder: 2 },
      { label: '网线', value: '网线', shortCode: 'CBL', sortOrder: 3 },
      { label: '转接器', value: '转接器', shortCode: 'ADP', sortOrder: 4 },
      { label: '小型工具', value: '小型工具', shortCode: 'TLS', sortOrder: 5 },
      { label: '常用备件', value: '常用备件', shortCode: 'SPT', sortOrder: 6 },
      { label: '办公耗材', value: '办公耗材', shortCode: 'SUP', sortOrder: 7 }
    ]
  }
]

const resourceAssetCategoryDefaults: AssetCategoryGroupDefault[] = [
  { label: '云主机', value: '云主机', shortCode: 'ECS', sortOrder: 1, items: [] },
  { label: '数据库', value: '数据库', shortCode: 'DB', sortOrder: 2, items: [] },
  { label: '容器集群', value: '容器集群', shortCode: 'K8S', sortOrder: 3, items: [] },
  { label: 'SSL证书', value: 'SSL证书', shortCode: 'SSL', sortOrder: 4, items: [] },
  { label: '模型额度', value: '模型额度', shortCode: 'LLM', sortOrder: 5, items: [] },
  { label: 'SaaS订阅', value: 'SaaS订阅', shortCode: 'SAAS', sortOrder: 6, items: [] }
]

const productAssetCategoryDefaults: AssetCategoryGroupDefault[] = [
  { label: '智慧房产', value: 'real_estate', shortCode: 'REA', sortOrder: 1, items: [] },
  { label: '不动产登记', value: 'registration', shortCode: 'REG', sortOrder: 2, items: [] },
  { label: '农业农村', value: 'agriculture', shortCode: 'AGR', sortOrder: 3, items: [] },
  { label: '平台产品', value: 'platform', shortCode: 'PLT', sortOrder: 4, items: [] },
  { label: '内部产品', value: 'internal', shortCode: 'INT', sortOrder: 5, items: [] }
]

const ipAssetCategoryDefaults: AssetCategoryGroupDefault[] = [
  { label: '软件著作权', value: 'software_copyright', shortCode: 'SWC', sortOrder: 1, items: [] },
  { label: '商标', value: 'trademark', shortCode: 'TM', sortOrder: 2, items: [] },
  { label: '专利', value: 'patent', shortCode: 'PAT', sortOrder: 3, items: [] },
  { label: '版权/著作权', value: 'copyright', shortCode: 'CPY', sortOrder: 4, items: [] },
  { label: '资质证照', value: 'qualification', shortCode: 'QLF', sortOrder: 5, items: [] }
]

const digitalAssetCategoryDefaults: AssetCategoryGroupDefault[] = [
  { label: '代码资产', value: 'code', shortCode: 'CODE', sortOrder: 1, items: [] },
  { label: '文档资产', value: 'document', shortCode: 'DOC', sortOrder: 2, items: [] },
  { label: '数据资产', value: 'data', shortCode: 'DATA', sortOrder: 3, items: [] },
  { label: '设计资产', value: 'design', shortCode: 'DSGN', sortOrder: 4, items: [] },
  { label: '模型资产', value: 'model', shortCode: 'ML', sortOrder: 5, items: [] },
  { label: '交付物资产', value: 'artifact', shortCode: 'ARTF', sortOrder: 6, items: [] }
]

export const assetCategoryDefaultsByScope: Record<AssetCategoryScope, AssetCategoryGroupDefault[]> = {
  physical: physicalAssetCategoryDefaults,
  resource: resourceAssetCategoryDefaults,
  product: productAssetCategoryDefaults,
  ip: ipAssetCategoryDefaults,
  digital: digitalAssetCategoryDefaults
}

export const managedAssetCategoryDictionaryCodes = assetCategoryScopeDefinitions.map(item => item.dictionaryCode)
