import { defineEventHandler, setHeader } from 'h3'
import { runtimeSummaryQuery, fetchRuntimeSummary, projectDataRuntimeSummary } from '../../../../utils/consoleRuntimeSummaryRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  runtimeSummaryQuery(event)
  return { code: 0, data: projectDataRuntimeSummary(await fetchRuntimeSummary(event, 'runtime-summary.data.read')) }
})
