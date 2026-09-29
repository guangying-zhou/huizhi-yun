import { uploadEnterpriseDepartmentCabinet } from '~~/server/utils/enterpriseCodocsDepartmentCabinetUpload'
export default defineEventHandler(event => uploadEnterpriseDepartmentCabinet(event))
