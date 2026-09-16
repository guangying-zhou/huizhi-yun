import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  explainPolicyBundleInstanceConflicts
} from '../server/utils/instanceConflictExplanation.ts'
import type { FoundationScopedAuthorizationGrant } from '../server/utils/scopeEvaluator.ts'

const payload = {
  conflictRules: [
    {
      ruleCode: 'tenant-finance-expense-maker-confirmation',
      ruleName: '租户付款制单与确认硬隔离',
      conflictType: 'segregation_of_duties',
      enforcement: 'enforce',
      leftAppCode: 'finance',
      leftResourceCode: 'expenses',
      leftAction: 'edit',
      rightAppCode: 'finance',
      rightResourceCode: 'expenses',
      rightAction: 'confirm',
      description: '租户要求付款制单人与确认人必须不同',
      status: 'active'
    }
  ]
}

function grants(...actions: string[]): FoundationScopedAuthorizationGrant[] {
  return actions.map(action => ({
    grantId: `grant:${action}`,
    permissions: [
      { appCode: 'finance', resourceCode: 'expenses', action }
    ]
  }))
}

function explain(options: Partial<Parameters<typeof explainPolicyBundleInstanceConflicts>[0]> = {}) {
  return explainPolicyBundleInstanceConflicts({
    tenantCode: 'C000001',
    uid: 'u1',
    appCode: 'finance',
    resourceCode: 'expenses',
    action: 'confirm',
    payload,
    grants: grants('edit', 'confirm'),
    object: { actorUid: 'u1' },
    principals: [{ kind: 'applicant', uid: 'u1' }],
    ...options
  })
}

describe('policy bundle instance conflict explanation', () => {
  test('detects blocking same-actor approval conflicts from bundle conflictRules', () => {
    const result = explain()

    assert.equal(result.hasViolation, true)
    assert.equal(result.hasBlockingViolation, true)
    assert.equal(result.hasWarningViolation, false)
    assert.equal(result.rules.length, 1)
    assert.equal(result.rules[0].status, 'violated')
    assert.equal(result.rules[0].reasonCode, 'self_approval')
    assert.equal(result.rules[0].requested.allowed, true)
    assert.equal(result.rules[0].counterpart.allowed, true)
    assert.equal(result.rules[0].sameActorPrincipals[0].kind, 'applicant')
  })

  test('satisfies the rule when the business instance actor is different', () => {
    const result = explain({
      principals: [{ kind: 'applicant', uid: 'u2' }]
    })

    assert.equal(result.hasViolation, false)
    assert.equal(result.hasBlockingViolation, false)
    assert.equal(result.rules[0].status, 'satisfied')
    assert.equal(result.rules[0].reasonCode, 'different_instance_actor')
  })

  test('does not apply the rule when counterpart permission is absent', () => {
    const result = explain({
      grants: grants('confirm')
    })

    assert.equal(result.hasViolation, false)
    assert.equal(result.rules[0].status, 'not_applicable')
    assert.equal(result.rules[0].reasonCode, 'missing_counterpart_permission')
    assert.equal(result.rules[0].requested.allowed, true)
    assert.equal(result.rules[0].counterpart.allowed, false)
  })

  test('treats archive as an approval-like action for publish archiving conflicts', () => {
    const result = explainPolicyBundleInstanceConflicts({
      tenantCode: 'C000001',
      uid: 'u1',
      appCode: 'codocs',
      resourceCode: 'reviews',
      action: 'archive',
      payload: {
        conflictRules: [
          {
            ruleCode: 'codocs-review-submit-archive',
            ruleName: '文档发起与发布归档分离',
            conflictType: 'segregation_of_duties',
            enforcement: 'warning',
            leftAppCode: 'codocs',
            leftResourceCode: 'reviews',
            leftAction: 'submit',
            rightAppCode: 'codocs',
            rightResourceCode: 'reviews',
            rightAction: 'archive',
            status: 'active'
          }
        ]
      },
      grants: [
        {
          grantId: 'grant:submit',
          permissions: [{ appCode: 'codocs', resourceCode: 'reviews', action: 'submit' }]
        },
        {
          grantId: 'grant:archive',
          permissions: [{ appCode: 'codocs', resourceCode: 'reviews', action: 'archive' }]
        }
      ],
      object: { actorUid: 'u1' },
      principals: [{ kind: 'initiator', uid: 'u1' }]
    })

    assert.equal(result.hasViolation, true)
    assert.equal(result.rules[0].status, 'violated')
    assert.equal(result.rules[0].reasonCode, 'self_approval')
  })
})
