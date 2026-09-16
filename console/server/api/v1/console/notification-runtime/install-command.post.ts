import { createError } from 'h3'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'admin')
  throw createError({
    statusCode: 410,
    message: 'Notification Runtime installation was replaced by Enterprise Connector Runtime enrollment.'
  })
})
