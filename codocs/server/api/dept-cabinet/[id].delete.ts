import { createOSSClient } from '../../utils/oss'
import { deleteCabinetFileMetadata, getCabinetFileMetadata, updateCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件 ID 不能为空' })
  }

  const file = await getCabinetFileMetadata(event, 'department', id)

  await updateCabinetFileMetadata(event, 'department', id, { status: 0 })
  await deleteCabinetFileMetadata(event, 'department', id)

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
