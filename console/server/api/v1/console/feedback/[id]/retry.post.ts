import { consoleFeedback } from '~~/server/utils/feedbackAdmin'

export default defineEventHandler(event => consoleFeedback(event, 'retry'))
