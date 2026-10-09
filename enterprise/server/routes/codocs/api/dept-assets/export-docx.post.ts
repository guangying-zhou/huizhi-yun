import { exportEnterpriseDepartmentAssetDocx } from '../../../../utils/enterpriseCodocsDepartmentAssets'

export default defineEventHandler(event => exportEnterpriseDepartmentAssetDocx(event))
