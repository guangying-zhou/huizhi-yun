import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 走查 ISSUE-B-025 最后一环：maybeCallFinanceDataRuntime 曾逐字段枚举转发
// （只转 scope/method/query/body），把调用方传的 serviceCommandActor 静默丢掉。
// 类型是 Omit<TenantRuntimeCallOptions, 'appCode'>，传这些字段不会有任何类型
// 错误，所以 lint / typecheck / 单测全都发现不了。
//
// 生产后果：actor 委托签名头根本没发出去 -> data-runtime 的
// runtimeSignedActorContext 验不过 -> 回落到服务主体 -> current_user 被清空
// -> 403 trusted_actor_mismatch。

const ROOT = new URL('..', import.meta.url).pathname
const WRAPPER = join(ROOT, 'server/utils/dataRuntime.ts')

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.nuxt' || entry === '.output') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

/** 抓 maybeCallFinanceDataRuntime(...) 调用里最后一个对象字面量的顶层键名。 */
function callerOptionKeys(raw: string) {
  // 去掉行注释，避免注释里的 `key:` 被当成真实选项
  const source = raw.replace(/^\s*\/\/.*$/gmu, '')
  const keys = new Set<string>()
  // 调用点可能带泛型：maybeCallFinanceDataRuntime<RuntimeEnvelope>(...)
  const callSites = [...source.matchAll(/maybeCallFinanceDataRuntime\s*(?:<[^>]*>)?\s*\(/gu)]
    .map(match => match.index ?? -1)
    .filter(position => position >= 0)
  let siteIndex = 0
  let index = callSites.length > 0 ? callSites[0] : -1
  while (index >= 0) {
    const open = source.indexOf('{', index)
    if (open < 0) break
    let depth = 0
    let end = -1
    for (let cursor = open; cursor < source.length; cursor += 1) {
      const char = source[cursor]
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          end = cursor
          break
        }
      }
    }
    if (end < 0) break
    const literal = source.slice(open + 1, end)
    // 只取顶层键：跳过嵌套对象内部
    let nested = 0
    let token = ''
    for (let cursor = 0; cursor < literal.length; cursor += 1) {
      const char = literal[cursor]
      if (char === '{' || char === '[' || char === '(') nested += 1
      else if (char === '}' || char === ']' || char === ')') nested -= 1
      else if (nested === 0) token += char
    }
    for (const match of token.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:/g)) {
      keys.add(match[1])
    }
    siteIndex += 1
    index = siteIndex < callSites.length ? callSites[siteIndex] : -1
  }
  return keys
}

describe('finance data runtime wrapper option forwarding', () => {
  test('wrapper forwards the caller options object wholesale', () => {
    const wrapper = readFileSync(WRAPPER, 'utf8')
    const body = wrapper.slice(wrapper.indexOf('export async function maybeCallFinanceDataRuntime'))
    const call = body.slice(body.indexOf('return maybeCallTenantRuntime'))
    assert.ok(
      call.includes('...options'),
      'maybeCallFinanceDataRuntime must spread the caller options; enumerating fields silently drops the rest'
    )
  })

  test('every option key any caller passes actually reaches the tenant runtime', () => {
    const wrapper = readFileSync(WRAPPER, 'utf8')
    const spreads = wrapper.includes('{ ...options, appCode:') || wrapper.includes('...options,')

    const passed = new Set<string>()
    for (const file of walk(join(ROOT, 'server'))) {
      if (file === WRAPPER) continue
      for (const key of callerOptionKeys(readFileSync(file, 'utf8'))) passed.add(key)
    }

    // 至少要覆盖到那个真实踩坑的键，否则这条测试等于没断言
    assert.ok(
      passed.has('serviceCommandActor'),
      'expected at least one caller to pass serviceCommandActor (the B-025 regression key)'
    )

    if (spreads) return
    const wrapperCall = wrapper.slice(wrapper.indexOf('return maybeCallTenantRuntime'))
    const dropped = [...passed].filter(key => key !== 'appCode' && !wrapperCall.includes(`${key}:`))
    assert.deepEqual(dropped, [], `wrapper silently drops caller options: ${dropped.join(', ')}`)
  })
})
