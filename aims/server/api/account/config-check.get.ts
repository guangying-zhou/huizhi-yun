/**
 * 验证 Console Directory 配置
 * 路由: GET /api/account/config-check
 */
export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  const hzy = config.hzy as {
    directory?: {
      provider?: string
      consoleApiUrl?: string
      consoleClientId?: string
      consoleClientSecret?: string
    }
  }

  const issues: string[] = []
  const warnings: string[] = []
  const directory = hzy.directory || {}

  if (directory.provider !== 'console') issues.push('HZY_DIRECTORY_PROVIDER 必须设置为 console')
  if (!directory.consoleApiUrl) issues.push('HZY_CONSOLE_API_URL 或 license bootstrap consoleUrl 未配置')
  if (!directory.consoleClientId || !directory.consoleClientSecret) {
    warnings.push('未配置 HZY_CONSOLE_CLIENT_ID/HZY_CONSOLE_CLIENT_SECRET，将以无服务凭证模式访问 Console Directory')
  }

  return {
    valid: issues.length === 0,
    provider: 'console.directory-runtime',
    config: {
      accountApiRequired: false,
      directoryProvider: directory.provider || '(未配置)',
      consoleApiUrl: directory.consoleApiUrl || '(未配置)',
      hasConsoleClientId: !!directory.consoleClientId,
      hasConsoleClientSecret: !!directory.consoleClientSecret
    },
    issues,
    warnings
  }
})
