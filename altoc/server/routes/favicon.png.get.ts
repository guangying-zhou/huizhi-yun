import { sendRedirect } from 'h3'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const baseURL = config.app.baseURL.endsWith('/') ? config.app.baseURL : `${config.app.baseURL}/`
  return sendRedirect(event, `${baseURL}logo.png`, 302)
})
