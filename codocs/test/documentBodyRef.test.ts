/* eslint-disable @stylistic/max-statements-per-line -- compact fake storage clients */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { assertLegacyBodyDocument, isSnapshotV2Document, parseBodyRef, readBodyByRef } from '../server/utils/documentBodyRef.ts'

const body = Buffer.from('# exact published body')
const digest = createHash('sha256').update(body).digest('hex')
const wire = () => ({ generation: 4, epoch: 2, markdown: { key: 'codocs/snapshots/h/uuid/c/attempt/body.md', version: 'v-4' }, size: body.length, sha256: digest })

test('v2 detection and the legacy-body guard fail closed before storage', () => {
  assert.equal(isSnapshotV2Document({}), false)
  assert.equal(isSnapshotV2Document({ snapshot_generation: 0 }), false)
  assert.equal(isSnapshotV2Document({ snapshot_generation: 1 }), true)
  assert.equal(isSnapshotV2Document({ snapshot_generation: '2' }), true)
  const v1 = { uuid: 'a', snapshot_generation: 0 }
  assert.equal(assertLegacyBodyDocument(v1), v1)
  assert.throws(() => assertLegacyBodyDocument({ uuid: 'a', snapshot_generation: 3 }), (error: { statusCode?: number, data?: { code?: string } }) => error.statusCode === 409 && error.data?.code === 'document_on_snapshot_v2')
})

test('body reference is parsed strictly', () => {
  assert.deepEqual(parseBodyRef(wire()).markdown, wire().markdown)
  for (const bad of [null, {}, { ...wire(), generation: 0 }, { ...wire(), sha256: 'nope' }, { ...wire(), markdown: { key: 'codocs/other/body.md', version: 'v' } }, { ...wire(), markdown: { key: wire().markdown.key, version: '' } }, { ...wire(), size: -1 }]) {
    assert.throws(() => parseBodyRef(bad), { statusCode: 503 })
  }
})

test('exact version is read and verified; a mismatch never yields content', async () => {
  const calls: unknown[] = []
  const good = { get: async (path: string, options?: { versionId?: string }) => { calls.push([path, options?.versionId]); return { content: body } } }
  assert.equal((await readBodyByRef(good, parseBodyRef(wire()))).toString(), body.toString())
  assert.deepEqual(calls, [[wire().markdown.key, 'v-4']])
  await assert.rejects(readBodyByRef({ get: async () => ({ content: Buffer.from('# tampered body!!!!') }) }, parseBodyRef(wire())), { statusCode: 503 })
  await assert.rejects(readBodyByRef({ get: async () => ({ content: Buffer.from('# exact published bodY') }) }, parseBodyRef(wire())), { statusCode: 503 })
  await assert.rejects(readBodyByRef({ get: async () => { throw new Error('offline') } }, parseBodyRef(wire())), { statusCode: 503 })
})
