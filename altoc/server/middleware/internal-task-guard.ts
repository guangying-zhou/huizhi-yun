import { createError, getRequestURL } from 'h3'

export default defineEventHandler((event) => {
  if (/(?:^|\/)_nitro\/tasks(?:\/|$)/.test(getRequestURL(event).pathname)) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
})
