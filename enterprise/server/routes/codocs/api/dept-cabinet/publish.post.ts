import { publishEnterpriseDepartmentCabinetPdf } from '~~/server/utils/enterpriseCodocsDepartmentCabinetPublish'

export default defineEventHandler(event => publishEnterpriseDepartmentCabinetPdf(event))
