import { manageEnterpriseDepartmentDocument } from '../../../../../../utils/enterpriseCodocsDepartmentWrites'

export default defineEventHandler(event => manageEnterpriseDepartmentDocument(event, 'readonly'))
