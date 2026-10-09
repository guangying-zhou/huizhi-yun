import { handleProductFeedbackSubmission } from '~~/server/utils/productFeedbackSubmission'

export default defineEventHandler(event => handleProductFeedbackSubmission(event, false))
