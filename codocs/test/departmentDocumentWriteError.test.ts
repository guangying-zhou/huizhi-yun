import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { departmentDocumentWriteErrorMessage, documentLoadErrorMessage } from '../app/utils/departmentDocumentWriteError'

const hostError = (statusCode: number, code: string) => ({ statusCode, data: { message: '服务端说明', data: { code } } })
const gatewayError = (statusCode: number, code: string) => ({ statusCode, data: { code, message: '网关说明' } })

test('department write business codes have stable Chinese messages for both error envelopes', () => {
  const expected = {
    department_directory_unavailable: '部门目录暂不可用，请稍后重试',
    department_manager_required: '仅部门经理可执行此操作',
    department_writer_required: '仅本部门成员可新建或编辑',
    department_document_move_denied: '仅作者或部门经理可移动此文档',
    department_folder_not_empty: '目录不为空，请先移走其中内容'
  }
  for (const makeError of [hostError, gatewayError]) {
    for (const [code, message] of Object.entries(expected)) {
      assert.equal(departmentDocumentWriteErrorMessage(makeError(403, code), '失败'), message, code)
    }
    assert.equal(departmentDocumentWriteErrorMessage(makeError(503, 'hzy0_upstream_error'), '失败'), '服务暂时不可用，请稍后重试')
    assert.equal(departmentDocumentWriteErrorMessage(makeError(409, 'department_document_key_conflict'), '失败'), '请求已变更，请刷新后重试')
    assert.equal(departmentDocumentWriteErrorMessage(makeError(409, 'department_folder_key_conflict'), '失败'), '请求已变更，请刷新后重试')
    assert.equal(departmentDocumentWriteErrorMessage(makeError(409, 'department_folder_not_empty'), '失败'), expected.department_folder_not_empty)
  }
})

test('503 maps by status; unrelated codes retain the server message or caller fallback', () => {
  assert.equal(departmentDocumentWriteErrorMessage(hostError(503, 'upstream_unavailable'), '失败'), '服务暂时不可用，请稍后重试')
  assert.equal(departmentDocumentWriteErrorMessage(hostError(409, 'other_conflict'), '失败'), '服务端说明')
  assert.equal(departmentDocumentWriteErrorMessage(new Error('本地文件格式错误'), '失败'), '本地文件格式错误')
  assert.equal(departmentDocumentWriteErrorMessage(null, '失败'), '失败')
})

test('department page reports failed writes while keeping both form modals open for retry', () => {
  const page = readFileSync(new URL('../layer/pages/enterprise-department-documents.vue', import.meta.url), 'utf8')
  assert.match(page, /folderError\.value = departmentDocumentWriteErrorMessage\(error,[^\n]+\)\s*toast\.add\(\{ title: folderError\.value, color: 'error' \}\)/)
  assert.match(page, /actionError\.value = departmentDocumentWriteErrorMessage\(error,[^\n]+\)\s*toast\.add\(\{ title: actionError\.value, color: 'error' \}\)/)
  assert.match(page, /finally \{\s*folderSubmitting\.value = false\s*\}/)
  assert.match(page, /finally \{ actionBusy\.value = false \}/)
  assert.equal((page.match(/showFolderModal\.value = false/g) || []).length, 1)
  assert.equal((page.match(/showActionModal\.value = false/g) || []).length, 1)
  assert.equal((page.match(/catch \(error\) \{ toast\.add\(\{ title: departmentDocumentWriteErrorMessage\(error,/g) || []).length, 3)
})

test('document load failures map 503 storage/session codes to Chinese and never leak English', () => {
  for (const make of [hostError, gatewayError]) {
    assert.equal(documentLoadErrorMessage(make(503, 'enterprise_document_storage_unavailable')), '文档存储服务暂时不可用，请稍后重试')
    assert.equal(documentLoadErrorMessage(make(503, 'console_session_verification_unavailable')), '登录状态暂时无法核验，请稍后重试')
    assert.equal(documentLoadErrorMessage(make(503, 'other')), '服务暂时不可用，请稍后重试')
    assert.equal(documentLoadErrorMessage(make(500, 'boom')), '文档加载失败，请稍后重试')
    assert.equal(documentLoadErrorMessage(make(401, 'x')), '登录状态已失效，请重新登录')
    assert.equal(documentLoadErrorMessage(make(404, 'x')), '文档不存在或已移除，请返回文档列表确认')
    assert.equal(documentLoadErrorMessage(make(403, 'x')), '你没有查看此文档正文的权限，请返回文档列表')
  }
})

test('retired document routes use safe migration guidance', () => {
  assert.equal(documentLoadErrorMessage({ statusCode: 410, message: 'GET /internal/legacy' }), '此文档入口已下线，请返回文档列表使用现有功能')
})
