import { defineEventHandler } from 'h3'
import { publicConsoleLoginConfig } from '~~/server/utils/loginConfig'

export default defineEventHandler(async (event) => {
  return {
    code: 200,
    data: await publicConsoleLoginConfig(event)
  }
})
