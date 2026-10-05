import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { compareDataRuntimeVersions, resolveDataRuntimeReleaseTarget } from '../server/utils/dataRuntimeRelease.ts'

describe('data runtime approved release target', () => {
  test('promotes an enrolled instance to the current approved version under the same signing key', () => {
    assert.deepEqual(resolveDataRuntimeReleaseTarget({
      enrolledDesiredVersion: '0.3.104',
      enrolledSigningKeyId: 'key-a',
      approvedVersion: '0.3.107',
      approvedSigningKeyId: 'key-a'
    }), {
      desiredVersion: '0.3.107',
      signingKeyId: 'key-a',
      changed: true,
      signingKeyCompatible: true,
      downgradeBlocked: false
    })
  })

  test('keeps the enrolled target when the approved release uses another trust anchor', () => {
    assert.deepEqual(resolveDataRuntimeReleaseTarget({
      enrolledDesiredVersion: '0.3.104',
      enrolledSigningKeyId: 'key-a',
      approvedVersion: '0.3.107',
      approvedSigningKeyId: 'key-b'
    }), {
      desiredVersion: '0.3.104',
      signingKeyId: 'key-a',
      changed: false,
      signingKeyCompatible: false,
      downgradeBlocked: false
    })
  })

  test('does not report a change when the approved version is already enrolled', () => {
    assert.equal(resolveDataRuntimeReleaseTarget({
      enrolledDesiredVersion: '0.3.107',
      enrolledSigningKeyId: 'key-a',
      approvedVersion: '0.3.107',
      approvedSigningKeyId: 'key-a'
    }).changed, false)
  })

  test('blocks implicit downgrade but permits an explicitly approved rollback', () => {
    assert.deepEqual(resolveDataRuntimeReleaseTarget({
      enrolledDesiredVersion: '0.3.137',
      enrolledSigningKeyId: 'key-a',
      approvedVersion: '0.3.129',
      approvedSigningKeyId: 'key-a'
    }), {
      desiredVersion: '0.3.137',
      signingKeyId: 'key-a',
      changed: false,
      signingKeyCompatible: true,
      downgradeBlocked: true
    })

    assert.equal(resolveDataRuntimeReleaseTarget({
      enrolledDesiredVersion: '0.3.137',
      enrolledSigningKeyId: 'key-a',
      approvedVersion: '0.3.129',
      approvedSigningKeyId: 'key-a',
      allowDowngrade: true
    }).desiredVersion, '0.3.129')
  })

  test('compares stable and prerelease semantic versions', () => {
    assert.equal(compareDataRuntimeVersions('0.3.137', '0.3.129'), 1)
    assert.equal(compareDataRuntimeVersions('0.3.137-rc.1', '0.3.137'), -1)
    assert.equal(compareDataRuntimeVersions('0.3.137-rc.2', '0.3.137-rc.1'), 1)
  })
})
