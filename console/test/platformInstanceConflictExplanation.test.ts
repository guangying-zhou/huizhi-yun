import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Platform instance conflict explanation proxy', () => {
  test('prefers local policy bundle conflictRules before Platform fallback', () => {
    const content = source('server/utils/platformInstanceConflictExplanation.ts')

    assert.match(content, /explainLocalPolicyBundleInstanceConflicts/)
    assert.match(content, /buildScopedAuthorizationGrantsFromPolicyBundle/)
    assert.match(content, /explainPolicyBundleInstanceConflicts/)
    assert.ok(
      content.indexOf('explainLocalPolicyBundleInstanceConflicts') < content.indexOf('fetchPlatform('),
      'local policy bundle explanation should appear before Platform fallback'
    )
  })

  test('falls back to the Platform internal API with Console service credentials', () => {
    const content = source('server/utils/platformInstanceConflictExplanation.ts')

    assert.match(content, /\/api\/platform\/internal\/authorization\/instance-conflict-explain/)
    assert.match(content, /Authorization': `Bearer \$\{config\.platformServiceToken\}`/)
    assert.match(content, /x-hzy-internal-principal': 'console-authorization-runtime'/)
    assert.match(content, /tenantCode: config\.tenantCode/)
    assert.match(content, /timeout: 10000/)
  })

  test('session endpoint resolves the current Console session and forwards the session uid', () => {
    const content = source('server/api/auth/instance-conflict-explain.post.ts')

    assert.match(content, /resolveConsoleSession\(event\)/)
    assert.match(content, /uid: session\.uid/)
    assert.match(content, /appCode: targetAppCode/)
    assert.match(content, /resourceCode/)
    assert.match(content, /principals: principalValue\(body\.principals\)/)
  })

  test('bearer endpoint verifies user tokens and defaults appCode from token audience', () => {
    const content = source('server/api/v1/console/user/instance-conflict-explain.post.ts')

    assert.match(content, /verifyAccessToken\(event, token\)/)
    assert.match(content, /const audience = audienceFromPayload\(payload\)/)
    assert.match(content, /const targetAppCode = text\(body\.appCode\) \|\| audience/)
    assert.match(content, /writeTokenEvent\(event, \{/)
    assert.match(content, /eventType: 'introspect'/)
  })
})
