import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const code = ts.transpileModule(source('server/api/reviews/by-oss-path.get.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function recordHandler(path: string, permissions: string[]) {
  let queried = false
  const exports: Record<string, (event: object) => Promise<unknown>> = {}
  runInNewContext(code, {
    exports,
    defineEventHandler: (handler: unknown) => handler,
    getQuery: () => ({ path }),
    createError: (error: object) => Object.assign(new Error(), error),
    require: (name: string) => {
      if (name.endsWith('/authIdentity')) return { requireRequestUid: () => 'actor' }
      if (name.endsWith('/checkPermission')) return { requirePermission: async (_event: object, resource: string, action: string) => {
        if (!permissions.includes(`${resource}:${action}`)) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
      } }
      if (name.endsWith('/reviewReadScope')) return { withTrustedCodocsReviewReadContext: (query: object, uid: string) => ({ ...query, current_user: uid }) }
      if (name.endsWith('/codocsRuntime')) return { callCodocsTenantRuntime: async () => {
        queried = true
        return { id: 1 }
      } }
      throw new Error(`Unexpected import: ${name}`)
    }
  })
  return { call: () => exports.default!({}), queried: () => queried }
}

test('ordinary readers cannot retrieve organization asset publishing records', async () => {
  for (const path of ['codocs/company/rules/published.md', '/codocs/company/rules/published.md']) {
    const route = recordHandler(path, ['reviews:view', 'company:admin'])
    await assert.rejects(route.call(), { statusCode: 403 })
    assert.equal(route.queried(), false)
  }
})

test('system administrator can retrieve company records while department review access remains unchanged', async () => {
  await recordHandler('codocs/company/rules/published.md', ['reviews:view', 'admin:admin']).call()
  await recordHandler('codocs/departments/GMO/records/meeting.md', ['reviews:view']).call()
})

test('only the administrator recommended role receives explicit organization asset export permission', () => {
  const manifest = JSON.parse(source('app.manifest.json'))
  assert.ok(manifest.resources.find((resource: { code: string }) => resource.code === 'company').actions.includes('export'))
  const roles = manifest.recommendedRoles.filter((role: { suggestedPermissions: string[] }) => role.suggestedPermissions.includes('codocs:company:export'))
  assert.deepEqual(roles.map((role: { code: string }) => role.code), ['codocs:admin'])
})

test('company publishing history is not mounted for ordinary users', () => {
  const browser = source('app/components/company/AssetBrowser.vue')
  assert.match(browser, /v-if="isSystemAdmin"[\s\S]*?@click="showPublishRecord = true"/)
  assert.match(browser, /<ReviewPublishRecordModal v-if="isSystemAdmin"/)
  assert.match(browser, /hasPermission\('admin', 'admin'\)/)
})
