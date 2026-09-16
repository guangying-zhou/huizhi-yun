import { fetchConsoleBusinessDomainsByService } from '../../utils/directoryApi'

export default defineEventHandler(event => fetchConsoleBusinessDomainsByService({
  event,
  params: getQuery(event)
}))
