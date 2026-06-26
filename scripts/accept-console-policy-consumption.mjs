#!/usr/bin/env node
/**
 * E8-T24 / E8-T16（服务端部分）: Console 权限消费验收脚本。
 *
 * 验收点：
 *   1. 未登录访问 /api/auth/permissions 返回 401（bundle resolver 不静默放权）
 *   2. 已授权用户的 permissions 响应包含目标 resource/action（view/edit/admin 向下包含）
 *   3. 已授权用户可访问 requirePermission 保护的接口
 *   4. 未登录访问受保护接口被拦截
 *   5. （可选）未授权用户 permissions 不含目标资源，且受保护接口返回 403
 *
 * 菜单过滤与前端路由守卫消费同一个 /api/auth/permissions 响应，
 * UI 行为核对见 docs/Console-Policy-Authorization-Acceptance-Runbook.md。
 */
import process from 'node:process'

const SCRIPT = 'accept-console-policy-consumption'

function usage() {
  return `
Usage:
  pnpm run accept:console-policy-consumption -- \\
    --base-url http://127.0.0.1:3000/console \\
    --cookie-env CONSOLE_ACCEPT_COOKIE \\
    [--denied-cookie-env CONSOLE_ACCEPT_DENIED_COOKIE] \\
    [--resource org_profile] [--action view] \\
    [--protected-path /api/v1/console/business-domains]

说明：
  - --base-url 需包含 Console 的 app base path（默认部署为 /console）。
  - cookie 环境变量可以放完整 Cookie 串，也可以只放 console_session 的值
    （浏览器登录 Console 后从 DevTools 复制）。
  - --denied-cookie-env 指向一个"未被授权目标资源"的用户会话，用于反向验证。
`
}

