package people

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const maxEmployeeArchiveImportItems = 1000

type employeePrivateFieldSpec struct {
	Code       string
	Aliases    []string
	Date       bool
	AllowMonth bool
}

var employeePrivateFieldSpecs = []employeePrivateFieldSpec{
	{Code: "id_number", Aliases: []string{"id_number", "idNumber", "identity_number", "identityNumber", "idCardNo", "身份证号"}},
	{Code: "birth_date", Aliases: []string{"birth_date", "birthDate", "birthday", "date_of_birth", "dateOfBirth", "出生日期"}, Date: true},
	{Code: "education_level", Aliases: []string{"education_level", "educationLevel", "education", "学历"}},
	{Code: "major", Aliases: []string{"major", "专业"}},
	{Code: "graduation_school", Aliases: []string{"graduation_school", "graduationSchool", "school", "毕业学校", "毕业院校"}},
	{Code: "graduation_date", Aliases: []string{"graduation_date", "graduationDate", "graduation", "毕业时间", "毕业日期"}, Date: true, AllowMonth: true},
}

var employeeIDNumberPattern = regexp.MustCompile(`^[0-9]{17}[0-9X]$`)

func normalizeEmployeePrivateValue(spec employeePrivateFieldSpec, value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if spec.Date {
		value = normalizeDirectoryDate(value)
		if value == "" {
			return "", employeePrivateDateError(spec)
		}
		layout := "2006-01-02"
		if spec.AllowMonth && len(value) == len("2006-01") {
			layout = "2006-01"
		}
		if _, err := time.Parse(layout, value); err != nil {
			return "", employeePrivateDateError(spec)
		}
	}
	if spec.Code == "id_number" {
		value = strings.ToUpper(strings.ReplaceAll(value, " ", ""))
		if !employeeIDNumberPattern.MatchString(value) {
			return "", httperror.New(http.StatusBadRequest, "people_employee_id_number_invalid", "id_number must be an 18-character PRC identity number")
		}
	}
	if utf8.RuneCountInString(value) > 255 {
		return "", httperror.New(http.StatusBadRequest, "people_employee_private_value_too_long", spec.Code+" exceeds 255 characters")
	}
	return value, nil
}

func employeePrivateDateError(spec employeePrivateFieldSpec) error {
	format := "YYYY-MM-DD"
	if spec.AllowMonth {
		format = "YYYY-MM or YYYY-MM-DD"
	}
	return httperror.New(http.StatusBadRequest, "people_employee_private_date_invalid", spec.Code+" must use "+format)
}

func employeePrivateFieldInput(body map[string]any, spec employeePrivateFieldSpec) (string, bool) {
	for _, key := range spec.Aliases {
		value, ok := body[key]
		if ok {
			return cleanAnyString(value), true
		}
	}
	return "", false
}

// publicDirectoryEmployeeSnapshot prevents source-private HR facts from leaking
// through people_employees.metadata and the generic employees:view contract.
func publicDirectoryEmployeeSnapshot(item map[string]any) map[string]any {
	result := make(map[string]any, len(item))
	for key, value := range item {
		result[key] = value
	}
	for _, spec := range employeePrivateFieldSpecs {
		for _, alias := range spec.Aliases {
			delete(result, alias)
		}
	}
	return result
}

func maskEmployeeIDNumber(value string) string {
	value = strings.TrimSpace(value)
	if len(value) < 10 {
		return "****"
	}
	return value[:6] + "********" + value[len(value)-4:]
}

func privateSourcePriority(source string) int {
	switch source {
	case "dingtalk":
		return 3
	case "manual":
		return 2
	case "oa_archive":
		return 1
	default:
		return 0
	}
}

