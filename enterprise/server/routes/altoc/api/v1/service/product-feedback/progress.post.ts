import { defineEventHandler } from 'h3'
import { enterpriseAltocFeedbackService } from '../../../../../../utils/enterpriseAltocFeedbackService'

export default defineEventHandler(event => enterpriseAltocFeedbackService(event, 'progress'))
