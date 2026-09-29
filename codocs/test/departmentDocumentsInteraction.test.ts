import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { parse, compileTemplate } from 'vue/compiler-sfc'

const page = readFileSync(new URL('../layer/pages/enterprise-department-documents.vue', import.meta.url), 'utf8')
const assetBrowser = readFileSync(new URL('../app/components/department/AssetBrowser.vue', import.meta.url), 'utf8')

test('department document titles link to the editor without an interactive table row', () => {
  assert.match(page, /<NuxtLink\s+:to="`\$\{documentUrl\(row\.original\.uuid\)\}\?dept_code=\$\{encodeURIComponent\(deptCode\)\}`"/)
  assert.match(page, /:disabled="!canExport"/)
  assert.doesNotMatch(page, /@select="openDocument"/)
  assert.match(page, /<template #actions-cell="\{ row \}">\s*<div class="flex flex-wrap gap-1"/)
})

test('successful department writes identify their completed action', () => {
  const script = page.split('<script setup lang="ts">')[1]!.split('</script>')[0]!
  const ast = ts.createSourceFile('department.ts', script, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const functionNode = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'actionSuccessTitle')
  assert.ok(functionNode)
  const exports: Record<string, (kind: string, title: string) => string> = {}
  const code = ts.transpileModule(`${functionNode.getText(ast)}\nexports.title = actionSuccessTitle`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, {
    exports,
    selectedDocument: { value: { title: '旧标题', folder_id: null } },
    selectedFolder: { value: { name: '旧目录', parent_id: null } },
    targetFolderId: { value: null }
  })
  assert.equal(exports.title!('new', '新文档'), '文档已创建')
  assert.equal(exports.title!('upload', ''), '文档已上传')
  assert.equal(exports.title!('copy', '副本'), '文档已复制')
  assert.equal(exports.title!('edit', '新标题'), '文档已改名')
  assert.equal(exports.title!('folder-edit', '新目录'), '目录已改名')
  assert.match(page, /action === 'recycle' \? '文档已回收' : desired \? '已设为只读' : '已取消只读'/)
  assert.match(page, /action === 'delete' \? '目录已删除' : row\.is_open \? '已关闭目录开放' : '已开放目录'/)
  assert.doesNotMatch(page, /操作已完成/)
})

test('department asset file entries are named keyboard-operable buttons', () => {
  assert.match(assetBrowser, /<button\s+v-for="item in items"[\s\S]*?:aria-label="`\$\{item\.isDirectory \? '打开目录' : '预览文件'\}：\$\{item\.name\}`"/)
  for (const [filename, source] of [['enterprise-department-documents.vue', page], ['AssetBrowser.vue', assetBrowser]]) {
    const { descriptor, errors } = parse(source, { filename })
    assert.deepEqual(errors, [], filename)
    assert.ok(descriptor.template, filename)
    assert.deepEqual(compileTemplate({ filename, source: descriptor.template.content, id: filename }).errors, [], filename)
  }
})

test('the document page reads department documents through the department route and gates client-side export', () => {
  const doc = readFileSync(new URL('../app/pages/documents/[uuid].vue', import.meta.url), 'utf8')
  assert.match(doc, /const isDepartmentRead = computed\(\(\) => hosted && Boolean\(documentDeptCode\.value\)\)/)
  assert.match(doc, /departmentRead \? `\/api\/departments\/documents\/\$\{documentId\.value\}`/)
  assert.match(doc, /hasPermission\('departments', 'export'\)/)
  assert.match(doc, /缺少部门文档导出权限/)
  assert.match(doc, /!isDepartmentRead\.value && authUserId\.value/)
  const cabinet = readFileSync(new URL('../app/pages/departments/cabinet.vue', import.meta.url), 'utf8')
  assert.match(cabinet, /部门文件柜仅部门经理可上传和管理，成员可查看与下载（需导出权限）/)
  assert.match(cabinet, /departmentCanWrite\.value = response\.data\?\.canManage === true && response\.data\?\.canEdit === true/)
  const overlay = readFileSync(new URL('../app/components/editor/useReadonlyEditorOverlay.ts', import.meta.url), 'utf8')
  const editor = readFileSync(new URL('../app/components/editor/MilkdownEditor.client.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(overlay + editor, /data:image/)
})