func (a *Adapter) employeePrivateProfile(ctx context.Context, employeeUID string, query url.Values) (map[string]any, error) {
	var foundEmployeeUID, deptCode string
	if err := a.DB().QueryRowContext(ctx, `
		SELECT employee_uid,COALESCE(dept_code,'')
		FROM people_employees
		WHERE employee_uid=? AND archived_at IS NULL
	`, employeeUID).Scan(&foundEmployeeUID, &deptCode); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "people_employee_not_found", "employee not found")
		}
		return nil, err
	}
	if err := requireEmployeeRecordQueryAccess(query, map[string]any{
		"employee_uid": foundEmployeeUID,
		"dept_code":    deptCode,
	}); err != nil {
		return nil, err
	}

	rows, err := a.queryMaps(ctx, `
		SELECT field_code,source_code,value_text,source_updated_at,updated_at
		FROM people_employee_private_facts
		WHERE employee_uid=?
		ORDER BY field_code,
			CASE source_code WHEN 'dingtalk' THEN 1 WHEN 'manual' THEN 2 ELSE 3 END,
			updated_at DESC
	`, employeeUID)
	if err != nil {
		return nil, err
	}

	fields := make(map[string]any, len(employeePrivateFieldSpecs))
	selected := make(map[string]int, len(employeePrivateFieldSpecs))
	for _, row := range rows {
		field := cleanAnyString(row["field_code"])
		source := cleanAnyString(row["source_code"])
		priority := privateSourcePriority(source)
		if priority == 0 || selected[field] >= priority {
			continue
		}
		value := cleanAnyString(row["value_text"])
		if field == "id_number" {
			value = maskEmployeeIDNumber(value)
		}
		fields[field] = map[string]any{
			"value":       value,
			"source":      source,
			"editable":    source != "dingtalk",
			"has_value":   value != "",
			"updated_at":  row["updated_at"],
			"source_time": row["source_updated_at"],
		}
		selected[field] = priority
	}
	for _, spec := range employeePrivateFieldSpecs {
		if _, ok := fields[spec.Code]; !ok {
			fields[spec.Code] = map[string]any{"value": "", "source": nil, "editable": true, "has_value": false}
		}
	}
	return map[string]any{"employee_uid": employeeUID, "fields": fields}, nil
}

func upsertEmployeePrivateFact(ctx context.Context, tx *sql.Tx, employeeUID, field, source, value, sourceBizID, sourceUpdatedAt, actor string) error {
	if value == "" {
		_, err := tx.ExecContext(ctx, `DELETE FROM people_employee_private_facts WHERE employee_uid=? AND field_code=? AND source_code=?`, employeeUID, field, source)
		return err
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO people_employee_private_facts (
			employee_uid,field_code,source_code,value_text,source_biz_id,source_updated_at,created_by,updated_by
		) VALUES (?,?,?,?,NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''))
		ON DUPLICATE KEY UPDATE
			value_text=VALUES(value_text),
			source_biz_id=COALESCE(VALUES(source_biz_id),source_biz_id),
			source_updated_at=COALESCE(VALUES(source_updated_at),source_updated_at),
			updated_by=COALESCE(VALUES(updated_by),updated_by),
			updated_at=NOW()
	`, employeeUID, field, source, value, sourceBizID, sourceUpdatedAt, actor, actor)
	return err
}

func (a *Adapter) updateEmployeePrivateProfile(ctx context.Context, employeeUID string, query url.Values, body map[string]any, actor string) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var lockedEmployeeUID, deptCode string
	if err = tx.QueryRowContext(ctx, `SELECT employee_uid,COALESCE(dept_code,'') FROM people_employees WHERE employee_uid=? AND archived_at IS NULL FOR UPDATE`, employeeUID).Scan(&lockedEmployeeUID, &deptCode); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "people_employee_not_found", "employee not found")
		}
		return nil, err
	}
	if lockedEmployeeUID == "" {
		return nil, httperror.New(http.StatusNotFound, "people_employee_not_found", "employee not found")
	}
	if err = requireEmployeeRecordQueryAccess(query, map[string]any{
		"employee_uid": lockedEmployeeUID,
		"dept_code":    deptCode,
	}); err != nil {
		return nil, err
	}

	updated := 0
	for _, spec := range employeePrivateFieldSpecs {
		raw, present := employeePrivateFieldInput(body, spec)
		if !present {
			continue
		}
		value, normalizeErr := normalizeEmployeePrivateValue(spec, raw)
		if normalizeErr != nil {
			return nil, normalizeErr
		}
		var dingtalkCount int
		if err = tx.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM people_employee_private_facts
			WHERE employee_uid=? AND field_code=? AND source_code='dingtalk' AND value_text<>''
		`, employeeUID, spec.Code).Scan(&dingtalkCount); err != nil {
			return nil, err
		}
		if dingtalkCount > 0 {
			return nil, httperror.New(http.StatusConflict, "people_employee_private_field_owned_by_dingtalk", spec.Code+" is managed by DingTalk")
		}
		if err = upsertEmployeePrivateFact(ctx, tx, employeeUID, spec.Code, "manual", value, "", "", actor); err != nil {
			return nil, err
		}
		updated++
	}
	if updated == 0 {
		return nil, httperror.New(http.StatusBadRequest, "people_employee_private_fields_empty", "no supported private profile fields were provided")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return a.employeePrivateProfile(ctx, employeeUID, query)
}

