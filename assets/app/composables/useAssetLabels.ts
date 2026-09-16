const staticDictionaryLabels: Record<string, Record<string, string>> = {
  asset_category: {
    physical: '实物资产',
    resource: '资源资产',
    product: '产品资产',
    ip: '知识产权',
    digital: '数字资产'
  },
  assignment_action_type: {
    assign: '分配',
    claim: '领用',
    transfer: '转移',
    return: '归还',
    release: '释放',
    renew: '续费',
    scrap: '报废'
  },
  assignment_status: {
    draft: '草稿',
    pending: '待处理',
    active: '进行中',
    completed: '已完成',
    cancelled: '已取消'
  },
  assignment_target_type: {
    none: '无',
    user: '用户',
    dept: '部门',
    project: '项目',
    environment: '环境',
    system: '系统'
  },
  product_line: {
    FC: '智慧房产 FC',
    BDC: '不动产登记 BDC',
    TY: '通用领域 TY',
    JD: '特定领域 JD',
    NY: '农业农村 NY',
    GZ: '公证处 GZ',
    real_estate: '智慧房产 FC',
    registration: '不动产登记 BDC',
    agriculture: '农业农村 NY',
    platform: '通用领域 TY',
    internal: '通用领域 TY'
  },
  customer_domain: {
    G: 'G 端',
    B: 'B 端',
    C: 'C 端',
    government: 'G 端',
    business: 'B 端',
    consumer: 'C 端',
    internal: '内部'
  },
  business_domain: {
    JY: '交易监管 JY',
    DJ: '登记服务 DJ',
    WY: '物业管理 WY',
    BZ: '住房保障 BZ',
    ZJ: '资金监管 ZJ',
    FX: '分析决策 FX',
    JC: '基础支撑 JC',
    GX: '共享服务 GX',
    pending: '待分类'
  },
  product_level: {
    focus_invest: '重点投入',
    continue_operate: '持续经营',
    control_maintain: '控制维护',
    orderly_exit: '有序退出',
    pending_eval: '待评估'
  },
  product_asset_value_type: {
    core_asset: '核心资产',
    operating_asset: '经营资产',
    deposited_asset: '沉淀资产',
    pending_eval: '待评估'
  },
  product_status: {
    poc: '规划POC',
    mvp: '核心MVP',
    mmp: '商用MMP',
    pmf: '市场PMF',
    eol: '退市EOL'
  },
  build_stage: {
    planned: '规划',
    building: '在建',
    built: '已建'
  },
  productization_value_level: {
    high: '高',
    medium: '中',
    low: '低'
  },
  supported_terminal: {
    web: 'WEB',
    mini_program: '小程序',
    app: 'APP',
    shandong_app: '爱山东 APP',
    kiosk: '自助终端',
    standalone: '单机版',
    api_service: '接口服务',
    data_interface: '数据及接口服务',
    workstation_terminal: '工位一体机',
    pad: 'PAD'
  }
}

function normalizeLegacyDictionaryValue(code: string, value: string) {
  if (code === 'purchase_purpose_type') {
    if (value === 'internal') return 'self_use'
    if (value === 'customer_delivery') return 'project_procurement'
  }
  if (code === 'product_line') {
    if (value === 'real_estate') return 'FC'
    if (value === 'registration') return 'BDC'
    if (value === 'agriculture') return 'NY'
    if (value === 'platform' || value === 'internal') return 'TY'
  }
  if (code === 'customer_domain') {
    if (value === 'government') return 'G'
    if (value === 'business') return 'B'
    if (value === 'consumer') return 'C'
  }
  if (code === 'business_domain') {
    if (value === 'core' || value === 'support') return 'JC'
    if (value === 'external_service') return 'GX'
    if (value === 'governance') return 'FX'
  }
  if (code === 'product_level') {
    if (value === 'star' || value === 'question') return 'focus_invest'
    if (value === 'cash_cow') return 'continue_operate'
    if (value === 'dog') return 'orderly_exit'
  }
  if (code === 'product_status') {
    if (value === 'planning') return 'poc'
    if (value === 'iterating') return 'mvp'
    if (value === 'maintenance' || value === 'refactor_pending') return 'mmp'
    if (value === 'retire_pending') return 'eol'
  }

  return value
}

export function useAssetLabels() {
  const { loadDictionaries, getDictionary } = useAssetDictionaries()

  function getLabel(code: string, value: string | null | undefined, fallback = '-') {
    if (!value) {
      return fallback
    }

    const dictionary = getDictionary(code)
    const directOption = dictionary?.options?.find(item => item.value === value)
    if (directOption?.label) {
      return directOption.label
    }

    const normalizedValue = normalizeLegacyDictionaryValue(code, value)
    const option = dictionary?.options?.find(item => item.value === normalizedValue)
    if (option?.label) {
      return option.label
    }

    const staticLabel = staticDictionaryLabels[code]?.[value] || staticDictionaryLabels[code]?.[normalizedValue]
    return staticLabel || value
  }

  return {
    loadDictionaries,
    getLabel
  }
}
