#!/usr/bin/env node
/**
 * E8-T23: Platform 角色权限治理链路验收脚本。
 *
 * 验收链路：全局企业角色存在 -> 物化到租户 -> 出现在可分配角色 ->
 * 授权给 user subject -> 生成 policy bundle 并断言 payload 数据。
 *
 * 依赖一个具备 tenant owner 身份的 Platform Dashboard 账号
 * （生成 bundle 的 API 仅 tenant owner 可调用）。
 */
import process from 'node:process'

const SCRIPT = 'accept-platform-policy-roles'
const POLICY_BUNDLE_V2_SCHEMA_VERSION = 'policy-bundle.v2'
const PLATFORM_AUTHORIZATION_ADMIN_APP_ROLE = 'platform:authorization_admin'
const PLATFORM_AUTHORIZATION_SIMULATOR_APP_ROLE = 'platform:authorization_simulator'
const PLATFORM_AUTHORIZATION_SIMULATION_PERMISSIONS = [
  'platform:authorization:simulate-role',
  'platform:authorization:simulate-user'
]

function usage() {
  return `
Usage:
  pnpm run accept:platform-policy-roles -- \\
    --base-url http://127.0.0.1:3011 \\
    --tenant-code <tenantCode> \\
    --subject-code <uid> \\
    [--role-code system_admin] \\
    [--environment production] \\
    [--email-env PLATFORM_ACCEPT_EMAIL --password-env PLATFORM_ACCEPT_PASSWORD] \\
    [--cookie-env PLATFORM_ACCEPT_COOKIE]

认证方式二选一：
  1. --email-env / --password-env：指向存放 Dashboard 登录邮箱/密码的环境变量，
     脚本通过 POST /api/platform/auth/login 换取会话 cookie。
  2. --cookie-env：指向存放完整 Cookie 串的环境变量
     （从浏览器复制 hzy_tenant_dashboard_session=... 即可）。

前置条件：
  - Platform 服务可访问，登录账号是目标租户 owner。
  - 已导入当前 app manifest，并已执行 HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql。
  - 测试用户已投影到 tenant_subjects（subjectType=user，subjectCode=uid）。
`
}

function parseArgs(argv) {
  const args = {
    baseUrl: 'http://127.0.0.1:3011',
    tenantCode: '',
    subjectCode: '',
    roleCode: 'system_admin',
    environment: '',
    email: '',
    password: '',
    cookie: ''
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
      case 'tenant-code': args.tenantCode = consume(); break
      case 'subject-code': args.subjectCode = consume(); break
      case 'role-code': args.roleCode = consume(); break
      case 'environment': args.environment = consume(); break
      case 'email-env': args.email = consumeEnv(); break
      case 'password-env': args.password = consumeEnv(); break
      case 'cookie-env': args.cookie = consumeEnv(); break
      default: throw new Error(`unknown option: --${name}`)
    }
  }

  return args
}

function info(message) {
  console.info(`[${SCRIPT}] ${message}`)
}

function fail(message) {
  console.error(`[${SCRIPT}] FAIL: ${message}`)
}

function extractCookies(response) {
  const cookies = response.headers.getSetCookie?.() || []
  return cookies
    .map(cookie => String(cookie).split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

async function requestJson(url, { method = 'GET', cookie = '', tenantCode = '', body } = {}) {
  const headers = { accept: 'application/json' }
  if (cookie) headers.cookie = cookie
  if (tenantCode) headers['x-hzy-tenant-code'] = tenantCode
  if (body !== undefined) headers['content-type'] = 'application/json'

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  })

  let json = null
  try {
    json = await response.json()
  } catch {
    json = null
  }

  return { status: response.status, json, response }
}

function dataOf(result, label) {
  if (result.status < 200 || result.status >= 300 || result.json?.success !== true) {
    const message = result.json?.message || result.json?.statusMessage || `HTTP ${result.status}`
    throw new Error(`${label} failed: ${message}`)
  }
  return result.json.data
}

function objectOf(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

function arrayOf(value) {
  return Array.isArray(value) ? value : []
}

function fieldOf(row, ...keys) {
  if (!row || typeof row !== 'object') return ''
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null) return String(value).trim()
  }
  return ''
}

function isActiveRow(row) {
  return (fieldOf(row, 'status') || 'active') === 'active'
}

function permissionKey(row) {
  return [
    fieldOf(row, 'appCode', 'app_code'),
    fieldOf(row, 'resourceCode', 'resource_code'),
    fieldOf(row, 'action')
  ].join(':')
}