func (a *Adapter) syncDingTalkPrivateFacts(ctx context.Context, tx *sql.Tx, employeeUID, sourceBizID string, item map[string]any, fieldStatus *directoryFieldStatusCounter) error {
	for _, spec := range employeePrivateFieldSpecs {
		raw, fieldPresent := employeePrivateFieldInput(item, spec)
		if spec.Date {
			normalized := normalizeDirectoryDate(raw)
			fieldStatus.observeDate(spec.Code, item, raw, normalized, spec.Aliases)
			if !fieldPresent || raw != "" && normalized == "" {
				continue
			}
			raw = normalized
		} else {
			fieldStatus.observe(spec.Code, item, raw, spec.Aliases)
			if !fieldPresent {
				continue
			}
		}
		value, normalizeErr := normalizeEmployeePrivateValue(spec, raw)
		if normalizeErr != nil {
			// Provider 的单个无效私密字段不能使整批组织同步失败；保留旧事实。
			continue
		}
		if err := upsertEmployeePrivateFact(ctx, tx, employeeUID, spec.Code, "dingtalk", value, sourceBizID, "", "dingtalk"); err != nil {
			return err
		}
	}
	return nil
}

type employeeArchiveMatch struct {
	UID       string
	MatchedBy string
	Ambiguous bool
}

func uniqueEmployeeArchiveMatch(ctx context.Context, tx *sql.Tx, query string, args ...any) (employeeArchiveMatch, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return employeeArchiveMatch{}, err
	}
	defer rows.Close()
	uids := make([]string, 0, 2)
	for rows.Next() {
		var uid string
		if err = rows.Scan(&uid); err != nil {
			return employeeArchiveMatch{}, err
		}
		uids = append(uids, uid)
	}
	if err = rows.Err(); err != nil {
		return employeeArchiveMatch{}, err
	}
	if len(uids) == 1 {
		return employeeArchiveMatch{UID: uids[0]}, nil
	}
	return employeeArchiveMatch{Ambiguous: len(uids) > 1}, nil
}

