import { restoreEnterpriseDepartmentDocument } from '../../../../../../utils/enterpriseCodocsDepartmentWrites'

export default defineEventHandler(event => restoreEnterpriseDepartmentDocument(event))
