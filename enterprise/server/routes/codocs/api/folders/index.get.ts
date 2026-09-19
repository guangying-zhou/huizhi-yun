import { enterpriseCodocsDocumentRead } from '../../../../utils/enterpriseCodocsDocumentReads'

export default defineEventHandler(event => enterpriseCodocsDocumentRead(event, 'folders'))
