import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)

  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('runtime contract access boundaries', () => {
  test('policy bundle and revocation downloads stay behind runtime token middleware', () => {
    const runtimeAuth = source('server/utils/runtimeAuth.ts')
    const middleware = source('server/middleware/platform-access.ts')
    const latestBundle = source('server/api/v1/policy/bundles/latest.get.ts')
    const deploymentBundle = source('server/api/v1/runtime/deployments/[deploymentCode]/bundle.get.ts')
    const bundleDownload = source('server/api/v1/policy/bundles/[bundleVersion]/download.get.ts')
    const latestRevocation = source('server/api/v1/revocations/latest.get.ts')
    const revocationDownload = source('server/api/v1/revocations/[revocationVersion]/download.get.ts')

    assert.match(runtimeAuth, /'\/api\/v1\/policy\/'/)
    assert.match(runtimeAuth, /'\/api\/v1\/revocations\/'/)
    assert.match(middleware, /if \(isRuntimeContractPath\(path\)\) \{[\s\S]*await requireRuntimeAccess\(event, path\)/)
    assertBefore(middleware, 'await requireRuntimeAccess(event, path)', 'event.context.platformAccessScope = \'runtime\'')
    assertBefore(middleware, 'event.context.platformAccessScope = \'runtime\'', 'event.context.platformAccessScope = \'contract\'')

    for (const content of [latestBundle, deploymentBundle]) {
      assert.match(content, /downloadUrl:\s*`\/api\/v1\/policy\/bundles\/\$\{encodeURIComponent\(/)
    }
    assert.match(latestRevocation, /downloadUrl:\s*`\/api\/v1\/revocations\/\$\{encodeURIComponent\(/)

    for (const content of [bundleDownload, revocationDownload]) {
      assert.match(content, /resolveDeploymentForV1\(event/)
      assert.doesNotMatch(content, /skipRuntimeAccess|publicDownload|authDisabled/)
    }
  })
})
