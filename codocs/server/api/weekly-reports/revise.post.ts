/**
 * 修订部门周报
 * POST /api/weekly-reports/revise
 * body: { uuid }
 *
 * 1. 校验当前用户是部门负责人
 * 2. 将当前"工作周报"内容复制为 V{n} 存档（只读）
 * 3. 将当前"工作周报"改为可读写（负责人继续编辑）
 */

import { downloadDocument, uploadDocument } from '../../utils/oss'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { fetchDirectoryData } from '~~/server/utils/directoryCompat'
import { callCodocsTenantRuntime, createCodocsDocumentMetadata, getCodocsDocumentMetadata, updateCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import type { DepartmentResponse } from '~/types/account'

interface DocumentRow {
  uuid: string
  title: string
  dept_code: string
  owner_uid: string
  oss_path: string
  readonly_flag: number
  doc_type: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { uuid } = body
  const operatorUid = requireRequestUid(event)

  if (!uuid || !operatorUid) {
    throw createError({ statusCode: 400, message: '缺少参数' })
  }

  const doc = await getCodocsDocumentMetadata(event, uuid, { actorUid: operatorUid }) as DocumentRow
  if (!doc.readonly_flag) {
    throw createError({ statusCode: 400, message: '文档当前已处于可编辑状态' })
  }

  // 2. 校验部门负责人
  const deptRes = await fetchDirectoryData<DepartmentResponse>('/departments')
  const allDepts = deptRes.flat || []
  const dept = allDepts.find(d => d.deptCode === doc.dept_code)

  if (!dept || (dept.managerId !== operatorUid && dept.leaderId !== operatorUid)) {
    throw createError({ statusCode: 403, message: '仅部门负责人可以修订周报' })
  }

  // 3. 确定存档版本号
  const baseTitle = doc.title.replace(/V\d+$/, '').trim()

  const versionPage = await callCodocsTenantRuntime<{ items?: Array<{ title: string }> }>(event, '/v1/codocs/documents', {
    query: { type: doc.doc_type, dept_code: doc.dept_code, limit: 5000 },
    scope: 'codocs.read'
  })
  const existingVersions = (versionPage.items || [])
    .filter(item => item.title.startsWith(`${baseTitle}V`))
    .map((r) => {
      const match = r.title.match(/V(\d+)$/)
      return match ? parseInt(match[1]!) : 0
    })
    .filter(n => n > 0)

  const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1

  // 4. 复制当前内容到 V{n} 存档
  const archiveTitle = `${baseTitle}V${nextVersion}`
  const archiveOssPath = doc.oss_path.replace(/[^/]+\.md$/, `${archiveTitle}.md`)

  let content = ''
  try {
    content = (await downloadDocument(doc.oss_path, doc.doc_type)) || ''
  } catch {
    content = `# ${archiveTitle}\n\n`
  }

  const archive = await createCodocsDocumentMetadata(event, {
    title: archiveTitle,
    docType: doc.doc_type,
    ownerUid: operatorUid,
    operatorUid,
    deptCode: doc.dept_code,
    ossPath: archiveOssPath,
    contentSize: Buffer.byteLength(content, 'utf-8')
  })
  await updateCodocsDocumentMetadata(event, archive.uuid, { readonlyFlag: true, actorUid: operatorUid })
  await uploadDocument(archive.oss_path || archiveOssPath, content, doc.doc_type)

  // 5. 将当前"工作周报"改为可读写
  await updateCodocsDocumentMetadata(event, uuid, { readonlyFlag: false, actorUid: operatorUid })

  return {
    success: true,
    data: {
      uuid,
      archiveUuid: archive.uuid,
      archiveTitle,
      version: nextVersion
    }
  }
})
