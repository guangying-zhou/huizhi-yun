import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

// WizBiz migration W2, prerequisite 2: the unassigned-owner marker in the Host.
test('directory labels show the unassigned owner without asking Directory or flagging an error', async () => {
  const scope = { value: 'actor-scope' }
  globalThis.ref = value => ({ value })
  globalThis.computed = fn => ({ get value() {
    return fn()
  } })
  globalThis.useState = () => scope
  globalThis.watch = () => {}
  globalThis.onMounted = () => {}
  globalThis.onScopeDispose = () => {}
  const batches = []
  globalThis.$fetch = async (path, options) => {
    if (path.includes('/users/')) {
      batches.push(options.body.uids)
      // Directory knows Person only; it is never asked about the marker.
      return { code: 0, data: options.body.uids.filter(uid => uid === 'Person').map(uid => ({ uid, realName: '王明' })) }
    }
    return { code: 0, data: { tree: [] } }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/useHostDirectoryLabels')) return next(specifier + '.ts', context)
    if (specifier.endsWith('/sharedApiPath')) return { url: 'data:text/javascript,' + encodeURIComponent('export const sharedApiPath=p=>`/enterprise${p}`'), shortCircuit: true }
    if (specifier.endsWith('/reservedDirectorySubject')) return next(specifier + '.ts', context)
    return next(specifier, context)
  } })
  try {
    const { useAltocDirectoryLabels } = await import('../app/composables/useAltocDirectoryLabels.ts')
    const directory = useAltocDirectoryLabels({ value: ['Person', 'system:unassigned', 'System:Unassigned', 'client:aims.runtime'] })
    await directory.refresh(false)
    assert.deepEqual(batches, [['Person']], 'reserved subjects are not sent to the batch lookup')
    assert.equal(directory.directoryError.value, false, 'an unassigned owner on the page is not a directory failure')
    assert.equal(directory.userName('system:unassigned'), '未分配')
    assert.equal(directory.userName(''), '未分配')
    assert.equal(directory.userName('Person'), '王明')
    assert.notEqual(directory.userName('client:aims.runtime'), '姓名加载中或不可用')
    // A page showing only unassigned owners performs no user lookup at all.
    batches.length = 0
    const only = useAltocDirectoryLabels({ value: ['system:unassigned'] })
    await only.refresh(false)
    assert.equal(batches.length, 0)
    assert.equal(only.directoryError.value, false)
    // A genuinely unknown user is still a directory problem.
    const unknown = useAltocDirectoryLabels({ value: ['Ghost'] })
    await unknown.refresh(false)
    assert.equal(unknown.directoryError.value, true)
    assert.equal(unknown.userName('Ghost'), '姓名加载中或不可用')
  } finally {
    hooks.deregister()
    for (const key of ['ref', 'computed', 'useState', 'watch', 'onMounted', 'onScopeDispose', '$fetch']) delete globalThis[key]
  }
})

test('the owner selector used by APF forms cannot offer or submit a reserved subject', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
  const wrapper = read('../app/components/APFUserSelect.vue')
  // APF forms select owners only through the shared tree selector.
  assert.match(wrapper, /import UserTreeSelector from '\.\.\/\.\.\/\.\.\/foundation\/app\/components\/UserTreeSelector\.vue'/)
  const selector = read('../../foundation/app/components/UserTreeSelector.vue')
  assert.match(selector, /if \(isReservedDirectorySubject\(u\.uid\)\) continue/)
  assert.match(selector, /const selectable = uids\.filter\(uid => !isReservedDirectorySubject\(uid\) && availableUserMap\.value\.has\(uid\)\)/)
  // Candidates come from the Directory user list, which never contains built-ins.
  assert.match(selector, /sharedApiPath\('\/api\/directory\/users'\)/)
  assert.doesNotMatch(selector, /users\/batch/)
})
