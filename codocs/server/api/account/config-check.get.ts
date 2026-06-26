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

  if (directory.provider !== 'console') {
    issues.push('HZY_DIRECTORY_PROVIDER 必须设置为 console')
  }
  if (!directory.consoleApiUrl) {
    issues.push('HZY_CONSOLE_API_URL 未配置')
  }
  if (!directory.consoleClientId || !directory.consoleClientSecret) {
    warnings.push('未配置 HZY_CONSOLE_CLIENT_ID/HZY_CONSOLE_CLIENT_SECRET，将以无服务凭证模式访问 Console Directory')
  }

  const isValid = issues.length === 0

  return {
    valid: isValid,
    provider: 'console.directory-runtime',
    config: {
      accountApiRequired: false,
      directoryProvider: directory.provider || '(未配置)',
      consoleApiUrl: directory.consoleApiUrl || '(未配置)',
      hasConsoleClientId: !!directory.consoleClientId,
      hasConsoleClientSecret: !!directory.consoleClientSecret
    },
    issues,
    warnings,
    recommendations: isValid && warnings.length === 0
      ? ['新架构目录配置正确']
      : [
          '1. 编辑 .env.dev 文件',
          '2. 设置 HZY_DIRECTORY_PROVIDER=console',
          '3. 设置 HZY_CONSOLE_API_URL，或通过 Console runtime 配置注入目录端点',
          '4. 如 Console Directory 要求服务凭证，配置 HZY_CONSOLE_CLIENT_ID/HZY_CONSOLE_CLIENT_SECRET',
          '5. 重启开发服务器'
        ]
  }
})
