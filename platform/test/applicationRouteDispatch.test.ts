import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { test } from 'node:test'
import { createEvent, createRouter } from 'h3'

function routes(scope: string) {
  const root = new URL(`../server/api/platform/${scope}/applications/`, import.meta.url)
  return readdirSync(root, { recursive: true }).filter((file): file is string => typeof file === 'string' && file.endsWith('.ts'))
    .sort().map((file) => {
      const match = file.match(/^(.*)\.(get|post|patch|delete|put)\.ts$/)
      assert.ok(match, file)
      return { path: `/api/platform/${scope}/applications/${match[1]}`.replace(/\[([^\]]+)\]/g, ':$1'), method: match[2]! }
    })
}

for (const scope of ['ops', 'admin', 'tenant-admin', '_handlers']) {
  test(`${scope}: nested application routes survive sibling registration in either order`, async () => {
    const actual = routes(scope)
    for (const order of [actual, [...actual].reverse()]) {
      const router = createRouter()
      for (const route of order) {
        router.add(route.path, event => ({ route: route.path, params: event.context.params }), route.method as 'get')
      }
      for (const expected of actual) {
        const path = expected.path.replace(':appCode', '184').replace(':releaseId', '29')
        const request = new IncomingMessage(new Socket())
        request.method = expected.method.toUpperCase()
        request.url = path
        const result = await router.handler(createEvent(request, new ServerResponse(request))) as unknown as {
          route: string
          params: Record<string, string>
        }
        assert.equal(result?.route, expected.path, `${request.method} ${path}`)
        if (expected.path.includes(':appCode')) assert.equal(result.params.appCode, '184')
        if (expected.path.includes(':releaseId')) assert.equal(result.params.releaseId, '29')
      }
    }
  })
}
