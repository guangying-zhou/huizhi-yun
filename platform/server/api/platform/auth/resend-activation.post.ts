import { readBody } from 'h3'
import { ok } from '~~/server/utils/api'
import { normalizeRedirect, resendActivationToken, sendActivationEmail } from '~~/server/utils/emailAuth'

type ResendBody = {
  email?: string
  redirect?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<ResendBody | null>(event).catch(() => null)
  const redirect = normalizeRedirect(body?.redirect)
  const result = await resendActivationToken(body?.email || '')

  await sendActivationEmail(event, {
    email: result.account.email,
    displayName: result.account.displayName,
    token: result.token,
    redirect
  })

  return ok({
    activationEmailSent: true,
    redirect
  })
})
