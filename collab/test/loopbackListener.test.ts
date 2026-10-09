import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import test from 'node:test'
import { Server } from '@hocuspocus/server'
import { bindLoopbackListener } from '../src/providers/loopback-listener.js'

async function reachable(host: string, port: number) {
  return await new Promise<boolean>((resolve) => {
    const socket = connect({ host, port })
    const done = (value: boolean) => { socket.destroy(); resolve(value) }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(1000, () => done(false))
  })
}

test('real Hocuspocus listens on IPv4 loopback and not the machine interface', async () => {
  const provider = new Server({ port: 0, address: '127.0.0.1', quiet: true, stopOnSignals: false })
  bindLoopbackListener(provider.httpServer, '127.0.0.1')
  try {
    await provider.listen()
    const address = provider.httpServer.address() as AddressInfo
    assert.equal(address.address, '127.0.0.1')
    assert.equal(address.family, 'IPv4')
    assert.equal(await reachable('127.0.0.1', address.port), true)
    const external = Object.values(networkInterfaces()).flat().find(value => value?.family === 'IPv4' && !value.internal)
    if (external) assert.equal(await reachable(external.address, address.port), false)
    const unrelated = createServer()
    await new Promise<void>(resolve => unrelated.listen({ port: 0, host: '127.0.0.1' }, resolve))
    assert.equal((unrelated.address() as AddressInfo).address, '127.0.0.1')
    await new Promise<void>(resolve => unrelated.close(() => resolve()))
  } finally {
    await provider.destroy()
  }
})

test('wildcard, non-loopback and hostname configurations fail before listening', () => {
  for (const address of ['0.0.0.0', '::', '', 'localhost', '192.0.2.1']) {
    const server = createServer()
    assert.throws(() => bindLoopbackListener(server, address), /collab_loopback_address_required/)
    assert.equal(server.listening, false)
  }
})

test('unexpected listen signatures fail closed; the caller cannot override host', async () => {
  const server = createServer()
  bindLoopbackListener(server, '127.0.0.1')
  assert.throws(() => server.listen(0), /collab_listen_options_invalid/)
  assert.equal(server.listening, false)
  try {
    await new Promise<void>(resolve => server.listen({ port: 0, host: '0.0.0.0' }, resolve))
    assert.equal((server.address() as AddressInfo).address, '127.0.0.1')
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
