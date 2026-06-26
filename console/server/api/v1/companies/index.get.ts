import { listCompanies } from '~~/server/utils/orgCompat'

export default defineEventHandler(async event => ({
  code: 0,
  data: await listCompanies(getQuery(event))
}))