func resolveEmployeeArchiveMatch(ctx context.Context, tx *sql.Tx, item map[string]any, sourceNameCount int) (employeeArchiveMatch, error) {
	dingID := cleanBodyString(item, "ding_id", "dingId")
	if dingID != "" {
		match, err := uniqueEmployeeArchiveMatch(ctx, tx, `
			SELECT employee_uid FROM people_employees
			WHERE archived_at IS NULL AND (
				JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.directory_user.provider_subject'))=? OR
				JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.directory_user.providerSubject'))=?
			) LIMIT 2
		`, dingID, dingID)
		if err != nil || match.UID != "" || match.Ambiguous {
			match.MatchedBy = "dingtalk_id"
			return match, err
		}
	}
	mobile := cleanBodyString(item, "mobile", "mobile_number", "mobileNumber")
	if mobile != "" {
		match, err := uniqueEmployeeArchiveMatch(ctx, tx, `
			SELECT employee_uid FROM people_employees
			WHERE archived_at IS NULL AND REGEXP_REPLACE(COALESCE(mobile,''),'[^0-9]','')=? LIMIT 2
		`, mobile)
		if err != nil || match.UID != "" || match.Ambiguous {
			match.MatchedBy = "mobile"
			return match, err
		}
	}
	name := cleanBodyString(item, "name", "display_name", "displayName")
	if name != "" && sourceNameCount == 1 {
		match, err := uniqueEmployeeArchiveMatch(ctx, tx, `
			SELECT employee_uid FROM people_employees
			WHERE archived_at IS NULL AND display_name=? LIMIT 2
		`, name)
		match.MatchedBy = "unique_name"
		return match, err
	}
	return employeeArchiveMatch{}, nil
}

