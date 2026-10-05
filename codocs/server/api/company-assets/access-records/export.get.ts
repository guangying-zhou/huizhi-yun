import { defineEventHandler, getQuery, setHeader } from 'h3'
import { companyAssetAccessRecordsCsv, listCompanyAssetAccessRecords } from '~~/server/utils/companyAssetAccessRecords'

export default defineEventHandler(async (event) => {
  const data = await listCompanyAssetAccessRecords(event, getQuery(event), true)
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'attachment; filename="company-asset-access-records.csv"')
  return companyAssetAccessRecordsCsv(data.items)
})
