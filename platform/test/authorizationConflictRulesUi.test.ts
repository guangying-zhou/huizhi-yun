import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  createAuthorizationConflictRuleDraft,
  hasDuplicateAuthorizationConflictRuleCode,
  normalizeAuthorizationConflictRule,
  replaceAuthorizationConflictRule,
  toggleAuthorizationConflictRuleStatus,
  validateAuthorizationConflictRule
} from '../app/utils/authorizationConflictRules.ts'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const validRule = createAuthorizationConflictRuleDraft({
  ruleCode: 'finance-maker-confirm',
  ruleName: '付款制单与确认分离',
  conflictType: 'segregation_of_duties',
  enforcement: 'enforce',
  leftRoleCode: 'finance_maker',
  rightRoleCode: 'finance_confirmer',
  leftAppCode: '',
  leftResourceCode: '',
  leftAction: '',
  rightAppCode: '',
  rightResourceCode: '',
  rightAction: '',
  description: '',
  status: 'active'
})

describe('authorization conflict rule UI behavior', () => {
  test('normalizes API fields and creates an independent default draft', () => {
    const normalized = normalizeAuthorizationConflictRule({
      ...validRule,
      ruleCode: ' finance-maker-confirm ',
      ruleName: ' 付款制单与确认分离 ',
      enforcement: 'unexpected',
      leftRoleCode: null,
      status: 'unexpected'
    })

    assert.equal(normalized.ruleCode, 'finance-maker-confirm')
    assert.equal(normalized.ruleName, '付款制单与确认分离')
    assert.equal(normalized.enforcement, 'warning')
    assert.equal(normalized.leftRoleCode, '')
    assert.equal(normalized.status, 'active')
    assert.notEqual(createAuthorizationConflictRuleDraft(), createAuthorizationConflictRuleDraft())
  })

  test('rejects incomplete, missing, and duplicate rule drafts before persistence', () => {
    assert.equal(validateAuthorizationConflictRule(createAuthorizationConflictRuleDraft()), '规则编码和名称不能为空。')
    assert.equal(validateAuthorizationConflictRule({ ...validRule, leftRoleCode: '', leftAppCode: 'finance' }), '左侧权限必须同时填写应用编码、业务对象和操作。')
    assert.equal(validateAuthorizationConflictRule({ ...validRule, rightRoleCode: '' }), '右侧必须填写角色编码或完整权限三元组。')
    assert.equal(validateAuthorizationConflictRule(validRule), '')
    assert.equal(hasDuplicateAuthorizationConflictRuleCode([validRule], validRule.ruleCode, -1), true)
    assert.equal(hasDuplicateAuthorizationConflictRuleCode([validRule], validRule.ruleCode, 0), false)
  })

  test('replaces or toggles only the selected rule without mutating the current array', () => {
    const secondRule = { ...validRule, ruleCode: 'aims-owner-approve', ruleName: '项目负责人审批分离' }
    const rules = [validRule, secondRule]
    const updated = replaceAuthorizationConflictRule(rules, { ...secondRule, description: '需要双人校验' }, 1)
    const toggled = toggleAuthorizationConflictRuleStatus(updated, 1)

    assert.equal(rules[1]?.description, '')
    assert.equal(updated[0]?.ruleCode, validRule.ruleCode)
    assert.equal(updated[1]?.description, '需要双人校验')
    assert.equal(toggled[1]?.status, 'disabled')
    assert.deepEqual(toggleAuthorizationConflictRuleStatus(updated, 99), updated)
  })

  test('keeps the editor open when persistence fails and keeps tenant-owned writes in the parent', () => {
    const manager = source('app/components/console/AuthorizationsManager.vue')
    const panel = source('app/components/console/AuthorizationConflictRulesPanel.vue')

    assert.match(manager, /async function persistConflictRules\([\s\S]*?return true[\s\S]*?return false/)
    assert.match(manager, /<AuthorizationConflictRulesPanel[\s\S]*?:save-rules="persistConflictRules"[\s\S]*?@warning="setNotice\('warning', \$event\)"/)
    assert.match(panel, /if \(await props\.saveRules\(editorTenantCode\.value, nextRules\)\) \{[\s\S]*?editorOpen\.value = false/)
    assert.match(panel, /watch\(\(\) => props\.tenantCode[\s\S]*?editorOpen\.value = false/)
  })
})
