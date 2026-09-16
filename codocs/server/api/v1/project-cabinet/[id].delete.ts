import { createRuntimeOSSClient } from '~~/server/utils/oss'
import { deleteCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'
import { getProjectCabinetFileWithScope } from '~~/server/utils/projectCabinetService'
import { AIMS_PROJECT_CABINET_DELETE_SERVICE_AUTH, requireAimsProjectCabinetServiceAuth } from '~~/server/utils/serviceAuthGuard'

export default defineEventHandler(async (event) => {
  await requireAimsProjectCabinetServiceAuth(event, AIMS_PROJECT_CABINET_DELETE_SERVICE_AUTH)

  const id = String(getRouterParam(event, 'id') || '').trim()
  if (!id) {
    throw createError({ statusCode: 400, message: '文件 ID 不能为空' })
  }
  const body = await readBody<Record<string, unknown>>(event)
  const projectCode = String(body?.project_code || body?.projectCode || '').trim()
  const expectedOssPath = String(body?.expected_oss_path || body?.expectedOssPath || '').trim()
  if (!projectCode || !expectedOssPath) {
    throw createError({ statusCode: 400, message: 'project_code 和 expected_oss_path 不能为空' })
  }

  // The signed Runtime read receives the project marker only after the exact
  // Aims guard above succeeds. It also locks the OSS identity we can recycle.
  const { file } = await getProjectCabinetFileWithScope(event, id, projectCode, expectedOssPath)
  const recyclePath = file.oss_path.replace(/^codocs\//, 'recycle.bin/')
  if (recyclePath === file.oss_path) {
    throw createError({ statusCode: 503, message: '项目文件柜 OSS 路径不受支持' })
  }

  let missingOssObject = false
  try {
    const client = await createRuntimeOSSClient({ event })
    await client.copy(recyclePath, file.oss_path)
    await client.delete(file.oss_path)
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'NoSuchKey') {
      missingOssObject = true
    } else {
      throw error
    }
  }

  await deleteCabinetFileMetadata(event, 'project', id, {
    projectCode,
    expectedOssPath: file.oss_path
  })

  return {
    code: 0,
    data: {
      uuid: file.uuid,
      ossPath: file.oss_path,
      projectCode: file.project_code || projectCode,
      recycledPath: missingOssObject ? null : recyclePath,
      missingOssObject
    }
  }
})
