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

describe('Altoc cross-app read scoped authorization', () => {
  test('customer delivery package verifies scoped customer before requesting Assets token', () => {
    const content = source('server/api/v1/customers/[customerCode]/delivery-package.get.ts')

    assert.match(content, /await requirePermission\(event, 'customer', 'view'\)/)
    assert.match(content, /resolveCurrentAltocDataAccessQuery\(event, 'customer', 'view'\)/)
    assert.match(content, /assertCustomerScope\(event, customerCode, dataAccessQuery\)/)
    assert.match(content, /\/v1\/altoc\/service\/customers\/\$\{encodeURIComponent\(customerCode\)\}\/maintenance-summary/)
    assert.match(content, /scope: 'altoc\.read altoc:customer:view'/)
    assert.match(content, /audience: 'assets'/)
    assert.match(content, /scope: 'assets:read'/)

    assertBefore(content, 'await requirePermission(event, \'customer\', \'view\')', 'const token = await requestServiceAccessToken')
    assertBefore(content, 'await assertCustomerScope(event, customerCode, dataAccessQuery)', 'const token = await requestServiceAccessToken')
    assertBefore(content, 'const token = await requestServiceAccessToken', 'authorization: `Bearer ${token}`')
    assert.doesNotMatch(content, /assets_delivery_package_not_found/)
    assert.match(content, /statusCode: 502, message: 'Assets delivery package endpoint was not found\.'/)
  })

  test('contract eligible Aims project lookup verifies scoped contract before requesting Aims token', () => {
    const content = source('server/api/v1/contracts/[id]/eligible-aims-projects.get.ts')

    assert.match(content, /await requirePermission\(event, 'contract', 'view'\)/)
    assert.match(content, /resolveCurrentAltocDataAccessQuery\(event, 'contract', 'view'\)/)
    assert.match(content, /\/v1\/altoc\/contracts\/\$\{encodeURIComponent\(id\)\}/)
    assert.match(content, /scope: 'altoc\.read altoc:contract:view'/)
    assert.match(content, /params\.set\('contract_code', text\(contract\.code\)\)/)
    assert.match(content, /params\.set\('customer_code', customerCode\)/)
    assert.match(content, /audience: 'aims'/)
    assert.match(content, /scope: 'aims:read'/)

    assertBefore(content, 'await requirePermission(event, \'contract\', \'view\')', 'const token = await requestServiceAccessToken')
    assertBefore(content, 'const contract = await loadContract(event, id)', 'const token = await requestServiceAccessToken')
    assertBefore(content, 'params.set(\'contract_code\', text(contract.code))', 'const token = await requestServiceAccessToken')
    assertBefore(content, 'const token = await requestServiceAccessToken', 'authorization: `Bearer ${token}`')
  })
})
