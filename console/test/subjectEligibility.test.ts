import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  decideSubjectEligibility,
  parseSubjectEligibilityRequest,
  resolveBoundSubjectEligibilityRequest,
  subjectEligibilityRegistry,
  SubjectEligibilityError
} from '../server/utils/subjectEligibilityContract.ts'

const clientRequest = () => parseSubjectEligibilityRequest({
  subjectUid: 'user-1',
  purpose: 'resource_expiry'
})
const request = () => resolveBoundSubjectEligibilityRequest(actor(), {
  tenantId: 'tenant-1', deploymentId: 'deployment-1'
}, clientRequest())

const actor = () => ({
  actorType: 'service', actorId: 'assets.runtime', appCode: 'assets',
  tenantCode: 'tenant-1', deploymentCode: 'deployment-1'
})

function assertContractError(run: () => unknown, code: string) {
  assert.throws(run, (error: unknown) => error instanceof SubjectEligibilityError && error.code === code)
}

describe('purpose-bound subject eligibility contract', () => {
  test('accepts only subject and purpose and rejects every permission/object/runtime override', () => {
    assert.equal(request().action, 'view')
    for (const injected of [
      { targetAppCode: 'aims' }, { resourceCode: 'admin' }, { action: 'edit' },
      { tenantId: 'tenant-2' }, { deploymentId: 'deployment-2' },
      { object: { owner: 'user-1' } }, { simulation: true }, { activeRoleCode: 'admin' }
    ]) {
      assertContractError(() => parseSubjectEligibilityRequest({ ...clientRequest(), ...injected }), 'subject_eligibility_request_invalid')
    }
    assertContractError(() => resolveBoundSubjectEligibilityRequest(actor(), {
      tenantId: 'tenant-1', deploymentId: 'deployment-1'
    }, { ...clientRequest(), purpose: 'arbitrary_permission_probe' }), 'subject_eligibility_tuple_unregistered')
  })

  test('rejects broadcast, service/system, overlong and control-character subjects and malformed purposes', () => {
    for (const subjectUid of ['@all', 'SYSTEM', 'service', 'service:runtime', 'client:assets', 'svc:worker', `u${'x'.repeat(64)}`, 'user\nadmin']) {
      assertContractError(() => parseSubjectEligibilityRequest({
        subjectUid,
        purpose: 'resource_expiry'
      }), 'subject_eligibility_subject_invalid')
    }
    for (const purpose of ['', `p${'x'.repeat(64)}`, 'Resource Expiry', 'resource\nexpiry', '../resource_expiry']) {
      assertContractError(() => parseSubjectEligibilityRequest({
        subjectUid: 'user-1',
        purpose
      }), purpose ? 'subject_eligibility_purpose_invalid' : 'subject_eligibility_request_invalid')
    }
  })

  test('registry exactly follows producer streams plus Workflow proxy actions and every target is declared', () => {
    const quoted = (source: string) => [...source.matchAll(/'([a-z][a-z0-9_]*)'/g)].map(match => match[1])
    const union = (path: string, typeName: string) => {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8')
      const match = source.match(new RegExp(`export type ${typeName}[\\s\\S]*?(?=\\nexport (?:interface|type|const|function))`))
      assert.ok(match, `${typeName} stream union is required`)
      return quoted(match[0])
    }
    const streamsByApp = new Map<string, string[]>([
      ['aims', union('../../aims/server/utils/dueNotificationPolicy.ts', 'AimsDueStream')],
      ['assets', union('../../assets/server/utils/dueNotificationPolicy.ts', 'AssetsDueStream')],
      ['people', union('../../people/server/utils/offboardingNotificationPolicy.ts', 'PeopleOffboardingStream')],
      ['finance', union('../../finance/server/utils/dueNotificationPolicy.ts', 'FinanceDueStream')],
      ['altoc', (() => {
        const source = readFileSync(new URL('../../altoc/server/utils/receivableDueNotificationPolicy.ts', import.meta.url), 'utf8')
        const match = source.match(/stream:\s*'([a-z][a-z0-9_]*)'/)
        assert.ok(match?.[1], 'Altoc receivable stream is required')
        return [match[1]]
      })()]
    ])
    const expectedKeys = [
      ...[...streamsByApp].flatMap(([app, streams]) => streams.map(stream => `${app}|${stream}`)),
      'workflow|task_actionable',
      'workflow|instance_actionable',
      'workflow|instance_status',
      'workflow|task_approve',
      'workflow|task_reject',
      'workflow|task_delegate',
      'workflow|instance_cancel',
      'workflow|instance_resubmit'
    ].sort()
    const registry = subjectEligibilityRegistry()
    assert.deepEqual([...registry.keys()].sort(), expectedKeys)

    for (const [key, target] of registry) {
      const app = key.split('|')[0]
      const manifest = JSON.parse(readFileSync(new URL(`../../${app}/app.manifest.json`, import.meta.url), 'utf8')) as {
        resources: Array<{ code: string, actions: string[] }>
      }
      const declared = manifest.resources.find(item => item.code === target.resourceCode)
      assert.ok(
        declared?.actions.includes(target.action),
        `${key} maps to undeclared ${app}:${target.resourceCode}:${target.action}`
      )
    }
  })

  test('Workflow purposes bind only to Workflow minimum-view resources', () => {
    const workflowActor = { ...actor(), actorId: 'workflow.runtime', appCode: 'workflow' }
    assert.deepEqual(resolveBoundSubjectEligibilityRequest(workflowActor, {
      tenantId: 'tenant-1', deploymentId: 'deployment-1'
    }, { subjectUid: 'approver-1', purpose: 'task_actionable' }), {
      subjectUid: 'approver-1',
      purpose: 'task_actionable',
      targetAppCode: 'workflow',
      resourceCode: 'workflow_tasks',
      action: 'view',
      tenantId: 'tenant-1',
      deploymentId: 'deployment-1'
    })
    assert.equal(resolveBoundSubjectEligibilityRequest(workflowActor, {
      tenantId: 'tenant-1', deploymentId: 'deployment-1'
    }, { subjectUid: 'approver-2', purpose: 'instance_actionable' }).resourceCode, 'workflow_instances')
    assert.equal(resolveBoundSubjectEligibilityRequest(workflowActor, {
      tenantId: 'tenant-1', deploymentId: 'deployment-1'
    }, { subjectUid: 'initiator-1', purpose: 'instance_status' }).resourceCode, 'workflow_instances')
    assertContractError(() => resolveBoundSubjectEligibilityRequest(workflowActor, {
      tenantId: 'tenant-1', deploymentId: 'deployment-1'
    }, { subjectUid: 'user-1', purpose: 'finance' }), 'subject_eligibility_tuple_unregistered')
  })

  test('Workflow proxy action purposes bind to exact non-overridable permissions', () => {
    const workflowActor = { ...actor(), actorId: 'workflow.runtime', appCode: 'workflow' }
    assert.deepEqual(resolveBoundSubjectEligibilityRequest(workflowActor, {
      tenantId: 'tenant-1', deploymentId: 'deployment-1'
    }, { subjectUid: 'approver-1', purpose: 'task_approve' }), {
      subjectUid: 'approver-1',
      purpose: 'task_approve',
      targetAppCode: 'workflow',
      resourceCode: 'workflow_tasks',
      action: 'approve',
      tenantId: 'tenant-1',
      deploymentId: 'deployment-1'
    })
  })

  test('binds dual-claim service identity to own app, tenant and deployment', () => {
    assert.equal(request().resourceCode, 'asset_items')
    assertContractError(() => resolveBoundSubjectEligibilityRequest({ ...actor(), appCode: 'aims' }, {
      tenantId: 'tenant-1', deploymentId: 'deployment-1'
    }, clientRequest()), 'subject_eligibility_tuple_unregistered')
    assertContractError(() => resolveBoundSubjectEligibilityRequest({ ...actor(), appCode: null }, {
      tenantId: 'tenant-1', deploymentId: 'deployment-1'
    }, clientRequest()), 'subject_eligibility_identity_incomplete')
    assertContractError(() => resolveBoundSubjectEligibilityRequest({ ...actor(), actorType: 'user' }, {
      tenantId: 'tenant-1', deploymentId: 'deployment-1'
    }, clientRequest()), 'subject_eligibility_identity_incomplete')
    for (const changed of [
      { actor: { ...actor(), tenantCode: 'tenant-2' }, binding: { tenantId: 'tenant-1', deploymentId: 'deployment-1' } },
      { actor: actor(), binding: { tenantId: 'tenant-1', deploymentId: 'deployment-2' } }
    ]) {
      assertContractError(() => resolveBoundSubjectEligibilityRequest(changed.actor, changed.binding, clientRequest()), 'subject_eligibility_runtime_binding_mismatch')
    }
  })

  test('requires explicit active Directory status before evaluating fresh policy', async () => {
    let evaluations = 0
    for (const status of [null, '', 'pending', 'inactive']) {
      const result = await decideSubjectEligibility(request(), {
        loadDirectoryStatus: async () => status,
        evaluatePermission: async () => {
          evaluations += 1
          return { allowed: true, policyRevision: 8 }
        }
      })
      assert.deepEqual(result, { active: false, allowed: false, reason: 'subject_inactive', policyRevision: null })
    }
    assert.equal(evaluations, 0)
  })

  test('returns only safe allow/deny evidence for current or expired/missing grants', async () => {
    for (const allowed of [true, false]) {
      const result = await decideSubjectEligibility(request(), {
        loadDirectoryStatus: async () => 'active',
        // false covers expired or absent effective grants from the normal-merged snapshot.
        evaluatePermission: async () => ({ allowed, policyRevision: 9 })
      })
      assert.deepEqual(Object.keys(result).sort(), ['active', 'allowed', 'policyRevision', 'reason'])
      assert.equal(result.allowed, allowed)
      assert.equal(result.reason, allowed ? 'allowed' : 'permission_denied')
    }
  })

  test('Directory and policy failures propagate fail closed', async () => {
    await assert.rejects(decideSubjectEligibility(request(), {
      loadDirectoryStatus: async () => { throw new Error('directory unavailable') },
      evaluatePermission: async () => ({ allowed: true, policyRevision: 1 })
    }), /directory unavailable/)
    await assert.rejects(decideSubjectEligibility(request(), {
      loadDirectoryStatus: async () => 'active',
      evaluatePermission: async () => { throw new Error('policy unavailable') }
    }), /policy unavailable/)
  })

  test('API authenticates before reading body and policy evaluation disables caches/simulation', () => {
    const api = readFileSync(new URL('../server/api/v1/console/service/authorization/subject-eligibility.post.ts', import.meta.url), 'utf8')
    assert.ok(api.indexOf('requireConsoleServiceActor(') < api.indexOf('readBody(event)'))
    assert.match(api, /'console',[\s\S]*'console:authorization:subject-eligibility'/)
    assert.doesNotMatch(api, /'console_authorization'/)
    const evaluator = readFileSync(new URL('../server/utils/subjectEligibility.ts', import.meta.url), 'utf8')
    assert.match(evaluator, /authorizationMode: 'merged'/)
    assert.match(evaluator, /ignoreSimulationSession: true/)
    assert.match(evaluator, /bypassSnapshotCache: true/)
    assert.match(evaluator, /action: input\.action/)
    assert.match(evaluator, /devPolicyBypassEnabled/)
    assert.match(api, /requireBoundTargetApp: true/)
    assert.match(api, /Cache-Control', 'no-store'/)
  })

  test('v1.42 grant registration is repeatable, exact and secret-free', () => {
    const seed = readFileSync(new URL('../docs/sql/Console-SQL-Seed-v1.42-subject-eligibility.sql', import.meta.url), 'utf8')
    const verify = readFileSync(new URL('../docs/sql/Console-SQL-Verify-v1.42-subject-eligibility.sql', import.meta.url), 'utf8')
    assert.match(seed, /'workflow\.runtime','Workflow Runtime','runtime','workflow'/)
    assert.match(seed, /'console:authorization'[\s\S]*'subject-eligibility'/)
    assert.match(seed, /JSON_ARRAY\('task_actionable','instance_actionable','instance_status'\)/)
    assert.match(seed, /app_code` IN \('aims','assets','people','workflow','finance','altoc'\)/)
    assert.match(verify, /app_code` IN \('aims','assets','people','workflow','finance','altoc'\)/)
    assert.match(seed, /ON DUPLICATE KEY UPDATE/)
    assert.match(verify, /CONCAT\(scg\.`resource_code`,':',scg\.`action`\)/)
    assert.doesNotMatch(`${seed}\n${verify}`, /client_secret|secret_value|plaintext/i)
  })

  test('v1.97 restores the exact Workflow eligibility grant and all proxy action purposes', () => {
    const seed = readFileSync(new URL('../docs/sql/Console-SQL-Seed-v1.97-workflow-subject-eligibility-grant.sql', import.meta.url), 'utf8')
    const verify = readFileSync(new URL('../docs/sql/Console-SQL-Verify-v1.97-workflow-subject-eligibility-grant.sql', import.meta.url), 'utf8')
    assert.match(seed, /client_code` = 'workflow\.runtime'/)
    assert.match(seed, /'console:authorization'[\s\S]*'subject-eligibility'/)
    assert.match(seed, /'semanticScope', 'console:authorization:subject-eligibility'/)
    assert.match(seed, /'audience', 'console'/)
    for (const purpose of ['task_approve', 'task_reject', 'task_delegate', 'instance_cancel', 'instance_resubmit']) {
      assert.match(seed, new RegExp(`'${purpose}'`))
      assert.match(verify, new RegExp(`JSON_QUOTE\\('${purpose}'\\)`))
    }
    assert.match(seed, /ON DUPLICATE KEY UPDATE/)
    assert.match(verify, /has_subject_eligibility/)
    assert.doesNotMatch(`${seed}\n${verify}`, /client_secret|secret_value|plaintext/i)
  })
})
