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

describe('Altoc maintenance financial summary scoped filters', () => {
  test('customer service financial summary narrows query filters to scoped maintenance facts', () => {
    const content = source('server/api/v1/customers/[customerCode]/maintenance-financial-summary.get.ts')

    assert.match(content, /await requirePermission\(event, 'customer', 'view'\)/)
    assert.match(content, /resolveCurrentAltocDataAccessQuery\(event, 'customer', 'view'\)/)
    assert.match(content, /fetchMaintenanceSummary\(event, customerCode, dataAccessQuery\)/)
    assert.match(content, /const allowedContractCodes = unique\(contracts\.map/)
    assert.match(content, /const allowedProjectCodes = unique\(contracts\.map/)
    assert.match(content, /const requestedContractCodes = csvValues/)
    assert.match(content, /const requestedProjectCodes = csvValues/)
    assert.match(content, /const hasExplicitScope = requestedContractCodes\.length > 0 \|\| requestedProjectCodes\.length > 0/)
    assert.match(content, /requestedContractCodes\.length > 0 \? scopedFilter\(allowedContractCodes, requestedContractCodes\) : \[\]/)
    assert.match(content, /requestedProjectCodes\.length > 0 \? scopedFilter\(allowedProjectCodes, requestedProjectCodes\) : \[\]/)

    assertBefore(content, 'fetchMaintenanceSummary(event, customerCode, dataAccessQuery)', 'const token = await requestServiceAccessToken')
    assertBefore(content, 'const hasExplicitScope = requestedContractCodes.length > 0 || requestedProjectCodes.length > 0', 'params.set(\'contract_codes\'')
    assertBefore(content, 'const hasExplicitScope = requestedContractCodes.length > 0 || requestedProjectCodes.length > 0', 'params.set(\'project_codes\'')

    assert.doesNotMatch(content, /\.\.\.text\(query\.contract_codes[\s\S]+split\(','\)/)
    assert.doesNotMatch(content, /\.\.\.text\(query\.project_codes[\s\S]+split\(','\)/)
    assert.doesNotMatch(content, /finance_maintenance_summary_not_found/)
    assert.match(content, /statusCode: 502, message: 'Finance maintenance summary endpoint was not found\.'/)
  })
})
