import { enterpriseWorkflowProxy } from '../../../../../../utils/enterpriseWorkflowProxy'

// Same Host Workflow operation as /api/workflow-proxy; it verifies the Host session itself.
export default defineEventHandler(event => enterpriseWorkflowProxy(event, 'history'))
