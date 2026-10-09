import { defineEventHandler } from 'h3'
import { enterpriseAltocQuotation } from '~~/server/utils/enterpriseAltocQuotations'

export default defineEventHandler(event => enterpriseAltocQuotation(event, 'quotations-update'))
