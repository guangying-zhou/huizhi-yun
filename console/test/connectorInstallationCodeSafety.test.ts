import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const page = readFileSync(new URL('../app/pages/connector-runtime.vue', import.meta.url), 'utf8')
const route = readFileSync(new URL('../server/api/v1/console/connector-runtime/install-command.post.ts', import.meta.url), 'utf8')
const compile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText

function commandPage() {
  const metadataData = { value: { code: 0, data: { installCommand: '', connector: null } } }
  const timers: Array<() => void> = []
  const command = 'curl fixture-install-code'
  const setup = page.slice(page.indexOf('const installationCommand'), page.indexOf('const runtimeSetting'))
  const actions = page.slice(page.indexOf('async function generateCommand()'), page.indexOf('async function runDiagnostics()'))
  const harness = new Function('ref', 'computed', 'metadataData', '$fetch', 'setTimeout', 'clearTimeout', 'navigator', 'canAdmin', 'commandPending', 'toast', 'errorMessage', compile(`${setup}\n${actions}\nreturn { generateCommand, copyCommand, clearInstallationCommand, metadata };`))
  const model = harness(
    (value: unknown) => ({ value }), (getter: () => unknown) => ({ get value() { return getter() } }), metadataData,
    async () => ({ code: 0, data: { installCommand: command, expiresAt: new Date(Date.now() + 900000).toISOString(), enrollmentCodeLast4: 'test', connector: null } }),
    (callback: () => void) => {
      timers.push(callback)
      return timers.length
    }, () => {},
    { clipboard: { writeText: async (value: string) => assert.equal(value, command) } },
    { value: true }, { value: false }, { add: () => {} }, () => 'fixed failure')
  return { model, metadataData, timers, command }
}

test('installation code stays outside shared fetch data and disappears after copy, close or expiry', async () => {
  for (const clear of ['copy', 'close', 'expiry']) {
    const { model, metadataData, timers, command } = commandPage()
    await model.generateCommand()
    assert.equal(model.metadata.value.installCommand, command)
    assert.equal(metadataData.value.data.installCommand, '')
    if (clear === 'copy') await model.copyCommand()
    if (clear === 'close') model.clearInstallationCommand()
    if (clear === 'expiry') timers.at(-1)!()
    assert.equal(model.metadata.value.installCommand, '')
    assert.doesNotMatch(JSON.stringify(metadataData), /fixture-install-code/)
  }
  assert.match(page, /onBeforeRouteLeave\(clearInstallationCommand\)/)
  assert.match(page, /onBeforeUnmount\(\(\) => \{\s*disposed = true\s*clearInstallationCommand\(\)/)
  assert.doesNotMatch(page, /localStorage|sessionStorage|useState/)
})

test('installation POST sets no-store before authorization on success and denial', async () => {
  for (const denied of [false, true]) {
    const headers: Record<string, string> = {}
    const dependencies: Record<string, unknown> = {
      'h3': { setHeader: (_event: unknown, name: string, value: string) => { headers[name] = value } },
      '~~/server/utils/directoryRuntime': { ok: (value: unknown) => value },
      '~~/server/utils/connectorRuntimeEnrollment': { issueConnectorRuntimeEnrollment: async () => ({ installCommand: 'fixture-code' }) },
      '~~/server/utils/idempotency': { requireIdempotencyKey: () => {} },
      '~~/server/utils/systemSettingsAccess': { requireSystemSettingsAccess: async () => {
        assert.equal(headers['Cache-Control'], 'no-store')
        if (denied) throw Object.assign(new Error('denied'), { statusCode: 403 })
      } }
    }
    const exports: { default?: (event: unknown) => Promise<unknown> } = {}
    new Function('require', 'exports', 'defineEventHandler', compile(route))((name: string) => dependencies[name], exports, (handler: unknown) => handler)
    if (denied) await assert.rejects(exports.default!({}), { statusCode: 403 })
    else assert.deepEqual(await exports.default!({}), { installCommand: 'fixture-code' })
    assert.equal(headers['Cache-Control'], 'no-store')
  }
})
