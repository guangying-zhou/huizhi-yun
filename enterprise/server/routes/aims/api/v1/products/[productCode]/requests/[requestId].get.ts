import { defineEventHandler } from 'h3'
import { readEnterpriseProductRequests } from '../../../../../../../utils/enterpriseProductRequestRead'

export default defineEventHandler(event => readEnterpriseProductRequests(event, true))
