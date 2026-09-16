import path from 'node:path'
import { createError } from 'h3'

type Pm2Process = {
  name?: string
  pid?: number
  pm2_env?: {
    status?: string
    restart_time?: number
    unstable_restarts?: number
    pm_uptime?: number
  }
  monit?: {
    memory?: number
    cpu?: number
  }
}

export type RuntimeAppStatus = {
  appCode: string
  appName: string
  processName: string
  basePath: string
  port: number
  hmrPort: number
  enabledInStack: boolean
  manageable: boolean
  status: string
  pid: number | null
  cpu: number
  memoryBytes: number
  memoryMb: number
  uptimeMs: number | null
  restarts: number
  note: string | null
}

export type RuntimeAppAction = 'start' | 'stop' | 'restart'

const defaultEnabledAppCodes = ['console', 'workflow']
const runtimeApps = [
  { appCode: 'console', appName: '汇智云控制台', processName: 'hzy-console', basePath: '/', port: 3100, hmrPort: 3170 },
  { appCode: 'codocs', appName: '汇智云文档', processName: 'hzy-codocs', basePath: '/codocs/', port: 3101, hmrPort: 3171 },
  { appCode: 'aims', appName: '汇智云项目', processName: 'hzy-aims', basePath: '/aims/', port: 3102, hmrPort: 3172 },
  { appCode: 'altoc', appName: '汇智云营销', processName: 'hzy-altoc', basePath: '/altoc/', port: 3103, hmrPort: 3173 },
  { appCode: 'assets', appName: '汇智云资产', processName: 'hzy-assets', basePath: '/assets/', port: 3104, hmrPort: 3174 },
  { appCode: 'workflow', appName: '汇智云流程', processName: 'hzy-workflow', basePath: '/workflow/', port: 3105, hmrPort: 3175 },
  { appCode: 'finance', appName: '汇智云财务', processName: 'hzy-finance', basePath: '/finance/', port: 3106, hmrPort: 3176 }
]

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function isTruthy(value: unknown) {
  return ['1', 'true', 'yes', 'on'].includes(stringValue(value).toLowerCase())
}

function isExplicitlyFalse(value: unknown) {
  return ['0', 'false', 'no', 'off'].includes(stringValue(value).toLowerCase())
}

function isCloudflareRuntime() {
  return isTruthy(process.env.HZY_CLOUDFLARE_RUNTIME)
    || isTruthy(process.env.HZY_CLOUDFLARE_BUILD)
}

function pm2Bin() {
  return stringValue(process.env.HZY_PM2_BIN) || 'pm2'
}

function stackEnv() {
  return stringValue(process.env.HZY_DEV_STACK_ENV)
    || (stringValue(process.env.HZY_DEPLOYMENT_PUBLIC_URL).includes('localhost') ? 'local' : 'staging')
}

function enabledAppCodes() {
  const configured = stringValue(process.env.HZY_DEV_STACK_APPS)
  if (!configured) return new Set(defaultEnabledAppCodes)
  return new Set(configured.split(/[,\s]+/).map(item => item.trim()).filter(Boolean))
}

function enabledAppCodesWith(appCode: string) {
  return Array.from(new Set([...enabledAppCodes(), appCode]))
}

function ecosystemCandidates() {
  const configured = stringValue(process.env.HZY_DEV_STACK_ECOSYSTEM)
  const cwd = process.cwd()
  return [
    configured,
    path.resolve(cwd, 'deploy/dev-stack/ecosystem.config.cjs'),
    path.resolve(cwd, '../deploy/dev-stack/ecosystem.config.cjs')
  ].filter(Boolean)
}

function configuredEcosystemFile() {
  return ecosystemCandidates()[0] || ''
}

async function importNodeModule<T>(specifier: string): Promise<T> {
  return (Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<T>)(specifier)
}

async function resolveEcosystemFile() {
  if (isCloudflareRuntime()) return ''

  const { existsSync } = await importNodeModule<typeof import('node:fs')>('node:fs')
  return ecosystemCandidates().find(candidate => existsSync(candidate)) || ''
}

export function isRuntimeAppControlEnabled() {
  if (isCloudflareRuntime()) return false
  if (isExplicitlyFalse(process.env.HZY_RUNTIME_APP_CONTROL_ENABLED)) return false
  return process.env.NODE_ENV !== 'production' || isTruthy(process.env.HZY_RUNTIME_APP_CONTROL_ENABLED)
}

