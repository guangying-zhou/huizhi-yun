#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'

const AIMS_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name)
  if (index === -1 || index + 1 >= process.argv.length) return fallback
  return process.argv[index + 1]
}

function hasArg(name) {
  return process.argv.includes(name)
}

function readEnv(filePath) {
  const env = {}
  if (!fs.existsSync(filePath)) return env
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const index = line.indexOf('=')
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    env[key] = value
  }
  return env
}

function isoWeekStart(year, week) {
  const date = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7))
  const day = date.getUTCDay() || 7
  if (day <= 4) {
    date.setUTCDate(date.getUTCDate() - day + 1)
  } else {
    date.setUTCDate(date.getUTCDate() + 8 - day)
  }
  return date
}

function dateText(date) {
  return date.toISOString().slice(0, 10)
}

function nullIfEmpty(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  return value
}

function nullableNumber(value) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

async function upsertReport(conn, item, currentUser) {
  const payload = item.payload || {}
  const reportYear = Number(payload.reportYear || item.reportYear)
  const reportWeek = Number(payload.reportWeek || item.reportWeek)
  const weekStartDate = isoWeekStart(reportYear, reportWeek)
  const weekEndDate = new Date(weekStartDate)
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6)
  const weekStart = dateText(weekStartDate)
  const weekEnd = dateText(weekEndDate)
  const status = payload.status === 'draft' ? 'draft' : 'submitted'

  await conn.execute(`
    INSERT INTO project_weekly_reports (
      project_id,
      report_year,
      report_week,
      week_start,
      week_end,
      main_work,
      overall_progress,
      department_name,
      project_type_name,
      project_manager_name,
      initiation_status,
      current_stage,
      progress_status,
      completion_percent,
      contract_status,
      contract_amount,
      payment_status,
      cumulative_labor_cost,
      major_risks,
      coordination_needs,
      remarks,
      status,
      created_by,
      updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      week_start = VALUES(week_start),
      week_end = VALUES(week_end),
      main_work = VALUES(main_work),
      overall_progress = VALUES(overall_progress),
      department_name = VALUES(department_name),
      project_type_name = VALUES(project_type_name),
      project_manager_name = VALUES(project_manager_name),
      initiation_status = VALUES(initiation_status),
      current_stage = VALUES(current_stage),
      progress_status = VALUES(progress_status),
      completion_percent = VALUES(completion_percent),
      contract_status = VALUES(contract_status),
      contract_amount = VALUES(contract_amount),
      payment_status = VALUES(payment_status),
      cumulative_labor_cost = VALUES(cumulative_labor_cost),
      major_risks = VALUES(major_risks),
      coordination_needs = VALUES(coordination_needs),
      remarks = VALUES(remarks),
      status = VALUES(status),
      updated_by = VALUES(updated_by)
  `, [
    item.projectId,
    reportYear,
    reportWeek,
    weekStart,
    weekEnd,
    nullIfEmpty(payload.mainWork),
    nullIfEmpty(payload.overallProgress),
    nullIfEmpty(payload.departmentName),
    nullIfEmpty(payload.projectTypeName),
    nullIfEmpty(payload.projectManagerName),
    nullIfEmpty(payload.initiationStatus),
    nullIfEmpty(payload.currentStage),
    nullIfEmpty(payload.progressStatus),
    nullableNumber(payload.completionPercent),
    nullIfEmpty(payload.contractStatus),
    nullableNumber(payload.contractAmount),
    nullIfEmpty(payload.paymentStatus),
    nullableNumber(payload.cumulativeLaborCost),
    nullIfEmpty(payload.majorRisks),
    nullIfEmpty(payload.coordinationNeeds),
    nullIfEmpty(payload.remarks),
    status,
    currentUser,
    currentUser
  ])

  const [reportRows] = await conn.execute(`
    SELECT id
    FROM project_weekly_reports
    WHERE project_id = ?
      AND report_year = ?
      AND report_week = ?
    LIMIT 1
  `, [item.projectId, reportYear, reportWeek])
  const reportId = reportRows[0]?.id
  if (!reportId) throw new Error('report_id_not_found_after_upsert')

  await conn.execute('DELETE FROM project_weekly_report_entries WHERE report_id = ?', [reportId])
  await conn.execute('DELETE FROM project_weekly_report_work_items WHERE report_id = ?', [reportId])
  await conn.execute('DELETE FROM time_entries WHERE weekly_report_id = ?', [reportId])

  for (const entry of payload.entries || []) {
    await conn.execute(`
      INSERT INTO project_weekly_report_entries (
        report_id,
        project_id,
        uid,
        allocation_percent,
        hours
      )
      VALUES (?, ?, ?, ?, ?)
    `, [
      reportId,
      item.projectId,
      entry.uid,
      nullableNumber(entry.allocationPercent) ?? 0,
      nullableNumber(entry.hours) ?? 0
    ])
  }

  let index = 0
  for (const workItem of payload.workItems || []) {
    index += 1
    await conn.execute(`
      INSERT INTO project_weekly_report_work_items (
        report_id,
        project_id,
        plan_type,
        source_type,
        work_item_id,
        module_name,
        sort_order,
        task_summary,
        owner_uid,
        owner_name,
        completion_percent,
        incomplete_reason,
        workload_days
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      reportId,
      item.projectId,
      workItem.planType || 'this_week',
      workItem.sourceType || 'manual',
      nullableNumber(workItem.workItemId),
      nullIfEmpty(workItem.moduleName),
      nullableNumber(workItem.sortOrder) || index,
      workItem.taskSummary,
      nullIfEmpty(workItem.ownerUid),
      nullIfEmpty(workItem.ownerName),
      nullableNumber(workItem.completionPercent),
      nullIfEmpty(workItem.incompleteReason),
      nullableNumber(workItem.workloadDays)
    ])
  }

  return {
    reportId,
    entryCount: (payload.entries || []).length,
    workItemCount: (payload.workItems || []).length
  }
}

async function upsertProjectMember(conn, member) {
  await conn.execute(`
    INSERT INTO aims_project_members (
      project_id,
      uid,
      role,
      status
    )
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      role = CASE
        WHEN role = 'manager' THEN role
        ELSE VALUES(role)
      END,
      status = VALUES(status)
  `, [
    member.projectId,
    member.uid,
    member.role || 'member',
    member.status || 'active'
  ])
}

async function main() {
  const payloadReportPath = argValue('--payload-report', path.join(AIMS_ROOT, 'docs/weekly-report-import-payloads.json'))
  const resultReportPath = argValue('--result-report', path.join(AIMS_ROOT, 'docs/weekly-report-import-db-report.json'))
  const envPath = argValue('--env-file', path.resolve(AIMS_ROOT, '../data-runtime/.env'))
  const currentUser = argValue('--current-user', 'zhouguangying')
  const dryRun = hasArg('--dry-run')
  const addMembers = hasArg('--add-members')

  const env = readEnv(envPath)
  const report = JSON.parse(fs.readFileSync(payloadReportPath, 'utf8'))
  const payloads = report.preparedPayloads || []
  if (!payloads.length) throw new Error('preparedPayloads is empty; rerun import_weekly_reports.py with --include-payloads')

  const result = {
    mode: dryRun ? 'db-preview' : 'db-apply',
    generatedAt: new Date().toISOString(),
    sourcePayloadReport: payloadReportPath,
    stats: report.stats,
    unmatchedProjects: report.unmatchedProjects || [],
    unmatchedMembers: report.unmatchedMembers || [],
    membersToAdd: report.membersToAdd || [],
    skippedReports: report.skippedReports || [],
    emptyReportsIgnored: report.emptyReportsIgnored || [],
    workloadMismatches: report.workloadMismatches || [],
    addedMembers: [],
    appliedReports: [],
    failedReports: []
  }

  if (!dryRun) {
    const conn = await mysql.createConnection({
      host: env.HZY_AIMS_DB_HOST || env.HZY_DATA_RUNTIME_DB_HOST || env.DB_HOST || '127.0.0.1',
      port: Number(env.HZY_AIMS_DB_PORT || env.HZY_DATA_RUNTIME_DB_PORT || env.DB_PORT || 3306),
      user: env.HZY_AIMS_DB_USER || env.HZY_DATA_RUNTIME_DB_USER || env.DB_USER || 'root',
      password: env.HZY_AIMS_DB_PASSWORD || env.HZY_DATA_RUNTIME_DB_PASSWORD || env.DB_PASSWORD || '',
      database: env.HZY_AIMS_DB_NAME || env.DB_NAME || 'hzy_aims',
      supportBigNumbers: true,
      bigNumberStrings: false,
      multipleStatements: false
    })

    try {
      if (addMembers) {
        for (const member of result.membersToAdd) {
          try {
            await conn.beginTransaction()
            await upsertProjectMember(conn, member)
            await conn.commit()
            result.addedMembers.push(member)
          } catch (error) {
            await conn.rollback()
            result.failedReports.push({
              projectId: member.projectId,
              projectName: member.projectName,
              uid: member.uid,
              error: `add_member_failed: ${error?.message || String(error)}`
            })
          }
        }
      }

      let processed = 0
      for (const item of payloads) {
        processed += 1
        try {
          await conn.beginTransaction()
          const written = await upsertReport(conn, item, currentUser)
          await conn.commit()
          result.appliedReports.push({
            file: item.file,
            reportYear: item.reportYear,
            reportWeek: item.reportWeek,
            projectId: item.projectId,
            projectName: item.projectName,
            reportId: written.reportId,
            entryCount: written.entryCount,
            workItemCount: written.workItemCount
          })
          if (processed % 25 === 0) {
            console.log(`applied ${processed}/${payloads.length}`)
          }
        } catch (error) {
          await conn.rollback()
          result.failedReports.push({
            file: item.file,
            reportYear: item.reportYear,
            reportWeek: item.reportWeek,
            projectId: item.projectId,
            projectName: item.projectName,
            error: error?.message || String(error)
          })
        }
      }
    } finally {
      await conn.end()
    }
  }

  fs.writeFileSync(resultReportPath, JSON.stringify(result, null, 2), 'utf8')
  console.log(JSON.stringify({
    mode: result.mode,
    payloadReports: payloads.length,
    membersToAdd: result.membersToAdd.length,
    addedMembers: result.addedMembers.length,
    appliedReports: result.appliedReports.length,
    failedReports: result.failedReports.length,
    unmatchedProjects: result.unmatchedProjects.length,
    unmatchedMembers: result.unmatchedMembers.length,
    skippedReports: result.skippedReports.length,
    emptyReportsIgnored: result.emptyReportsIgnored.length,
    workloadMismatches: result.workloadMismatches.length,
    resultReport: resultReportPath
  }, null, 2))
  if (result.failedReports.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exit(1)
})
