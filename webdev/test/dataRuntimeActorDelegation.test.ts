import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('WebDev data-runtime actor delegation boundary', () => {
  test('uses the WebDev runtime identity before the explicit local static-token fallback', () => {
    const content = source('server/utils/dataRuntime.ts')

    assert.match(
      content,
      /isTenantRuntimeEnabled,[\s\S]*maybeCallTenantRuntime[\s\S]*from '@hzy\/foundation\/server\/utils\/tenantRuntimeClient'/
    )
    assert.match(content, /maybeCallTenantRuntime<T>\(event, path, \{/)
    assert.match(content, /appCode: 'webdev'/)
    assert.match(content, /scope: method === 'GET' \? 'webdev\.read' : 'webdev\.write'/)
    assert.match(content, /serviceTokenSourceBinding: 'service-client-policy'/)
    assert.match(content, /if \(runtime\.handled\) return runtime\.data/)
    assert.ok(content.indexOf('maybeCallTenantRuntime<T>') < content.indexOf('const config = dataRuntimeConfig(event)', content.indexOf('export async function dataRuntimeFetch')))
  })

  test('retains bootstrap context for service-token introspection but never uses it as a legacy runtime bearer', () => {
    const content = source('server/utils/dataRuntime.ts')

    assert.match(content, /function forwardedDataRuntimeToken/)
    assert.match(content, /isPlatformRuntimeBootstrapToken\(token\) \? '' : token/)
    assert.match(content, /forwardedDataRuntimeToken\(event\) \|\| config\.dataRuntime\?\.token/)
  })

  test('user-originated runtime calls sign the complete request target with the current Console actor', () => {
    const content = source('server/utils/dataRuntime.ts')

    assert.match(content, /function currentUserActor/)
    assert.match(content, /auth\?\.authenticated && auth\?\.subjectType !== 'service' && uid/)
    assert.match(content, /const payload = \[method, requestTarget, actorUid, '', signedAt\]\.join\('\\n'\)/)
    assert.match(content, /crypto\.subtle\.sign\('HMAC'/)
    assert.match(content, /'x-hzy-actor-signature': base64Url\(signature\)/)
    assert.match(content, /const url = new URL\(`\$\{config\.baseUrl\}\$\{path\}`\)/)
    assert.match(content, /actorDelegationHeaders\(event, config\.token, method, `\$\{url\.pathname\}\$\{url\.search\}`\)/)
  })

  test('only verified service intake/mine and the fixed auto-claim bridge use actorless runtime routes', () => {
    const intake = source('server/api/webdev/issues/intake.post.ts')
    const mine = source('server/api/webdev/issues/mine.get.ts')
    const claim = source('server/utils/issueClaim.ts')
    const runtime = source('server/utils/dataRuntime.ts')

    assert.match(intake, /requireWebDevService/)
    assert.match(intake, /\/v1\/webdev\/service\/issues\/intake/)
    assert.match(intake, /\/v1\/webdev\/service\/issues\/settings/)
    assert.match(intake, /`\/v1\/webdev\/service\/issues\/\$\{encodeURIComponent\(issueId\)\}`/)
    assert.match(mine, /requireWebDevService/)
    assert.match(mine, /\/v1\/webdev\/service\/issues\/mine/)
    assert.match(claim, /isServiceBridge/)
    assert.match(claim, /\/v1\/webdev\/service\/issues/)
    assert.match(runtime, /isAuthenticatedServiceRequest\(event\) \? '\/v1\/webdev\/service\/jobs' : '\/v1\/webdev\/jobs'/)
    assert.doesNotMatch(intake, /dataRuntimeFetch\(event, '\/v1\/webdev\/issues'/)
    assert.doesNotMatch(mine, /dataRuntimeFetch\(event, '\/v1\/webdev\/issues'/)
  })
})
