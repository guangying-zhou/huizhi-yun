import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 走查 ISSUE-B-011（P0）：三处范围解析都先滤掉 tenant:global 再判断剩余是否为空，
// 把「显式授予全局范围」和「压根没配过范围」折叠成同一个 access='all'。
// 生产 tenant_role_scopes 与 platform_app_role_scopes 都是空表，因此所有未配范围的
// 角色都拿到全量访问。
//
// 修复后：未配置范围 -> none（失败关闭）；全量只能由显式 tenant:global 授予。

function source() {
  return readFileSync(new URL('../server/utils/financeScopedAuthorization.ts', import.meta.url), 'utf8')
}

describe('finance data scope fails closed when nothing is configured', () => {
  test('all three resolvers gate the全量 fallback on an explicit tenant:global scope', () => {
    const text = source()
    const bare = text.match(/scopeGroups\.length === 0/g) || []
    assert.equal(bare.length, 3, 'expected exactly three scope resolvers')

    // 三处都不得再无条件返回全量。
    assert.ok(
      !/scopeGroups\.length === 0\) return 'all'/.test(text),
      'responsibility resolver must not return all unconditionally'
    )
    assert.ok(
      !/scopeGroups\.length === 0\s*\)\s*\{\s*return \{ access: 'all' \}/.test(text),
      'expense/project resolvers must not return all unconditionally'
    )

    const guarded = text.match(/hasExplicitTenantGlobalScope\(grant\)/g) || []
    assert.equal(guarded.length, 3, 'every empty-scope fallback must be guarded')
  })

  test('explicit tenant:global is detected across all three scope sources', () => {
    const text = source()
    const fn = text.slice(
      text.indexOf('function hasExplicitTenantGlobalScope'),
      text.indexOf('function isSubjectSelfScope')
    )
    for (const key of ['defaultScopes', 'assignmentScopes', 'scopes']) {
      assert.ok(fn.includes(key), `tenant:global detection must consider grant.${key}`)
    }
    assert.ok(fn.includes('isTenantGlobalScope'), 'must reuse the tenant:global predicate')
  })

  test('subject:self and department scopes keep their existing meaning', () => {
    const text = source()
    // 回归保护：本次只改「空范围」的分支，已配范围的语义不得变化。
    assert.ok(text.includes(`? 'relation' : 'none'`), 'subject:self mapping must be preserved')
    assert.ok(text.includes(`{ access: 'dept', deptCodes: allowedDeptCodes }`), 'department mapping must be preserved')
  })
})
