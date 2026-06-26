/**
 * 验证 Console directory-runtime 配置。
 *
 * 兼容旧的 /api/account/config-check 路由名，实际不再依赖 Account。
 * 路由: GET /api/account/config-check
 */
import { getDirectoryConfig } from '@hzy/foundation/server/utils/directoryApi'

export default defineEventHandler(() => {
  const config = getDirectoryConfig()

  const issues: string[] = []

  if (config.provider !== 'console') issues.push('HZY_DIRECTORY_PROVIDER must be console')
  if (!config.consoleApiUrl) issues.push('HZY_CONSOLE_API_URL 未配置')

  return {
    valid: issues.length === 0,
    config: {
      provider: config.provider,
      consoleApiUrl: config.consoleApiUrl || '(未配置)',
      hasConsoleClientId: !!config.consoleClientId,
      hasConsoleClientSecret: !!config.consoleClientSecret
    },
    issues
  }
})
