import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script, createContext } from 'node:vm'
import ts from 'typescript'

test('Assets document caller binds actor and deployments and rejects invalid metadata', async () => {
  const source = ['assetProductDocumentTransport.ts', 'productDocumentCodocs.ts'].map(file => readFileSync(new URL('../server/utils/' + file, import.meta.url), 'utf8')).join('\n').replace(/^import .*$/gm, '').replaceAll('export async function', 'async function').replaceAll('export interface', 'interface')
  const uuid = '00000000-0000-4000-8000-000000000001'
  const calls: string[] = []
  let denied = false, wrongResult = false, enterprise = false
  const context = createContext({
    URL,
    createError: (input: { statusCode: number }) => Object.assign(new Error('rejected'), input),
    getHeader: () => 'request-id',
    requirePermission: async (_event: unknown, resource: string, action: string) => {
      calls.push('permission')
      assert.equal(resource, 'products')
      assert.equal(action, 'edit')
      if (denied) throw new Error('denied')
    },
    requireRequestUid: () => 'verified-user',
    resolveTrustedTenantGatewayContext: () => ({ tenant: 'TENANT', deployment: enterprise ? 'custom-enterprise' : 'custom-assets' }),
    resolveTrustedServiceAppRoute: () => ({ baseUrl: 'https://codocs.invalid', deploymentCode: 'custom-codocs' }),
    hashServiceCommandPayload: async (command: { actorUid: string }) => {
      assert.equal(command.actorUid, 'verified-user')
      return 'a'.repeat(64)
    },
    requestServiceAccessToken: async (args: { scope: string }) => {
      calls.push('token')
      assert.equal(args.scope, 'codocs:product-document:read')
      return 'test-token'
    },
    trustedServiceRequestHeaders: () => ({}),
    buildServiceCommandRuntimeHeaders: async (args: { sourceApp: string, sourceClientId: string, sourceDeploymentCode: string, targetDeploymentCode: string, requestTarget: string }) => {
      assert.equal(args.sourceApp, enterprise ? 'enterprise' : 'assets')
      assert.equal(args.sourceClientId, enterprise ? 'enterprise.runtime' : 'assets.runtime')
      assert.equal(args.sourceDeploymentCode, enterprise ? 'custom-enterprise' : 'custom-assets')
      assert.equal(args.targetDeploymentCode, 'custom-codocs')
      assert.equal(args.requestTarget, `/api/v1/service/assets-product-documents/${uuid}/metadata`)
      return {}
    },
    serviceAppFetch: async (_event: unknown, app: string) => {
      calls.push('fetch')
      assert.equal(app, 'codocs')
      return { code: 0, data: { uuid: wrongResult ? 'other' : uuid, title: 'Document', doc_type: 'product', updated_at: '2026-09-09', oss_path: 'PRIVATE' } }
    }
  })
  new Script(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText).runInContext(context)
  const result = await context.readAssetProductDocumentMetadata({}, 'P1', uuid)
  assert.deepEqual(Object.keys(result).sort(), ['doc_type', 'title', 'updated_at', 'uuid'])
  assert.deepEqual(calls, ['permission', 'token', 'fetch'])
  enterprise = true
  await context.readProductDocumentMetadataTransport({}, 'P1', uuid, 'verified-user', 'enterprise')
  enterprise = false
  wrongResult = true
  await assert.rejects(context.readAssetProductDocumentMetadata({}, 'P1', uuid))
  calls.length = 0
  denied = true
  await assert.rejects(context.readAssetProductDocumentMetadata({}, 'P1', uuid), /denied/)
  assert.deepEqual(calls, ['permission'])
  calls.length = 0
  denied = false
  await assert.rejects(context.readAssetProductDocumentMetadata({}, 'P1', 'DOC-1'))
  assert.deepEqual(calls, ['permission'])
})
