import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemTimeEntryCreate } from '~~/server/utils/enterpriseAimsWorkItemWorkspace'

export default defineEventHandler(enterpriseAimsWorkItemTimeEntryCreate)
