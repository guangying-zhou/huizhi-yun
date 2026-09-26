import { enterpriseAimsWorkItemWrite } from '~~/server/utils/enterpriseAimsWorkItemWrite'
export default defineEventHandler(event => enterpriseAimsWorkItemWrite(event, 'plan-ready'))
