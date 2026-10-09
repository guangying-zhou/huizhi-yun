import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'

test('Foundation notification BFF forwards exact page filters and rejects ambiguous modes before Console', async () => {
  const state = { calls: [], status: 0 }
  globalThis.__notificationPage = state
  const previous = globalThis.defineEventHandler
  globalThis.defineEventHandler = fn => fn
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/utils/notifications'))
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent('export async function fetchConsoleNotificationsForUser(event,path,options){const s=globalThis.__notificationPage;s.calls.push({path,options});if(s.status)throw Object.assign(Error("unavailable"),{statusCode:s.status});return {items:[],total:21,page:Number(options.query.page||1),pageSize:Number(options.query.pageSize||20)}}')}` }
    let path
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:'))
      path = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (path && !existsSync(path) && existsSync(`${path}.ts`))
      return { shortCircuit: true, url: pathToFileURL(`${path}.ts`).href }
    return next(specifier, context)
  } })
  let server
  try {
    const handler = (await import('../../foundation/server/api/notifications/index.get.ts')).default
    server = createServer(toNodeListener(createApp().use(createRouter().get('/api/notifications', handler))))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}/api/notifications`
    let r = await fetch(`${base}?status=unread&page=2&pageSize=20&sourceAppCode=aims`)
    assert.equal(r.status, 200)
    assert.equal((await r.json()).data.total, 21)
    assert.deepEqual(state.calls.at(-1).options.query, { status: 'unread', page: '2', pageSize: '20', sourceAppCode: 'aims' })
    const n = state.calls.length
    for (const q of ['page=0', 'page=01', 'page=', 'page=1&page=2', 'pageSize=101', 'page=1&cursor=9', 'page=1&limit=20', 'uid=victim', 'status=forged'])
      assert.equal((await fetch(`${base}?${q}`)).status, 400)
    assert.equal(state.calls.length, n)
    for (const status of [401, 403, 503]) {
      state.status = status
      assert.equal((await fetch(`${base}?page=1`)).status, status)
    }
  } finally {
    if (server)
      await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.defineEventHandler = previous
    delete globalThis.__notificationPage
  }
})
