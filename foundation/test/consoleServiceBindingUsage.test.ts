import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 走查 ISSUE-B-025 第十三层：workflow 在审批入站里读 Console directory users
// 时走的是普通 $fetch，Worker 子请求没有访客国家上下文，被生产 zone 的
// CN_CA_JP 规则判为 country=US，在到达 Console 之前就被拦成 403（响应体是
// 一段 HTML 拦截页）。整条 Finance -> Workflow 审批链因此永久失败。
//
// 根 CLAUDE.md 已明确要求：托管云业务 Worker 访问 Console 必须复用 Foundation
// 的 Console Service Binding 请求 helper，不得以普通 $fetch / fetch 经公网调用。
// 本测试把这条约束变成可执行的检查。

const ROOT = new URL('..', import.meta.url).pathname

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.nuxt' || entry === '.output') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

describe('Console API access goes through the service binding', () => {
  test('no server util fetches the Console API base URL directly', () => {
    const offenders: string[] = []
    for (const file of walk(join(ROOT, 'server'))) {
      // 该文件本身实现 binding 与公网回落，是唯一允许出现回落的地方
      if (file.endsWith('consoleServiceBinding.ts')) continue
      const source = readFileSync(file, 'utf8')
      const lines = source.split('\n')
      lines.forEach((line, index) => {
        // 形如 externalFetch(`${config.consoleApiUrl}...`) 或 $fetch(`${consoleApiUrl}...`)
        if (/(?:\$fetch|externalFetch|fetchExternal)\s*<?[^>]*>?\s*\(\s*`\$\{[^}]*consoleApiUrl\}/.test(line)) {
          offenders.push(`${file.slice(ROOT.length)}:${index + 1}`)
        }
      })
    }
    assert.deepEqual(
      offenders,
      [],
      'Console API calls must use consoleServiceFetch so the Console Service Binding is used; '
      + 'a public fetch from a Worker is rejected by the production geo WAF with 403'
    )
  })

  test('the shared helper prefers the binding and only falls back when absent', () => {
    const source = readFileSync(join(ROOT, 'server/utils/consoleServiceBinding.ts'), 'utf8')
    const helper = source.slice(source.indexOf('export async function consoleServiceFetch'))
    assert.match(helper, /const binding = consoleServiceBinding\(event\)/)
    assert.match(helper, /binding\.fetch\(normalizeConsoleServiceBindingUrl\(/)
    assert.match(helper, /CONSOLE_WORKER_USER_AGENT/, 'the public fallback must carry the Worker user agent')
  })

  test('directory API uses the shared helper for every Console call', () => {
    const source = readFileSync(join(ROOT, 'server/utils/directoryApi.ts'), 'utf8')
    const calls = [...source.matchAll(/consoleApiUrl\}/g)]
    assert.ok(calls.length >= 3, `expected at least 3 Console API call sites, found ${calls.length}`)
    assert.equal(
      (source.match(/consoleServiceFetch</g) || []).length,
      calls.length,
      'every Console API call site in directoryApi.ts must go through consoleServiceFetch'
    )
  })
})
