import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

test('Workflow proxy accepts a delegated browser actor only from the token-bound source app', () => {
  const proxy = source('../../foundation/server/api/workflow-proxy/[...path].ts')
  const identity = source('../server/utils/authIdentity.ts')
  const middleware = source('../server/middleware/data-runtime.ts')
  const runtime = source('../server/utils/dataRuntime.ts')

  assert.match(proxy, /const appCode = String\(pub\?\.appCode \|\| ''\)\.trim\(\)/)
  assert.match(proxy, /Workflow proxy app identity is not configured/)
  assert.doesNotMatch(proxy, /pub\?\.appCode \|\| pub\?\.appName/)
  assert.match(proxy, /headers\.set\('x-hzy-request-app-code', appCode\)/)
  assert.match(proxy, /queryParams\.set\('request_app_code', appCode\)/)

  assert.match(identity, /scopes\.has\('workflow:proxy'\)/)
  assert.match(identity, /declaredApp !== sourceApp/)
  assert.match(identity, /getTrustedWorkflowProxyActor/)
  assert.doesNotMatch(identity, /workflow:proxy'\) && !scopes\.has\('workflow:invoice-request:create'/)

  assert.match(middleware, /const workflowProxyActor = getTrustedWorkflowProxyActor\(event, consoleAuth\)/)
  assert.match(middleware, /checkSubjectEligibility/)
  assert.match(middleware, /resolveWorkflowProxyAuthorizationPurpose/)
  assert.match(middleware, /subjectUid: workflowProxyActor\.uid/)
  assert.doesNotMatch(middleware, /workflowProxyActor[\s\S]*headers\.cookie/)
  assert.match(middleware, /workflowProxyActor: \{ uid: workflowProxyActor\.uid \}/)
  assert.match(middleware, /serviceTokenSourceBinding: 'service-client-policy'/)
  assert.match(middleware, /needsProjectDirectorReconciliation\(suffix, query\)/)
  assert.match(middleware, /resourceCode === 'milestones'/)
  assert.match(middleware, /actionCode === 'milestone_completion'/)
  assert.doesNotMatch(middleware, /await drainWorkflowActionableLifecycleOutbox\(event\)/)
  assert.doesNotMatch(middleware, /await drainWorkflowCallbackOutbox\(event\)/)
  assert.match(runtime, /workflowProxyActor\?: \{ uid: string \}/)
  assert.match(runtime, /workflowProxyActor: options\.workflowProxyActor/)
  assert.match(runtime, /serviceTokenSourceBinding: options\.serviceTokenSourceBinding/)
  const tenantRuntimeClient = source('../../foundation/server/utils/tenantRuntimeClient.ts')
  assert.match(tenantRuntimeClient, /!usesServiceClientPolicy && sourceDeployment !== input\.deployment/)
})
