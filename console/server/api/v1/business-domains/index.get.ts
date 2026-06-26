import { listBusinessDomains } from '~~/server/utils/businessDomains'
import { ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async event => ok(await listBusinessDomains(getQuery(event))))
