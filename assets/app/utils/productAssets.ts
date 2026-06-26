import type { AssetDictionaryOption } from '~~/shared/assetsDictionaries'

export type ProductArrayField = string[] | string | null | undefined

export const productLineFallbackOptions: AssetDictionaryOption[] = [
  { label: '智慧房产 FC', value: 'FC', sortOrder: 1 },
  { label: '不动产登记 BDC', value: 'BDC', sortOrder: 2 },
  { label: '通用领域 TY', value: 'TY', sortOrder: 3 },
  { label: '特定领域 JD', value: 'JD', sortOrder: 4 },
  { label: '农业农村 NY', value: 'NY', sortOrder: 5 },
  { label: '公证处 GZ', value: 'GZ', sortOrder: 6 }
]

export const businessDomainFallbackOptions: AssetDictionaryOption[] = [
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

export const customerDomainFallbackOptions: AssetDictionaryOption[] = [
  { label: 'G 端', value: 'G', sortOrder: 1 },
  { label: 'B 端', value: 'B', sortOrder: 2 },
  { label: 'C 端', value: 'C', sortOrder: 3 }
]

export const productInvestmentStrategyOptions: AssetDictionaryOption[] = [
  { label: '重点投入', value: 'focus_invest', sortOrder: 1 },
  { label: '持续经营', value: 'continue_operate', sortOrder: 2 },
  { label: '控制维护', value: 'control_maintain', sortOrder: 3 },
  { label: '有序退出', value: 'orderly_exit', sortOrder: 4 },
  { label: '待评估', value: 'pending_eval', sortOrder: 99 }
]

export const productAssetValueTypeOptions: AssetDictionaryOption[] = [
  { label: '核心资产', value: 'core_asset', sortOrder: 1 },
  { label: '经营资产', value: 'operating_asset', sortOrder: 2 },
  { label: '沉淀资产', value: 'deposited_asset', sortOrder: 3 },
  { label: '待评估', value: 'pending_eval', sortOrder: 99 }
]

export const productLifecycleStatusOptions: AssetDictionaryOption[] = [
  { label: '规划POC', value: 'poc', sortOrder: 1 },
  { label: '核心MVP', value: 'mvp', sortOrder: 2 },
  { label: '商用MMP', value: 'mmp', sortOrder: 3 },
  { label: '市场PMF', value: 'pmf', sortOrder: 4 },
  { label: '退市EOL', value: 'eol', sortOrder: 5 }
]

export const buildStageOptions: AssetDictionaryOption[] = [
  { label: '规划', value: 'planned', sortOrder: 1 },
  { label: '在建', value: 'building', sortOrder: 2 },
  { label: '已建', value: 'built', sortOrder: 3 }
]

export const productizationValueLevelOptions: AssetDictionaryOption[] = [
  { label: '高', value: 'high', sortOrder: 1 },
  { label: '中', value: 'medium', sortOrder: 2 },
  { label: '低', value: 'low', sortOrder: 3 }
]

export const supportedTerminalOptions: AssetDictionaryOption[] = [
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

const legacyProductLineMap: Record<string, string> = {
  real_estate: 'FC',
  registration: 'BDC',
  agriculture: 'NY',
  platform: 'TY',
  internal: 'TY'
}

const legacyBusinessDomainMap: Record<string, string> = {
  core: 'JC',
  support: 'JC',
  external_service: 'GX',
  governance: 'FX'
}

const legacyProductLevelMap: Record<string, string> = {
  star: 'focus_invest',
  cash_cow: 'continue_operate',
  question: 'focus_invest',
  dog: 'orderly_exit'
}

const legacyAssetLevelMap: Record<string, string> = {
  A: 'core_asset',
  B: 'operating_asset',
  C: 'deposited_asset',
  D: 'pending_eval'
}

const legacyStatusMap: Record<string, string> = {
  planning: 'poc',
  iterating: 'mvp',
  maintenance: 'mmp',
  refactor_pending: 'mmp',
  retire_pending: 'eol'
}

const legacyCustomerDomainMap: Record<string, string[]> = {
  government: ['G'],
  business: ['B'],
  consumer: ['C'],
  internal: []
}

const terminalAliasMap: Record<string, string> = {
  WEB: 'web',
  Web: 'web',
  web: 'web',
  小程序: 'mini_program',
  APP: 'app',
  app: 'app',
  爱山东APP: 'shandong_app',
  爱山东: 'shandong_app',
  自助终端设备: 'kiosk',
  自助终端: 'kiosk',
  单机版: 'standalone',
  接口服务: 'api_service',
  数据及接口服务: 'data_interface',
  工位一体机: 'workstation_terminal',
  PAD: 'pad',
  pad: 'pad'
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map(item => item.trim()).filter(Boolean))]
}

