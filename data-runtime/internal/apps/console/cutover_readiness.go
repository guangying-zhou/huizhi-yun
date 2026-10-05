package console

import (
	"context"
	"strings"
	"time"
)

type CutoverReadiness struct {
	App            string                   `json:"app"`
	Status         string                   `json:"status"`
	SchemaRevision string                   `json:"schemaRevision"`
	CheckedAt      string                   `json:"checkedAt"`
	Schema         SchemaStatus             `json:"schema"`
	Checks         []CutoverReadinessCheck  `json:"checks"`
	Metrics        []CutoverReadinessMetric `json:"metrics"`
	Blockers       []string                 `json:"blockers"`
}

type CutoverReadinessCheck struct {
	Code       string `json:"code"`
	Status     string `json:"status"`
	Violations int64  `json:"violations"`
}

type CutoverReadinessMetric struct {
	Code           string `json:"code"`
	Count          int64  `json:"count"`
	ReviewRequired bool   `json:"reviewRequired"`
}

type cutoverCountSpec struct {
	code           string
	query          string
	args           []any
	reviewRequired bool
}

func (a *Adapter) CutoverReadiness(ctx context.Context, deployment string) (CutoverReadiness, error) {
	schema, err := a.SchemaStatus(ctx)
	if err != nil {
		return CutoverReadiness{}, err
	}
	result := CutoverReadiness{
		App:            "console",
		Status:         "not_ready",
		SchemaRevision: schema.SchemaRevision,
		CheckedAt:      time.Now().UTC().Format(time.RFC3339Nano),
		Schema:         schema,
		Checks:         []CutoverReadinessCheck{},
		Metrics:        []CutoverReadinessMetric{},
		Blockers:       []string{},
	}
	if schema.Status != "ok" {
		result.Blockers = append(result.Blockers, "schema")
		return result, nil
	}

	tenant := strings.TrimSpace(a.tenant)
	deployment = strings.TrimSpace(deployment)
	if tenant == "" {
		result.Blockers = append(result.Blockers, "runtime_tenant_binding")
	}
	if deployment == "" {
		result.Blockers = append(result.Blockers, "runtime_deployment_binding")
	}
	if len(result.Blockers) > 0 {
		return result, nil
	}

	for _, spec := range cutoverBlockingChecks(tenant, deployment) {
		count, err := a.queryCutoverCount(ctx, spec)
		if err != nil {
			return CutoverReadiness{}, err
		}
		status := "pass"
		if count > 0 {
			status = "fail"
			result.Blockers = append(result.Blockers, spec.code)
		}
		result.Checks = append(result.Checks, CutoverReadinessCheck{
			Code: spec.code, Status: status, Violations: count,
		})
	}

	for _, spec := range cutoverMetrics() {
		count, err := a.queryCutoverCount(ctx, spec)
		if err != nil {
			return CutoverReadiness{}, err
		}
		result.Metrics = append(result.Metrics, CutoverReadinessMetric{
			Code: spec.code, Count: count, ReviewRequired: spec.reviewRequired,
		})
		if spec.reviewRequired && count > 0 {
			result.Blockers = append(result.Blockers, spec.code)
		}
	}

	if len(result.Blockers) == 0 {
		result.Status = "ready"
	}
	return result, nil
}

func (a *Adapter) queryCutoverCount(ctx context.Context, spec cutoverCountSpec) (int64, error) {
	var count int64
	err := a.db.QueryRowContext(ctx, spec.query, spec.args...).Scan(&count)
	return count, err
}

