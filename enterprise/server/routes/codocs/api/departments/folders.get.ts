import { listEnterpriseDepartmentItems } from '../../../../utils/enterpriseCodocsDepartmentDocuments'

export default defineEventHandler(event => listEnterpriseDepartmentItems(event, 'folders'))
