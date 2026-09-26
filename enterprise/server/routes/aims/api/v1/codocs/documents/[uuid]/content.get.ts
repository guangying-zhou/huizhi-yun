import { defineEventHandler } from 'h3'
import { enterpriseCodocsProjectDocumentContent } from '~~/server/utils/enterpriseCodocsProjectDocument'

export default defineEventHandler(enterpriseCodocsProjectDocumentContent)
