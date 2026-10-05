import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  deriveRoleCatalogCategory,
  generateRoleCatalogSplitSuggestion,
  normalizeRoleCatalogCategory,
  roleCatalogCategorySort
} from '../server/utils/roleCatalogCategory.ts'

describe('role catalog category', () => {
  test('manual catalog metadata wins over derived role text', () => {
    const result = deriveRoleCatalogCategory({
      roleCode: 'system_admin',
      roleName: '系统管理员',
      source: 'system',
      catalogCategory: 'management_duty'
    })

    assert.equal(result.category, 'management_duty')
    assert.equal(result.label, '管理职责')
    assert.equal(result.source, 'manual')
  })

  test('high risk role text is derived before generic management wording', () => {
    const result = deriveRoleCatalogCategory({
      roleCode: 'release_manager',
      roleName: '生产发布负责人',
      source: 'system'
    })

    assert.equal(result.category, 'high_risk_privilege')
    assert.equal(result.source, 'derived')
  })

  test('custom roles without stronger signals stay in custom bucket', () => {
    const result = deriveRoleCatalogCategory({
      roleCode: 'biz_assistant',
      roleName: '业务助理',
      source: 'custom'
    })

    assert.equal(result.category, 'custom_role')
  })

  test('category normalization rejects unknown values', () => {
    assert.equal(normalizeRoleCatalogCategory('main_position'), 'main_position')
    assert.equal(normalizeRoleCatalogCategory(''), null)
    assert.equal(normalizeRoleCatalogCategory('system'), null)
  })

  test('category sort keeps unknown values after configured categories', () => {
    assert.ok(roleCatalogCategorySort('main_position') < roleCatalogCategorySort('custom_role'))
    assert.ok(roleCatalogCategorySort('unknown') > roleCatalogCategorySort('custom_role'))
  })

  test('split suggestion separates wide high-risk privilege roles', () => {
    const suggestion = generateRoleCatalogSplitSuggestion({
      roleCode: 'system_admin',
      roleName: '系统管理员',
      category: 'high_risk_privilege',
      permissionCount: 120,
      appRoleCount: 8,
      assignedUserCount: 3,
      appCodes: ['platform', 'console', 'finance', 'assets']
    })

    assert.match(suggestion || '', /日常主岗位/)
    assert.match(suggestion || '', /高风险特权/)
  })

  test('split suggestion flags approval duties with broad scope', () => {
    const suggestion = generateRoleCatalogSplitSuggestion({
      roleCode: 'finance_manager',
      roleName: '财务审批经理',
      category: 'approval_duty',
      permissionCount: 95,
      appRoleCount: 3,
      assignedUserCount: 2,
      appCodes: ['finance', 'workflow']
    })

    assert.match(suggestion || '', /审批职责包/)
    assert.match(suggestion || '', /经办/)
  })

  test('split suggestion is quiet for narrow normal positions', () => {
    const suggestion = generateRoleCatalogSplitSuggestion({
      roleCode: 'project_assistant',
      roleName: '项目助理',
      category: 'main_position',
      permissionCount: 16,
      appRoleCount: 1,
      assignedUserCount: 1,
      appCodes: ['aims']
    })

    assert.equal(suggestion, null)
  })
})
