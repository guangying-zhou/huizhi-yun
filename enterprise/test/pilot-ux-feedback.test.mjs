import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from '@vue/compiler-sfc'
import { projectNameError } from '../../aims/shared/projectName.ts'

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const ref = value => ({ value })
const computed = getter => ({
  get value() {
    return typeof getter === 'function' ? getter() : getter.get()
  }
})
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function projectPage(fetch) {
  const source = parse(read('../../aims/layer/pages/enterprise-project-edit.vue')).descriptor.scriptSetup.content.replace(/^import .*$/gm, '')
  const state = vm.createContext({ ref, computed, reactive: value => value, onMounted: () => {},
    crypto: { randomUUID: () => 'same-request-key' },
    useRoute: () => ({ params: { id: '263' } }), useRouter: () => ({ push: async () => {} }),
    useAimsModule: () => ({ moduleUrl: path => path }), useProvidedEnterpriseProjectObjectContext: () => null,
    usePermissions: () => ({ hasPermission: () => true }),
    useAuth: () => ({ user: ref('U1') }), useConfirm: () => ({ confirm: async () => true }),
    effectiveProjectSecurityLevel: level => level, projectAccessControlPatch: () => ({}), projectNameError,
    useAccountDepartments: () => ({ flat: ref([]) }), useBusinessDomains: () => ({ domains: ref([]) }), $fetch: fetch
  })
  vm.runInContext(transpile(source + '\nglobalThis.page = { form, save, refreshComparison, error, errorTitle, operationKey, latestProject, comparisonError };'), state)
  state.page.form.name = '项目测试'
  state.page.form.description = '本地草稿'
  state.page.form.expectedVersion = 'old-version'
  return state.page
}

test('lost save response shows safe continuation guidance and retries with the same draft and key', async () => {
  const requests = []
  const page = projectPage(async (_path, options) => {
    requests.push({ key: options.headers['Idempotency-Key'], body: JSON.stringify(options.body) })
    if (requests.length === 1) throw new TypeError('[PUT] /aims/api/v1/projects/263: Failed to fetch')
    return { code: 0 }
  })
  await page.save()
  assert.match(page.error.value, /保存结果未确认，可能已提交，重试将沿用同一请求安全续行/)
  assert.doesNotMatch(page.error.value, /fetch|\/api\//)
  assert.equal(page.form.description, '本地草稿')
  assert.equal(page.operationKey.value, 'same-request-key')
  await page.save()
  assert.deepEqual(requests[0], requests[1])
  assert.equal(page.operationKey.value, '')
})

test('409 conflict refreshes a separate comparison without overwriting draft, version or retry key', async () => {
  const page = projectPage(async (_path, options) => {
    if (options?.method === 'PUT') throw { statusCode: 409 }
    return { code: 0, data: { editVersion: 'new-version', name: '最新项目', description: '其他人的修改' } }
  })
  await page.save()
  const draft = JSON.stringify(page.form)
  assert.equal(page.errorTitle.value, '内容已被他人修改')
  await page.refreshComparison()
  assert.equal(page.latestProject.value.description, '其他人的修改')
  assert.equal(JSON.stringify(page.form), draft)
  assert.equal(page.form.expectedVersion, 'old-version')
  assert.equal(page.operationKey.value, 'same-request-key')
})

test('payload mismatch is distinguished from another editor changing the version', async () => {
  const page = projectPage(async () => {
    throw { statusCode: 409, data: { code: 'idempotency_payload_mismatch' } }
  })
  await page.save()
  assert.match(page.error.value, /该请求与先前保存内容不同/)
  assert.doesNotMatch(page.error.value, /他人修改|idempotency/)
  assert.equal(page.form.description, '本地草稿')
})

test('document read rejection replaces the editor shell with a safe empty state and return action', async () => {
  const { descriptor } = parse(read('../../codocs/app/pages/documents/[uuid].vue'))
  const ast = ts.createSourceFile('document.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true)
  const statement = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(node => node.name.getText(ast) === 'fetchDocument'))
  const state = vm.createContext({ loading: ref(false), hasLoadedDocument: ref(true), documentLoadFailure: ref(null), documentLoadFailureMessage: ref(''), initialLoadPending: ref(true), slowLoadHint: ref(false), setTimeout, clearTimeout, slowLoadHintDelayMs: 2000,
    documentLoadErrorMessage: () => '你没有查看此文档正文的权限，请返回文档列表', collaboration: { disconnect: () => {} },
    privateDocumentAclVerified: ref({ uuid: 'restricted', actorUid: 'user-a' }), authUserId: ref('user-a'),
    documentId: ref('restricted'), documentDeptCode: ref(''), isDepartmentRead: ref(false), hosted: true,
    getDocumentPreviewBootstrap: () => undefined, clearDocumentPreviewBootstrap: () => {}, moduleUrl: path => path,
    console: { error: () => {} }, $fetch: async () => { throw { statusCode: 403 } }
  })
  vm.runInContext(transpile(statement.getText(ast) + '\nglobalThis.load = fetchDocument;'), state)
  await state.load()
  assert.equal(state.documentLoadFailure.value, 'forbidden')
  assert.equal(state.privateDocumentAclVerified.value, null, 'a denied re-read clears the previous actor ACL')
  assert.equal(state.hasLoadedDocument.value, false)
  assert.equal(state.loading.value, false)
  assert.equal(state.initialLoadPending.value, false)
  assert.match(state.documentLoadFailureMessage.value, /权限/)
  assert.match(descriptor.template.content, /UDashboardPanel v-if="documentLoadFailure"/)
  assert.match(descriptor.template.content, /CommonEmptyState[\s\S]*无权限查看此文档/)
  assert.match(descriptor.template.content, /label="返回"[\s\S]*@click="goBack"/)
  assert.match(descriptor.template.content, /UDashboardPanel v-else grow/)
})

test('comparison read rejection clears the previous remote snapshot while retaining the local draft', async () => {
  let reads = 0
  const page = projectPage(async (_path, options) => {
    if (options?.method === 'PUT') throw { status: 409 }
    if (++reads > 1) throw { response: { status: 403 } }
    return { code: 0, data: { editVersion: 'new-version', description: 'latest' } }
  })
  await page.save()
  await page.refreshComparison()
  assert.ok(page.latestProject.value)
  await page.refreshComparison()
  assert.equal(page.latestProject.value, null)
  assert.match(page.comparisonError.value, /草稿仍已保留/)
  assert.equal(page.form.description, '本地草稿')
  assert.equal(page.operationKey.value, 'same-request-key')
})
