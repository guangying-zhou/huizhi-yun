import { requirePermission } from '~~/server/utils/checkPermission'
import { upsertDirectorySource, type DirectorySourceProvider, type DirectorySourceCredentialInput } from '~~/server/utils/directorySources'
import { ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sources', 'edit', '需要目录源配置编辑权限')

  const body = await readBody<{
    providerCode?: DirectorySourceProvider
    integrationName?: string
    baseUrl?: string | null
    config?: Record<string, unknown>
    credential?: DirectorySourceCredentialInput | null
    status?: 'active' | 'inactive'
  }>(event)

  if (!body.providerCode) {
    throw createError({ statusCode: 400, message: 'providerCode is required' })
  }

  const source = await upsertDirectorySource({
    providerCode: body.providerCode,
    integrationName: body.integrationName,
    baseUrl: body.baseUrl,
    config: body.config,
    credential: body.credential,
    status: body.status,
    requestedBy: await requireConsoleRequestUid(event)
  })

  return ok(source)
})
