import { defineEventHandler, setHeader } from 'h3'
import { syncJobCode, syncReadQuery, fetchSyncRead, projectSyncJob } from '../../../../../utils/consoleDirectorySyncRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const query = syncReadQuery(event)
  const params = { jobCode: syncJobCode(event) }
  const data = await fetchSyncRead(event, 'directory.sync-jobs.read', { query, params })
  return { code: 0, data: projectSyncJob(data) }
})
