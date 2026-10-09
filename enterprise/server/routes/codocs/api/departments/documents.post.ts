import { createEnterpriseDepartmentDocument } from '../../../../utils/enterpriseCodocsDepartmentDocuments'

export default defineEventHandler(event => createEnterpriseDepartmentDocument(event))
