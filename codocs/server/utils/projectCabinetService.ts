import type { H3Event } from 'h3'
import { createError } from 'h3'
import { getCabinetFileMetadata, type CabinetFileMetadata, type CabinetScope } from '~~/server/utils/cabinetRuntime'

export async function getProjectCabinetFile(event: H3Event, id: string, projectCode: string, expectedOssPath: string) {
  const resolved = await getProjectCabinetFileWithScope(event, id, projectCode, expectedOssPath)
  return resolved.file
}

export async function getProjectCabinetFileWithScope(event: H3Event, id: string, projectCode: string, expectedOssPath: string) {
  const file = await getCabinetFileMetadata(event, 'project', id, { projectCode })
  if (file.project_code !== projectCode) {
    throw createError({ statusCode: 404, message: '项目文件不存在' })
  }
  assertExpectedOssPath(file, expectedOssPath)
  return { file, scope: 'project' as CabinetScope }
}

function assertExpectedOssPath(file: CabinetFileMetadata, expectedOssPath: string) {
  if (expectedOssPath && file.oss_path !== expectedOssPath) {
    throw createError({ statusCode: 409, message: '项目文件路径不一致，请刷新后重试' })
  }
}
