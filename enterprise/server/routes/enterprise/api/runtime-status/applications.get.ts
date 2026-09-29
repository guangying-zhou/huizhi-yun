import { defineEventHandler, setHeader } from 'h3'
import { runtimeSummaryQuery, fetchRuntimeSummary, projectRuntimeApplicationsSummary } from '../../../../utils/consoleRuntimeSummaryRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  runtimeSummaryQuery(event)
  return { code: 0, data: projectRuntimeApplicationsSummary(await fetchRuntimeSummary(event, 'runtime-summary.applications.read')) }
})
