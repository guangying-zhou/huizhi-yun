import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../app/components/products/CatalogRefresh.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1]!.split('</script>')[0]!
const ast = ts.createSourceFile('CatalogRefresh.ts', source, ts.ScriptTarget.Latest, true)
const run = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'run')!
const code = ts.transpileModule(run.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function harness(fetch: (action: string, revision?: number) => unknown) {
  const actions: string[] = []
  const events: string[] = []
  const ctx = {
    batch: { value: null as null | { refresh_id: string, status: string, revision: number } },
    busy: { value: false }, error: { value: null as null | Error }, resumeId: { value: '' },
    disposed: false, startKey: undefined, crypto: { randomUUID: () => 'stable-key' },
    confirm: async () => true, emit: (event: string) => events.push(event),
    $fetch: async (_: string, options: { body: { action: string, expectedRevision?: number } }) => {
      actions.push(options.body.action)
      return { code: 0, data: await fetch(options.body.action, options.body.expectedRevision) }
    },
    run: undefined as undefined | ((action: string) => Promise<void>)
  }
  runInNewContext(code, ctx)
  return { ctx, actions, events }
}
const batch = (revision: number, status = 'staging') => ({ refresh_id: 'batch-1', revision, status, row_count: (revision - 1) * 100, total: 200 })

test('start automatically advances pages and refreshes the list only when active', async () => {
  const { ctx, actions, events } = harness((action, revision) => action === 'start' ? batch(1) : batch(revision! + 1, revision === 2 ? 'active' : 'staging'))
  await ctx.run!('start')
  assert.deepEqual(actions, ['start', 'continue', 'continue'])
  assert.deepEqual(events, ['activated'])
  assert.equal(ctx.error.value, null)
  assert.equal(ctx.busy.value, false)
})

test('failure retains a resumable batch and does not report success', async () => {
  const { ctx, actions, events } = harness((action) => {
    if (action === 'start') return batch(1)
    throw new Error('source unavailable')
  })
  await ctx.run!('start')
  assert.deepEqual(actions, ['start', 'continue'])
  assert.equal(ctx.resumeId.value, 'batch-1')
  assert.ok(ctx.error.value)
  assert.deepEqual(events, [])
})

test('automatic processing is bounded and stops when no revision advances', async () => {
  const endless = harness((action, revision) => batch(action === 'start' ? 1 : revision! + 1))
  await endless.ctx.run!('start')
  assert.equal(endless.actions.length, 11)
  assert.equal(endless.ctx.batch.value?.status, 'staging')
  const stuck = harness(() => batch(1))
  await stuck.ctx.run!('start')
  assert.equal(stuck.actions.length, 2)
  assert.ok(stuck.ctx.error.value)
})