func cutoverBlockingChecks(tenant, deployment string) []cutoverCountSpec {
	return []cutoverCountSpec{
		{
			code: "runtime_database_identity",
			query: `SELECT CASE
				WHEN LOWER(SUBSTRING_INDEX(CURRENT_USER(),'@',1))
				       IN ('root','mysql.infoschema','mysql.session','mysql.sys')
				  OR SUBSTRING_INDEX(CURRENT_USER(),'@',-1) IN ('','%')
				THEN 1 ELSE 0 END`,
		},
		{
			code: "runtime_database_global_privileges",
			query: `SELECT COUNT(*)
				FROM information_schema.USER_PRIVILEGES
				WHERE GRANTEE=CONCAT(
					CHAR(39),
					REPLACE(SUBSTRING_INDEX(CURRENT_USER(),'@',1),CHAR(39),CONCAT(CHAR(39),CHAR(39))),
					CHAR(39),'@',CHAR(39),
					REPLACE(SUBSTRING_INDEX(CURRENT_USER(),'@',-1),CHAR(39),CONCAT(CHAR(39),CHAR(39))),
					CHAR(39)
				)
				  AND PRIVILEGE_TYPE<>'USAGE'`,
		},
		{
			code: "runtime_database_schema_privileges",
			query: `SELECT
				(SELECT COUNT(*)
				   FROM information_schema.SCHEMA_PRIVILEGES
				  WHERE GRANTEE=CONCAT(
						CHAR(39),
						REPLACE(SUBSTRING_INDEX(CURRENT_USER(),'@',1),CHAR(39),CONCAT(CHAR(39),CHAR(39))),
						CHAR(39),'@',CHAR(39),
						REPLACE(SUBSTRING_INDEX(CURRENT_USER(),'@',-1),CHAR(39),CONCAT(CHAR(39),CHAR(39))),
						CHAR(39)
					)
				    AND TABLE_SCHEMA=DATABASE()
				    AND PRIVILEGE_TYPE NOT IN
				      ('SELECT','INSERT','UPDATE','DELETE','CREATE TEMPORARY TABLES'))
				+
				(SELECT COUNT(*)
				   FROM information_schema.TABLE_PRIVILEGES
				  WHERE GRANTEE=CONCAT(
						CHAR(39),
						REPLACE(SUBSTRING_INDEX(CURRENT_USER(),'@',1),CHAR(39),CONCAT(CHAR(39),CHAR(39))),
						CHAR(39),'@',CHAR(39),
						REPLACE(SUBSTRING_INDEX(CURRENT_USER(),'@',-1),CHAR(39),CONCAT(CHAR(39),CHAR(39))),
						CHAR(39)
					)
				    AND TABLE_SCHEMA=DATABASE()
				    AND PRIVILEGE_TYPE NOT IN ('SELECT','INSERT','UPDATE','DELETE'))
				+
				(SELECT COUNT(*)
				   FROM information_schema.COLUMN_PRIVILEGES
				  WHERE GRANTEE=CONCAT(
						CHAR(39),
						REPLACE(SUBSTRING_INDEX(CURRENT_USER(),'@',1),CHAR(39),CONCAT(CHAR(39),CHAR(39))),
						CHAR(39),'@',CHAR(39),
						REPLACE(SUBSTRING_INDEX(CURRENT_USER(),'@',-1),CHAR(39),CONCAT(CHAR(39),CHAR(39))),
						CHAR(39)
					)
				    AND TABLE_SCHEMA=DATABASE()
				    AND PRIVILEGE_TYPE NOT IN ('SELECT','INSERT','UPDATE'))`,
		},
		{
			code: "tenant_profile_binding",
			query: `SELECT CASE
				WHEN COUNT(*)=1
				 AND COALESCE(SUM(CASE WHEN singleton_key=1 AND tenant_code=? AND status='active' THEN 1 ELSE 0 END),0)=1
				THEN 0 ELSE 1 END
				FROM org_profiles`,
			args: []any{tenant},
		},
		{
			code: "runtime_data_binding",
			query: `SELECT
				(SELECT COUNT(*) FROM auth_external_login_transactions WHERE tenant_code<>? OR deployment_code<>?) +
				(SELECT COUNT(*) FROM directory_connector_enrollments WHERE tenant_code<>? OR deployment_code<>?) +
				(SELECT COUNT(*) FROM directory_connectors WHERE tenant_code<>? OR deployment_code<>?) +
				(SELECT COUNT(*) FROM connector_runtime_enrollments WHERE tenant_code<>? OR deployment_code<>?) +
				(SELECT COUNT(*) FROM connector_runtime_instances WHERE tenant_code<>? OR deployment_code<>?) +
				(SELECT COUNT(*) FROM service_command_receipt WHERE tenant_code<>? OR deployment_code<>?) +
				(SELECT COUNT(*) FROM integration_operation WHERE tenant_code<>? OR deployment_code<>?)`,
			args: []any{
				tenant, deployment, tenant, deployment, tenant, deployment,
				tenant, deployment, tenant, deployment, tenant, deployment,
				tenant, deployment,
			},
		},
		{
			code: "vault_current_version_integrity",
			query: `SELECT COUNT(*)
				FROM vault_secrets vs
				LEFT JOIN vault_secret_versions vsv
				  ON vsv.id=vs.current_version_id AND vsv.secret_id=vs.id
				WHERE vs.status='active'
				  AND (vs.current_version_id IS NULL OR vsv.id IS NULL OR vsv.status<>'active'
				    OR (vsv.ciphertext_blob IS NULL AND vsv.backend_secret_ref IS NULL))`,
		},
		{
			code: "integration_credential_integrity",
			query: `SELECT
				(SELECT COUNT(*)
				   FROM integrations i
				   LEFT JOIN integration_credentials ic
				     ON ic.id=i.current_credential_id AND ic.integration_id=i.id
				   LEFT JOIN vault_secrets vs ON vs.id=ic.secret_id
				   LEFT JOIN vault_secret_versions vsv
				     ON vsv.id=COALESCE(ic.secret_version_id,vs.current_version_id) AND vsv.secret_id=vs.id
				  WHERE i.current_credential_id IS NOT NULL
				    AND (ic.id IS NULL OR ic.status<>'active' OR vs.status<>'active' OR vsv.status<>'active'))
				+
				(SELECT COUNT(*) FROM (
					SELECT integration_id FROM integration_credentials
					WHERE status='active' GROUP BY integration_id HAVING COUNT(*)>1
				) duplicate_active_integrations)`,
		},
		{
			code: "service_client_credential_integrity",
			query: `SELECT
				(SELECT COUNT(*)
				   FROM service_clients sc
				   LEFT JOIN service_client_credentials scc
				     ON scc.id=sc.current_credential_id AND scc.service_client_id=sc.id
				   LEFT JOIN vault_secrets vs ON vs.id=scc.secret_id
				   LEFT JOIN vault_secret_versions vsv
				     ON vsv.id=vs.current_version_id AND vsv.secret_id=vs.id
				  WHERE sc.status='active'
				    AND (sc.current_credential_id IS NULL OR scc.id IS NULL OR scc.status<>'active'
				      OR (scc.expires_at IS NOT NULL AND scc.expires_at<=UTC_TIMESTAMP())
				      OR vs.status<>'active' OR vsv.status<>'active'))
				+
				(SELECT COUNT(*) FROM (
					SELECT service_client_id FROM service_client_credentials
					WHERE status='active' GROUP BY service_client_id HAVING COUNT(*)>1
				) duplicate_active_service_clients)`,
		},
		{
			code: "oidc_current_signing_key",
			query: `SELECT CASE WHEN COUNT(*)=1 THEN 0 ELSE 1 END
				FROM auth_signing_keys
				WHERE status='current' AND private_key_ref IS NOT NULL AND private_key_ref<>''
				  AND (not_before IS NULL OR not_before<=UTC_TIMESTAMP())
				  AND (not_after IS NULL OR not_after>UTC_TIMESTAMP())`,
		},
		{
			code: "stale_mutation_receipts",
			query: `SELECT COUNT(*) FROM console_mutation_receipts
				WHERE status='processing' AND updated_at<UTC_TIMESTAMP(3)-INTERVAL 15 MINUTE`,
		},
		{
			code: "stale_service_command_receipts",
			query: `SELECT COUNT(*) FROM service_command_receipt
				WHERE status='processing' AND updated_at<UTC_TIMESTAMP(3)-INTERVAL 15 MINUTE`,
		},
		{
			code: "stuck_integration_operations",
			query: `SELECT COUNT(*) FROM integration_operation
				WHERE status='processing'
				  AND ((locked_until IS NOT NULL AND locked_until<UTC_TIMESTAMP(3))
				    OR updated_at<UTC_TIMESTAMP(3)-INTERVAL 15 MINUTE)`,
		},
		{
			code: "stale_lifecycle_actionables",
			query: `SELECT COUNT(*) FROM console_platform_lifecycle_actionables
				WHERE updated_at<UTC_TIMESTAMP(3)-INTERVAL 15 MINUTE
				  AND (notification_id IS NULL
				    OR (closure_state IS NOT NULL AND closure_acknowledged_at IS NULL))`,
		},
		{
			code: "directory_primary_department_integrity",
			query: `SELECT COUNT(*)
				FROM directory_users u
				LEFT JOIN directory_user_departments ud
				  ON ud.uid=u.uid AND ud.relation_type='member' AND ud.is_primary=1 AND ud.status='active'
				LEFT JOIN directory_departments d
				  ON d.dept_code=ud.dept_code AND d.org_type='department' AND d.status='active'
				WHERE u.status='active'
				  AND ((u.primary_dept_code IS NULL AND d.dept_code IS NOT NULL)
				    OR (u.primary_dept_code IS NOT NULL
				      AND (d.dept_code IS NULL OR d.dept_code<>u.primary_dept_code)))`,
		},
		{
			code: "directory_subject_export_completeness",
			query: `SELECT COUNT(*) FROM (
				SELECT u.uid
				  FROM directory_users u
				  LEFT JOIN directory_subject_exports e
				    ON e.subject_type='user' AND e.subject_code=u.uid AND e.status='active'
				 WHERE u.status='active' AND e.id IS NULL
				UNION ALL
				SELECT d.dept_code
				  FROM directory_departments d
				  LEFT JOIN directory_subject_exports e
				    ON e.subject_type=CASE WHEN d.org_type='committee' THEN 'committee' ELSE 'department' END
				   AND e.subject_code=d.dept_code AND e.status='active'
				 WHERE d.status='active' AND e.id IS NULL
				UNION ALL
				SELECT p.project_code
				  FROM directory_projects p
				  LEFT JOIN directory_subject_exports e
				    ON e.subject_type='project' AND e.subject_code=p.project_code AND e.status='active'
				 WHERE p.status='active' AND e.id IS NULL
			) missing_exports`,
		},
	}
}

