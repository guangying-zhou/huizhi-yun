import { defineEventHandler } from 'h3'
import { enterprisePeopleFacts } from '../../../../../../utils/enterprisePeopleFacts'

export default defineEventHandler(event => enterprisePeopleFacts(event, 'onboarding-create'))
