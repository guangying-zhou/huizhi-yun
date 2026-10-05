import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, toNodeListener } from 'h3'
import { parse } from '@vue/compiler-sfc'
import { businessModules } from '../composition/registry.mjs'
import { projectNameError } from '../../aims/shared/projectName.ts'

const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')

test('the shared project name rule mirrors the Runtime update command', () => {
  const runtime = read('data-runtime/internal/apps/aims/enterprise_project_update.go')
  assert.match(runtime, /`\^\[\\p\{Han\}a-zA-Z0-9\]\+\(\?:\[vV\]\\d\+\)\?\$`/)
  assert.match(runtime, /"name": 200/)
  for (const valid of ['智慧房产平台', 'ABC123', '项目V2', '項目v3', '𠀀项目']) assert.equal(projectNameError(valid), '', valid)
  for (const invalid of ['ZZ-TPLFIX-20260928 模板修复验证', '含 空格', 'a-b', 'x_y', '']) assert.notEqual(projectNameError(invalid), '', invalid)
  assert.notEqual(projectNameError('项'.repeat(201)), '')
})

test('Host project create rejects a name the edit command would later refuse', async () => {
  const calls = []
  globalThis.__projectCreateCall = async (_event, operation, input) => {
    calls.push({ operation, input })
    return { code: 0, data: { result: { id: 9 } } }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/enterpriseRuntimeClient')) return { url: 'data:text/javascript,export const requireEnterpriseUser=async()=>({uid:"U1",tenant:"T1",deployment:"host"});export const prepareEnterpriseRuntime=async()=>{};export const callEnterpriseRuntime=(...args)=>globalThis.__projectCreateCall(...args)', shortCircuit: true }
    if (specifier.endsWith('/projectCommandAuthorization')) return { url: 'data:text/javascript,export const loadProjectCommandAuthorization=async()=>({allowed:true})', shortCircuit: true }
    if (specifier === './enterpriseAimsPersonnel') return { url: 'data:text/javascript,export const enterpriseAimsPersonnel=async()=>[]', shortCircuit: true }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (!existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  let server
  try {
    const { enterpriseAimsProjectCreate } = await import('../server/utils/enterpriseAimsProjectCreate.ts')
    const app = createApp()
    const router = createRouter()
    router.post('/projects', enterpriseAimsProjectCreate)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const create = name => fetch(`http://127.0.0.1:${server.address().port}/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'create-key' },
      body: JSON.stringify({ projectCode: 'ZZTPL', name, shortName: 'ZZ', leaderUid: 'U1' })
    })
    const rejected = await create('ZZ-TPLFIX-20260928 模板修复验证')
    assert.equal(rejected.status, 400)
    const body = await rejected.json()
    assert.equal(body.data?.code, 'project_name_invalid')
    assert.equal(calls.length, 0)
    assert.equal((await create('模板修复验证V2')).status, 200)
    assert.equal(calls.at(-1).operation, 'aims.project-create')
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    delete globalThis.__projectCreateCall
  }
})

test('project create and edit pages use the shared rule and report it instead of disabling save', () => {
  const create = read('aims/layer/pages/enterprise-project-new.vue')
  assert.match(create, /import\{projectNameError\}from'\.\.\/\.\.\/shared\/projectName'/)
  assert.match(create, /async function submit\(\)\{nameTouched\.value=true;if\(nameError\.value\)return;/)
  assert.match(create, /label="项目名称" required :error="nameFieldError"/)
  const edit = read('aims/layer/pages/enterprise-project-edit.vue')
  assert.match(edit, /import \{ projectNameError \} from '\.\.\/\.\.\/shared\/projectName'/)
  assert.doesNotMatch(edit, /\\u4e00-\\u9fa5/)
  assert.doesNotMatch(edit, /:disabled="[^"]*nameError/)
})

// Nuxt UI v4 USelect (Reka SelectItem) throws for value ''. Composed pages use a
// sentinel instead; USelectMenu (combobox) is unaffected.
function composedFiles() {
  const files = new Set()
  const queue = []
  const pages = (list) => {
    for (const page of list) {
      queue.push(page.file)
      if (page.children) pages(page.children)
    }
  }
  for (const module of businessModules) pages(module.pages)
  while (queue.length) {
    const file = queue.shift()
    if (files.has(file) || !existsSync(file)) continue
    files.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/from\s+['"](\.[^'"]+\.vue)['"]/g)) {
      const target = resolve(dirname(file), match[1])
      if (existsSync(target) && statSync(target).isFile()) queue.push(target)
    }
  }
  return [...files].filter(file => file.endsWith('.vue'))
}

test('composed USelect items never use an empty-string value', () => {
  const failures = []
  for (const file of composedFiles()) {
    const source = readFileSync(file, 'utf8')
    if (!/<USelect[\s>]/.test(parse(source).descriptor.template?.content || '')) continue
    if (/\bvalue:\s*(?:''|"")\s*[,}]/.test(parse(source).descriptor.scriptSetup?.content || '')
      && /label:/.test(source)) {
      // Only flag option literals ({ label, value: '' }), not unrelated form models.
      for (const m of source.matchAll(/\{\s*label:[^{}]*\bvalue:\s*(?:''|"")\s*\}/g)) failures.push(`${relative(root, file)}: ${m[0]}`)
    }
  }
  assert.deepEqual(failures, [])
  const admin = read('aims/layer/pages/enterprise-admin-projects.vue')
  assert.match(admin, /category: filterValue\(category\.value\), lifecycleStatus: filterValue\(lifecycleStatus\.value\)/)
  assert.ok(admin.indexOf('}, { flush: \'sync\' })') < admin.indexOf('watch([page, debounced, category, lifecycleStatus, portfolioId]'), 'filter changes reset page before the reload')
  assert.match(read('aims/app/pages/projects/[id]/plan.vue'), /\$event === 'none' \? null/)
})
