import { defineEventHandler, setHeader } from 'h3'
import { consoleCommitteeWrite } from '../../../../../utils/consoleCommitteeWrite'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { code: 0, data: await consoleCommitteeWrite(event, 'delete') }
})
