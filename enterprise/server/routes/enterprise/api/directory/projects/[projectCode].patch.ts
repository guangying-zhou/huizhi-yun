import { defineEventHandler, setHeader } from 'h3'
import { consoleProjectWrite } from '../../../../../utils/consoleProjectWrite'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { code: 0, data: await consoleProjectWrite(event, 'update') }
})
