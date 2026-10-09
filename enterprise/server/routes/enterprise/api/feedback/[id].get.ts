import { enterpriseFeedback } from '~~/server/utils/enterpriseFeedback'

export default defineEventHandler(event => enterpriseFeedback(event, 'detail'))