async function login(args) {
  if (args.cookie) {
    info('auth: using cookie from environment variable')
    return args.cookie
  }

  if (!args.email || !args.password) {
    throw new Error('missing credentials: provide --cookie-env, or --email-env and --password-env')
  }

  const result = await requestJson(`${args.baseUrl}/api/platform/auth/login`, {
    method: 'POST',
    body: { email: args.email, password: args.password }
  })

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`login failed: ${result.json?.message || `HTTP ${result.status}`}`)
  }

  const cookie = extractCookies(result.response)
  if (!cookie) {
    throw new Error('login succeeded but no session cookie returned')
  }

  info('auth: dashboard login ok')
  return cookie
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage())
    return
  }
  if (!args.tenantCode) throw new Error('--tenant-code is required')
  if (!args.subjectCode) throw new Error('--subject-code is required')

  const cookie = await login(args)
  const ctx = { cookie, tenantCode: args.tenantCode }
  const failures = []

  // Step 1: 全局企业角色存在
  const systemRoles = dataOf(
    await requestJson(
      `${args.baseUrl}/api/platform/tenant-admin/system-roles?tenantCode=${encodeURIComponent(args.tenantCode)}&pageSize=200`,
      ctx
    ),
    'list system roles'
  )
  const systemRole = (systemRoles.items || []).find(item => item.roleCode === args.roleCode)
  if (!systemRole) {
    throw new Error(`global system role not found: ${args.roleCode} (检查 HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql 是否已执行)`)
  }
  if (systemRole.status !== 'active') {
    failures.push(`system role ${args.roleCode} status is ${systemRole.status}, expected active`)
  }
  info(`step 1 ok: global role ${args.roleCode} exists (enabled=${systemRole.enabled})`)

  // Step 2: 物化到租户
  const enableResult = dataOf(
    await requestJson(`${args.baseUrl}/api/platform/tenant-admin/system-roles/${encodeURIComponent(args.roleCode)}/enable`, {
      ...ctx,
      method: 'POST',
      body: { tenantCode: args.tenantCode }
    }),
    'enable system role'
  )
  info(`step 2 ok: role materialized to tenant (${JSON.stringify(enableResult).slice(0, 200)})`)

  // Step 3: 出现在可分配角色列表
  const assignable = dataOf(
    await requestJson(
      `${args.baseUrl}/api/platform/tenant-admin/assignable-roles?tenantCode=${encodeURIComponent(args.tenantCode)}&keyword=${encodeURIComponent(args.roleCode)}&pageSize=100`,
      ctx
    ),
    'list assignable roles'
  )
  const tenantRole = (assignable.items || []).find(item => item.roleCode === args.roleCode)
  if (!tenantRole) {
    failures.push(`role ${args.roleCode} not found in assignable roles after enable`)
  } else if (!tenantRole.isAssignable || tenantRole.status !== 'active') {
    failures.push(`tenant role ${args.roleCode} is not active assignable (status=${tenantRole.status}, isAssignable=${tenantRole.isAssignable})`)
  } else {
    info(`step 3 ok: tenant role assignable (id=${tenantRole.id}, source=${tenantRole.source})`)
  }

  // Step 4: 授权给 user subject
  const grantResult = await requestJson(`${args.baseUrl}/api/platform/tenant-admin/subject-roles`, {
    ...ctx,
    method: 'POST',
    body: {
      tenantCode: args.tenantCode,
      subjectType: 'user',
      subjectCode: args.subjectCode,
      roleCode: args.roleCode
    }
  })
  if (grantResult.status === 404) {
    throw new Error(`grant failed: ${grantResult.json?.message || 'not found'}（若提示 subject not found，需先把测试用户投影同步到 tenant_subjects）`)
  }
  const grant = dataOf(grantResult, 'grant role to subject')
  info(`step 4 ok: granted ${args.roleCode} to user ${args.subjectCode} (assignment id=${grant.id})`)

  // Step 5: 生成 bundle 并断言 payload
  const bundle = dataOf(
    await requestJson(`${args.baseUrl}/api/platform/tenant-admin/bundles`, {
      ...ctx,
      method: 'POST',
      body: {
        includePayload: true,
        ...(args.environment ? { environment: args.environment } : {})
      }
    }),
    'generate policy bundle'
  )
  info(`step 5: bundle generated (version=${bundle.bundleVersion}, hash=${String(bundle.bundleHash).slice(0, 16)}..., targets=${bundle.targetCount})`)

  const payload = objectOf(bundle.payload)
  const roles = arrayOf(payload.roles)
  const roleAssignments = arrayOf(payload.roleAssignments)
  const rolePermissionGrants = arrayOf(payload.rolePermissionGrants)
  const subjects = arrayOf(payload.subjects)

  if (payload.schemaVersion !== POLICY_BUNDLE_V2_SCHEMA_VERSION) {
    failures.push(`bundle payload.schemaVersion is ${payload.schemaVersion || '<empty>'}, expected ${POLICY_BUNDLE_V2_SCHEMA_VERSION}`)
  }
  if (!arrayOf(payload.compatSchemaVersions).includes(POLICY_BUNDLE_V2_SCHEMA_VERSION)) {
    failures.push(`bundle payload.compatSchemaVersions does not include ${POLICY_BUNDLE_V2_SCHEMA_VERSION}`)
  }
  if (!Array.isArray(payload.roleAssignments)) {
    failures.push('bundle payload.roleAssignments is missing（检查是否仍在生成旧版 policy bundle）')
  }
  if (!Array.isArray(payload.rolePermissionGrants)) {
    failures.push('bundle payload.rolePermissionGrants is missing（检查是否仍在生成旧版 policy bundle）')
  }

  if (!roles.some(role => fieldOf(role, 'roleCode', 'role_code') === args.roleCode && isActiveRow(role))) {
    failures.push(`bundle payload.roles does not contain ${args.roleCode}`)
  }
  if (!roleAssignments.some(row =>
    fieldOf(row, 'subjectCode', 'subject_code') === args.subjectCode
    && fieldOf(row, 'roleCode', 'role_code') === args.roleCode
    && isActiveRow(row)
  )) {
    failures.push(`bundle payload.roleAssignments does not contain active (${args.subjectCode}, ${args.roleCode})`)
  }
  const roleGrantRows = rolePermissionGrants.filter(row =>
    fieldOf(row, 'roleCode', 'role_code') === args.roleCode
    && isActiveRow(row)
  )
  const permissionCount = roleGrantRows.length
  if (!permissionCount) {
    failures.push(`bundle payload.rolePermissionGrants has no active rows for ${args.roleCode}（检查角色的 app-role 映射 / 权限配置）`)
  }
  if (!subjects.some(row =>
    fieldOf(row, 'subjectType', 'subject_type') === 'user'
    && (
      fieldOf(row, 'subjectCode', 'subject_code') === args.subjectCode
      || fieldOf(row, 'externalRef', 'external_ref') === args.subjectCode
    )
    && isActiveRow(row)
  )) {
    failures.push(`bundle payload.subjects does not contain user subject ${args.subjectCode}（baseline 权限依赖该投影）`)
  }
  if (args.roleCode === 'system_admin') {
    for (const permission of PLATFORM_AUTHORIZATION_SIMULATION_PERMISSIONS) {
      if (!roleGrantRows.some(row =>
        permissionKey(row) === permission
        && fieldOf(row, 'appRoleCode', 'app_role_code') === PLATFORM_AUTHORIZATION_SIMULATOR_APP_ROLE
      )) {
        failures.push(`bundle payload.rolePermissionGrants missing ${permission} from ${PLATFORM_AUTHORIZATION_SIMULATOR_APP_ROLE}`)
      }
    }

    const adminSourcedSimulationPermissions = roleGrantRows
      .filter(row =>
        PLATFORM_AUTHORIZATION_SIMULATION_PERMISSIONS.includes(permissionKey(row))
        && fieldOf(row, 'appRoleCode', 'app_role_code') === PLATFORM_AUTHORIZATION_ADMIN_APP_ROLE
      )
      .map(row => permissionKey(row))
      .sort()
    if (adminSourcedSimulationPermissions.length) {
      failures.push(`role simulation permissions still come from ${PLATFORM_AUTHORIZATION_ADMIN_APP_ROLE}: ${adminSourcedSimulationPermissions.join(', ')}`)
    }
  }

  if (failures.length) {
    for (const message of failures) fail(message)
    process.exit(1)
  }

  info(`passed: role=${args.roleCode} subject=${args.subjectCode} permissions=${permissionCount} bundleVersion=${bundle.bundleVersion}`)
  info('提示：Console 侧需拉取该新版本 bundle 后再执行 accept:console-policy-consumption')
}

main().catch((error) => {
  console.error(`[${SCRIPT}] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
