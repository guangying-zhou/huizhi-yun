import assert from 'node:assert/strict'
import test from 'node:test'
import { companySummaryOssVersionId } from '../server/utils/companyWeeklySummaryOssVersion'

const sha = 'a'.repeat(64)

test('company summary OSS version id keeps a real id and always fits document_versions.oss_version_id', () => {
  assert.equal(companySummaryOssVersionId(undefined, sha), `sha256-${sha}`)
  assert.equal(companySummaryOssVersionId('  ', sha), `sha256-${sha}`)
  const real = 'CAEQNhiBgIDe'.padEnd(64, 'x')
  assert.equal(companySummaryOssVersionId(` ${real} `, sha), real)
  assert.equal(companySummaryOssVersionId('v'.repeat(100), sha), 'v'.repeat(100))
  assert.equal(companySummaryOssVersionId('v'.repeat(101), sha), `sha256-${sha}`)
  for (const reported of [undefined, '', 'short', 'v'.repeat(500)]) {
    assert.ok([...companySummaryOssVersionId(reported, sha)].length <= 100)
  }
})
