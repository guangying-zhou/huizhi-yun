import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('legacy platform runtime config endpoint', () => {
  test('only returns the Console runtime token for the current Console deployment license', () => {
    const content = source('server/api/v1/platform-runtime/config.post.ts')

    const appCodeCheck = content.indexOf('if (appCode !== \'console\')')
    const deploymentCheck = content.indexOf('if (deploymentCode !== config.deploymentCode)')
    const signatureCheck = content.indexOf('if (!verified)')
    const runtimeTokenReturn = content.indexOf('runtimeToken: config.runtimeToken')

    assert.ok(appCodeCheck >= 0, 'must reject non-console license appCode')
    assert.ok(deploymentCheck >= 0, 'must reject licenses for a different deployment')
    assert.ok(signatureCheck >= 0, 'must verify the license signature')
    assert.ok(runtimeTokenReturn >= 0, 'must return the legacy runtime token for compatible clients')

    assert.ok(appCodeCheck < runtimeTokenReturn, 'appCode check must happen before returning runtimeToken')
    assert.ok(deploymentCheck < runtimeTokenReturn, 'deploymentCode check must happen before returning runtimeToken')
    assert.ok(signatureCheck < runtimeTokenReturn, 'signature verification must happen before returning runtimeToken')
  })
})
