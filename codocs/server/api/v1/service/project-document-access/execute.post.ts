import { defineEventHandler } from 'h3'
import { projectDocumentAccessService } from '~~/server/utils/projectDocumentAccessService'

export default defineEventHandler(projectDocumentAccessService)
