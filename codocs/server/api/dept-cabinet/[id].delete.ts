import { createOSSClient } from '../../utils/oss'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { deleteCabinetFileMetadata, getCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'
import { requireDepartmentManagerAccess } from '~~/server/utils/departmentAccess'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件 ID 不能为空' })
  }

  const actorUid = requireRequestUid(event)
  const query = getQuery(event)
  const deptCode = String(query.dept_code || query.deptCode || '').trim()
  const file = await getCabinetFileMetadata(event, 'department', id, { departmentCode: deptCode })
  await requireDepartmentManagerAccess(event, actorUid, file.dept_code!, '仅部门经理可删除部门文件柜文件')

  await deleteCabinetFileMetadata(event, 'department', id, {
    departmentManagerCode: file.dept_code!
  })

  try {
    const client = createOSSClient()
    const recyclePath = file.oss_path.replace(/^codocs\//, 'recycle.bin/')
    await client.copy(recyclePath, file.oss_path)
    await client.delete(file.oss_path)
  } catch (err) {
    console.warn('[Dept Cabinet Delete] OSS cleanup failed:', err)
  }

  return { success: true }
})