function parseStringArray(value: ProductArrayField): string[] {
  if (Array.isArray(value)) {
    return uniqueValues(value.flatMap(item => parseStringArray(String(item))))
  }

  const text = cleanText(value)
  if (!text) {
    return []
  }

  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as unknown
      if (Array.isArray(parsed)) {
        return uniqueValues(parsed.flatMap(item => parseStringArray(String(item))))
      }
    } catch {
      // Fall through to separator parsing for non-standard legacy text.
    }
  }

  return uniqueValues(text.split(/[\n,，、;；]+/))
}

function normalizeSingleValue(value: string | null | undefined, legacyMap: Record<string, string>, fallback: string) {
  const text = cleanText(value)
  if (!text) {
    return fallback
  }
  return legacyMap[text] || text
}

export function normalizeProductLine(value: string | null | undefined) {
  return normalizeSingleValue(value, legacyProductLineMap, 'FC')
}

export function normalizeBusinessDomain(value: string | null | undefined) {
  return normalizeSingleValue(value, legacyBusinessDomainMap, 'pending')
}

export function normalizeProductInvestmentStrategy(value: string | null | undefined) {
  return normalizeSingleValue(value, legacyProductLevelMap, 'pending_eval')
}

export function normalizeProductAssetValueType(value: string | null | undefined) {
  return normalizeSingleValue(value, legacyAssetLevelMap, 'pending_eval')
}

export function normalizeProductLifecycleStatus(value: string | null | undefined) {
  return normalizeSingleValue(value, legacyStatusMap, 'mvp')
}

export function normalizeCustomerDomains(value: ProductArrayField) {
  const values = parseStringArray(value).flatMap((item) => {
    const mapped = legacyCustomerDomainMap[item]
    if (mapped) {
      return mapped
    }

    const upper = item.toUpperCase()
    if (/^[GBC]+$/.test(upper)) {
      return upper.split('')
    }

    return [item]
  })

  const selected = new Set(values)
  return customerDomainFallbackOptions
    .map(option => option.value)
    .filter(value => selected.has(value))
}

export function normalizeSupportedTerminals(value: ProductArrayField) {
  return uniqueValues(parseStringArray(value).map(item => terminalAliasMap[item] || item))
}

export function normalizeStringList(value: ProductArrayField) {
  return parseStringArray(value)
}

export function nullableArray(values: string[]) {
  const cleaned = uniqueValues(values)
  return cleaned.length > 0 ? cleaned : null
}

export function multilineToArray(value: string) {
  return nullableArray(parseStringArray(value))
}

export function arrayToMultiline(value: ProductArrayField) {
  return normalizeStringList(value).join('\n')
}

export function preferModernOptions(options: AssetDictionaryOption[], fallbackOptions: AssetDictionaryOption[]) {
  const optionValues = new Set(options.map(option => option.value))
  const hasModernOption = fallbackOptions.some(option => optionValues.has(option.value))
  return hasModernOption ? options : fallbackOptions
}

export function preferDictionaryOptions(options: AssetDictionaryOption[], fallbackOptions: AssetDictionaryOption[]) {
  return options.length > 0 ? options : fallbackOptions
}

export function defaultProductLifecycleStatus(options: AssetDictionaryOption[], preferredValue = 'mvp') {
  return options.some(option => option.value === preferredValue)
    ? preferredValue
    : options[0]?.value || preferredValue
}

export function normalizeProductLifecycleStatusForOptions(
  value: string | null | undefined,
  options: AssetDictionaryOption[],
  fallbackValue = 'mvp'
) {
  const text = cleanText(value)
  if (text && options.some(option => option.value === text)) {
    return text
  }

  const normalized = normalizeProductLifecycleStatus(value)
  if (options.some(option => option.value === normalized)) {
    return normalized
  }

  return text || defaultProductLifecycleStatus(options, fallbackValue)
}

export function labelFromOptions(options: AssetDictionaryOption[], value: string | null | undefined, fallback = '-') {
  if (!value) {
    return fallback
  }
  return options.find(option => option.value === value)?.label || value
}

export function labelsFromOptions(options: AssetDictionaryOption[], values: ProductArrayField, fallback = '-') {
  const normalized = normalizeStringList(values)
  if (normalized.length === 0) {
    return fallback
  }
  return normalized.map(value => labelFromOptions(options, value, value)).join('、')
}
