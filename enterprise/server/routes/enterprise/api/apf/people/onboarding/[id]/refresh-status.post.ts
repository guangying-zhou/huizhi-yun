import { enterprisePeopleProvisioning } from '../../../../../../../utils/enterprisePeopleProvisioning'

export default defineEventHandler(event => enterprisePeopleProvisioning(event, 'refresh-status'))
