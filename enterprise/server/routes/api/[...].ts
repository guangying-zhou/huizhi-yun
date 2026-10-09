import { defineEventHandler } from 'h3'
import { enterpriseApiNotFound } from '../../utils/enterpriseApiNotFound'

// Root /api/** reaches the Host only through the gateway's auth rewrite of
// /enterprise/api/auth/* (and direct local access). Registered Foundation and
// Host handlers are more specific and win; anything else is a JSON 404 instead
// of the SPA HTML fallback. Not a readiness route: see business-api-surface.
export default defineEventHandler(event => enterpriseApiNotFound(event))
