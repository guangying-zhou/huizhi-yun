import { enterpriseWorkflowProxy } from '../../../../utils/enterpriseWorkflowProxy'

export default defineEventHandler(event => enterpriseWorkflowProxy(event, 'pending'))
