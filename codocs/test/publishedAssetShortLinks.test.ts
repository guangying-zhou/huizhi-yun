import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import * as links from '../shared/utils/publishedAssetLink.ts'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/publishedAssetShortLinks.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const path = 'codocs/company/rules/2026/中文 + 100% #制度?.md'
const token = 'aB1234567890_-xy'

function harness(options: { unauthenticated?: boolean, denied?: boolean, headStatus?: number, runtimeStatus?: number, resolvedPath?: string, responseToken?: string } = {}) {
  const calls: string[] = []
  const event = {}
  const exports: {
    createPublishedAssetShortLink?: (event: unknown, path: unknown) => Promise<{ token: string, path: string }>
    resolvePublishedAssetShortLink?: (event: unknown, token: unknown) => Promise<{ token: string, path: string }>
  } = {}
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name === 'h3') return { createError: (input: object) => Object.assign(new Error(), input) }
      if (name === '~~/shared/utils/publishedAssetLink') return links
      if (name === './authIdentity') return { requireRequestUid: () => {
        calls.push('auth')
        if (options.unauthenticated) throw Object.assign(new Error('unauthenticated'), { statusCode: 401 })
        return 'verified-reader'
      } }
      if (name === './checkPermission') return { requirePermission: async (_event: unknown, resource: string, action: string) => {
        calls.push(`${resource}:${action}`)
        if (options.denied) throw Object.assign(new Error('forbidden'), { statusCode: 403 })
      } }
      if (name === './oss') return { createRuntimeOSSClient: async (input: { event: unknown }) => {
        assert.equal(input.event, event)
        return { head: async (key: string) => {
          calls.push(`head:${key}`)
          if (options.headStatus) throw { status: options.headStatus }
        } }
      } }
      if (name === './codocsRuntime') return { callCodocsTenantRuntime: async (_event: unknown, target: string, input: { method?: string, query: Record<string, string> }) => {
        calls.push(target)
        const creating = input.method === 'POST'
        assert.deepEqual(Object.keys(input.query).sort(), creating ? ['codocs_trusted_published_asset_link_action', 'path'] : ['codocs_trusted_published_asset_link_action'])
        assert.equal(input.query.codocs_trusted_published_asset_link_action, creating ? 'create' : 'resolve')
        if (options.runtimeStatus) throw Object.assign(new Error('runtime error'), { statusCode: options.runtimeStatus })
        return { token: options.responseToken || token, path: options.resolvedPath || input.query.path || path }
      } }
      throw new Error(`Unexpected dependency ${name}`)
    }
  })
  return { calls, create: (input: unknown = path) => exports.createPublishedAssetShortLink!(event, input), resolve: (input: unknown = token) => exports.resolvePublishedAssetShortLink!(event, input) }
}

test('short page links have a fixed URL-safe token and no encoded document title', () => {
  assert.equal(links.publishedAssetShortPagePath(token), `/s/${token}`)
  for (const invalid of ['', 'a'.repeat(15), 'a'.repeat(17), '../secret', 'https://evil.test', 'a'.repeat(15) + '%', [token], null]) {
    assert.equal(links.publishedAssetShortPagePath(invalid), '')
  }
})

test('create validates read permission and object existence before saving the exact historical path', async () => {
  const h = harness()
  assert.deepEqual({ ...await h.create() }, { token, path })
  assert.deepEqual(h.calls, ['auth', 'company:view', `head:${path}`, '/v1/codocs/published-asset-links'])
  const department = harness()
  await department.create('codocs/departments/GMO/rules/已发布.md')
  assert.equal(department.calls[1], 'departments:view')
})

test('unauthenticated and unauthorized generation never reaches storage or runtime', async () => {
  const unauth = harness({ unauthenticated: true })
  await assert.rejects(unauth.create(), { statusCode: 401 })
  assert.deepEqual(unauth.calls, ['auth'])
  const denied = harness({ denied: true })
  await assert.rejects(denied.create(), { statusCode: 403 })
  assert.deepEqual(denied.calls, ['auth', 'company:view'])
})

test('unpublished, archived, traversal and external paths cannot create links', async () => {
  for (const input of ['codocs/documents/draft.md', 'codocs/archives/company/rules/a.md', 'codocs/company/rules/../a.md', 'https://evil.test', null]) {
    const h = harness()
    await assert.rejects(h.create(input), { statusCode: 400 })
    assert.deepEqual(h.calls, ['auth'])
  }
})

test('missing or unavailable objects never create durable links', async () => {
  for (const [headStatus, statusCode] of [[404, 404], [400, 503], [500, 503]]) {
    const h = harness({ headStatus })
    await assert.rejects(h.create(), { statusCode })
    assert.equal(h.calls.some(call => call.startsWith('/v1/')), false)
  }
})

test('resolution rechecks current company or department permission before exposing a path', async () => {
  const h = harness()
  assert.deepEqual({ ...await h.resolve() }, { token, path })
  assert.deepEqual(h.calls, ['auth', `/v1/codocs/published-asset-links/${token}`, 'company:view'])
  const denied = harness({ denied: true })
  await assert.rejects(denied.resolve(), { statusCode: 403 })
  const department = harness({ resolvedPath: 'codocs/departments/GMO/rules/已发布.md' })
  await department.resolve()
  assert.equal(department.calls.at(-1), 'departments:view')
})

test('resolution rejects anonymous users and malformed tokens before runtime lookup', async () => {
  const unauth = harness({ unauthenticated: true })
  await assert.rejects(unauth.resolve(), { statusCode: 401 })
  assert.deepEqual(unauth.calls, ['auth'])
  const malformed = harness()
  await assert.rejects(malformed.resolve('../secret'), { statusCode: 400 })
  assert.deepEqual(malformed.calls, ['auth'])
})

test('missing mappings and runtime errors remain failures, never a long URL fallback', async () => {
  for (const statusCode of [404, 403, 503]) await assert.rejects(harness({ runtimeStatus: statusCode }).resolve(), { statusCode })
  await assert.rejects(harness({ runtimeStatus: 409 }).create(), { statusCode: 409 })
})

test('unexpected runtime paths or tokens are not returned to readers', async () => {
  await assert.rejects(harness({ resolvedPath: 'https://evil.test' }).resolve(), { statusCode: 400 })
  await assert.rejects(harness({ responseToken: 'different-token!' }).resolve(), { statusCode: 502 })
  await assert.rejects(harness({ resolvedPath: 'codocs/company/rules/other.md' }).create(), { statusCode: 502 })
})
