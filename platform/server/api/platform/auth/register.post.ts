import { readBody } from 'h3'
import { ok } from '~~/server/utils/api'
import { normalizeRedirect, registerEmailAccount, sendActivationEmail } from '~~/server/utils/emailAuth'

type RegisterBody = {
  email?: string
  password?: string
  displayName?: string
  redirect?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<RegisterBody | null>(event).catch(() => null)
  const redirect = normalizeRedirect(body?.redirect)
  const result = await registerEmailAccount({
    email: body?.email || '',
    password: body?.password || '',
    displayName: body?.displayName
  })

  await sendActivationEmail(event, {
    email: result.account.email,
    displayName: result.account.displayName,
    token: result.token,
    redirect
  })

  return ok({
    account: result.account,
    activationEmailSent: true,
    redirect
  })
})
