/**
 * Prepare readonly preview access for embedded Codocs previews.
 * POST /api/v1/documents/:uuid/preview-access
 *
 * Service-only endpoint. It deliberately fails closed until the AIMS → Codocs
 * signed service-command contract can bind the checked user, document and
 * project facts. A raw service token and request body cannot grant a relation.
 */
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import {
  AIMS_DOCUMENT_PREVIEW_GRANT_SERVICE_AUTH,
  requireCodocsServiceAuth
} from '~~/server/utils/serviceAuthGuard'

export default defineEventHandler(async (event) => {
  const auth = await requireConsoleAuthContext(event)
  requireCodocsServiceAuth(auth, AIMS_DOCUMENT_PREVIEW_GRANT_SERVICE_AUTH)

  throw createError({
    statusCode: 503,
    statusMessage: 'preview_access_service_command_required',
    message: 'Codocs preview access requires a signed AIMS service command.'
  })
})
