import { defineEventHandler } from 'h3'
import { enterprisePeopleOffboarding } from '../../../../../../../utils/enterprisePeopleOffboarding'

export default defineEventHandler(event => enterprisePeopleOffboarding(event, 'offboarding-confirm'))
