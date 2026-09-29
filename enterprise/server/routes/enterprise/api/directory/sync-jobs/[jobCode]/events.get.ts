import { defineEventHandler, setHeader } from 'h3'
import { syncJobCode, syncReadQuery, fetchSyncRead, projectSyncResult } from '../../../../../../utils/consoleDirectorySyncRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const query = syncReadQuery(event, true)
  const params = { jobCode: syncJobCode(event) }
  const data = await fetchSyncRead(event, 'directory.sync-jobs.events.list', { query, params })
  return { code: 0, data: projectSyncResult(data, 'events', query) }
})
