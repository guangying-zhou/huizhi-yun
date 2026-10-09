package directory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type dingTalkLegacyDepartment struct {
	externalID string
	code       string
	name       string
	parentCode string
	members    int
}

type dingTalkCanonicalDepartment struct {
	code       string
	name       string
	parentCode string
}

func (a *Adapter) ConsolePreviewDingTalkDepartmentMappings(ctx context.Context) (map[string]any, error) {
	legacyRows, err := a.db.QueryContext(ctx, `SELECT d.dept_code,d.dept_name,COALESCE(d.parent_dept_code,''),d.external_ref,
		(SELECT COUNT(*) FROM directory_user_departments memberships
		 WHERE memberships.dept_code=d.dept_code AND memberships.status='active')
		FROM directory_departments d
		WHERE d.source_provider='dingtalk' AND d.external_ref LIKE 'dingtalk:department:%'
			AND d.status<>'deleted' ORDER BY d.level_no,d.sort_order,d.id`)
	if err != nil {
		return nil, err
	}
	legacy := make([]dingTalkLegacyDepartment, 0)
	legacyByCode := map[string]dingTalkLegacyDepartment{}
	for legacyRows.Next() {
		var item dingTalkLegacyDepartment
		var externalRef string
		if err = legacyRows.Scan(&item.code, &item.name, &item.parentCode, &externalRef, &item.members); err != nil {
			_ = legacyRows.Close()
			return nil, err
		}
		item.externalID = strings.TrimPrefix(externalRef, "dingtalk:department:")
		if item.externalID == "" || item.externalID == externalRef {
			continue
		}
		legacy = append(legacy, item)
		legacyByCode[item.code] = item
	}
	if err = legacyRows.Close(); err != nil {
		return nil, err
	}

	canonicalRows, err := a.db.QueryContext(ctx, `SELECT dept_code,dept_name,COALESCE(parent_dept_code,'')
		FROM directory_departments
		WHERE org_type='department' AND status='active'
			AND NOT (source_provider='dingtalk' AND external_ref LIKE 'dingtalk:department:%')
		ORDER BY level_no,sort_order,id`)
	if err != nil {
		return nil, err
	}
	canonical := make([]dingTalkCanonicalDepartment, 0)
	for canonicalRows.Next() {
		var item dingTalkCanonicalDepartment
		if err = canonicalRows.Scan(&item.code, &item.name, &item.parentCode); err != nil {
			_ = canonicalRows.Close()
			return nil, err
		}
		canonical = append(canonical, item)
	}
	if err = canonicalRows.Close(); err != nil {
		return nil, err
	}

	resolved := map[string]string{}
	identityRows, err := a.db.QueryContext(ctx, `SELECT external_department_id,dept_code
		FROM directory_department_identities WHERE provider_code='dingtalk' AND status='active'`)
	if err != nil {
		return nil, err
	}
	for identityRows.Next() {
		var externalID, code string
		if err = identityRows.Scan(&externalID, &code); err != nil {
			_ = identityRows.Close()
			return nil, err
		}
		resolved[externalID] = code
	}
	if err = identityRows.Close(); err != nil {
		return nil, err
	}

	aliasRows, err := a.db.QueryContext(ctx, `SELECT alias.alias_dept_code,alias.canonical_dept_code
		FROM directory_department_aliases alias WHERE alias.provider_code='dingtalk' AND alias.status='active'`)
	if err != nil {
		return nil, err
	}
	for aliasRows.Next() {
		var aliasCode, targetCode string
		if err = aliasRows.Scan(&aliasCode, &targetCode); err != nil {
			_ = aliasRows.Close()
			return nil, err
		}
		if item, ok := legacyByCode[aliasCode]; ok && resolved[item.externalID] == "" {
			resolved[item.externalID] = targetCode
		}
	}
	if err = aliasRows.Close(); err != nil {
		return nil, err
	}

	// Unique suggestions may unlock child suggestions in the next pass. They
	// remain suggestions only; apply still requires an explicit admin decision.
	suggestions := map[string]string{}
	conflicts := map[string][]string{}
	for pass := 0; pass <= len(legacy); pass++ {
		changed := false
		for _, item := range legacy {
			if resolved[item.externalID] != "" || suggestions[item.externalID] != "" || len(conflicts[item.externalID]) > 0 {
				continue
			}
			parentTarget := ""
			if item.parentCode != "" {
				parent, ok := legacyByCode[item.parentCode]
				if !ok {
					continue
				}
				parentTarget = resolved[parent.externalID]
				if parentTarget == "" {
					parentTarget = suggestions[parent.externalID]
				}
				if parentTarget == "" {
					continue
				}
			}
			matches := make([]string, 0, 2)
			for _, candidate := range canonical {
				if candidate.name == item.name && candidate.parentCode == parentTarget {
					matches = append(matches, candidate.code)
				}
			}
			if len(matches) == 1 {
				suggestions[item.externalID] = matches[0]
				changed = true
			} else if len(matches) > 1 {
				sort.Strings(matches)
				conflicts[item.externalID] = matches
			}
		}
		if !changed {
			break
		}
	}

	items := make([]map[string]any, 0, len(legacy))
	departments := make([]map[string]any, 0, len(canonical))
	for _, item := range canonical {
		departments = append(departments, map[string]any{
			"deptCode":       item.code,
			"departmentName": item.name,
			"parentDeptCode": item.parentCode,
		})
	}
	totals := map[string]int{"total": len(legacy), "mapped": 0, "suggested": 0, "conflict": 0, "unmatched": 0}
	for _, item := range legacy {
		state := "unmatched"
		targetCode := resolved[item.externalID]
		candidates := []string{}
		if targetCode != "" {
			state = "mapped"
		} else if suggestions[item.externalID] != "" {
			state = "suggested"
			targetCode = suggestions[item.externalID]
		} else if len(conflicts[item.externalID]) > 0 {
			state = "conflict"
			candidates = conflicts[item.externalID]
		}
		totals[state]++
		parentExternalID := ""
		if parent, ok := legacyByCode[item.parentCode]; ok {
			parentExternalID = parent.externalID
		}
		items = append(items, map[string]any{
			"externalDepartmentId": item.externalID,
			"legacyDeptCode":       item.code,
			"departmentName":       item.name,
			"parentExternalId":     parentExternalID,
			"activeMemberCount":    item.members,
			"state":                state,
			"suggestedDeptCode":    targetCode,
			"candidateDeptCodes":   candidates,
		})
	}
	return map[string]any{"items": items, "departments": departments, "totals": totals}, nil
}

