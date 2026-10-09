import { defineEventHandler } from 'h3'
import { enterpriseAltocCustomerWrite } from '~~/server/utils/enterpriseAltocCustomers'

export default defineEventHandler(event => enterpriseAltocCustomerWrite(event, 'invoice-profiles-delete'))
