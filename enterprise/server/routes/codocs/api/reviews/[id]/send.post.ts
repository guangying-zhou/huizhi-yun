import { enterpriseCodocsPublishExecution } from '../../../../../utils/enterpriseCodocsPublishExecution'
export default defineEventHandler(event => enterpriseCodocsPublishExecution(event, 'send'))
