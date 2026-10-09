import { enterprisePeople } from '../../../../../../utils/enterprisePeople'

export default defineEventHandler(event => enterprisePeople(event, 'positions-delete'))
