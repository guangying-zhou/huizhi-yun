import { defineEventHandler, setHeader } from 'h3'
import { consoleDepartmentWrite } from '../../../../../utils/consoleDepartmentWrite'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { code: 0, data: await consoleDepartmentWrite(event, 'create') }
})
