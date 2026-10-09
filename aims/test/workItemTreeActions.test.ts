import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import ts from 'typescript'

const filename = new URL('../app/pages/projects/[id]/work-items/[workItemId]/breakdown.vue', import.meta.url).pathname
const source = readFileSync(filename, 'utf8')
const { descriptor, errors } = parse(source, { filename })

test('work item tree page compiles as a complete SFC', () => {
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'work-item-tree-actions' })
  const template = compileTemplate({ filename, id: 'work-item-tree-actions', source: descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
})

const script = ts.createSourceFile(filename, descriptor.scriptSetup!.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const handler = script.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'runTreeAction')
assert.ok(handler && ts.isFunctionDeclaration(handler))
const compiled = ts.transpileModule(handler.getText(script), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const buildHandler = new Function('$fetch', 'hosted', 'breakdownVersion', 'treeActionRetries', 'projectId', 'workItemId', 'moduleUrl', 'crypto', 'loadContext', 'toast', `${compiled}; return runTreeAction`) as (...args: unknown[]) => (action: string, status?: string) => Promise<{ code: number } | null>

function fixture(fail = false) {
  const calls: Array<{ path: string, options: { body: Record<string, unknown>, headers?: Record<string, string>, retry?: number, method: string } }> = []
  const notices: unknown[] = []
  let loads = 0
  const retries = new Map()
  const fetch = async (path: string, options: typeof calls[number]['options']) => {
    calls.push({ path, options })
    if (fail) throw new Error('network lost')
    return { code: 0, data: { mattersUpdated: 2 } }
  }
  const run = buildHandler(fetch, true, { value: 'a'.repeat(64) }, retries, { value: 262 }, { value: 99 }, (path: string) => `/aims${path}`, { randomUUID: () => 'fixed-key' }, async () => {
    loads++
  }, { add: (notice: unknown) => notices.push(notice) })
  return { run, calls, notices, retries, get loads() {
    return loads
  } }
}

test('all four tree decisions send project, current version and intent key through the Host BFF', async () => {
  for (const action of ['confirm-distribute', 'revoke-distribute', 'confirm-append', 'reject-append']) {
    const f = fixture()
    assert.ok(await f.run(action))
    assert.deepEqual(f.calls[0], {
      path: `/aims/api/v1/work-items/99/${action}`,
      options: { method: 'POST', body: { projectId: 262, expectedVersion: 'a'.repeat(64) }, headers: { 'Idempotency-Key': 'fixed-key' }, retry: 0 }
    })
    assert.equal(f.loads, 1)
    assert.equal(f.retries.size, 0)
  }
})

test('failed decision retains page state and the same key for explicit retry', async () => {
  const f = fixture(true)
  assert.equal(await f.run('confirm-distribute'), null)
  assert.equal(await f.run('confirm-distribute'), null)
  assert.equal(f.calls[0]?.options.headers?.['Idempotency-Key'], f.calls[1]?.options.headers?.['Idempotency-Key'])
  assert.equal(f.loads, 0)
  assert.equal(f.retries.size, 1)
  assert.equal(f.notices.length, 2)
})

test('completion state updates use the same BFF contract and distinct keys per state', async () => {
  const f = fixture()
  await f.run('update-status', 'in_review')
  assert.equal(f.calls[0]?.options.method, 'PUT')
  assert.deepEqual(f.calls[0]?.options.body, { projectId: 262, expectedVersion: 'a'.repeat(64), status: 'in_review' })
  assert.equal(f.calls[0]?.path, '/aims/api/v1/work-items/99')
})

test('workflow callbacks delegate every decision to the guarded tree handler', () => {
  const body = descriptor.scriptSetup!.content
  for (const action of ['confirm-distribute', 'revoke-distribute', 'confirm-append', 'reject-append']) {
    assert.match(body, new RegExp(`runTreeAction\\('${action}'\\)`))
  }
  assert.doesNotMatch(body, /moduleUrl\(`\/api\/v1\/work-items\/\$\{workItemId\.value\}\/(?:confirm-distribute|revoke-distribute|confirm-append|reject-append)`\)/)
})