func (a *Adapter) importEmployeeArchive(ctx context.Context, body map[string]any, actor string) (map[string]any, error) {
	items, ok := itemsFromBody(body)
	if !ok || len(items) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "people_employee_archive_empty", "employee archive items cannot be empty")
	}
	if len(items) > maxEmployeeArchiveImportItems {
		return nil, httperror.New(http.StatusRequestEntityTooLarge, "people_employee_archive_too_large", "employee archive import supports at most 1000 rows")
	}
	dryRun := isExplicitTrue(firstNonNil(body["dry_run"], body["dryRun"]))
	nameCounts := make(map[string]int)
	for _, item := range items {
		name := cleanBodyString(item, "name", "display_name", "displayName")
		if name != "" {
			nameCounts[name]++
		}
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	matched, profilesUpdated, factsUpdated, onboardBackfilled := 0, 0, 0, 0
	diagnostics := make([]map[string]any, 0)
	for index, item := range items {
		name := cleanBodyString(item, "name", "display_name", "displayName")
		rowNumber := intValue(firstNonNil(item["row_number"], item["rowNumber"]))
		if rowNumber == 0 {
			rowNumber = index + 2
		}
		match, matchErr := resolveEmployeeArchiveMatch(ctx, tx, item, nameCounts[name])
		if matchErr != nil {
			return nil, matchErr
		}
		if match.UID == "" {
			reason := "not_matched"
			if match.Ambiguous {
				reason = "ambiguous_" + match.MatchedBy
			} else if nameCounts[name] > 1 {
				reason = "duplicate_source_name"
			}
			diagnostics = append(diagnostics, map[string]any{"row_number": rowNumber, "name": name, "reason": reason})
			continue
		}
		matched++
		rowFacts := 0
		for _, spec := range employeePrivateFieldSpecs {
			raw, present := employeePrivateFieldInput(item, spec)
			if !present || strings.TrimSpace(raw) == "" {
				continue
			}
			value, normalizeErr := normalizeEmployeePrivateValue(spec, raw)
			if normalizeErr != nil {
				diagnostics = append(diagnostics, map[string]any{"row_number": rowNumber, "name": name, "reason": "invalid_" + spec.Code})
				continue
			}
			if !dryRun {
				if err = upsertEmployeePrivateFact(ctx, tx, match.UID, spec.Code, "oa_archive", value,
					cleanBodyString(item, "source_biz_id", "sourceBizId"), cleanBodyString(item, "source_updated_at", "sourceUpdatedAt"), actor); err != nil {
					return nil, err
				}
			}
			rowFacts++
			factsUpdated++
		}
		if rowFacts > 0 {
			profilesUpdated++
		}
		hireDate := normalizeDirectoryDate(cleanBodyString(item, "hire_date", "hireDate", "onboard_date", "onboardDate"))
		if hireDate != "" {
			if _, parseErr := time.Parse("2006-01-02", hireDate); parseErr == nil {
				if dryRun {
					var missing int
					if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM people_employees WHERE employee_uid=? AND (onboard_date IS NULL OR onboard_date='1970-01-01')`, match.UID).Scan(&missing); err != nil {
						return nil, err
					}
					onboardBackfilled += missing
				} else {
					result, updateErr := tx.ExecContext(ctx, `
						UPDATE people_employees SET onboard_date=?,onboard_date_source='oa_archive',updated_by=?,updated_at=NOW()
						WHERE employee_uid=? AND (onboard_date IS NULL OR onboard_date='1970-01-01')
					`, hireDate, actor, match.UID)
					if updateErr != nil {
						return nil, updateErr
					}
					if affected, affectedErr := result.RowsAffected(); affectedErr == nil {
						onboardBackfilled += int(affected)
					}
				}
			}
		}
	}
	if dryRun {
		if err = tx.Rollback(); err != nil {
			return nil, err
		}
	} else if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"dry_run":            dryRun,
		"total":              len(items),
		"matched":            matched,
		"skipped":            len(items) - matched,
		"profiles_updated":   profilesUpdated,
		"facts_updated":      factsUpdated,
		"onboard_backfilled": onboardBackfilled,
		"diagnostics":        diagnostics,
	}, nil
}

func (a *Adapter) rejectDingTalkOnboardOverride(ctx context.Context, method, path string, body map[string]any) error {
	if body == nil || (method != http.MethodPatch && method != http.MethodPut) {
		return nil
	}
	trimmed := strings.TrimRight(path, "/")
	if !strings.HasPrefix(trimmed, "/v1/people/employees/") {
		return nil
	}
	employeeUID := strings.TrimPrefix(trimmed, "/v1/people/employees/")
	if !singleSegment(employeeUID) {
		return nil
	}
	hasDate := false
	for _, key := range []string{"onboard_date", "onboardDate"} {
		if _, ok := body[key]; ok {
			hasDate = true
			break
		}
	}
	if !hasDate {
		return nil
	}
	var source sql.NullString
	if err := a.DB().QueryRowContext(ctx, `SELECT onboard_date_source FROM people_employees WHERE employee_uid=? AND archived_at IS NULL`, employeeUID).Scan(&source); err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return err
	}
	if source.Valid && source.String == "dingtalk" {
		return httperror.New(http.StatusConflict, "people_employee_onboard_date_owned_by_dingtalk", "onboard_date is managed by DingTalk")
	}
	return nil
}

func employeePrivateProfilePath(path string) (string, bool) {
	trimmed := strings.TrimRight(path, "/")
	if !strings.HasPrefix(trimmed, "/v1/people/employees/") || !strings.HasSuffix(trimmed, "/private-profile") {
		return "", false
	}
	employeeUID := strings.TrimSuffix(strings.TrimPrefix(trimmed, "/v1/people/employees/"), "/private-profile")
	return employeeUID, singleSegment(employeeUID)
}

func (a *Adapter) handleEmployeePrivateFactsRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if employeeUID, matched := employeePrivateProfilePath(path); matched {
		if err := requireEmployeeQueryAccess(query); err != nil {
			return nil, "people.employee_private_profile.access", true, err
		}
		switch method {
		case http.MethodGet:
			result, err := a.employeePrivateProfile(ctx, employeeUID, query)
			return result, "people.employee_private_profile.get", true, err
		case http.MethodPatch:
			result, err := a.updateEmployeePrivateProfile(ctx, employeeUID, query, body, peopleRuntimeActorFromRequest(query, body))
			return result, "people.employee_private_profile.update", true, err
		default:
			return nil, "people.employee_private_profile.method", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		}
	}
	if strings.TrimRight(path, "/") == "/v1/people/employee-private-profiles:import" {
		if method != http.MethodPost {
			return nil, "people.employee_archive_import.method", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		}
		if err := requireEmployeeGlobalAccess(query); err != nil {
			return nil, "people.employee_archive_import.access", true, err
		}
		result, err := a.importEmployeeArchive(ctx, body, peopleRuntimeActorFromRequest(query, body))
		return result, "people.employee_archive_import", true, err
	}
	return nil, "", false, nil
}
