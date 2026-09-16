package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var managementFactDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func (a *Adapter) handleProjectManagementFactsRuntime(ctx context.Context, method, path string, query url.Values) (any, string, bool, error) {
	if path != "/v1/aims/service/project-management-facts" {
		return nil, "", false, nil
	}
	if method != http.MethodGet {
		return nil, "aims.project_management_facts.read", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
	data, err := a.projectManagementFacts(ctx, query)
	return data, "aims.project_management_facts.read", true, err
}

func (a *Adapter) projectManagementFacts(ctx context.Context, query url.Values) (map[string]any, error) {
	periodStart := strings.TrimSpace(query.Get("periodStart"))
	if periodStart == "" {
		periodStart = strings.TrimSpace(query.Get("period_start"))
	}
	periodEnd := strings.TrimSpace(query.Get("periodEnd"))
	if periodEnd == "" {
		periodEnd = strings.TrimSpace(query.Get("period_end"))
	}
	if (periodStart != "" && !managementFactDatePattern.MatchString(periodStart)) ||
		(periodEnd != "" && !managementFactDatePattern.MatchString(periodEnd)) ||
		(periodStart != "" && periodEnd != "" && periodEnd < periodStart) {
		return nil, httperror.New(http.StatusBadRequest, "management_fact_period_invalid", "periodStart and periodEnd must be a valid date range")
	}
	afterRevision, err := parseUnsignedQuery(query, "afterRevision", "after_revision")
	if err != nil {
		return nil, err
	}
	limit := uint64(200)
	if requested, err := parseUnsignedQuery(query, "limit"); err != nil {
		return nil, err
	} else if requested > 0 {
		limit = requested
	}
	if limit > 500 {
		return nil, httperror.New(http.StatusBadRequest, "management_fact_limit_invalid", "limit cannot exceed 500")
	}

	where := []string{"fact.revision > ?"}
	args := []any{afterRevision}
	if periodStart != "" {
		where = append(where, "period.week_end >= ?")
		args = append(args, periodStart)
	}
	if periodEnd != "" {
		where = append(where, "period.week_start <= ?")
		args = append(args, periodEnd)
	}
	projectCodes, err := splitManagementFactProjectCodes(query.Get("projectCodes"))
	if err != nil {
		return nil, err
	}
	if len(projectCodes) == 0 {
		projectCodes, err = splitManagementFactProjectCodes(query.Get("project_codes"))
		if err != nil {
			return nil, err
		}
	}
	if len(projectCodes) > 100 {
		return nil, httperror.New(http.StatusBadRequest, "management_fact_project_filter_invalid", "projectCodes cannot contain more than 100 values")
	}
	if len(projectCodes) > 0 {
		placeholders := make([]string, 0, len(projectCodes))
		for _, code := range projectCodes {
			placeholders = append(placeholders, "?")
			args = append(args, code)
		}
		where = append(where, "fact.project_code IN ("+strings.Join(placeholders, ",")+")")
	}
	args = append(args, limit+1)
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  fact.id, fact.revision, fact.fact_code, fact.period_key,
		  fact.subject_uid, fact.project_id, fact.project_code,
		  fact.value_json, fact.source_refs_json, fact.source_sha256,
		  fact.correction_of_id,
		  DATE_FORMAT(fact.created_at, '%Y-%m-%dT%H:%i:%s.%fZ')
		FROM project_management_fact_snapshots fact
		INNER JOIN weekly_reporting_periods period ON period.period_key = fact.period_key
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY fact.revision
		LIMIT ?
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]map[string]any, 0, limit)
	hasMore := false
	for rows.Next() {
		var (
			id, revision                              uint64
			factCode, periodKey, sourceSHA, createdAt string
			subjectUID, projectCode                   sql.NullString
			projectID, correctionOf                   sql.NullInt64
			valueRaw, sourceRefsRaw                   []byte
		)
		if err := rows.Scan(&id, &revision, &factCode, &periodKey, &subjectUID, &projectID, &projectCode, &valueRaw, &sourceRefsRaw, &sourceSHA, &correctionOf, &createdAt); err != nil {
			return nil, err
		}
		if uint64(len(items)) == limit {
			hasMore = true
			break
		}
		value, err := decodeManagementFactJSON(valueRaw)
		if err != nil {
			return nil, err
		}
		sourceRefs, err := decodeManagementFactJSON(sourceRefsRaw)
		if err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "revision": revision, "factCode": factCode, "periodKey": periodKey,
			"subjectUid": managementFactNullableString(subjectUID), "projectId": managementFactNullableInt64(projectID),
			"projectCode": managementFactNullableString(projectCode), "value": value, "sourceRefs": sourceRefs,
			"sourceSha256": sourceSHA, "correctionOfId": managementFactNullableInt64(correctionOf), "createdAt": createdAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	nextRevision := afterRevision
	if len(items) > 0 {
		nextRevision = items[len(items)-1]["revision"].(uint64)
	}
	return map[string]any{
		"items": items, "afterRevision": afterRevision, "nextRevision": nextRevision,
		"hasMore": hasMore, "limit": limit,
	}, nil
}

func parseUnsignedQuery(query url.Values, keys ...string) (uint64, error) {
	for _, key := range keys {
		value := strings.TrimSpace(query.Get(key))
		if value == "" {
			continue
		}
		parsed, err := strconv.ParseUint(value, 10, 64)
		if err != nil {
			return 0, httperror.New(http.StatusBadRequest, "management_fact_revision_invalid", key+" must be an unsigned integer")
		}
		return parsed, nil
	}
	return 0, nil
}

func splitManagementFactProjectCodes(raw string) ([]string, error) {
	seen := map[string]struct{}{}
	result := []string{}
	for _, value := range strings.Split(raw, ",") {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if len(value) > 50 {
			return nil, httperror.New(http.StatusBadRequest, "management_fact_project_filter_invalid", "project code exceeds 50 characters")
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result, nil
}

func decodeManagementFactJSON(raw []byte) (any, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	return value, nil
}

func managementFactNullableString(value sql.NullString) any {
	if value.Valid {
		return value.String
	}
	return nil
}

func managementFactNullableInt64(value sql.NullInt64) any {
	if value.Valid {
		return value.Int64
	}
	return nil
}
