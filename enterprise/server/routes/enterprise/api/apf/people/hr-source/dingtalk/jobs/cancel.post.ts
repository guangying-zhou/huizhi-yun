import { enterprisePeopleHRWrite } from '~~/server/utils/enterprisePeopleHRSource'

export default defineEventHandler(event => enterprisePeopleHRWrite(event, 'jobs-cancel'))
