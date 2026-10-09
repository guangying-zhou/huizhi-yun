import { defineEventHandler } from 'h3'
import { enterpriseAltocFeedback } from '../../../../../../utils/enterpriseAltocFeedback'

export default defineEventHandler(event => enterpriseAltocFeedback(event, 'view'))
