import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  applyRuntimeReleaseApproval,
  isRuntimeReleaseApprovalObserved
} from '../app/utils/runtimeReleaseApproval.ts'

const staleSnapshot = {
  channel: {
    code: 'stable',
    approvedVersion: '0.3.152',
    approvalKind: 'promotion',
    approvedAt: '2026-07-27 15:42:27',
    source: 'registry' as const
  },
  releases: {
    items: [
      {
        version: '0.3.162',
        approved: false,
        approvedAt: null,
        approvalKind: null,
        approvalNote: null
      },
      {
        version: '0.3.152',
        approved: true,
        approvedAt: '2026-07-27 15:42:27',
        approvalKind: 'promotion',
        approvalNote: null
      }
    ],
    total: 2,
    page: 1,
    pageSize: 20
  },
  instances: {
    total: 1,
    aligned: 1,
    pending: 0,
    versions: [
      { currentVersion: '0.3.152', desiredVersion: '0.3.152', status: 'ready', count: 1 }
    ]
  }
}

const approval = {
  version: '0.3.162',
  approvalKind: 'promotion' as const,
  approvedAt: '2026-08-23 06:04:42',
  note: 'promote latest'
}

describe('Runtime release approval reconciliation', () => {
  test('applies the authoritative approval response over a stale list response', () => {
    assert.equal(isRuntimeReleaseApprovalObserved(staleSnapshot, approval), false)

    const reconciled = applyRuntimeReleaseApproval(staleSnapshot, approval)

    assert.equal(reconciled.channel.approvedVersion, '0.3.162')
    assert.equal(reconciled.channel.approvedAt, approval.approvedAt)
    assert.equal(reconciled.releases.items[0]?.approved, true)
    assert.equal(reconciled.releases.items[0]?.approvalNote, 'promote latest')
    assert.equal(reconciled.releases.items[1]?.approved, false)
    assert.equal(reconciled.instances.aligned, 0)
    assert.equal(reconciled.instances.pending, 1)
  })

  test('accepts a snapshot that observed or superseded the local approval', () => {
    const observed = applyRuntimeReleaseApproval(staleSnapshot, approval)
    assert.equal(isRuntimeReleaseApprovalObserved(observed, approval), true)

    const superseded = {
      ...observed,
      channel: {
        ...observed.channel,
        approvedVersion: '0.3.163',
        approvedAt: '2026-08-23 06:05:01'
      }
    }
    assert.equal(isRuntimeReleaseApprovalObserved(superseded, approval), true)
  })
})
