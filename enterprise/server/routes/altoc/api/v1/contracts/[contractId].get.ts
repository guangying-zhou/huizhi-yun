import { defineEventHandler } from 'h3'
import { enterpriseAltocRead } from '~~/server/utils/enterpriseAltocReads'

export default defineEventHandler(event => enterpriseAltocRead(event, 'contract', true))
