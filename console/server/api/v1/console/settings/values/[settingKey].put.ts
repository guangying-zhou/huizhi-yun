import { getRouterParam, readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'
import { updateSettingValue } from '~~/server/utils/systemParameters'

export default defineEventHandler(async (event) => {
  const actor = await requireSystemSettingsAccess(event, 'edit')
  const settingKey = getRouterParam(event, 'settingKey') || ''
  const body = await readBody<{
    scopeKey?: string
    value?: unknown
  }>(event)

  return ok(await updateSettingValue({
    settingKey,
    scopeKey: body.scopeKey,
    value: body.value,
    updatedBy: actor.actorId
  }))
})
