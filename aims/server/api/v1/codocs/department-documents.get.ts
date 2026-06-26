import { searchDepartmentDocuments } from '~~/server/utils/codocsApi'
import { hasDepartmentAccess } from '~~/server/utils/userDepartments'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const query = getQuery(event)
  const deptCode = String(query.deptCode || '').trim()
  if (!deptCode) {
    throw createError({ statusCode: 400, message: 'deptCode 不能为空' })
  }

  const allowed = await hasDepartmentAccess(uid, deptCode)
  if (!allowed) {
    throw createError({ statusCode: 403, message: '无权访问该部门文档列表' })
  }

  const res = await searchDepartmentDocuments({ event, deptCode, actorUid: uid })

  return {
    code: 0,
    data: {
      folders: (res.data?.folders || []).map(folder => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parent_id,
        updatedAt: folder.updated_at
      })),
      items: (res.data?.items || []).map(item => ({
        uuid: item.uuid,
        title: item.title,
        ownerUid: item.ownerUid,
        deptCode: item.deptCode,
        folderId: item.folderId ?? null,
        folderName: item.folderName ?? null,
        aiAbstract: item.aiAbstract,
        updatedAt: item.updatedAt,
        contentSize: item.contentSize
      }))
    }
  }
})
