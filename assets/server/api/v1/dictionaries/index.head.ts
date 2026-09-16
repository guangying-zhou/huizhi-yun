import { setHeader } from 'h3'

export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'application/json')
  setHeader(event, 'access-control-allow-origin', '*')
  setHeader(event, 'access-control-allow-methods', 'GET, HEAD, OPTIONS')
  setHeader(event, 'access-control-allow-headers', '*')
  setHeader(event, 'access-control-max-age', 86400)
  return null
})
