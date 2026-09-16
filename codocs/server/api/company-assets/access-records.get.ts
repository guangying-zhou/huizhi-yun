import { defineEventHandler, getQuery, setHeader } from 'h3'
import { listCompanyAssetAccessRecords } from '~~/server/utils/companyAssetAccessRecords'

export default defineEventHandler(async (event) => {
  const data = await listCompanyAssetAccessRecords(event, getQuery(event))
  setHeader(event, 'Cache-Control', 'no-store')
  return { code: 0, data }
})
