import { defineEventHandler } from 'h3'
import { startUpstreamOidcLogin } from '~~/server/utils/upstreamOidc'

export default defineEventHandler(event => startUpstreamOidcLogin(event))
