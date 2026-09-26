import { defineEventHandler } from 'h3'
import { handleProductHandoffDetail } from '../../../../../../../../../aims/server/utils/productHandoffDetailRuntime'
import { enterpriseProductHandoffBridge } from '../../../../../../../utils/enterpriseProductHandoff'
export default defineEventHandler(async event=>handleProductHandoffDetail(event,await enterpriseProductHandoffBridge(event)))
