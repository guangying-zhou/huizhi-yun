import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

type Row = Record<string, unknown>
type ProfileResponse = Row & { data: Row & { directory?: Row | null } }

function loadHandler(path: string, dependencies: Row) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports: Row = {}
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    defineEventHandler: (handler: unknown) => handler,
    createError: (input: Row) => Object.assign(new Error(String(input.message || '')), input)
  })
  return exports.default as (event: Row) => Promise<ProfileResponse>
}

function consoleHandler(event: Row, getUser: () => Row | null) {
  return loadHandler('../../console/server/api/v1/console/auth/me.get.ts', {
    'h3': { defineEventHandler: (handler: unknown) => handler },
    '~~/server/utils/authSession': {
      resolveOptionalConsoleSession: async (input: Row, options: Row) => {
        assert.equal(input, event)
        assert.equal(options.allowLegacyFallback, false)
        const user = getUser()
        return user ? { uid: user.uid, user, identity: {} } : null
      }
    }
  })
}

function foundationHandler(event: Row, getResponse: () => Promise<Row>) {
  return loadHandler('../server/api/directory/me.get.ts', {
    '../../utils/directoryApi': {
      fetchConsoleApi: async (path: string, options: Row) => {
        assert.equal(path, '/auth/me')
        assert.equal(options.event, event)
        return getResponse()
      }
    }
  })
}

test('self profile forwards current four-digit tail through Console and Foundation without full mobile', async () => {
  const event = { context: { tenant: 'tenant-1' } }
  let tail = '0042'
  const consoleMe = consoleHandler(event, () => ({ uid: 'viewer', mobileTail4: tail, mobile: '+86 138 0000 1234' }))
  const foundationMe = foundationHandler(event, () => consoleMe(event))
  for (const currentTail of ['0042', '0987']) {
    tail = currentTail
    const consoleResponse = await consoleMe(event)
    assert.equal(consoleResponse.data.directory?.mobileTail4, currentTail)
    assert.equal('mobile' in (consoleResponse.data.directory || {}), false)
    const response = await foundationMe(event)
    assert.equal(response.data.mobileTail4, currentTail)
    assert.equal(response.data.mobile, null)
    assert.doesNotMatch(JSON.stringify(response), /138|1234/)
  }
})

test('Console self projection uses only a valid tail or the final four mobile digits', async () => {
  const event = { context: {} }
  for (const [mobileTail4, mobile, expected] of [
    ['****', null, null], ['12345', null, null], ['12a4', null, null],
    [null, '+86 138 0000 1234', '1234'], ['bad', '123', null],
    [' 0042 ', null, '0042']
  ]) {
    const response = await consoleHandler(event, () => ({ uid: 'viewer', mobileTail4, mobile }))(event)
    assert.equal(response.data.directory?.mobileTail4, expected)
    assert.equal('mobile' in (response.data.directory || {}), false)
  }
})

test('Foundation rejects malformed tails and never derives one from a full-mobile field', async () => {
  const event = { context: {} }
  for (const mobileTail4 of ['****', '13800001234', '12a4', null, undefined]) {
    const handler = foundationHandler(event, async () => ({
      code: 0, data: { authenticated: true, directory: { uid: 'viewer', mobileTail4, mobile: '13800001234' } }
    }))
    const response = await handler(event)
    assert.equal(response.data.mobileTail4, null)
    assert.equal(response.data.mobile, null)
  }
})

test('anonymous or invalid Console profiles do not disclose self data', async () => {
  const event = { context: {} }
  const response = await consoleHandler(event, () => null)(event)
  assert.equal(response.data.authenticated, false)
  assert.equal(response.data.directory, null)
  for (const invalid of [
    response,
    { code: 0, data: { authenticated: false, directory: { uid: 'viewer', mobileTail4: '1234' } } },
    { code: 1, data: { authenticated: true, directory: { uid: 'viewer' } } },
    { code: 0, data: { authenticated: true, directory: {} } }
  ]) {
    await assert.rejects(foundationHandler(event, async () => invalid)(event), { statusCode: 401 })
  }
})
