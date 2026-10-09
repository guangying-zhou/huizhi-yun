import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createApp, eventHandler, toNodeListener } from 'h3'
import { createServer } from 'node:http'
import retired from '../server/middleware/00-retired-aims-services.ts'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'

test('old tasks compatibility boundary returns JSON 410 without creating a Host operation', async (t) => {
  const app = createApp().use(retired).use(eventHandler(() => ({ live: true })))
  const server = createServer(toNodeListener(app))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  for (const method of ['GET', 'POST']) {
    const response = await fetch(`${origin}/aims/api/v1/service/tasks?projectCodes=ANY`, { method })
    assert.equal(response.status, 410)
    assert.equal((await response.json()).data.code, 'aims_service_tasks_retired')
  }
  assert.equal((await fetch(`${origin}/aims/api/v1/work-items`)).status, 200)
  assert.equal(isBusinessApiReady('GET', '/aims/api/v1/service/tasks'), false)
})

test('legacy Aims rejects tasks before authentication or Runtime forwarding', () => {
  const source = readFileSync(new URL('../../aims/server/middleware/tenant-runtime.ts', import.meta.url), 'utf8')
  const handler = source.slice(source.indexOf('export default defineEventHandler'))
  assert.ok(handler.indexOf('=== \'/api/v1/service/tasks\'') < handler.indexOf('await ensureConsoleAuthContext(event)'))
  assert.match(handler, /statusCode: 410[\s\S]*aims_service_tasks_retired/)
})
