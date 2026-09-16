import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { computed, ref } from 'vue'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync(new URL('../app/composables/useViewerWatermark.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

type Profile = { uid: string, realName?: string, mobileTail4?: string | null }
function harness(fetcher: () => Promise<{ code: number, data: Profile }>) {
  const auth = { user: ref('u1'), tenant: ref('tenant-1'), userRealname: ref('查看者'), userMobileTail: ref<string | null>(null) }
  const data = ref<unknown>(null)
  const paths: string[] = []
  let loader: () => Promise<unknown>
  let cacheKey: { value: string }
  const exports: Record<string, () => { watermarkText: { value: string } }> = {}
  runInNewContext(code, {
    exports, computed,
    useAuth: () => auth,
    useAppUrls: () => ({ resolveCurrentAppPath: (path: string) => `/codocs${path}` }),
    useRequestFetch: () => async (path: string) => {
      paths.push(path)
      return fetcher()
    },
    useAsyncData: (key: { value: string }, handler: () => Promise<unknown>) => {
      cacheKey = key
      loader = handler
      return { data }
    }
  })
  const result = exports.useViewerWatermark!()
  return {
    ...result, auth, paths,
    key: () => cacheKey.value,
    load: async () => { data.value = await loader() }
  }
}

test('OIDC viewer reads the self profile suffix without a legacy phone cookie', async () => {
  const app = harness(async () => ({ code: 0, data: { uid: 'u1', realName: '目录姓名', mobileTail4: '0123' } }))
  assert.equal(app.watermarkText.value, '查看者 ****')
  await app.load()
  assert.equal(app.watermarkText.value, '目录姓名 0123')
  assert.deepEqual(app.paths, ['/codocs/api/directory/me'])
})

test('missing or malformed suffix stays masked and never prints a full phone number', async () => {
  for (const mobileTail4 of [null, '', '****', '123', '13800138000', '12x4']) {
    const app = harness(async () => ({ code: 0, data: { uid: 'u1', mobileTail4 } }))
    app.auth.userMobileTail.value = '9999'
    await app.load()
    assert.equal(app.watermarkText.value, '查看者 ****')
  }
})

test('directory failure remains readable without searching other employees', async () => {
  const app = harness(async () => {
    throw new Error('503')
  })
  await app.load()
  assert.equal(app.watermarkText.value, '查看者 ****')
  assert.equal(app.paths.length, 1)
})

test('a mismatched profile is ignored', async () => {
  const app = harness(async () => ({ code: 0, data: { uid: 'u2', realName: '其他人', mobileTail4: '1111' } }))
  await app.load()
  assert.equal(app.watermarkText.value, '查看者 ****')
})

test('profile cache is isolated by tenant and user, and logout clears the watermark', async () => {
  const app = harness(async () => ({ code: 0, data: { uid: 'u1', realName: '租户一', mobileTail4: '1111' } }))
  await app.load()
  const oldKey = app.key()
  app.auth.tenant.value = 'tenant-2'
  assert.notEqual(app.key(), oldKey)
  assert.equal(app.watermarkText.value, '查看者 ****')
  app.auth.user.value = 'u2'
  assert.equal(app.watermarkText.value, '查看者 ****')
  app.auth.user.value = ''
  assert.equal(app.watermarkText.value, '')
})

test('a late response from the previous tenant cannot update the new viewer', async () => {
  let resolve!: (value: { code: number, data: Profile }) => void
  const app = harness(() => new Promise((done) => {
    resolve = done
  }))
  const pending = app.load()
  app.auth.tenant.value = 'tenant-2'
  resolve({ code: 0, data: { uid: 'u1', realName: '租户一', mobileTail4: '1111' } })
  await pending
  assert.equal(app.watermarkText.value, '查看者 ****')
})
