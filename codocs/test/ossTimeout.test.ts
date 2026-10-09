import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveDocumentOssTimeoutMs } from '../server/utils/ossTimeout'

test('document OSS timeout defaults to 8000 and only accepts integers in 1000-120000', () => {
  const warnings: string[] = []
  const warn = (line: string) => warnings.push(line)
  for (const raw of [undefined, null, '', '   ']) assert.equal(resolveDocumentOssTimeoutMs(raw, warn), 8000)
  assert.deepEqual(warnings, [])
  assert.equal(resolveDocumentOssTimeoutMs('1000', warn), 1000)
  assert.equal(resolveDocumentOssTimeoutMs(' 30000 ', warn), 30000)
  assert.equal(resolveDocumentOssTimeoutMs('120000', warn), 120000)
  assert.deepEqual(warnings, [])
  for (const raw of ['999', '120001', '0', '-1', '30.5', '3e4', 'abc', '30000ms', '99999999', '0x7530']) {
    assert.equal(resolveDocumentOssTimeoutMs(raw, warn), 8000, raw)
  }
  assert.equal(warnings.length, 10)
  for (const line of warnings) {
    assert.deepEqual(JSON.parse(line), { event: 'codocs-oss-timeout-invalid', code: 'codocs_oss_timeout_invalid' })
  }
})