func (a *Adapter) ConsoleApplyDingTalkDepartmentMappings(
	ctx context.Context,
	body map[string]any,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	if envelope := object(body["serviceCommand"]); len(envelope) > 0 {
		body = object(envelope["command"])
	}
	rawMappings, ok := body["mappings"].([]any)
	if !ok || len(rawMappings) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "dingtalk_department_mappings_required", "At least one DingTalk department mapping is required")
	}
	if len(rawMappings) > 500 {
		return nil, httperror.New(http.StatusRequestEntityTooLarge, "dingtalk_department_mappings_too_large", "At most 500 DingTalk department mappings may be applied at once")
	}
	payload := map[string]any{"mappings": rawMappings}
	session, replay, err := a.beginConsoleMutation(ctx, "directory.dingtalk-department-mappings.apply", meta, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()

	type appliedMapping struct {
		externalID string
		legacyCode string
		targetCode string
	}
	applied := make([]appliedMapping, 0, len(rawMappings))
	seen := map[string]bool{}
	for _, raw := range rawMappings {
		mapping := object(raw)
		externalID := text(mapping["externalDepartmentId"])
		targetCode := text(mapping["canonicalDeptCode"])
		if externalID == "" || targetCode == "" || len(externalID) > 255 || len(targetCode) > 64 {
			return nil, httperror.New(http.StatusBadRequest, "dingtalk_department_mapping_invalid", "DingTalk department mapping identity is invalid")
		}
		if seen[externalID] {
			return nil, httperror.New(http.StatusBadRequest, "dingtalk_department_mapping_duplicate", "DingTalk department mapping contains a duplicate external identity")
		}
		seen[externalID] = true

		var legacyCode string
		if err = session.tx.QueryRowContext(ctx, `SELECT dept_code FROM directory_departments
			WHERE source_provider='dingtalk' AND external_ref=? AND status<>'deleted' LIMIT 1 FOR UPDATE`,
			dingTalkDepartmentRef(externalID)).Scan(&legacyCode); errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(http.StatusNotFound, "dingtalk_legacy_department_not_found", "Legacy DingTalk department was not found")
		} else if err != nil {
			return nil, err
		}
		var targetStatus, targetType, targetSourceProvider, targetExternalRef string
		if err = session.tx.QueryRowContext(ctx, `SELECT status,org_type,COALESCE(source_provider,''),COALESCE(external_ref,'') FROM directory_departments
			WHERE dept_code=? LIMIT 1 FOR UPDATE`, targetCode).
			Scan(&targetStatus, &targetType, &targetSourceProvider, &targetExternalRef); errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(http.StatusNotFound, "dingtalk_canonical_department_not_found", "Canonical department was not found")
		} else if err != nil {
			return nil, err
		}
		if legacyCode == targetCode || targetStatus != "active" || targetType != "department" ||
			(strings.EqualFold(strings.TrimSpace(targetSourceProvider), "dingtalk") &&
				strings.HasPrefix(strings.TrimSpace(targetExternalRef), "dingtalk:department:")) {
			return nil, httperror.New(http.StatusConflict, "dingtalk_canonical_department_invalid", "DingTalk mapping target must be a different active formal department")
		}
		var mappedCode string
		mapErr := session.tx.QueryRowContext(ctx, `SELECT dept_code FROM directory_department_identities
			WHERE provider_code='dingtalk' AND external_department_id=? LIMIT 1 FOR UPDATE`, externalID).Scan(&mappedCode)
		if mapErr == nil && mappedCode != targetCode {
			return nil, httperror.New(http.StatusConflict, "dingtalk_department_mapping_immutable", "DingTalk department identity is already mapped to another canonical department")
		}
		if mapErr != nil && !errors.Is(mapErr, sql.ErrNoRows) {
			return nil, mapErr
		}
		if errors.Is(mapErr, sql.ErrNoRows) {
			var existingExternalID string
			targetMapErr := session.tx.QueryRowContext(ctx, `SELECT external_department_id FROM directory_department_identities
				WHERE provider_code='dingtalk' AND dept_code=? AND status='active' LIMIT 1 FOR UPDATE`, targetCode).Scan(&existingExternalID)
			if targetMapErr == nil && existingExternalID != externalID {
				return nil, httperror.New(http.StatusConflict, "dingtalk_canonical_department_already_mapped", "Canonical department already has another active DingTalk identity")
			}
			if targetMapErr != nil && !errors.Is(targetMapErr, sql.ErrNoRows) {
				return nil, targetMapErr
			}
			if _, err = session.tx.ExecContext(ctx, `INSERT INTO directory_department_identities
				(provider_code,external_department_id,dept_code,mapping_origin,first_seen_at,last_seen_at,status,
				 created_by_uid,updated_by_uid,created_at,updated_at)
				VALUES ('dingtalk',?,?,'migration_confirmed',UTC_TIMESTAMP(),UTC_TIMESTAMP(),'active',?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
				externalID, targetCode, session.actorID, session.actorID); err != nil {
				return nil, err
			}
		} else if _, err = session.tx.ExecContext(ctx, `UPDATE directory_department_identities
			SET status='active',mapping_origin='migration_confirmed',last_seen_at=UTC_TIMESTAMP(),
				updated_by_uid=?,updated_at=UTC_TIMESTAMP()
			WHERE provider_code='dingtalk' AND external_department_id=? AND dept_code=?`,
			session.actorID, externalID, targetCode); err != nil {
			return nil, err
		}

		if _, err = session.tx.ExecContext(ctx, `INSERT INTO directory_user_departments
			(uid,dept_code,relation_type,is_primary,source_provider,external_ref,joined_at,left_at,status,created_at,updated_at)
			SELECT legacy_membership.uid,?,legacy_membership.relation_type,legacy_membership.is_primary,
				legacy_membership.source_provider,
				CONCAT(legacy_membership.uid,':',? ,':',legacy_membership.relation_type),
				legacy_membership.joined_at,NULL,'active',legacy_membership.created_at,UTC_TIMESTAMP()
			FROM directory_user_departments AS legacy_membership
			WHERE legacy_membership.dept_code=? AND legacy_membership.status='active'
			ON DUPLICATE KEY UPDATE
				is_primary=GREATEST(directory_user_departments.is_primary,VALUES(is_primary)),
				status='active',left_at=NULL,
				source_provider=IF(directory_user_departments.source_provider='people' OR VALUES(source_provider)='people','people',directory_user_departments.source_provider),
				updated_at=UTC_TIMESTAMP()`, targetCode, targetCode, legacyCode); err != nil {
			return nil, err
		}
		if _, err = session.tx.ExecContext(ctx, `UPDATE directory_user_departments
			SET is_primary=0,status='active',left_at=NULL,updated_at=UTC_TIMESTAMP()
			WHERE dept_code=? AND status='active'`, legacyCode); err != nil {
			return nil, err
		}
		if _, err = session.tx.ExecContext(ctx, `UPDATE directory_users
			SET primary_dept_code=?,updated_at=UTC_TIMESTAMP()
			WHERE primary_dept_code=?`, targetCode, legacyCode); err != nil {
			return nil, err
		}
		var existingAliasTarget string
		aliasErr := session.tx.QueryRowContext(ctx, `SELECT canonical_dept_code FROM directory_department_aliases
			WHERE alias_dept_code=? LIMIT 1 FOR UPDATE`, legacyCode).Scan(&existingAliasTarget)
		if aliasErr == nil && existingAliasTarget != targetCode {
			return nil, httperror.New(http.StatusConflict, "dingtalk_department_alias_immutable", "Legacy DingTalk department alias is already mapped to another canonical department")
		}
		if aliasErr != nil && !errors.Is(aliasErr, sql.ErrNoRows) {
			return nil, aliasErr
		}
		if _, err = session.tx.ExecContext(ctx, `INSERT INTO directory_department_aliases
			(alias_dept_code,canonical_dept_code,provider_code,reason_code,migration_run_id,status,
			 created_by_uid,created_at,updated_at)
			VALUES (?,?,'dingtalk','duplicate_tree_migration',?,'active',?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
			ON DUPLICATE KEY UPDATE migration_run_id=VALUES(migration_run_id),
				status='active',updated_at=UTC_TIMESTAMP()`, legacyCode, targetCode, meta.IdempotencyKey, session.actorID); err != nil {
			return nil, err
		}
		if _, err = session.tx.ExecContext(ctx, `UPDATE directory_departments
			SET status='inactive',updated_at=UTC_TIMESTAMP() WHERE dept_code=?`, legacyCode); err != nil {
			return nil, err
		}
		if _, err = session.tx.ExecContext(ctx, `UPDATE directory_subject_exports
			SET status='active',updated_at=UTC_TIMESTAMP()
			WHERE source_object_type='directory_departments' AND source_object_code=?`, legacyCode); err != nil {
			return nil, err
		}
		if err = upsertConsoleDepartmentSubject(ctx, session.tx, targetCode); err != nil {
			return nil, err
		}
		applied = append(applied, appliedMapping{externalID: externalID, legacyCode: legacyCode, targetCode: targetCode})
	}
	if err = rebuildUserSubjectExportsWith(ctx, session.tx); err != nil {
		return nil, err
	}
	aliases := make([]map[string]any, 0, len(applied))
	for _, item := range applied {
		aliases = append(aliases, map[string]any{
			"externalDepartmentId": item.externalID,
			"aliasDeptCode":        item.legacyCode,
			"canonicalDeptCode":    item.targetCode,
		})
	}
	result = map[string]any{"code": 0, "data": map[string]any{"applied": len(applied), "aliases": aliases}}
	err = finishConsoleMutation(ctx, session, "directory.dingtalk-department-mappings.apply",
		"directory_department_mapping", fmt.Sprint(len(applied)), map[string]any{"count": len(applied)}, result)
	return result, err
}
