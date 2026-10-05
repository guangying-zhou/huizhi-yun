import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../server/plugins/bootstrap.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText

for (const backend of ['runtime', 'verified-runtime', 'memory', 'file']) {
  test(`managed ${backend} bootstrap respects request-scoped policy readiness`, async () => {
    const persistent = ['runtime', 'verified-runtime'].includes(backend)
    const patches: unknown[][] = []
    const logs: string[] = []
    const forbidden = () => {
      throw new Error('tenant operation without request context')
    }
    const modules: Record<string, object> = {
      '~~/server/utils/bundleCache': {
        getRuntimeCacheDescriptor: () => ({ backend, cacheDir: '/fixture', scope: null }),
        persistentPolicyStoreEnabled: () => persistent,
        readCachedBundle: forbidden,
        patchActivationStatus: async (...args: unknown[]) => {
          if (persistent) forbidden()
          patches.push(args)
        }
      },
      '~~/server/utils/platformRuntime': {
        loadConsoleRuntimeMode: () => ({ runtimeEnabled: true }),
        resolvePlatformBundleCacheDir: () => '/fixture',
        loadPlatformRuntimeConfig: () => ({ bundleCacheDir: '/fixture' }),
        isManagedCloudMultitenantActivation: () => true,
        readAndVerifyLicense: forbidden,
        postPlatformHeartbeat: forbidden,
        refreshPlatformBundle: forbidden
      },
      '~~/server/utils/authClients': {
        materializeAuthClientsFromBundle: forbidden,
        materializeLocalDevAuthClients: forbidden
      }
    }
    const exports: { default?: () => Promise<void> } = {}
    new Function('require', 'exports', 'defineNitroPlugin', 'console', 'setInterval', compiled)(
      (name: string) => {
        assert.ok(modules[name])
        return modules[name]
      }, exports,
      (plugin: () => Promise<void>) => plugin,
      { info: (message: string) => logs.push(message) }, forbidden
    )
    await exports.default!()
    assert.equal(patches.length, persistent ? 0 : 1)
    if (!persistent) {
      assert.equal(patches[0]![2], 'managed-cloud-console:global')
      assert.equal((patches[0]![1] as { bundleReady: boolean }).bundleReady, false)
    }
    assert.ok(logs.some(message => message.includes(`cacheBackend=${backend},`)))
    assert.ok(logs.some(message => message.includes('readiness requires trusted Tenant Gateway context')))
  })
}
