import { enterpriseAltocContract } from '../../../../../../utils/enterpriseAltocContracts'

export default defineEventHandler(event => enterpriseAltocContract(event, 'contract-lines-replace'))
