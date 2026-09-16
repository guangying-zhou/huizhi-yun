import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../app/components/products/VersionDevelopmentAction.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!
const javascript = ts.transpileModule(`${source}\nglobalThis.action = { start, save, reason, open, error, canTransition };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText

function fixture() {
  const props = { productCode: 'P1', version: { id: 7, product_code: 'P1', version_code: 'v1', status: 'planning', revision: 3, workspace_revision: 12, current_release_record_id: null as number | null }, canEdit: true, disabled: false }
  const requests: { url: string, body: Record<string, unknown>, key: string }[] = []
  const events: [string, unknown][] = []
  let fail = false, allowConfirmation = true, keys = 0
  const context = vm.createContext({
    defineProps: () => props,
    defineEmits: () => (name: string, value: unknown) => { events.push([name, value]) },
    ref: (value: unknown) => ({ value }),
    computed: (get: () => unknown) => ({ get value() {
      return get()
    } }),
    useApiErrorAlert: () => null,
    useConfirm: () => ({ confirm: async () => allowConfirmation }),
    useToast: () => ({ add() {} }),
    crypto: { randomUUID: () => `key-${++keys}` },
    $fetch: async (url: string, input: { body: Record<string, unknown>, headers: Record<string, string> }) => {
      requests.push({ url, body: JSON.parse(JSON.stringify(input.body)), key: input.headers['Idempotency-Key']! })
      if (fail) throw new Error('Temporary request failure')
      return { code: 0, data: { value: { version_id: 7, product_code: 'P1', status: 'developing' } } }
    }
  })
  vm.runInContext(javascript, context)
  const action = context.action as { start(): void, save(): Promise<void>, reason: { value: string }, open: { value: boolean }, error: { value: Error | null }, canTransition: { value: boolean } }
  return { props, requests, events, action, failure: (value: boolean) => {
    fail = value
  }, confirmation: (value: boolean) => {
    allowConfirmation = value
  } }
}

test('development action freezes reviewed revisions and sends the existing transition command', async () => {
  const f = fixture()
  f.action.start()
  f.action.reason.value = '范围已经确认'
  f.props.version.revision = 4
  f.props.version.workspace_revision = 13
  await f.action.save()
  assert.equal(f.requests[0]?.url, '/api/v1/products/P1/versions/7/transition')
  assert.deepEqual(f.requests[0]?.body, { expectedRevision: 12, expectedVersionRevision: 3, toStatus: 'developing', reason: '范围已经确认' })
  assert.equal(f.action.open.value, false)
  assert.deepEqual(f.events, [['busy', true], ['busy', false], ['saved', undefined]])
})

test('failed transition preserves reason and idempotency identity until the payload changes', async () => {
  const f = fixture()
  f.action.start()
  f.action.reason.value = '确认进入开发'
  f.failure(true)
  await f.action.save()
  assert.equal(f.action.open.value, true)
  assert.equal(f.action.reason.value, '确认进入开发')
  assert.ok(f.action.error.value)
  assert.ok(!f.events.some(([event]) => event === 'saved'))
  await f.action.save()
  assert.equal(f.requests[0]?.key, f.requests[1]?.key)
  f.action.reason.value = '调整后的进入开发原因'
  f.failure(false)
  await f.action.save()
  assert.notEqual(f.requests[1]?.key, f.requests[2]?.key)
  assert.equal(f.action.open.value, false)
})

test('permission loss, published state and cancelled confirmation cannot issue a transition', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.props.canEdit = false },
    (f: ReturnType<typeof fixture>) => { f.props.version.current_release_record_id = 5 },
    (f: ReturnType<typeof fixture>) => { f.props.version.product_code = 'OTHER' },
    (f: ReturnType<typeof fixture>) => { f.props.version.status = 'released' },
    (f: ReturnType<typeof fixture>) => { f.confirmation(false) }
  ]) {
    const f = fixture()
    f.action.start()
    f.action.reason.value = '确认进入开发'
    mutate(f)
    await f.action.save()
    assert.equal(f.requests.length, 0)
    assert.ok(!f.events.some(([event]) => event === 'saved'))
  }
})
