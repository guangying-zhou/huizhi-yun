import { enterpriseCodocsDocumentTransfer } from '../../../../../utils/enterpriseCodocsDocumentTransfer'
export default defineEventHandler(event => enterpriseCodocsDocumentTransfer(event, 'department'))
