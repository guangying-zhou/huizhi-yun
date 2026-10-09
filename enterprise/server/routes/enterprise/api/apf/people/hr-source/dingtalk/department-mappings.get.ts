import { enterprisePeopleHRRead } from '~~/server/utils/enterprisePeopleHRSource'

export default defineEventHandler(event => enterprisePeopleHRRead(event, 'mappings'))