func cutoverMetrics() []cutoverCountSpec {
	return []cutoverCountSpec{
		{
			code: "unfinished_integration_operations",
			query: `SELECT COUNT(*) FROM integration_operation
				WHERE status IN ('pending','retry_wait','partial_unknown','processing')`,
			reviewRequired: true,
		},
		{
			code: "failed_integration_operations",
			query: `SELECT COUNT(*) FROM integration_operation io
				WHERE io.status IN ('failed','failed_permanent','dead_letter')
				  AND NOT EXISTS (
				    SELECT 1 FROM console_cutover_dispositions d
				     WHERE d.category='` + cutoverDispositionIntegration + `'
				       AND d.subject_key=io.operation_id
				       AND d.status='active'
				       AND d.source_fingerprint=` + integrationOperationCutoverFingerprintSQL + `
				  )`,
			reviewRequired: true,
		},
		{
			code:           "pending_notification_deliveries",
			query:          `SELECT COUNT(*) FROM portal_notification_deliveries WHERE status='pending'`,
			reviewRequired: true,
		},
		{
			code: "failed_notification_deliveries",
			query: `SELECT COUNT(*) FROM portal_notification_deliveries pnd
				WHERE pnd.status='failed'
				  AND NOT EXISTS (
				    SELECT 1 FROM console_cutover_dispositions d
				     WHERE d.category='` + cutoverDispositionNotification + `'
				       AND d.subject_key=CAST(pnd.id AS CHAR)
				       AND d.status='active'
				       AND d.source_fingerprint=` + notificationDeliveryCutoverFingerprintSQL + `
				  )`,
			reviewRequired: true,
		},
		{
			code: "incomplete_directory_sync_jobs",
			query: `SELECT COUNT(*) FROM directory_sync_jobs dsj
				WHERE dsj.status IN ('pending','running','partial_success','failed')
				  AND NOT EXISTS (
				    SELECT 1 FROM console_cutover_dispositions d
				     WHERE d.category='` + cutoverDispositionDirectorySync + `'
				       AND d.subject_key=dsj.job_code
				       AND d.status='active'
				       AND d.source_fingerprint=` + directorySyncJobCutoverFingerprintSQL + `
				  )`,
			reviewRequired: true,
		},
		{
			code: "effective_integration_operation_dispositions",
			query: `SELECT COUNT(*) FROM integration_operation io
				INNER JOIN console_cutover_dispositions d
				  ON d.category='` + cutoverDispositionIntegration + `'
				 AND d.subject_key=io.operation_id
				 AND d.status='active'
				 AND d.source_fingerprint=` + integrationOperationCutoverFingerprintSQL + `
				WHERE io.status IN ('failed','failed_permanent','dead_letter')`,
			reviewRequired: false,
		},
		{
			code: "effective_notification_delivery_dispositions",
			query: `SELECT COUNT(*) FROM portal_notification_deliveries pnd
				INNER JOIN console_cutover_dispositions d
				  ON d.category='` + cutoverDispositionNotification + `'
				 AND d.subject_key=CAST(pnd.id AS CHAR)
				 AND d.status='active'
				 AND d.source_fingerprint=` + notificationDeliveryCutoverFingerprintSQL + `
				WHERE pnd.status='failed'`,
			reviewRequired: false,
		},
		{
			code: "effective_directory_sync_dispositions",
			query: `SELECT COUNT(*) FROM directory_sync_jobs dsj
				INNER JOIN console_cutover_dispositions d
				  ON d.category='` + cutoverDispositionDirectorySync + `'
				 AND d.subject_key=dsj.job_code
				 AND d.status='active'
				 AND d.source_fingerprint=` + directorySyncJobCutoverFingerprintSQL + `
				WHERE dsj.status IN ('pending','running','partial_success','failed')`,
			reviewRequired: false,
		},
		{
			code:           "pending_user_actionables",
			query:          `SELECT COUNT(*) FROM portal_actionable_projections WHERE state='pending'`,
			reviewRequired: false,
		},
	}
}