export function runtimeAppControlContext() {
  return {
    enabled: isRuntimeAppControlEnabled(),
    stackEnv: stackEnv(),
    ecosystemFile: isCloudflareRuntime() ? '' : configuredEcosystemFile(),
    pm2Bin: pm2Bin()
  }
}

async function runPm2(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  if (isCloudflareRuntime()) {
    throw createError({ statusCode: 403, message: 'Cloudflare runtime does not support PM2 operations' })
  }

  const [
    { execFile },
    { promisify }
  ] = await Promise.all([
    importNodeModule<typeof import('node:child_process')>('node:child_process'),
    importNodeModule<typeof import('node:util')>('node:util')
  ])
  const execFileAsync = promisify(execFile)
  const { stdout, stderr } = await execFileAsync(pm2Bin(), args, {
    env: {
      ...process.env,
      HZY_DEV_STACK_ENV: stackEnv(),
      ...extraEnv
    },
    timeout: 15000,
    maxBuffer: 1024 * 1024
  })

  return {
    stdout: stringValue(stdout),
    stderr: stringValue(stderr)
  }
}

async function loadPm2Processes() {
  if (!isRuntimeAppControlEnabled()) return []

  try {
    const result = await runPm2(['jlist'])
    const parsed = JSON.parse(result.stdout || '[]')
    return Array.isArray(parsed) ? parsed as Pm2Process[] : []
  } catch {
    return []
  }
}

export async function listRuntimeApps() {
  const processes = await loadPm2Processes()
  const byName = new Map(processes.map(process => [stringValue(process.name), process]))
  const enabledCodes = enabledAppCodes()
  const context = runtimeAppControlContext()

  return runtimeApps.map((app): RuntimeAppStatus => {
    const processInfo = byName.get(app.processName)
    const enabledInStack = enabledCodes.has(app.appCode)
    const status = stringValue(processInfo?.pm2_env?.status) || 'not_found'
    const memoryBytes = Number(processInfo?.monit?.memory || 0)
    const manageable = context.enabled && app.appCode !== 'console'
    let note: string | null = null
    if (app.appCode === 'console') {
      note = 'Console 不能从当前页面停止或重启'
    } else if (!context.enabled) {
      note = '运行环境控制已禁用'
    } else if (!enabledInStack) {
      note = '未包含在默认启动集合中，点击启动会加入本次运行集合'
    }

    return {
      ...app,
      enabledInStack,
      manageable,
      status,
      pid: processInfo?.pid || null,
      cpu: Number(processInfo?.monit?.cpu || 0),
      memoryBytes,
      memoryMb: Math.round(memoryBytes / 1024 / 1024),
      uptimeMs: processInfo?.pm2_env?.pm_uptime ? Date.now() - Number(processInfo.pm2_env.pm_uptime) : null,
      restarts: Number(processInfo?.pm2_env?.restart_time || processInfo?.pm2_env?.unstable_restarts || 0),
      note
    }
  })
}

export async function applyRuntimeAppAction(appCode: string, action: RuntimeAppAction) {
  const app = runtimeApps.find(item => item.appCode === appCode)
  if (!app) {
    throw createError({ statusCode: 404, message: '应用不存在' })
  }

  if (!isRuntimeAppControlEnabled()) {
    throw createError({ statusCode: 403, message: '运行环境控制未启用' })
  }

  if (app.appCode === 'console') {
    throw createError({ statusCode: 400, message: '不能从 Console 页面停止或重启 Console 自身' })
  }

  if (action === 'start' || action === 'restart') {
    const ecosystemFile = await resolveEcosystemFile()
    if (!ecosystemFile) {
      throw createError({ statusCode: 500, message: '未找到 dev-stack PM2 ecosystem 配置' })
    }
    return runPm2(
      ['startOrReload', ecosystemFile, '--only', app.processName, '--update-env'],
      { HZY_DEV_STACK_APPS: enabledAppCodesWith(app.appCode).join(',') }
    )
  }

  if (action === 'stop') {
    return runPm2(['stop', app.processName])
  }

  throw createError({ statusCode: 400, message: '不支持的操作' })
}
