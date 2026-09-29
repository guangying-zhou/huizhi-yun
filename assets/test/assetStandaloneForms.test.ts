import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script, createContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

for (const kind of ['DigitalAsset', 'IpAsset']) {
  for (const action of ['Create', 'Edit']) {
    test(`${kind} ${action} standalone form retains request identity, retry key and failed draft`, async () => {
      const source = readFileSync(new URL(`../app/components/assets/${kind}${action}Modal.vue`, import.meta.url), 'utf8')
      const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import .*$/gm, '')
      const prefix = kind === 'DigitalAsset' ? 'digital' : 'ip'
      const collection = kind === 'DigitalAsset' ? 'digital-assets' : 'ip-assets'
      const requests: { url: string, method: string, headers: Record<string, string>, body: Record<string, unknown> }[] = []
      const events: unknown[][] = []
      let fail = true
      let saved = 0
      const props = { open: true, page: true, asset: { id: 42, [`${prefix}_name`]: '原名称', [`${prefix}_type`]: 'document' } }
      const context = createContext({
        defineProps: () => props,
        defineEmits: () => (...args: unknown[]) => { events.push(args) },
        ref: (value: unknown) => ({ value }),
        reactive: (value: unknown) => value,
        computed: (value: (() => unknown) | { get: () => unknown, set: (value: unknown) => void }) => ({
          get value() { return typeof value === 'function' ? value() : value.get() },
          set value(next: unknown) { if (typeof value !== 'function') value.set(next) }
        }),
        watch: (read: () => unknown, callback: (value: unknown) => void, options?: { immediate?: boolean }) => {
          if (options?.immediate) callback(read())
        },
        useAssetDictionaries: () => ({ loadDictionaries: async () => {}, getOptions: () => [] }),
        useAssetsModule: () => ({ moduleUrl: (path: string) => `/assets${path}` }),
        useToast: () => ({ add: () => {} }),
        console: { error: () => {} },
        crypto: { randomUUID: () => 'same-intent-key' },
        $fetch: async (url: string, options: { method: string, headers: Record<string, string>, body: Record<string, unknown> }) => {
          requests.push({ url, ...options })
          if (fail) throw new Error('response lost')
          return { data: { id: 42 } }
        }
      })
      const code = ts.transpileModule(`${script}\nglobalThis.form = { state, surface, handleSubmit }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
      await new Script(`(async () => { ${code} })()`).runInContext(context)
      const form = context.form as { state: Record<string, unknown>, surface: { value: unknown }, handleSubmit: () => Promise<void> }
      form.surface.value = { markSaved: () => {
        saved += 1
      } }
      Object.assign(form.state, { [`${prefix}_name`]: ' 新名称 ', owner_uid: ' user-1 ', notes: ' 草稿备注 ' })
      await form.handleSubmit()
      assert.equal(form.state[`${prefix}_name`], ' 新名称 ')
      assert.equal(saved, 0)
      assert.equal(events.length, 0)
      fail = false
      await form.handleSubmit()
      assert.equal(requests.length, 2)
      assert.equal(requests[0]!.headers['Idempotency-Key'], requests[1]!.headers['Idempotency-Key'])
      assert.equal(requests[1]!.url, `/assets/api/v1/${collection}${action === 'Edit' ? '/42' : ''}`)
      assert.equal(requests[1]!.method, action === 'Edit' ? 'PATCH' : 'POST')
      assert.equal(requests[1]!.body[`${prefix}_name`], '新名称')
      assert.equal(requests[1]!.body.owner_uid, 'user-1')
      assert.equal(requests[1]!.body.notes, '草稿备注')
      assert.equal(saved, 1)
      assert.equal(events[0]![0], action === 'Edit' ? 'updated' : 'created')
    })
  }
}

for (const collection of ['digital-assets', 'ip-assets']) {
  test(`${collection} form uses its original write-access bit and restricts return paths`, async () => {
    const source = readFileSync(new URL('../layer/pages/asset-form.vue', import.meta.url), 'utf8')
    const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import .*$/gm, '')
    for (const granted of [false, true]) {
      const calls: { url: string, immediate: boolean }[] = []
      const bit = collection === 'digital-assets' ? 'digital_assets' : 'ip_assets'
      const otherBit = collection === 'digital-assets' ? 'ip_assets' : 'digital_assets'
      const context = createContext({
        definePageMeta: () => {},
        useRoute: () => ({ path: `/assets/${collection}/42/edit`, params: { id: '42' }, query: { returnTo: 'https://outside.example/' } }),
        useAssetsModule: () => ({ moduleUrl: (path: string) => `/assets${path}`, cacheKey: (key: string) => key }),
        computed: (read: () => unknown) => ({ get value() { return read() } }),
        useFetch: async (url: string, options: { immediate?: boolean }) => {
          calls.push({ url, immediate: options.immediate !== false })
          const data = url.endsWith('write-access') ? { [bit]: granted, [otherBit]: !granted } : { id: 42 }
          return { data: { value: { data } }, error: null, pending: false, refresh: async () => {} }
        },
        navigateTo: (path: string) => path
      })
      const code = ts.transpileModule(`${script}\nglobalThis.page = { allowed: canEdit.value, leave }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
      await new Script(`(async () => { ${code} })()`).runInContext(context)
      const page = context.page as { allowed: boolean, leave: () => string }
      assert.equal(page.allowed, granted)
      assert.equal(calls[1]!.immediate, granted)
      assert.equal(calls[1]!.url, `/assets/api/v1/${collection}/42`)
      assert.equal(page.leave(), `/assets/${collection}/42`)
    }
  })
}
