import { defineEventHandler } from 'h3'
import { handleUpstreamOidcCallback } from '~~/server/utils/upstreamOidc'

export default defineEventHandler(event => handleUpstreamOidcCallback(event))
