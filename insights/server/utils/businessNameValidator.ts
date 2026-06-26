/**
 * Business Name Validator
 * 基于RFC标准、开源项目和自定义规则的business name验证服务
 */

import type { RowDataPacket } from 'mysql2/promise'

// RFC 2606 & RFC 6761 保留域名
const rfcReservedDomains = [
  'test', 'example', 'invalid', 'localhost',
  'local', 'onion', 'home', 'corp'
]

// 系统功能相关保留词
const systemReserved = [
  // 核心系统
  'api', 'admin', 'dashboard', 'login', 'register', 'auth', 'oauth',
  'www', 'mail', 'email', 'ftp', 'cdn', 'assets', 'static', 'public',
  'secure', 'ssl', 'tls', 'dns', 'ldap', 'smtp', 'pop', 'imap',

  // 应用特定
  'repoinsight', 'app', 'system', 'root', 'config', 'settings',
  'help', 'support', 'docs', 'documentation', 'blog', 'news',
  'about', 'contact', 'legal', 'privacy', 'terms', 'policy',

  // 开发环境
  'dev', 'development', 'test', 'testing', 'staging', 'beta',
  'demo', 'sandbox', 'preview', 'build', 'deploy',

  // 网络服务
  'webhook', 'callback', 'redirect', 'proxy', 'gateway',
  'status', 'health', 'monitor', 'metrics', 'analytics',

  // 用户相关
  'user', 'users', 'account', 'accounts', 'profile', 'profiles',
  'member', 'members', 'guest', 'guests',

  // 内容管理
  'content', 'media', 'upload', 'download', 'file', 'files',
  'image', 'images', 'video', 'videos', 'audio',

  // 商业相关
  'shop', 'store', 'cart', 'checkout', 'payment', 'billing',
  'invoice', 'order', 'orders', 'product', 'products'
]

// 基于jedireza/reserved-subdomains的常见保留词（精选）
const commonReserved = [
  // 网站常用
  'home', 'index', 'main', 'search', 'sitemap', 'feed', 'rss',

  // 账户相关
  'signin', 'signup', 'logout', 'reset', 'verify', 'activate',

  // 社交功能
  'forum', 'community', 'social', 'chat', 'message', 'notification',

  // 移动端
  'mobile', 'app', 'm', 'wap', 'touch',

  // 地区标识
  'cn', 'us', 'uk', 'jp', 'de', 'fr', 'global', 'international'
]

// 中文相关保留词（拼音）
const chineseReserved = [
  // 管理相关
  'guanli', 'admin', 'guanliyuan', 'kefu', 'service', 'fuwu',

  // 系统相关
  'xitong', 'shezhi', 'peizhi', 'bangzhu', 'zhichi',

  // 商业相关
  'shangcheng', 'dianpu', 'gouwu', 'zhifu', 'dingdan'
]

// 不当内容关键词（基础版）
const inappropriateWords = [
  'admin', 'administrator', 'root', 'superuser', 'moderator',
  'official', 'staff', 'team', 'business', 'corp', 'inc', 'ltd'
]

// 合并所有保留词
const allReservedWords = [
  ...rfcReservedDomains,
  ...systemReserved,
  ...commonReserved,
  ...chineseReserved,
  ...inappropriateWords
]

// 去重并转换为Set以提高查找效率
const reservedWordsSet = new Set(allReservedWords.map(word => word.toLowerCase()))

/**
 * 验证business name格式
 */
function validateFormat(name: string): { valid: boolean; error?: string } {
  // 检查长度
  if (name.length < 3) {
    return { valid: false, error: 'Business name must be at least 3 characters long' }
  }

  if (name.length > 30) {
    return { valid: false, error: 'Business name cannot exceed 30 characters' }
  }

  // 检查字符（只允许小写字母、数字、连字符）
  const validCharRegex = /^[a-z0-9-]+$/
  if (!validCharRegex.test(name)) {
    return { valid: false, error: 'Business name can only contain lowercase letters, numbers, and hyphens' }
  }

  // 不能以连字符开头或结尾
  if (name.startsWith('-') || name.endsWith('-')) {
    return { valid: false, error: 'Business name cannot start or end with a hyphen' }
  }

  // 不能包含连续连字符
  if (name.includes('--')) {
    return { valid: false, error: 'Business name cannot contain consecutive hyphens' }
  }

  // 不能全是数字
  if (/^\d+$/.test(name)) {
    return { valid: false, error: 'Business name cannot be all numbers' }
  }

  return { valid: true }
}

/**
 * 检查是否为保留词
 */
function isReservedWord(name: string): boolean {
  const lowerName = name.toLowerCase()

  // 直接匹配
  if (reservedWordsSet.has(lowerName)) {
    return true
  }

  // 检查是否以保留词开头（避免admin1, admin-test等）
  const reservedPrefixes = ['admin', 'api', 'www', 'mail', 'ftp']
  for (const prefix of reservedPrefixes) {
    if (lowerName.startsWith(prefix + '-') || lowerName.startsWith(prefix)) {
      return true
    }
  }

  return false
}

/**
 * 主验证函数
 */
export function validateBusinessName(name: string): {
  valid: boolean
  error?: string
  suggestions?: string[]
} {
  // 格式验证
  const formatResult = validateFormat(name)
  if (!formatResult.valid) {
    return formatResult
  }

  // 保留词检查
  if (isReservedWord(name)) {
    return {
      valid: false,
      error: 'This name is reserved and cannot be used',
      suggestions: generateSuggestions(name)
    }
  }

  return { valid: true }
}

/**
 * 生成建议的替代名称
 */
function generateSuggestions(name: string): string[] {
  const suggestions: string[] = []

  // 添加数字后缀
  for (let i = 1; i <= 3; i++) {
    suggestions.push(`${name}${i}`)
  }

  // 添加常见后缀
  const suffixes = ['co', 'inc', 'pro', 'biz']
  for (const suffix of suffixes) {
    if (!isReservedWord(`${name}-${suffix}`)) {
      suggestions.push(`${name}-${suffix}`)
    }
  }

  return suggestions.filter(suggestion => !isReservedWord(suggestion)).slice(0, 3)
}

/**
 * 异步检查数据库中是否已存在
 */
export async function checkBusinessNameAvailability(name: string): Promise<{
  available: boolean
  error?: string
}> {
  try {
    const { queryRow } = await import('./db')
    const normalizedName = name.toLowerCase()
    const existing = await queryRow<RowDataPacket & { id: string }>(
      'SELECT id FROM businesses WHERE LOWER(name) = ? LIMIT 1',
      [normalizedName]
    )

    return {
      available: existing === null
    }
  } catch (error) {
    console.error('Error checking business name availability:', error)
    return {
      available: false,
      error: 'Failed to check name availability'
    }
  }
}

/**
 * 完整的业务名称验证（包含格式和可用性检查）
 */
export async function validateBusinessNameComplete(name: string): Promise<{
  valid: boolean
  available?: boolean
  error?: string
  suggestions?: string[]
}> {
  // 首先进行格式和保留词验证
  const validationResult = validateBusinessName(name)
  if (!validationResult.valid) {
    return validationResult
  }

  // 检查数据库可用性
  const availabilityResult = await checkBusinessNameAvailability(name)
  if (!availabilityResult.available) {
    return {
      valid: false,
      available: false,
      error: availabilityResult.error || 'This business name is already taken',
      suggestions: generateSuggestions(name)
    }
  }

  return {
    valid: true,
    available: true
  }
}
