import { defineEventHandler } from 'h3'
import { handleProductHandoff } from '../../../../../../../../../../aims/server/utils/productHandoffRuntime'
import { enterpriseProductHandoffBridge } from '../../../../../../../../utils/enterpriseProductHandoff'
export default defineEventHandler(async event=>handleProductHandoff(event,'planning',await enterpriseProductHandoffBridge(event)))
