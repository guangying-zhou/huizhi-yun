/**
 * 项目创建必填字段契约
 *
 * data-runtime 要求 project_code、name、short_name 三者必填，缺失返回
 * 400 missing_required_fields。历史上 ProjectCreateModal 只初始化了
 * shortName 却没有输入框，导致该入口创建任何分类的项目都失败。
 *
 * 所有创建入口都必须：收集这三个字段 + 提交前拦截 + 复用共享校验。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

import { validateProjectShortName } from '../app/utils/projectShortName.ts'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

const entries = [
  ['ProjectCreateModal', read('../app/components/project/ProjectCreateModal.vue')],
  ['projects/new.vue', read('../app/pages/projects/new.vue')]
] as const

describe('项目创建入口必填字段', () => {
  for (const [name, source] of entries) {
    test(`${name} 收集项目简称并绑定输入`, () => {
      assert.match(source, /v-model="(createForm|form)\.shortName"/, `${name} 缺少项目简称输入框`)
    })

    test(`${name} 提交前拦截空简称`, () => {
      // 必须在提交前校验，否则空简称会撞服务端 missing_required_fields
      assert.match(
        source,
        /validateShortName\((createForm|form)\.value\.shortName\)/,
        `${name} 提交前未校验项目简称`
      )
    })

    test(`${name} 复用共享校验而非自建规则`, () => {
      assert.match(source, /validateProjectShortName as validateShortName/, `${name} 应从 config/project 引入`)
      assert.doesNotMatch(
        source,
        /shortName不能超过|不能超过6个汉字'\s*\n?\s*}/,
        `${name} 不应自建简称规则副本`
      )
    })
  }
})

describe('共享简称校验规则', () => {
  test('空值拦截', () => {
    assert.equal(validateProjectShortName(''), '请填写项目简称')
    assert.equal(validateProjectShortName('   '), '请填写项目简称')
    assert.equal(validateProjectShortName(undefined), '请填写项目简称')
    assert.equal(validateProjectShortName(null), '请填写项目简称')
  })

  test('超过 6 个汉字拦截', () => {
    assert.equal(validateProjectShortName('汇智云项目管理系统'), '项目简称不能超过6个汉字')
    assert.equal(validateProjectShortName('汇智云'), '')
    // 仅统计汉字，英文数字不计入
    assert.equal(validateProjectShortName('HZY-Aims-2026'), '')
  })
})
