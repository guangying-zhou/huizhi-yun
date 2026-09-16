import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import {
  loadAuthorizationFromCachedPlatformBundle,
  loadAuthorizationSnapshotFromConsoleRuntime,
  loadInstanceConflictExplanationFromConsoleRuntime,
  loadScopedAuthorizationFromConsoleRuntime
} from '../server/utils/platformBundleAuthorization.ts'

type FetchCall = {
  url: string
  options: Record<string, unknown>
}

type ServiceBindingCall = {
  url: string
  init: RequestInit
}

type RuntimeConfig = ReturnType<typeof runtimeConfig>

const originalFetch = (globalThis as { $fetch?: unknown }).$fetch
const originalRuntimeConfig = (globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig
const workspaceRoot = resolve(import.meta.dirname, '../..')
const businessApplicationDirs = [
  'aims',
  'align',
  'altoc',
  'assets',
  'codocs',
  'finance',
  'insights',
  'people',
  'webdev',
  'workflow'
]
const ignoredSourceDirs = new Set(['.git', '.nuxt', '.output', 'coverage', 'dist', 'node_modules'])
const sourceFilePattern = /\.(?:ts|tsx|js|mjs|cjs|vue)$/
const forbiddenBusinessBundleFallbackPattern = /\b(?:readCachedPlatformBundle|loadAuthorizationFromCachedPlatformBundle|listUserCodesByRoleFromCachedPlatformBundle)\b|HZY_(?:LOCAL_)?POLICY_BUNDLE|policy-bundle\.(?:json|jsonc|jwt)/i

function runtimeConfig(baseUrl: string, bundleVersion = 'runtime-bundle') {
  return {
    schemaVersion: 'console-runtime.v1',
    app: {
      appCode: 'altoc',
      appName: 'Altoc'
    },
    console: {
      baseUrl,
      issuer: baseUrl,
      tokenUrl: `${baseUrl}/oauth/token`,
      bootstrapTokenUrl: `${baseUrl}/api/v1/console/bootstrap/token`,
      authMeUrl: `${baseUrl}/api/v1/console/auth/me`,
      directoryApiUrl: `${baseUrl}/api/v1/console/directory`,
      settingsApiUrl: `${baseUrl}/api/v1/console/settings`,
      integrationsApiUrl: `${baseUrl}/api/v1/console/integrations`,
      userApplicationsUrl: `${baseUrl}/api/user/applications`
    },
    tenant: {
      tenantCode: 'C000001'
    },
    deployment: {
      deploymentCode: 'altoc-prod',
      publicUrl: 'https://altoc.example.test',
      basePath: '/altoc'
    },
    applications: [],
    bundle: {
      bundleVersion,
      bundleHash: `${bundleVersion}-hash`
    },
    fetchedAt: '2026-06-30T00:00:00Z'
  } as const
}

function makeEvent(appCode: string, consoleUrl: string, headers: Record<string, string> = {}) {
  return {
    context: {
      cloudflare: {
        env: {
          HZY_APP_CODE: appCode,
          HZY_CONSOLE_RUNTIME_API_URL: consoleUrl
        }
      }
    },
    node: {
      req: {
        url: '/api/test',
        originalUrl: '/api/test',
        headers: {
          host: 'altoc.example.test',
          cookie: 'console_session=session-1',
          ...headers
        }
      }
    },
    path: '/api/test'
  } as never
}

function installRuntimeConfig() {
  ;(globalThis as { useRuntimeConfig?: () => Record<string, unknown> }).useRuntimeConfig = () => ({})
}

function installFetch(handler: (url: string, options: Record<string, unknown>) => unknown | Promise<unknown>) {
  const calls: FetchCall[] = []
  ;(globalThis as { $fetch?: typeof handler }).$fetch = async (url: string, options: Record<string, unknown> = {}) => {
    calls.push({ url, options })
    return await handler(url, options)
  }
  return calls
}

function installConsoleRuntimeFetch(params: {
  appCode: string
  seedUrl: string
  runtime?: RuntimeConfig
  permissions?: Record<string, unknown>
  scoped?: Record<string, unknown>
}) {
  return installFetch((url) => {
    if (url === `${params.seedUrl}/api/v1/console/runtime/apps/${encodeURIComponent(params.appCode)}/config`) {
      return {
        code: 0,
        data: params.runtime || runtimeConfig(params.seedUrl)
      }
    }
    if (url.endsWith('/api/auth/permissions') || url.endsWith('/api/v1/console/user/permissions')) {
      return {
        code: 0,
        data: params.permissions || {
          uid: 'u1',
          roles: ['sales'],
          availableRoles: [{ roleCode: 'sales', roleName: '销售', roleType: 'tenant', appCode: null }],
          activeRoleCode: 'sales',
          authorizationMode: 'merged',
          resources: { customers: ['view'] },
          bundleVersion: 'bundle-v1',
          bundleHash: 'hash-v1',
          policyRevision: 1
        }
      }
    }
    if (url.endsWith('/api/auth/scoped-authorization') || url.endsWith('/api/v1/console/user/scoped-authorization')) {
      return {
        code: 0,
        data: params.scoped || {
          uid: 'u1',
          appCode: 'altoc',
          roles: ['sales'],
          availableRoles: [],
          activeRoleCode: 'sales',
          authorizationMode: 'role_simulation',
          bundleVersion: 'bundle-v1',
          bundleHash: 'hash-v1',
          policyRevision: 1,
          grants: [{
            grantId: 'assignment:1:sales',
            roleCode: 'sales',
            source: 'assignment',
            permissions: [{ appCode: 'altoc', resourceCode: 'customer', action: 'view' }],
            scopes: [{ dimension: 'department', predicate: 'self', value: 'dept-sales', source: 'assignment' }]
          }],
          decision: { allowed: true, reasonCode: 'allowed', matchedGrantId: 'assignment:1:sales' }
        }
      }
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

function walkSourceFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const stat = statSync(root)
  if (stat.isFile()) return sourceFilePattern.test(root) ? [root] : []

  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredSourceDirs.has(entry.name)) continue
    const child = resolve(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(child))
    } else if (sourceFilePattern.test(entry.name)) {
      files.push(child)
    }
  }
  return files
}

function businessRuntimeSourceFiles() {
  const roots = businessApplicationDirs.flatMap((appDir) => {
    const appRoot = resolve(workspaceRoot, appDir)
    return [
      resolve(appRoot, 'app'),
      resolve(appRoot, 'server'),
      resolve(appRoot, 'nuxt.config.ts'),
      resolve(appRoot, 'app.config.ts')
    ]
  })
  return roots.flatMap(root => walkSourceFiles(root))
}

afterEach(() => {
  if (originalFetch === undefined) {
    delete (globalThis as { $fetch?: unknown }).$fetch
  } else {
    ;(globalThis as { $fetch?: unknown }).$fetch = originalFetch
  }
  if (originalRuntimeConfig === undefined) {
    delete (globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig
  } else {
    ;(globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig = originalRuntimeConfig
  }
})

describe('Foundation Console authorization runtime client', () => {
  test('authorization helper cannot read local policy bundle files', () => {
    const source = readFileSync(new URL('../server/utils/platformBundleAuthorization.ts', import.meta.url), 'utf8')

    assert.doesNotMatch(source, /from ['"]node:fs['"]/)
    assert.doesNotMatch(source, /from ['"]fs['"]/)
    assert.doesNotMatch(source, /\breadFile(?:Sync)?\b/)
    assert.doesNotMatch(source, /\bcreateReadStream\b/)
    assert.doesNotMatch(source, /HZY_(?:LOCAL_)?POLICY_BUNDLE/i)
    assert.doesNotMatch(source, /policy-bundle\.(?:json|jsonc|jwt)/i)
  })

  test('business application runtime code does not call local policy bundle readers', () => {
    const files = businessRuntimeSourceFiles()
    assert.ok(files.length > 0)

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      assert.doesNotMatch(
        source,
        forbiddenBusinessBundleFallbackPattern,
        `${relative(workspaceRoot, file)} must consume Console/Foundation authorization instead of local policy bundle readers`
      )
    }
  })

  test('loads normal authorization snapshots from Console and exposes the latest bundle revision', async () => {
    installRuntimeConfig()
    const seedUrl = 'https://console-runtime-v1.example.test'
    const calls = installConsoleRuntimeFetch({
      appCode: 'altoc-client-v1',
      seedUrl,
      runtime: runtimeConfig('https://console-runtime-v1.example.test', 'runtime-bundle-v1'),
      permissions: {
        uid: 'u1',
        roles: ['sales'],
        availableRoles: [{ roleCode: 'sales', roleName: '销售', roleType: 'tenant', appCode: null }],
        activeRoleCode: 'sales',
        authorizationMode: 'merged',
        resources: { customers: ['view'], contracts: ['view', 'edit'] },
        actionPolicies: {
          contracts: {
            implications: {
              edit: ['view', 'view'],
              admin: ['edit', 'view']
            }
          },
          invalid: { implications: { admin: 'view' } }
        },
        bundleVersion: 'bundle-v1',
        bundleHash: 'hash-v1',
        policyRevision: 11
      }
    })

    const event = makeEvent('altoc-client-v1', seedUrl)
    const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime('u1', 'altoc', event)

    assert.equal(snapshot.bundleVersion, 'bundle-v1')
    assert.equal(snapshot.bundleHash, 'hash-v1')
    assert.equal(snapshot.policyRevision, 11)
    assert.deepEqual(snapshot.resources, { contracts: ['edit', 'view'], customers: ['view'] })
    assert.deepEqual(snapshot.actionPolicies, {
      contracts: {
        implications: {
          admin: ['edit', 'view'],
          edit: ['view']
        }
      }
    })
    assert.equal(calls.some(call => call.url.endsWith('/api/auth/permissions')), true)
  })

  test('uses the Cloudflare Console service binding for authorization snapshots', async () => {
    installRuntimeConfig()
    const seedUrl = 'https://tenant.example.test/console'
    const event = makeEvent('codocs', seedUrl)
    const bindingCalls: ServiceBindingCall[] = []
    ;(event as {
      context: {
        cloudflare: {
          env: Record<string, unknown>
        }
      }
    }).context.cloudflare.env.HZY_CONSOLE_SERVICE = {
      async fetch(input: string | URL | Request, init: RequestInit = {}) {
        const url = new URL(String(input))
        bindingCalls.push({
          url: url.toString(),
          init
        })
        if (url.pathname.endsWith('/scoped-authorization')) {
          return Response.json({
            code: 0,
            data: {
              uid: 'caoqian',
              appCode: 'codocs',
              roles: [],
              availableRoles: [],
              activeRoleCode: '',
              authorizationMode: 'merged',
              bundleVersion: 'bundle-binding',
              bundleHash: 'hash-binding',
              policyRevision: 42,
              grants: []
            }
          })
        }
        if (url.pathname.endsWith('/instance-conflict-explain')) {
          return Response.json({
            code: 0,
            data: {
              tenantCode: 'C000001',
              uid: 'caoqian',
              requested: {
                appCode: 'codocs',
                resourceCode: 'documents',
                action: 'create'
              },
              principals: [],
              hasViolation: false,
              hasBlockingViolation: false,
              hasWarningViolation: false,
              rules: []
            }
          })
        }
        return Response.json({
          code: 0,
          data: {
            uid: 'caoqian',
            roles: [],
            availableRoles: [],
            activeRoleCode: '',
            authorizationMode: 'merged',
            resources: { documents: ['create', 'view'] },
            bundleVersion: 'bundle-binding',
            bundleHash: 'hash-binding',
            policyRevision: 42
          }
        })
      }
    }
    const directCalls = installFetch((url) => {
      if (url === `${seedUrl}/api/v1/console/runtime/apps/codocs/config`) {
        return { code: 0, data: runtimeConfig(seedUrl, 'runtime-binding') }
      }
      throw new Error(`authorization request bypassed Console service binding: ${url}`)
    })

    const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime('caoqian', 'codocs', event)
    const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, 'caoqian', 'codocs', {
      resourceCode: 'documents',
      action: 'create'
    })
    const conflict = await loadInstanceConflictExplanationFromConsoleRuntime(event, 'caoqian', 'codocs', {
      resourceCode: 'documents',
      action: 'create'
    })

    assert.deepEqual(snapshot.resources, { documents: ['create', 'view'] })
    assert.deepEqual(scoped.grants, [])
    assert.equal(conflict.hasViolation, false)
    // runtime config 现在也经 Service Binding 取（避免公网 WAF 地理规则拦截 cron 子请求），
    // 因此 binding 调用数为 3 次授权请求 + 1 次 runtime config。
    assert.equal(bindingCalls.length, 4)
    const permissionsCall = bindingCalls.find(
      call => new URL(call.url).pathname === '/api/auth/permissions'
    )
    assert.ok(permissionsCall, 'permissions 请求必须经 Service Binding')
    assert.equal(new URL(permissionsCall.url).searchParams.get('appCode'), 'codocs')
    assert.ok(
      bindingCalls.some(call => new URL(call.url).pathname.includes('/console/runtime/apps/')),
      'runtime config 也必须经 Service Binding'
    )
    assert.equal(
      directCalls.some(call => call.url.includes('/api/auth/permissions')),
      false
    )
    assert.deepEqual(
      bindingCalls.map(call => new URL(call.url).pathname),
      [
        '/api/v1/console/runtime/apps/codocs/config',
        '/api/auth/permissions',
        '/api/auth/scoped-authorization',
        '/api/auth/instance-conflict-explain'
      ]
    )
  })

  test('forwards the simulation cookie even when a Console access token is present', async () => {
    installRuntimeConfig()
    const seedUrl = 'https://console-runtime-simcookie.example.test'
    const calls = installConsoleRuntimeFetch({
      appCode: 'altoc-client-simcookie',
      seedUrl,
      runtime: runtimeConfig(seedUrl, 'runtime-bundle-simcookie')
    })

    const event = makeEvent('altoc-client-simcookie', seedUrl, {
      'cookie': 'console_session=session-1; hzy_authorization_simulation=sim-token-1',
      'x-hzy-app-code': 'altoc',
      'x-hzy-data-runtime-url': 'https://tenant-runtime.example.test',
      'x-hzy-data-runtime-code': 'c000001-prod-tenant-runtime',
      'x-hzy-data-runtime-token': 'runtime-bootstrap-token',
      'x-hzy-data-runtime-audience': 'data-runtime'
    })
    ;(event as { context: Record<string, unknown> }).context.consoleAuth = {
      authenticated: true,
      token: 'access-token-1',
      tokenUse: 'oidc',
      subjectType: 'user'
    }

    await loadAuthorizationSnapshotFromConsoleRuntime('u1', 'altoc', event)

    // Access token path hits the bearer endpoint...
    const permissionsCall = calls.find(call => call.url.endsWith('/api/v1/console/user/permissions'))
    assert.ok(permissionsCall, 'expected the bearer permissions endpoint to be called')
    const headers = permissionsCall.options.headers as Record<string, string>
    assert.equal(headers.authorization, 'Bearer access-token-1')
    // ...but the browser cookie (carrying hzy_authorization_simulation) must still be forwarded
    // so an active role/user simulation narrows business-app snapshots too, matching the
    // scoped-authorization loader. Regression guard for the else-if -> if fix.
    assert.match(headers.cookie, /hzy_authorization_simulation=sim-token-1/)
    assert.equal(headers['x-hzy-app-code'], 'altoc')
    assert.equal(headers['x-hzy-data-runtime-url'], 'https://tenant-runtime.example.test')
    assert.equal(headers['x-hzy-data-runtime-code'], 'c000001-prod-tenant-runtime')
    assert.equal(headers['x-hzy-data-runtime-token'], 'runtime-bootstrap-token')
    assert.equal(headers['x-hzy-data-runtime-audience'], 'data-runtime')
    assert.equal(calls.some(call => call.url.endsWith('/api/auth/permissions')), false)
  })

  test('does not reuse stale authorization snapshots when Console returns a newer bundle', async () => {
    installRuntimeConfig()
    const seedUrl = 'https://console-runtime-v2.example.test'
    let bundleRevision = 20
    installConsoleRuntimeFetch({
      appCode: 'altoc-client-v2',
      seedUrl,
      runtime: runtimeConfig(seedUrl, 'runtime-bundle-v2'),
      get permissions() {
        return {
          uid: 'u1',
          roles: ['sales'],
          availableRoles: [],
          activeRoleCode: 'sales',
          authorizationMode: 'merged',
          resources: { customers: ['view'] },
          bundleVersion: `bundle-v${bundleRevision}`,
          bundleHash: `hash-v${bundleRevision}`,
          policyRevision: bundleRevision
        }
      }
    } as Parameters<typeof installConsoleRuntimeFetch>[0])

    const event = makeEvent('altoc-client-v2', seedUrl)
    const first = await loadAuthorizationSnapshotFromConsoleRuntime('u1', 'altoc', event)
    bundleRevision = 21
    const second = await loadAuthorizationSnapshotFromConsoleRuntime('u1', 'altoc', event)

    assert.equal(first.bundleVersion, 'bundle-v20')
    assert.equal(first.policyRevision, 20)
    assert.equal(second.bundleVersion, 'bundle-v21')
    assert.equal(second.policyRevision, 21)
  })

  test('fails closed when Console authorization is unavailable instead of reading a local bundle fallback', async () => {
    installRuntimeConfig()
    const seedUrl = 'https://console-runtime-down.example.test'
    installFetch((url) => {
      if (url === `${seedUrl}/api/v1/console/runtime/apps/altoc-client-down/config`) {
        return { code: 0, data: runtimeConfig(seedUrl) }
      }
      throw new Error('console is down')
    })

    const event = makeEvent('altoc-client-down', seedUrl)

    await assert.rejects(
      () => loadAuthorizationSnapshotFromConsoleRuntime('u1', 'altoc', event),
      (error: unknown) => {
        const err = error as { statusCode?: number, statusMessage?: string, message?: string }
        assert.equal(err.statusCode, 503)
        assert.equal(err.statusMessage, 'Authorization Unavailable')
        assert.match(String(err.message), /no longer fall back to local policy bundle/)
        return true
      }
    )
  })

  test('legacy cached-bundle alias delegates to Console when a request context is present', async () => {
    installRuntimeConfig()
    const seedUrl = 'https://console-runtime-alias.example.test'
    const calls = installConsoleRuntimeFetch({
      appCode: 'altoc-client-alias',
      seedUrl,
      permissions: {
        uid: 'u1',
        roles: ['sales'],
        availableRoles: [],
        activeRoleCode: 'sales',
        authorizationMode: 'merged',
        resources: { opportunities: ['view'] },
        bundleVersion: 'bundle-alias',
        bundleHash: 'hash-alias',
        policyRevision: 31
      }
    })

    const event = makeEvent('altoc-client-alias', seedUrl)
    const snapshot = await loadAuthorizationFromCachedPlatformBundle('u1', 'altoc', event)

    assert.equal(snapshot?.bundleVersion, 'bundle-alias')
    assert.deepEqual(snapshot?.resources, { opportunities: ['view'] })
    assert.equal(calls.some(call => call.url.endsWith('/api/auth/permissions')), true)
  })

  test('forwards scoped authorization simulation and object context to Console', async () => {
    installRuntimeConfig()
    const seedUrl = 'https://console-runtime-scoped.example.test'
    const calls = installConsoleRuntimeFetch({
      appCode: 'altoc-client-scoped',
      seedUrl,
      scoped: {
        uid: 'u1',
        appCode: 'altoc',
        roles: ['sales'],
        availableRoles: [],
        activeRoleCode: 'sales',
        authorizationMode: 'role_simulation',
        bundleVersion: 'bundle-scoped',
        bundleHash: 'hash-scoped',
        policyRevision: 41,
        grants: [{
          grantId: 'assignment:1:sales',
          roleCode: 'sales',
          source: 'assignment',
          permissions: [{ appCode: 'altoc', resourceCode: 'customer', action: 'view' }],
          scopes: [{ dimension: 'department', predicate: 'self', value: 'dept-sales', source: 'assignment' }]
        }],
        decision: { allowed: true, reasonCode: 'allowed', matchedGrantId: 'assignment:1:sales' }
      }
    })

    const event = makeEvent('altoc-client-scoped', seedUrl)
    const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, 'u1', 'altoc', {
      activeRoleCode: 'sales',
      authorizationMode: 'role_simulation',
      resourceCode: 'customer',
      action: 'view',
      object: { departmentCode: 'dept-sales', actorUid: 'u1' }
    })

    const scopedCall = calls.find(call => call.url.endsWith('/api/auth/scoped-authorization'))
    assert.ok(scopedCall)
    assert.deepEqual(scopedCall.options.body, {
      appCode: 'altoc',
      activeRoleCode: 'sales',
      authorizationMode: 'role_simulation',
      resourceCode: 'customer',
      action: 'view',
      object: { departmentCode: 'dept-sales', actorUid: 'u1' }
    })
    assert.equal(snapshot.policyRevision, 41)
    assert.equal(snapshot.decision?.allowed, true)
  })

  test('scoped authorization also fails closed when Console rejects all attempts', async () => {
    installRuntimeConfig()
    const seedUrl = 'https://console-runtime-scoped-down.example.test'
    installFetch((url) => {
      if (url === `${seedUrl}/api/v1/console/runtime/apps/altoc-client-scoped-down/config`) {
        return { code: 0, data: runtimeConfig(seedUrl) }
      }
      throw new Error('scoped console is down')
    })

    const event = makeEvent('altoc-client-scoped-down', seedUrl)
    await assert.rejects(
      () => loadScopedAuthorizationFromConsoleRuntime(event, 'u1', 'altoc', {
        resourceCode: 'customer',
        action: 'view'
      }),
      (error: unknown) => {
        const err = error as { statusCode?: number, statusMessage?: string, message?: string }
        assert.equal(err.statusCode, 503)
        assert.equal(err.statusMessage, 'Authorization Unavailable')
        assert.match(String(err.message), /Console scoped authorization unavailable/)
        return true
      }
    )
  })
})
