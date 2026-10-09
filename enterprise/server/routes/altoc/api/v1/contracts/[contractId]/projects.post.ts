import { enterpriseAltocContract } from '../../../../../../utils/enterpriseAltocContracts'

export default defineEventHandler(event => enterpriseAltocContract(event, 'contract-projects-bind'))
