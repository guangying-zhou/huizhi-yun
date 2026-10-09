import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { presenceMembers, updatePresenceRoster, attachPresence } from '../app/utils/collaborationPresence.ts'

test('two clients exchange online/away presence, retain cursor colors, deduplicate tabs and reconnect', () => {
  const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()]
  const clients = docs.map(doc => new Awareness(doc))
  try {
    const [alice, bob, tab] = clients
    alice.setLocalStateField('user', { id: 'alice', name: 'Alice', color: '#f87171' })
    bob.setLocalStateField('user', { id: 'bob', name: 'Bob', color: '#38bdf8' })
    bob.setLocalStateField('cursor', { anchor: 'relative-anchor', head: 'relative-head' })
    const exchange = (from: Awareness) => applyAwarenessUpdate(alice, encodeAwarenessUpdate(from, [from.clientID]), 'remote')
    exchange(bob)
    assert.deepEqual(presenceMembers(alice).map(member => [member.id, member.status, member.color]), [['alice', 'online', '#f87171'], ['bob', 'online', '#38bdf8']])
    bob.setLocalStateField('presence', { status: 'away' })
    exchange(bob)
    assert.equal(presenceMembers(alice)[1]!.status, 'away')
    assert.equal(alice.getStates().get(bob.clientID)!.cursor.anchor, 'relative-anchor')
    tab.setLocalStateField('user', { id: 'bob', name: 'Bob', color: '#38bdf8' })
    exchange(tab)
    assert.equal(presenceMembers(alice).length, 2)
    assert.equal(presenceMembers(alice)[1]!.status, 'online')
    const before = presenceMembers(alice)
    removeAwarenessStates(alice, [bob.clientID, tab.clientID], 'timeout')
    const offline = updatePresenceRoster(before, presenceMembers(alice), true)
    assert.equal(offline[1]!.status, 'offline')
    bob.setLocalStateField('presence', { status: 'online' })
    exchange(bob)
    assert.equal(updatePresenceRoster(offline, presenceMembers(alice), true)[1]!.status, 'online')
    assert.ok(updatePresenceRoster(before, presenceMembers(alice), false).every(member => member.status === 'offline'))
  } finally {
    clients.forEach(client => client.destroy())
    docs.forEach(doc => doc.destroy())
  }
})

test('visibility/idle activity publishes presence without replacing cursor and removes listeners', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 })
  const doc = new Y.Doc(), awareness = new Awareness(doc)
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const activity = new EventTarget()
  try {
    awareness.setLocalStateField('cursor', { anchor: 1, head: 2 })
    const cleanup = attachPresence(awareness, page as unknown as Document, activity as unknown as Window, 10000)
    assert.equal(awareness.getLocalState()!.presence.status, 'online')
    t.mock.timers.tick(10000)
    assert.equal(awareness.getLocalState()!.presence.status, 'away')
    activity.dispatchEvent(new Event('keydown'))
    assert.equal(awareness.getLocalState()!.presence.status, 'online')
    page.visibilityState = 'hidden'
    page.dispatchEvent(new Event('visibilitychange'))
    assert.equal(awareness.getLocalState()!.presence.status, 'away')
    assert.deepEqual(awareness.getLocalState()!.cursor, { anchor: 1, head: 2 })
    cleanup()
    page.visibilityState = 'visible'
    activity.dispatchEvent(new Event('keydown'))
    assert.equal(awareness.getLocalState()!.presence.status, 'away')
  } finally {
    awareness.destroy()
    doc.destroy()
  }
})

test('a silent remote client expires after the protocol timeout, not an idle user', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const a = new Y.Doc(), b = new Y.Doc()
  const local = new Awareness(a), remote = new Awareness(b)
  try {
    remote.setLocalStateField('user', { id: 'remote', name: 'Remote', color: '#38bdf8' })
    remote.setLocalStateField('presence', { status: 'away' })
    applyAwarenessUpdate(local, encodeAwarenessUpdate(remote, [remote.clientID]), 'remote')
    const before = presenceMembers(local)
    assert.equal(before[0]!.status, 'away')
    local.meta.get(remote.clientID)!.lastUpdated = Date.now() - 30001
    t.mock.timers.tick(3001)
    assert.equal(presenceMembers(local).length, 0)
    assert.equal(updatePresenceRoster(before, presenceMembers(local), true)[0]!.status, 'offline')
  } finally {
    local.destroy()
    remote.destroy()
    a.destroy()
    b.destroy()
  }
})

test('editor wires the same awareness to cursors and uses the accessible presence component', async () => {
  const { readFileSync } = await import('node:fs')
  const editor = readFileSync(new URL('../app/components/editor/MilkdownEditor.client.vue', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../app/pages/documents/[uuid].vue', import.meta.url), 'utf8')
  const presence = readFileSync(new URL('../app/components/editor/CollaborationPresence.vue', import.meta.url), 'utf8')
  assert.match(editor, /collabService\.setAwareness\(props\.collaborationAwareness\)/)
  assert.match(editor, /\.ProseMirror-yjs-cursor > div/)
  assert.match(editor, /\.ProseMirror-yjs-selection/)
  assert.match(page, /import CollaborationPresence from/)
  assert.match(page, /<CollaborationPresence :members="collaboration\.members\.value"/)
  assert.doesNotMatch(page, /bg-success\/10/)
  assert.match(presence, /presenceLabels\[member\.status\]/)
  assert.match(presence, /borderColor: member\.color/)
  assert.match(presence, /:aria-label="label\(member\)"/)
})
