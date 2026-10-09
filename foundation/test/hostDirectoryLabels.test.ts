import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { ref, computed, watch, onScopeDispose, effectScope, nextTick } from 'vue'
import { isReservedDirectorySubject, UNASSIGNED_OWNER_LABEL, UNASSIGNED_OWNER_UID } from '../shared/utils/reservedDirectorySubject'

function harness(fetcher: (path: string, options?: { body: { uids: string[] } }) => Promise<unknown>) {
  const source = readFileSync(new URL('../app/composables/useHostDirectoryLabels.ts', import.meta.url), 'utf8')
  const program = ts.createSourceFile('labels.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const script = program.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(program)).join('\n').replace('export function', 'function')
  const code = ts.transpileModule(script + '\nreturn useHostDirectoryLabels(uids, enabled)', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const uids = ref(['synthetic-person', 'synthetic-person', 'system:unassigned']), enabled = ref(true), cache = ref('synthetic-session')
  const context = { ref, computed, watch, onScopeDispose, onMounted: () => {}, useState: () => cache, uids, enabled, isReservedDirectorySubject, UNASSIGNED_OWNER_LABEL, UNASSIGNED_OWNER_UID, sharedApiPath: (path: string) => '/enterprise' + path, $fetch: fetcher }
  const scope = effectScope()
  const result = scope.run(() => new Function(...Object.keys(context), code)(...Object.values(context)))
  return { ...result, uids, enabled, cache, stop: () => scope.stop() }
}
test('Host directory labels coalesce exact batch lookups, resolve name/department and never render UID as a name', async () => {
  const calls: string[] = []
  const h = harness(async (path, options) => {
    calls.push(path)
    if (options) {
      assert.deepEqual(options.body.uids, ['synthetic-person'])
      return { code: 0, data: [{ uid: 'synthetic-person', realName: '合成人员', deptCode: 'D-SYNTHETIC' }, { uid: 'unrequested-person', realName: 'MUST-NOT-LEAK' }] }
    }
    return { code: 0, data: { tree: [{ name: '合成部门', deptCode: 'D-SYNTHETIC' }] } }
  })
  try {
    await Promise.all([h.refresh(false), h.refresh(false)])
    assert.equal(calls.length, 2)
    assert.equal(h.userName('synthetic-person'), '合成人员')
    assert.equal(h.userDepartment('synthetic-person'), '合成部门')
    assert.equal(h.userName('system:unassigned'), UNASSIGNED_OWNER_LABEL)
    assert.notEqual(h.userName('unrequested-person'), 'MUST-NOT-LEAK')
    assert.notEqual(h.userName('unknown-uid'), 'unknown-uid')
  } finally { h.stop() }
})
test('scope changes discard late directory data and disabled consumers make no new request', async () => {
  let finish: ((response: unknown) => void) | undefined
  let calls = 0
  const h = harness(async (_path, options) => {
    calls++
    return options
      ? await new Promise((resolve) => {
          finish = resolve
        })
      : { code: 0, data: { tree: [] } }
  })
  try {
    const pending = h.refresh(false)
    h.enabled.value = false
    h.cache.value = 'new-synthetic-session'
    finish!({ code: 0, data: [{ uid: 'synthetic-person', realName: 'OLD-SCOPE-MUST-NOT-LEAK' }] })
    await pending
    await nextTick()
    assert.notEqual(h.userName('synthetic-person'), 'OLD-SCOPE-MUST-NOT-LEAK')
    const before = calls
    await h.refresh()
    assert.equal(calls, before)
  } finally { h.stop() }
})
