import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isExplicitProjectEligible } from '../server/utils/serviceTicketProjectResolution.ts'

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

describe('Altoc service ticket Aims work item scoped project resolution', () => {
  test('resolves project fallback only from scoped ticket facts before calling Aims', () => {
    const content = source('server/api/v1/service-tickets/[ticketCode]/aims-work-item.post.ts')

    assert.match(content, /await requirePermission\(event, 'service_ticket', 'edit'\)/)
    assert.match(content, /const dataAccessQuery = await resolveCurrentAltocDataAccessQuery\(event, 'service_ticket', 'edit'\)/)
    assert.match(content, /\/v1\/altoc\/service-tickets\/\$\{encodeURIComponent\(ticketCode\)\}\/dispatch-context/)
    assert.match(content, /query: dataAccessQuery/)
    assert.match(content, /resolveProjectCode\(event, ticketCode, body, ticket, dataAccessQuery\)/)

    assertBefore(
      content,
      'const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, \'service_ticket\', \'edit\')',
      'const ticket = await callAltocRuntime<RuntimeRow>'
    )
    assertBefore(
      content,
      'const ticket = await callAltocRuntime<RuntimeRow>',
      'const projectResolution = await resolveProjectCode(event, ticketCode, body, ticket, dataAccessQuery)'
    )
    assertBefore(
      content,
      'const projectResolution = await resolveProjectCode(event, ticketCode, body, ticket, dataAccessQuery)',
      'const frozen = await callAltocRuntime<{ ticket?: RuntimeRow, operation?: { operationKey?: string, status?: string } }>'
    )

    assert.match(content, /const serviceAgreementCode = firstText\(ticket, 'service_agreement_code', 'serviceAgreementCode', 'resolved_service_agreement_code'\)/)
    assert.match(content, /query: \{ \.\.\.dataAccessQuery, allow_missing: 'true' \}/)
    assert.match(content, /const contractCode = firstText\(ticket, 'contract_code', 'contractCode'\)/)
    assert.match(content, /const customerCode = firstText\(ticket, 'customer_code', 'customerCode'\)/)
    assert.match(content, /project_code: explicit/)
    assert.match(content, /if \(contractCode\) params\.set\('contract_code', contractCode\)/)
    assert.match(content, /if \(customerCode\) params\.set\('customer_code', customerCode\)/)
    assert.match(content, /isExplicitProjectEligible\(explicit, customerCode, contractCode, projectData\.items \|\| \[\]\)/)
    assert.match(content, /statusMessage: 'project_not_eligible'/)
    assert.match(content, /contract_match: 'exact'/)
    assert.match(content, /limit: '2'/)
    assert.match(content, /statusMessage: 'service_ticket_project_binding_conflict'/)
    assert.match(content, /aims-work-item:freeze/)
    assert.match(content, /resolvedProjectCode: projectResolution\.projectCode/)
    assert.match(content, /resolvedProjectSource: projectResolution\.source/)
    assert.match(content, /executeServiceTicketAimsOperation/)

    assert.doesNotMatch(content, /firstText\(body, 'serviceAgreementCode', 'service_agreement_code'\)/)
    assert.doesNotMatch(content, /const contractCode = firstText\(body, 'contractCode', 'contract_code'\)/)
    assert.doesNotMatch(content, /const customerCode = firstText\(body, 'customerCode', 'customer_code'\)/)
    assert.doesNotMatch(content, /customerCode: firstText\(body,/)
    assert.doesNotMatch(content, /customerName: firstText\(body,/)
    assert.doesNotMatch(content, /contractCode: firstText\(body,/)
    assert.doesNotMatch(content, /serviceTicketPayload/)
  })

  test('forged customer, contract, or project values cannot expand explicit project candidates', () => {
    const scopedCustomerCode = 'CUS-SCOPED'
    const scopedContractCode = 'CON-SCOPED'
    const candidates = [
      { project_code: 'PRJ-VALID-LINKED', customer_code: scopedCustomerCode, contract_code: scopedContractCode },
      { project_code: 'PRJ-VALID-UNLINKED', customer_code: scopedCustomerCode, contract_code: '' },
      { project_code: 'PRJ-FORGED-CUSTOMER', customer_code: 'CUS-FORGED', contract_code: scopedContractCode },
      { project_code: 'PRJ-FORGED-CONTRACT', customer_code: scopedCustomerCode, contract_code: 'CON-FORGED' }
    ]

    assert.equal(
      isExplicitProjectEligible('PRJ-VALID-LINKED', scopedCustomerCode, scopedContractCode, candidates),
      true
    )
    assert.equal(
      isExplicitProjectEligible('PRJ-VALID-UNLINKED', scopedCustomerCode, scopedContractCode, candidates),
      true
    )
    assert.equal(
      isExplicitProjectEligible('PRJ-FORGED-CUSTOMER', scopedCustomerCode, scopedContractCode, candidates),
      false
    )
    assert.equal(
      isExplicitProjectEligible('PRJ-FORGED-CONTRACT', scopedCustomerCode, scopedContractCode, candidates),
      false
    )
    assert.equal(
      isExplicitProjectEligible('PRJ-NOT-RETURNED', scopedCustomerCode, scopedContractCode, candidates),
      false
    )
  })

  test('does not treat an unlinked project as scoped by a contract code alone', () => {
    assert.equal(
      isExplicitProjectEligible('PRJ-UNLINKED', '', 'CON-SCOPED', [
        { project_code: 'PRJ-UNLINKED', customer_code: 'CUS-UNKNOWN', contract_code: '' }
      ]),
      false
    )
  })
})
