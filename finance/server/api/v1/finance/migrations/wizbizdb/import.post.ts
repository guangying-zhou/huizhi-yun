import { defineEventHandler, readBody } from 'h3'
import { runWizbizMigration, type WizbizMigrationResult } from '../../../../../utils/financeMigration'
import { cleanString, numberOrNull } from '../../../../../utils/financeWrite'
import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'

export default defineEventHandler(async (event): Promise<{ data: WizbizMigrationResult }> => {
  const runtime = await maybeCallCurrentFinanceDataRuntime<{ data: WizbizMigrationResult }>(event)
  if (runtime.handled) return runtime.data

  const body = await readBody<Record<string, unknown>>(event)

  return {
    data: await runWizbizMigration({
      batchCode: cleanString(body.batchCode ?? body.batch_code),
      dryRun: body.dryRun !== false,
      limit: numberOrNull(body.limit, 'limit'),
      targets: body.targets,
      cleanTargetData: body.cleanTargetData === true || body.cleanTargetData === 'true' || body.clean_target_data === true || body.clean_target_data === 'true',
      cleanOnly: body.cleanOnly === true || body.cleanOnly === 'true' || body.clean_only === true || body.clean_only === 'true'
    })
  }
})
