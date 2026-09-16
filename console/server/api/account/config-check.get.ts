/**
 * 兼容旧配置检查接口。Console directory-runtime 已不依赖 Account API 配置。
 */
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  await requireConsoleRequestUid(event)
  return {
    valid: true,
    provider: 'console.directory-runtime',
    config: {
      accountApiRequired: false
    },
    issues: []
  }
})
