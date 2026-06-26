import { requirePermission } from '~~/server/utils/checkPermission'
import {
  upsertDirectorySource,
  type DirectorySourceCredentialInput,
  type DirectorySourceProvider
} from '~~/server/utils/directorySources'
import { ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sources', 'edit', '需要目录源配置编辑权限')

  const providerCode = getRouterParam(event, 'providerCode')
  if (!providerCode) throw createError({ statusCode: 400, message: 'providerCode is required' })

  const body = await readBody<{
    integrationName?: string
    baseUrl?: string | null
    config?: Record<string, unknown>
    credential?: DirectorySourceCredentialInput | null
    status?: 'active' | 'inactive'
  }>(event)

  const source = await upsertDirectorySource({
    providerCode: providerCode as DirectorySourceProvider,
    integrationName: body.integrationName,
    baseUrl: body.baseUrl,
    config: body.config,
    credential: body.credential,
    status: body.status,
    requestedBy: await requireConsoleRequestUid(event)
  })

  return ok(source)
})
