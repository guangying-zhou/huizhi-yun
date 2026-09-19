import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('event-bound OSS clients keep concurrent tenant buckets and credentials isolated', async () => {
  const root = resolve(import.meta.dirname, '..')
  const oldConfig = globalThis.useRuntimeConfig
  const oldIntegration = globalThis.__codocsOssIntegration
  globalThis.useRuntimeConfig = () => ({ oss: { integrationCode: 'oss.default' } })
  globalThis.__codocsOssIntegration = async (event) => {
    const tenant = event?.context?.tenant
    await new Promise(resolve => setTimeout(resolve, tenant === 'tenant-a' ? 20 : 2))
    if (tenant === 'tenant-missing') {
      return {
        accessKeyId: '', accessKeySecret: '', bucket: '', endpoint: '', region: '',
        config: {}, bucketDomain: ''
      }
    }
    return {
      accessKeyId: `key-${tenant}`,
      accessKeySecret: `secret-${tenant}`,
      bucket: `bucket-${tenant}`,
      endpoint: `oss.${tenant}.example`,
      region: `region-${tenant}`,
      bucketDomain: `${tenant}.cdn.example`,
      config: { provider: 'aliyun-oss-native' }
    }
  }

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/objectStorage')) {
        source = 'export const createAliOssCompatibleClient=config=>({config})'
      }
      if (specifier.endsWith('/ossIntegration')) {
        source = 'export const getOssIntegrationConfig=(code,options)=>globalThis.__codocsOssIntegration(options?.event)'
      }
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      let candidate
      if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, '..', 'foundation', specifier.slice('@hzy/foundation/'.length))
      else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
      return next(specifier, context)
    }
  })

  try {
    const { createRuntimeOSSClient } = await import('../server/utils/oss.ts')
    const eventA = { context: { tenant: 'tenant-a' } }
    const eventB = { context: { tenant: 'tenant-b' } }
    const [clientA, clientB] = await Promise.all([
      createRuntimeOSSClient({ event: eventA }),
      createRuntimeOSSClient({ event: eventB })
    ])

    assert.equal(clientA.config.bucket, 'bucket-tenant-a')
    assert.equal(clientA.config.accessKeyId, 'key-tenant-a')
    assert.equal(clientA.config.accessKeySecret, 'secret-tenant-a')
    assert.equal(clientB.config.bucket, 'bucket-tenant-b')
    assert.equal(clientB.config.accessKeyId, 'key-tenant-b')
    assert.equal(clientB.config.accessKeySecret, 'secret-tenant-b')
    assert.notEqual(clientA.config.bucket, clientB.config.bucket)
    assert.notEqual(clientA.config.accessKeyId, clientB.config.accessKeyId)

    await assert.rejects(
      createRuntimeOSSClient({ event: { context: { tenant: 'tenant-missing' } } }),
      /OSS credentials not configured/
    )
  } finally {
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    globalThis.__codocsOssIntegration = oldIntegration
  }
})
