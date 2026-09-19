import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemTimeEntryUpdate } from '~~/server/utils/enterpriseAimsWorkItemWorkspace'

export default defineEventHandler(enterpriseAimsWorkItemTimeEntryUpdate)
