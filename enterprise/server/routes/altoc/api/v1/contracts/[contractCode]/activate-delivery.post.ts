import { defineEventHandler } from 'h3'
import { activateEnterpriseAltocContractDelivery } from '~~/server/utils/enterpriseContractActivation'

export default defineEventHandler(activateEnterpriseAltocContractDelivery)
