import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('folder list returns runtime pagination facts and preserves HTTP errors', async () => {
  const oldHarness = globalThis.__folderListHarness
  const oldHandler = globalThis.defineEventHandler
  const oldGetQuery = globalThis.getQuery
  const oldCreateError = globalThis.createError
  globalThis.__folderListHarness = { query: {}, runtime: null, permissionError: null, uid: 'person-a', deptError: null }
  globalThis.defineEventHandler = handler => handler
  globalThis.getQuery = () => globalThis.__folderListHarness.query
  globalThis.createError = ({ statusCode, message }) => Object.assign(new Error(message), { statusCode })

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      const harness = 'globalThis.__folderListHarness'
      const modules = new Map([
        ['~~/server/utils/authIdentity', `export const requireRequestUid=()=>${harness}.uid`],
        ['~~/server/utils/codocsRuntime', `export const callCodocsTenantRuntime=async (_event,_path,options)=>{${harness}.runtimeOptions=options;if(${harness}.runtime instanceof Error)throw ${harness}.runtime;return ${harness}.runtime}`],
        ['~~/server/utils/checkPermission', `export const requirePermission=async()=>{if(${harness}.permissionError)throw ${harness}.permissionError}`],
      ])
      const source = modules.get(specifier) || (specifier.endsWith('/departmentAccess') ? `export const requireDepartmentReadAccess=async()=>{if(globalThis.__folderListHarness.deptError)throw globalThis.__folderListHarness.deptError}` : null)
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      let candidate
      if (specifier.startsWith('~~/')) candidate = resolve(import.meta.dirname, '..', specifier.slice(3))
      else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
      return next(specifier, context)
    }
  })

  try {
    const { default: handler } = await import('../server/api/folders/index.get.ts')
    const harness = globalThis.__folderListHarness
    harness.query = { folder_type: 'private', page: '3', pageSize: '25', owner_uid: 'victim', current_user: 'forged', codocs_trusted_department_read_dept_code: 'D-SECRET' }
    harness.runtime = { items: [{ id: 7 }], total: 37, page: 3, pageSize: 25, limit: 99 }
    const response = await handler({})
    assert.deepEqual(response, { success: true, data: { items: [{ id: 7 }], total: 37, page: 3, pageSize: 25, limit: 99 } })
    assert.equal(harness.runtimeOptions.query.page, '3')
    assert.equal(harness.runtimeOptions.query.pageSize, '25')
    assert.equal(harness.runtimeOptions.query.current_user, 'person-a')
    assert.equal(harness.runtimeOptions.query.codocs_trusted_department_read_dept_code, undefined)

    harness.runtime = Object.assign(new Error('runtime unavailable'), { statusCode: 503 })
    await assert.rejects(() => handler({}), error => error.statusCode === 503)
    harness.runtime = { items: [], total: 0, page: 1, pageSize: 20 }
    harness.permissionError = Object.assign(new Error('forbidden'), { statusCode: 403 })
    await assert.rejects(() => handler({}), error => error.statusCode === 403)
    harness.permissionError = Object.assign(new Error('unauthenticated'), { statusCode: 401 })
    await assert.rejects(() => handler({}), error => error.statusCode === 401)
  } finally {
    hooks.deregister()
    globalThis.__folderListHarness = oldHarness
    globalThis.defineEventHandler = oldHandler
    globalThis.getQuery = oldGetQuery
    globalThis.createError = oldCreateError
  }
})
