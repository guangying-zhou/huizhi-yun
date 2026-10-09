import { enterpriseAPFDeadLetterPurpose } from '../../../../../../utils/enterpriseAPFDeadLetterPurpose'
import { enterpriseAPFDuePurpose } from '../../../../../../utils/enterpriseAPFDuePurpose'
import { enterpriseAPFNotification } from '../../../../../../utils/enterpriseAPF'
import { createError, defineEventHandler, readBody } from 'h3'
import { receiveAimsNotificationAuthorization } from '../../../../../../../../aims/layer/server/index'
import { receiveAssetsNotificationAuthorization } from '../../../../../../../../assets/layer/server/index'
import { requireEnterpriseAimsServiceIngress } from '../../../../../../utils/enterpriseAimsServiceIngress'

export default defineEventHandler(async (event) => {
  await requireEnterpriseAimsServiceIngress(event, 'notification')
  const body = await readBody<Record<string, unknown>>(event)
  if (body?.sourceAppCode === 'enterprise' && /^apf_(altoc|finance|people)_dead_letter$/.test(String((body.descriptor as Record<string, unknown>)?.resource))) return await enterpriseAPFDeadLetterPurpose(event, body)
  if (body?.sourceAppCode === 'enterprise') return await enterpriseAPFDuePurpose(event, body)
  if (body?.sourceAppCode === 'aims') return await receiveAimsNotificationAuthorization(event, body, false)
  if (body?.sourceAppCode === 'assets') return await receiveAssetsNotificationAuthorization(event, body)
  if (['altoc', 'finance', 'people'].includes(String(body?.sourceAppCode))) return await enterpriseAPFNotification(event, body)
  throw createError({ statusCode: 403, message: 'Notification owning application is not supported.' })
})
