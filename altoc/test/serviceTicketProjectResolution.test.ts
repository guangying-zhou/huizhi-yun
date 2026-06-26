import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  altocRuntimeErrorCode,
  altocRuntimeErrorStatus,
  selectLegacyContractProject
} from '../server/utils/serviceTicketProjectResolution.ts'

describe('selectLegacyContractProject', () => {
  test('selects the only maintenance project deterministically', () => {
    const selection = selectLegacyContractProject('C-1', [
      { contract_code: 'C-1', project_code: 'PRJ-DEV', category: 'delivery' },
      { contract_code: 'C-1', project_code: 'PRJ-MAINT', category: 'maintenance' }
    ])

    assert.deepEqual(selection.resolution, {
      projectCode: 'PRJ-MAINT',
      source: 'legacy_contract_resolution'
    })
  })

  test('returns ambiguity for multiple maintenance projects', () => {
    const selection = selectLegacyContractProject('C-1', [
      { contract_code: 'C-1', project_code: 'PRJ-OPS', category: 'operation' },
      { contract_code: 'C-1', project_code: 'PRJ-INSPECT', category: 'maintenance' }
    ])

    assert.equal(selection.errorCode, 'project_resolution_ambiguous')
    assert.deepEqual(selection.candidateProjectCodes, ['PRJ-OPS', 'PRJ-INSPECT'])
  })

  test('returns ambiguity when non-maintenance fallback is not unique', () => {
    const selection = selectLegacyContractProject('C-1', [
      { contract_code: 'C-1', project_code: 'PRJ-A', category: 'delivery' },
      { contract_code: 'C-1', project_code: 'PRJ-B', category: 'special' }
    ])

    assert.equal(selection.errorCode, 'project_resolution_ambiguous')
  })

  test('ignores rows without project code when checking uniqueness', () => {
    const selection = selectLegacyContractProject('C-1', [
      { contract_code: 'C-1', project_code: '', category: 'maintenance' },
      { contract_code: 'C-1', project_code: 'PRJ-A', category: 'delivery' }
    ])

    assert.deepEqual(selection.resolution, {
      projectCode: 'PRJ-A',
      source: 'legacy_contract_resolution'
    })
  })
})

describe('altocRuntimeErrorStatus', () => {
  test('maps data integrity runtime errors to caller-visible status codes', () => {
    assert.equal(
      altocRuntimeErrorStatus({ error: { code: 'multiple_default_service_projects', message: 'bad data' } }),
      409
    )
    assert.equal(
      altocRuntimeErrorStatus({ error: { code: 'invalid_contract_project_line_refs', message: 'bad line' } }),
      400
    )
    assert.equal(
      altocRuntimeErrorStatus({ error: { code: 'no_default_project', message: 'missing' } }),
      404
    )
  })

  test('extracts nested error code and ignores string zero success code', () => {
    assert.equal(altocRuntimeErrorCode({ code: '0' }), '')
    assert.equal(altocRuntimeErrorCode({ error: { code: 'relation_ambiguous' } }), 'relation_ambiguous')
  })
})
