import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeProjectModuleConfig,
  projectModuleKeys,
  toPersistedProjectModuleConfig
} from '../app/utils/projectModuleConfig.ts'

describe('project module config normalization', () => {
  test('uses category defaults when no project override is present', () => {
    assert.deepEqual(normalizeProjectModuleConfig(null, 'delivery'), {
      milestones: true,
      workflows: true,
      requirements: false,
      releases: false,
      environments: true,
      service_desk: false,
      decomposition: false
    })
  })

  test('merges category defaults, template defaults, and project overrides in order', () => {
    const normalized = normalizeProjectModuleConfig(
      { environments: false, service_desk: true },
      'delivery',
      { requirements: true, releases: true }
    )

    assert.equal(normalized.requirements, true)
    assert.equal(normalized.releases, true)
    assert.equal(normalized.environments, false)
    assert.equal(normalized.service_desk, true)
  })

  test('keeps legacy milestones and process audit keys backward compatible', () => {
    const normalized = normalizeProjectModuleConfig({
      milestonesEnabled: false,
      processAuditEnabled: '0'
    }, 'custom_dev')

    assert.equal(normalized.milestones, false)
    assert.equal(normalized.workflows, false)
  })

  test('persists only the new module keys', () => {
    const persisted = toPersistedProjectModuleConfig({
      milestonesEnabled: false,
      processAuditEnabled: false,
      milestones: true
    }, 'maintenance')

    assert.deepEqual(Object.keys(persisted).sort(), [...projectModuleKeys].sort())
    assert.equal('milestonesEnabled' in persisted, false)
    assert.equal('processAuditEnabled' in persisted, false)
    assert.equal(persisted.milestones, true)
  })
})
