import { enterprisePeopleDirectoryRecovery } from '../../../../../../../utils/enterprisePeopleDirectoryRecovery'

export default defineEventHandler(event => enterprisePeopleDirectoryRecovery(event, 'probe'))
