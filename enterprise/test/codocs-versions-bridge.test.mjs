import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

test('Enterprise Codocs version bridge exposes Host routes and keeps restore as PUT plus version DELETE', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const listRoute = resolve(root, 'enterprise/server/routes/codocs/api/documents/[uuid]/versions.get.ts')
  const detailRoute = resolve(root, 'enterprise/server/routes/codocs/api/documents/[uuid]/versions/[versionId].get.ts')
  const deleteRoute = resolve(root, 'enterprise/server/routes/codocs/api/documents/[uuid]/versions/[versionId].delete.ts')
  const utility = resolve(root, 'enterprise/server/utils/enterpriseCodocsVersions.ts')
  assert.ok(existsSync(listRoute))
  assert.ok(existsSync(detailRoute))
  assert.ok(existsSync(deleteRoute))
  const source = await import('node:fs/promises').then(fs => fs.readFile(utility, 'utf8'))
  assert.match(source, /Idempotency-Key|idempotency-key/)
  assert.match(source, /personal-document-version-delete/)
  assert.match(source, /action === 'read' \? 'view' : action/)
  assert.match(source, /operation\('view'\)[\s\S]*objectId: versionId/)
  assert.doesNotMatch(source, /readRows\(event, uuid, user, 'view', versionId\)/)

  const editor = await import('node:fs/promises').then(fs => fs.readFile(resolve(root, 'codocs/app/pages/documents/[uuid].vue'), 'utf8'))
  assert.match(editor, /saveMode:\s*'recovery'/)
  assert.match(editor, /moduleUrl\(`\/api\/documents\/\$\{documentId\.value\}\/versions/)
  assert.match(editor, /method:\s*'DELETE'[\s\S]*Idempotency-Key/)
  assert.ok(!editor.includes("POST /api/documents/${documentId.value}/versions/${versionId}/restore"))
})
