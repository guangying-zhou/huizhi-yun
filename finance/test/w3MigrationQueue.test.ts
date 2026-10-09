import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { parse, compileScript } from '@vue/compiler-sfc'
import { computed, reactive, ref, watch, onScopeDispose, effectScope, nextTick } from 'vue'
import * as queue from '../app/utils/w3MigrationQueue.ts'

const intentModule: Record<string, unknown> = {}
new Function('exports', ts.transpileModule(readFileSync(new URL('../../foundation/shared/utils/consoleMutationIntent.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(intentModule)
const reviewModule: Record<string, unknown> = {}
new Function('exports', 'require', ts.transpileModule(readFileSync(new URL('../../foundation/shared/utils/reviewMutationIntent.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(reviewModule, () => intentModule)
const createReviewMutationIntent = reviewModule.createReviewMutationIntent

const contact = { id: 1, kind: 'contact_without_customer', status: 'open', row_version: 2, contact: { cm_name: '合成联系人' } }
const balance = { id: 2, kind: 'balance_without_account', status: 'open', row_version: 3, detail: { latestAmounts: ['1.00', '2.00'], balanceDate: '2026-10-04' } }
test('queue action closure preserves resolve/edit separation and read-only/unknown types', () => {
  assert.deepEqual(queue.queueMethods(contact, false, true), [])

  assert.deepEqual(queue.queueMethods(contact, true, false), ['accept'])

  assert.deepEqual(queue.queueMethods({ kind: 'contract_balance_mismatch', status: 'open' }, true, true), [])

  assert.deepEqual(queue.queueMethods({ kind: 'future_kind', status: 'open' }, true, true), [])

  assert.deepEqual(queue.queueMethods({ ...contact, status: 'resolved' }, true, true), [])

  const person = { source_user_id: 'employee:7', match_status: 'confirmed', open_owner_items: 102 }

  assert.ok(queue.identityMethods(person, true, true, true).includes('apply'))

  assert.ok(!queue.identityMethods(person, true, true, false).includes('apply'))

  assert.deepEqual(queue.identityMethods({ ...person, source_user_id: 'unknown:7' }, true, true, true), [])
})
test('queue queries and payloads use real pagination, only allowed search, and original amount choices', () => {
  assert.deepEqual(queue.queueQuery('exceptions', 'balance_without_account', 'open', 3, 'secret search'), { kind: 'balance_without_account', status: 'open', page: 3, pageSize: 20 })

  assert.equal(queue.queueQuery('identities', 'owner_unmatched', '', 1, ' synthetic ').search, 'synthetic')

  assert.deepEqual(queue.queueResolvePayload(contact, 'assign_customer', { customerId: '7', reason: '' }), { expectedVersion: 2, method: 'assign_customer', customerId: '7' })

  assert.throws(() => queue.queueResolvePayload(balance, 'record_balance', { accountCode: 'BA-SYNTHETIC', amount: '999.00' }), /候选金额/)

  assert.deepEqual(queue.queueResolvePayload(balance, 'record_balance', { accountCode: 'BA-SYNTHETIC', amount: '2.00' }), { expectedVersion: 3, method: 'record_balance', accountCode: 'BA-SYNTHETIC', amount: '2.00' })

  assert.throws(() => queue.queueResolvePayload({ ...contact, kind: 'effective_amount_exceeds_total' }, 'accept', { reason: '' }), /核对原因/)

  assert.match(queue.queueError({ statusCode: 403 }), /没有处理权限/)

  assert.match(queue.queueError({ statusCode: 409 }), /已保留/)

  assert.match(queue.queueError({ data: { code: 'finance_historical_contract_not_ready' } }), /尚未就绪/)

  assert.deepEqual(queue.queueDetail({ ...balance, detail: { ...balance.detail, account_no: 'MUST-NOT-LEAK', row_json: 'MUST-NOT-LEAK' } }).map(x => x.value), ['2026-10-04', '—'])
})
function harness(fetcher: (path: string, options: Record<string, unknown>) => Promise<unknown>, app: 'altoc' | 'finance' = 'finance', initialPermission = true, confirmation?: () => Promise<boolean>) {
  const source = readFileSync(new URL('../app/components/host/W3MigrationQueuePage.vue', import.meta.url), 'utf8')

  const script = parse(source).descriptor.scriptSetup!.content

  const program = ts.createSourceFile('component.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  const statements = program.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(program)).join('\n')

  const code = ts.transpileModule(statements + '\nreturn { page, view, kind, status, rows, draft, open, selected, method, load, begin, save, writeError, linkDuplicate, refreshComparison, adoptVersion, comparison, applyResult, applicationPrompt, selectedView }', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

  const cache = ref('synthetic-session')

  const permission = ref(initialPermission)

  const confirmations: Record<string, unknown>[] = []

  const notices: unknown[] = []

  const context: Record<string, unknown> = { useHostDirectoryLabels: () => ({ userName: () => '合成人员', userDepartment: () => '合成部门', directoryError: ref(false), refresh: async () => {} }), ...queue, computed, reactive, ref, watch, onScopeDispose, createReviewMutationIntent, defineProps: () => ({ app }), useState: () => cache, onMounted: () => {}, usePermissions: () => ({ loaded: ref(true), error: ref(''), hasPermission: () => permission.value, loadPermissions: async () => {} }), useDebouncedSearch: ({ onChange }: { onChange: () => void }) => {
    const search = ref('')

    const debounced = ref('')

    watch(search, () => {
      onChange()

      debounced.value = search.value
    })

    return { search, debounced, flush: () => {} }
  }, useConfirm: () => ({ confirm: async (options: Record<string, unknown>) => {
    confirmations.push(options)

    return confirmation ? await confirmation() : true
  } }), useToast: () => ({ add: (notice: unknown) => notices.push(notice) }), nextTick, $fetch: fetcher, navigateTo: async () => {} }

  const scope = effectScope()

  const result = scope.run(() => new Function(...Object.keys(context), code)(...Object.values(context)))!

  return { ...result, cache, permission, confirmations, notices, stop: () => scope.stop() }
}
test('actual queue page resets page on filters and discards a stale read after session change', async () => {
  const calls: { path: string, query: Record<string, unknown> }[] = []

  let complete: ((reply: unknown) => void) | undefined

  const h = harness(async (path, options) => {
    calls.push({ path, query: options.query as Record<string, unknown> })

    if (calls.length === 1) return new Promise((resolve) => {
      complete = resolve
    })

    return { data: [], total: 0, openCounts: {} }
  })

  await nextTick()

  h.page.value = 4

  await nextTick()

  h.kind.value = 'balance_without_account'

  await nextTick()

  assert.equal(h.page.value, 1)

  assert.equal(calls.at(-1)!.query.page, 1)

  assert.equal(calls.at(-1)!.query.pageSize, 20)

  h.cache.value = ''

  await nextTick()

  complete!({ data: [balance], total: 1 })

  await nextTick()

  assert.deepEqual(h.rows.value, [])

  h.stop()
})
test('actual resolve confirms before posting, retains draft on 409 and retries a lost response with the same key', async () => {
  const posts: Record<string, unknown>[] = []

  let failure: unknown = { statusCode: 409, data: { code: 'migration_exception_version_conflict' } }

  const h = harness(async (_, options) => {
    if (!options.method) return { data: [{ ...balance, row_version: 4 }], total: 1 }

    posts.push(options)

    if (failure) throw failure

    return { data: { status: 'resolved' } }
  })

  await nextTick()

  h.begin(balance, 'record_balance')

  h.draft.accountCode = 'BA-SYNTHETIC'

  h.draft.amount = '2.00'

  await h.save()

  assert.equal(h.open.value, true)

  assert.equal(h.draft.amount, '2.00')

  assert.equal(h.comparison.value.row_version, 4)

  assert.equal(h.confirmations[0].tone, 'warning')

  h.adoptVersion()

  failure = Error('fetch failed')

  await h.save()

  const frozen = posts.at(-1)!

  failure = null

  await h.save()

  assert.deepEqual(posts.at(-1)!.body, frozen.body)

  assert.deepEqual(posts.at(-1)!.headers, frozen.headers)

  assert.equal(h.open.value, false)

  h.stop()
})
test('actual source-person apply is bounded, displays per-item failures, and never auto-submits another batch', async () => {
  let writes = 0

  const h = harness(async (_, options) => {
    if (!options.method) return { data: [], total: 0 }

    writes++

    assert.deepEqual(options.body, { limit: 100 })

    return { data: { resolved: 1, remaining: 101, items: [{ id: 9, status: 'failed', code: 'migration_target_unavailable' }] } }
  }, 'altoc')

  await nextTick()

  h.begin({ source_user_id: 'employee:7', match_status: 'confirmed', open_owner_items: 102 }, 'apply')

  await h.save()

  assert.equal(writes, 1)

  assert.equal(h.applyResult.value.remaining, 101)

  assert.equal(h.applyResult.value.items[0].status, 'failed')

  assert.match(String(h.confirmations[0].message), /最多改派 100/)

  h.stop()
})
test('queue SFCs compile, explicitly import shared components and use table loading/empty states with mobile cards', () => {
  for (const name of ['W3MigrationQueuePage.vue', 'W3QueueObjectSelect.vue']) {
    const source = readFileSync(new URL(`../app/components/host/${name}`, import.meta.url), 'utf8')

    const { descriptor, errors } = parse(source, { filename: name })

    assert.deepEqual(errors, [])

    assert.doesNotThrow(() => compileScript(descriptor, { id: name, inlineTemplate: true }))

    if (name === 'W3QueueObjectSelect.vue') {
      assert.match(source, /import RemoteObjectSelectMenu from/)
      const shared = readFileSync(new URL('../../foundation/app/components/RemoteObjectSelectMenu.vue', import.meta.url), 'utf8')
      assert.match(shared, /import CommonEmptyState from/)
      assert.match(shared, /#empty/)
    } else {
      assert.match(source, /import CommonEmptyState from/)
    }

    assert.doesNotMatch(source, /account_no|console\.log|row_json|detail_json/)

    if (name.startsWith('W3Migration')) {
      assert.match(source, /import ContentPageHeader from/)

      assert.match(source, /:loading="loading"/)

      assert.match(source, /#empty/)

      assert.match(source, /共 \{\{ total \}\} 条/)

      assert.match(source, /sm:hidden/)

      assert.match(source, /exclude-uids="\['system:unassigned'\]"/)
    }
  }
})

test('actual queue denies reads and writes without permission', async () => {
  let calls = 0

  const denied = harness(async () => {
    calls++

    return { data: [], total: 0 }
  }, 'finance', false)

  await nextTick()

  denied.begin(balance, 'record_balance')

  denied.draft.accountCode = 'BA-SYNTHETIC'

  denied.draft.amount = '2.00'

  await denied.save()

  assert.equal(calls, 0)

  denied.stop()
})
test('actual duplicate contact can switch to linking without dropping the selected customer', async () => {
  const h = harness(async (_, options) => {
    if (!options.method) return { data: [contact], total: 1 }

    throw { statusCode: 409, data: { code: 'migration_contact_duplicate' } }
  }, 'altoc')

  await nextTick()

  h.view.value = 'exceptions'

  h.kind.value = 'contact_without_customer'

  await nextTick()

  h.begin(contact, 'assign_customer')

  h.draft.customerId = '7'

  await h.save()

  h.linkDuplicate()

  assert.equal(h.method.value, 'link_existing')

  assert.equal(h.draft.customerId, '7')

  assert.equal(h.open.value, true)

  h.stop()
})

test('a confirmation from the previous session cannot dispatch a queue write', async () => {
  let writes = 0

  let complete: ((value: boolean) => void) | undefined

  const h = harness(async (_, options) => {
    if (options.method) writes++

    return { data: [balance], total: 1 }
  }, 'finance', true, () => new Promise((resolve) => {
    complete = resolve
  }))

  await nextTick()

  h.begin(balance, 'record_balance')

  h.draft.accountCode = 'BA-SYNTHETIC'

  h.draft.amount = '2.00'

  const saving = h.save()

  await nextTick()

  await nextTick()

  h.cache.value = ''

  await nextTick()

  complete!(true)

  await saving

  assert.equal(writes, 0)

  assert.equal(h.open.value, false)

  h.stop()
})

test('confirming a person offers an explicit bounded apply step even when the candidate filter hides the confirmed row', async () => {
  const calls: string[] = []
  const person = { source_user_id: 'employee:7', display_name: '合成源人员', match_status: 'candidate', directory_uid: 'synthetic-target', open_owner_items: 102 }
  let confirmed = false
  const h = harness(async (path, options) => {
    calls.push(path)
    if (options.method) {
      confirmed = true
      return { data: { source_user_id: person.source_user_id, match_status: 'confirmed', directory_uid: person.directory_uid } }
    }
    return { data: path.endsWith('/identities') && !confirmed ? [person] : [], total: path.endsWith('/identities') && !confirmed ? 1 : 0, page: 1, pageSize: 20, openCounts: {} }
  }, 'altoc')
  try {
    await nextTick()
    h.status.value = 'candidate'
    await nextTick()
    h.begin(person, 'confirm')
    await h.save()
    assert.equal(h.open.value, false)
    assert.equal(h.applicationPrompt.value.match_status, 'confirmed')
    assert.equal(h.applicationPrompt.value.open_owner_items, 102)
    assert.equal(calls.filter(path => path.endsWith('/confirm')).length, 1)
    assert.equal(calls.filter(path => path.endsWith('/apply')).length, 0, 'confirm never auto-applies')
    h.view.value = 'exceptions'
    h.begin(h.applicationPrompt.value, 'apply', 'identities')
    assert.equal(h.selectedView.value, 'identities', 'the second step retains its command family across tab changes')
    h.permission.value = false
    await nextTick()
    assert.equal(h.applicationPrompt.value, null)
  } finally { h.stop() }
})

test('contract contact mismatch has its own label and manual resolution', () => {
  assert.equal(queue.queueKinds.altoc.contract_contact_mismatch, '合同联系人客户不一致')
  assert.deepEqual(queue.queueMethods({ kind: 'contract_contact_mismatch', status: 'open' }, true, false), ['mark_done', 'accept'])
})

test('B4 display preferences cannot persist source rows and queues retain full server pagination', () => {
  assert.deepEqual(queue.queueColumnPreference({ columns: ['id', 'id', 'row_json', 'account_no', 'created_at'], source: 'private' }), ['id', 'created_at'])
  assert.equal(queue.queueQuery('exceptions', 'owner_unmatched', 'open', 2, '', 100).pageSize, 100)
  const page = readFileSync(new URL('../app/components/host/W3MigrationQueuePage.vue', import.meta.url), 'utf8')
  assert.match(page, /:total="total"/)
  assert.match(page, /:items-per-page="pageSize"/)
  assert.match(page, /:sibling-count="1"/)
  assert.match(page, /共.*total.*条/)
  assert.match(page, /eventsFor/)
  assert.match(page, /:total="eventTotal"/)
})
