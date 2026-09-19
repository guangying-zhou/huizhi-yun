import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemTimeEntries } from '~~/server/utils/enterpriseAimsWorkItemWorkspace'

export default defineEventHandler(enterpriseAimsWorkItemTimeEntries)
