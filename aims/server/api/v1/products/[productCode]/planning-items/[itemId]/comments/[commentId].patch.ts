import { handleProductPlanningComments } from '../../../../../../../utils/productPlanningCommentRuntime'

export default defineEventHandler(event => handleProductPlanningComments(event, 'edit'))
