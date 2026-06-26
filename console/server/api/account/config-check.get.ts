/**
 * 兼容旧配置检查接口。Console directory-runtime 已不依赖 Account API 配置。
 */
export default defineEventHandler(() => ({
  valid: true,
  provider: 'console.directory-runtime',
  config: {
    accountApiRequired: false
  },
  issues: []
}))
