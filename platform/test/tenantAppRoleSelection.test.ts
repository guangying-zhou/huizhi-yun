import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { setTenantAppRoleSelected } from '../app/utils/tenantAppRoleSelection.ts'

describe('tenant app role selection', () => {
  test('selects only the requested role and preserves other selections', () => {
    const initial = ['workflow:viewer']
    const selected = setTenantAppRoleSelected(initial, 'workflow:approver', true)

    assert.deepEqual(selected, ['workflow:viewer', 'workflow:approver'])
    assert.deepEqual(initial, ['workflow:viewer'])
    assert.equal(setTenantAppRoleSelected(selected, 'workflow:approver', true), selected)
    assert.deepEqual(setTenantAppRoleSelected(selected, 'workflow:approver', false), ['workflow:viewer'])
  })

  test('binds each checkbox to its own boolean value instead of the shared array model', () => {
    const component = readFileSync(new URL('../app/components/console/RolesManager.vue', import.meta.url), 'utf8')

    assert.match(component, /:model-value="selectedAppRoleCodes\.includes\(appRole\.roleCode\)"/)
    assert.match(component, /@update:model-value="setAppRoleSelected\(appRole\.roleCode, \$event === true\)"/)
    assert.doesNotMatch(component, /<UCheckbox\s+v-model="selectedAppRoleCodes"/)
  })
})