function parseArgs(argv) {
  const args = {
    baseUrl: 'http://127.0.0.1:3000/console',
    cookie: '',
    deniedCookie: '',
    resource: 'org_profile',
    action: 'view',
    protectedPath: '/api/v1/console/business-domains'
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') continue
    if (item === '--help' || item === '-h') {
      args.help = true
      continue
    }
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]
    const consume = () => {
      if (equalsIndex < 0) index += 1
      if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`)
      return value
    }
    const consumeEnv = () => {
      const envName = consume()
      const envValue = String(process.env[envName] || '').trim()
      if (!envValue) throw new Error(`environment variable is empty: ${envName}`)
      return envValue
    }

    switch (name) {
      case 'base-url': args.baseUrl = consume().replace(/\/+$/, ''); break
      case 'cookie-env': args.cookie = consumeEnv(); break
      case 'denied-cookie-env': args.deniedCookie = consumeEnv(); break
      case 'resource': args.resource = consume(); break
      case 'action': args.action = consume(); break
      case 'protected-path': args.protectedPath = consume(); break
      default: throw new Error(`unknown option: --${name}`)
    }
  }

  return args
}

function info(message) {
  console.info(`[${SCRIPT}] ${message}`)
}

function normalizeCookie(value) {
  const cookie = String(value || '').trim()
  if (!cookie) return ''
  return cookie.includes('=') ? cookie : `console_session=${cookie}`
}

async function requestJson(url, cookie = '') {
  const headers = { accept: 'application/json' }
  if (cookie) headers.cookie = cookie

  const response = await fetch(url, { headers, redirect: 'manual' })
  let json = null
  try {
    json = await response.json()
  } catch {
    json = null
  }

  return { status: response.status, json }
}

function actionSatisfied(actions, action) {
  const granted = Array.isArray(actions) ? actions : []
  if (action === 'view') {
    return granted.includes('view') || granted.includes('edit') || granted.includes('admin')
  }
  if (action === 'edit') {
    return granted.includes('edit') || granted.includes('admin')
  }
  return granted.includes(action)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage())
    return
  }
  if (!args.cookie) throw new Error('--cookie-env is required（已授权测试用户的 Console 会话）')

  const authorizedCookie = normalizeCookie(args.cookie)
  const deniedCookie = normalizeCookie(args.deniedCookie)
  const permissionsUrl = `${args.baseUrl}/api/auth/permissions`
  const protectedUrl = `${args.baseUrl}${args.protectedPath}`
  const failures = []
  const check = (condition, okMessage, failMessage) => {
    if (condition) {
      info(`ok: ${okMessage}`)
    } else {
      failures.push(failMessage)
      console.error(`[${SCRIPT}] FAIL: ${failMessage}`)
    }
  }

  // 1. 未登录 permissions -> 401
  const anonymous = await requestJson(permissionsUrl)
  check(
    anonymous.status === 401,
    'anonymous /api/auth/permissions returns 401',
    `anonymous /api/auth/permissions expected 401, got ${anonymous.status}`
  )

  // 2. 已授权用户 permissions 包含目标资源
  const authorized = await requestJson(permissionsUrl, authorizedCookie)
  if (authorized.status !== 200 || authorized.json?.code !== 0) {
    const reason = authorized.json?.data?.reason || authorized.json?.message || `HTTP ${authorized.status}`
    throw new Error(`authorized /api/auth/permissions failed: ${reason}（检查会话 cookie 与本地 bundle 状态，reason=bundle_unavailable 时先确认 Console 已拉取 bundle）`)
  }
  const data = authorized.json.data || {}
  info(`authorized snapshot: uid=${data.uid} roles=${JSON.stringify(data.roles || [])}`)
  check(
    actionSatisfied((data.resources || {})[args.resource], args.action),
    `resource ${args.resource}:${args.action} granted`,
    `resource ${args.resource}:${args.action} not granted; resources=${JSON.stringify(data.resources || {})}`
  )

  // 3. 已授权用户访问受保护接口
  const protectedOk = await requestJson(protectedUrl, authorizedCookie)
  check(
    protectedOk.status >= 200 && protectedOk.status < 300,
    `authorized user can access ${args.protectedPath} (HTTP ${protectedOk.status})`,
    `authorized user expected 2xx on ${args.protectedPath}, got ${protectedOk.status}`
  )

  // 4. 未登录访问受保护接口被拦截
  const protectedAnonymous = await requestJson(protectedUrl)
  check(
    protectedAnonymous.status === 401 || protectedAnonymous.status === 403,
    `anonymous request to ${args.protectedPath} blocked (HTTP ${protectedAnonymous.status})`,
    `anonymous request to ${args.protectedPath} expected 401/403, got ${protectedAnonymous.status}`
  )

  // 5. 未授权用户反向验证（可选）
  if (deniedCookie) {
    const denied = await requestJson(permissionsUrl, deniedCookie)
    if (denied.status === 200 && denied.json?.code === 0) {
      const deniedData = denied.json.data || {}
      check(
        !actionSatisfied((deniedData.resources || {})[args.resource], args.action),
        `denied user has no ${args.resource}:${args.action}`,
        `denied user unexpectedly granted ${args.resource}:${args.action}`
      )
    } else {
      info(`denied user permissions returned HTTP ${denied.status}（视为无权限）`)
    }

    const deniedProtected = await requestJson(protectedUrl, deniedCookie)
    check(
      deniedProtected.status === 401 || deniedProtected.status === 403,
      `denied user blocked on ${args.protectedPath} (HTTP ${deniedProtected.status})`,
      `denied user expected 401/403 on ${args.protectedPath}, got ${deniedProtected.status}`
    )
  } else {
    info('skipped: denied-user checks (--denied-cookie-env not provided)')
  }

  if (failures.length) {
    console.error(`[${SCRIPT}] ${failures.length} check(s) failed`)
    process.exit(1)
  }

  info('passed: console policy consumption checks')
  info('提示：菜单过滤与路由守卫的 UI 核对步骤见 docs/Console-Policy-Authorization-Acceptance-Runbook.md')
}

main().catch((error) => {
  console.error(`[${SCRIPT}] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
