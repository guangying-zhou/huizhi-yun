import { setHeader, setResponseStatus, type H3Event } from 'h3'

// An API path the Host does not serve must answer JSON, never the SPA HTML
// fallback: a browser client would otherwise parse a 200 page as data.
export function enterpriseApiNotFound(event: H3Event) {
  setResponseStatus(event, 404, 'Not Found')
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  return { code: 404, message: 'API not found', data: { code: 'enterprise_api_not_found' } }
}
