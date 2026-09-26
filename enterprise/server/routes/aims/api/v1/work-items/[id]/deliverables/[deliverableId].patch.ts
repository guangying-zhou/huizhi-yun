import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemDeliverableUpdate } from '~~/server/utils/enterpriseAimsWorkItemWorkspace'

export default defineEventHandler(enterpriseAimsWorkItemDeliverableUpdate)
