import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { HocuspocusCollaborationProvider } from '../app/utils/hocuspocus-provider'

test('one-time admission is fetched once per socket and refreshed on reconnect', async () => {
  const original = globalThis.WebSocket
  const sockets: FakeSocket[] = []
  let tickets = 0
  class FakeSocket {
    static OPEN = 1
    readyState = 0
    binaryType = ''
    onopen: (() => void) | null = null
    onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    onclose: ((event: Event) => void) | null = null
    sent: Uint8Array[] = []
    url: string
    constructor(url: string) {
      this.url = url
      sockets.push(this)
    }

    open() {
      this.readyState = 1
      this.onopen?.()
    }

    send(bytes: Uint8Array) { this.sent.push(bytes) }
    close() { this.readyState = 3 }
    drop() {
      this.readyState = 3
      this.onclose?.(new Event('close'))
    }
  }
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
  const doc = new Y.Doc()
  const provider = new HocuspocusCollaborationProvider({
    url: 'ws://localhost/ws', documentName: 'doc:test', document: doc,
    token: async () => `v2.ticket-${++tickets}`, connect: false
  })
  try {
    provider.connect()
    assert.equal(sockets.length, 1)
    sockets[0]!.open()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(tickets, 1)
    assert.equal(sockets[0]!.sent.length, 1)

    sockets[0]!.drop()
    await new Promise(resolve => setTimeout(resolve, 230))
    assert.equal(sockets.length, 2)
    sockets[1]!.open()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(tickets, 2)
    assert.equal(sockets[1]!.sent.length, 1)
    assert.notDeepEqual(sockets[0]!.sent[0], sockets[1]!.sent[0])
  } finally {
    provider.destroy()
    doc.destroy()
    globalThis.WebSocket = original
  }
})
