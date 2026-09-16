import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const sensitiveBusinessActions = [
  'approve',
  'confirm',
  'export',
  'deploy',
  'release',
  'publish',
  'archive',
  'download'
]

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function listFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...listFiles(fullPath))
      continue
    }
    files.push(fullPath)
  }

  return files
}

function routeLikeStrings(source: string) {
  return Array.from(source.matchAll(/['"`]([^'"`]*(?:\/api\/|\/v1\/|\/collab|\/healthz)[^'"`]*)['"`]/g))
    .map(match => match[1])
    .filter((value): value is string => Boolean(value))
}

test('Collab manifest stays service-only and does not define business sensitive actions', () => {
  const manifest = readJson<{
    appCode: string
    appType: string
    authMode: string
    bundleEnabled: boolean
    recommendedRoles: unknown[]
    resources: Array<{ code: string, actions: string[] }>
  }>(join(repoRoot, 'app.manifest.json'))

  assert.equal(manifest.appCode, 'collab')
  assert.equal(manifest.appType, 'internal')
  assert.equal(manifest.authMode, 'service')
  assert.equal(manifest.bundleEnabled, false)
  assert.deepEqual(manifest.recommendedRoles, [])
  assert.deepEqual(manifest.resources.map(resource => resource.code), ['runtime'])
  assert.deepEqual(manifest.resources[0]?.actions, ['view', 'admin'])

  for (const resource of manifest.resources) {
    for (const action of resource.actions) {
      assert.equal(
        sensitiveBusinessActions.includes(action),
        false,
        `collab runtime must not expose ${action} as a business action`
      )
    }
  }
})

test('Collab runtime has no Nuxt API handler tree for business operations', () => {
  assert.equal(existsSync(join(repoRoot, 'server')), false)
  assert.equal(existsSync(join(repoRoot, 'server/api')), false)
})

test('Collab HTTP runtime surface is limited to health and runtime status routes', () => {
  const runtimeHttp = readFileSync(join(repoRoot, 'src/extensions/runtime-http.ts'), 'utf8')
  const durableObject = readFileSync(join(repoRoot, 'src/providers/cloudflare-durable-object.ts'), 'utf8')

  const runtimeHttpRoutes = Array.from(runtimeHttp.matchAll(/pathname === '([^']+)'/g)).map(match => match[1])
  assert.deepEqual(runtimeHttpRoutes, [
    '/healthz',
    '/api/v1/collab/health',
    '/api/v1/collab/runtime',
    '/api/v1/collab/providers'
  ])

  const durableObjectHealthRoutes = Array.from(durableObject.matchAll(/pathname === '([^']+)'/g)).map(match => match[1])
  assert.deepEqual(durableObjectHealthRoutes, [
    '/',
    '/collab',
    '/collab/',
    '/collab/health',
    '/api/v1/collab/health',
    '/api/v1/collab/runtime'
  ])
})

test('Collab source does not define sensitive business operation endpoints', () => {
  const sourceFiles = [
    join(repoRoot, 'app.manifest.json'),
    ...listFiles(join(repoRoot, 'src')).filter(file => file.endsWith('.ts'))
  ]

  for (const file of sourceFiles) {
    const relativePath = relative(repoRoot, file)
    const routes = routeLikeStrings(readFileSync(file, 'utf8'))

    for (const route of routes) {
      for (const action of sensitiveBusinessActions) {
        assert.doesNotMatch(
          route,
          new RegExp(`(?:^|[/._:-])${action}(?:$|[/._:-])`, 'i'),
          `${relativePath} must not define ${action} endpoint route ${route}`
        )
      }
    }
  }
})
