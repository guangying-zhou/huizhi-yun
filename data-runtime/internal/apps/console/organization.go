package console

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var organizationCodePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`)

type businessDomain struct {
	ID          uint64  `json:"id"`
	CompanyCode *string `json:"companyCode"`
	DomainCode  string  `json:"domainCode"`
	DomainName  string  `json:"domainName"`
	Category    string  `json:"category"`
	AliasName   *string `json:"aliasName"`
	DisplayName string  `json:"displayName"`
	Source      string  `json:"source"`
	ParentCode  *string `json:"parentCode"`
	Description *string `json:"description"`
	SortOrder   int     `json:"sortOrder"`
	Status      int     `json:"status"`
	Revision    uint64  `json:"revision"`
}

type region struct {
	ID            uint64  `json:"id"`
	CompanyCode   *string `json:"companyCode"`
	RegionCode    string  `json:"regionCode"`
	RegionName    string  `json:"regionName"`
	Description   *string `json:"description"`
	SortOrder     int     `json:"sortOrder"`
	DivisionCount uint64  `json:"divisionCount"`
	Status        int     `json:"status"`
	Revision      uint64  `json:"revision"`
}

type division struct {
	ID              uint64  `json:"id"`
	DivisionCode    string  `json:"divisionCode"`
	DivisionName    *string `json:"divisionName"`
	IncludeChildren bool    `json:"includeChildren"`
}

type standardRegion struct {
	Code      string
	Name      string
	SortOrder int
	Divisions []string
}

var standardRegions = []standardRegion{
	{"NORTH_CHINA", "华北", 1, []string{"110000", "120000", "130000", "140000", "150000"}},
	{"NORTHEAST_CHINA", "东北", 2, []string{"210000", "220000", "230000"}},
	{"EAST_CHINA", "华东", 3, []string{"310000", "320000", "330000", "340000", "350000", "360000", "370000"}},
	{"SOUTH_CENTRAL_CHINA", "中南", 4, []string{"410000", "420000", "430000", "440000", "450000", "460000"}},
	{"SOUTHWEST_CHINA", "西南", 5, []string{"500000", "510000", "520000", "530000", "540000"}},
	{"NORTHWEST_CHINA", "西北", 6, []string{"610000", "620000", "630000", "640000", "650000"}},
	{"HK_MACAO_TAIWAN", "港澳台", 7, []string{"710000", "810000", "820000"}},
}

func (a *Adapter) BusinessDomains(ctx context.Context, query url.Values) (map[string]any, error) {
	conditions := []string{"1=1"}
	args := make([]any, 0, 6)
	status := strings.TrimSpace(query.Get("status"))
	if status == "" {
		status = "active"
	}
	if status != "all" {
		conditions = append(conditions, "d.status=?")
		args = append(args, status)
	}
	if category := strings.TrimSpace(query.Get("category")); category != "" {
		conditions = append(conditions, "d.category=?")
		args = append(args, category)
	}
	if search := strings.TrimSpace(firstValue(query.Get("search"), query.Get("keyword"))); search != "" {
		conditions = append(conditions, "(d.domain_code LIKE ? OR d.domain_name LIKE ?)")
		pattern := "%" + search + "%"
		args = append(args, pattern, pattern)
	}
	companyOnly := query.Get("companyOnly") == "1" || query.Get("companyOnly") == "true"
	if companyOnly {
		conditions = append(conditions, "(d.parent_id IS NOT NULL OR d.source='custom' OR d.domain_code NOT IN ('GOV','BIZ','CON'))")
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT d.id,d.domain_code,d.domain_name,d.category,d.alias_name,d.source,
			p.domain_code,d.description,d.sort_order,d.status,d.revision
		FROM org_business_domains d
		LEFT JOIN org_business_domains p ON p.id=d.parent_id
		WHERE `+strings.Join(conditions, " AND ")+`
		ORDER BY
			CASE COALESCE(p.domain_code,d.domain_code)
				WHEN 'GOV' THEN 1 WHEN 'BIZ' THEN 2 WHEN 'CON' THEN 3 ELSE 9
			END,
			d.sort_order,d.domain_code
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]businessDomain, 0)
	companyCode := strings.TrimSpace(query.Get("companyCode"))
	for rows.Next() {
		var item businessDomain
		var alias, parent, description sql.NullString
		var statusText string
		if err := rows.Scan(
			&item.ID, &item.DomainCode, &item.DomainName, &item.Category, &alias, &item.Source,
			&parent, &description, &item.SortOrder, &statusText, &item.Revision,
		); err != nil {
			return nil, err
		}
		item.AliasName = nullableString(alias)
		item.ParentCode = nullableString(parent)
		item.Description = nullableString(description)
		item.DisplayName = item.DomainName
		if item.AliasName != nil {
			item.DisplayName = *item.AliasName
		}
		if item.Source != "custom" {
			item.Source = "preset"
		}
		if statusText == "active" {
			item.Status = 1
		}
		if companyCode != "" {
			value := companyCode
			item.CompanyCode = &value
		}
		items = append(items, item)
	}
	return map[string]any{"code": 0, "data": items}, rows.Err()
}

func (a *Adapter) CreateBusinessDomains(ctx context.Context, body map[string]any, meta MutationMeta) (map[string]any, error) {
	rawDomains := []any{body}
	if values, ok := body["domains"].([]any); ok {
		rawDomains = values
	}
	if len(rawDomains) == 0 || len(rawDomains) > 100 {
		return nil, httperror.New(http.StatusBadRequest, "business_domain_batch_invalid", "Business domain batch must contain 1-100 items")
	}
	type createDomain struct {
		DomainCode string `json:"domainCode"`
		DomainName string `json:"domainName"`
		Category   string `json:"category"`
		Source     string `json:"source"`
		SortOrder  int    `json:"sortOrder"`
	}
	inputs := make([]createDomain, 0, len(rawDomains))
	for _, raw := range rawDomains {
		record, ok := raw.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "business_domain_invalid", "Business domain item must be an object")
		}
		code, err := validOrganizationCode(record["domainCode"], "domainCode")
		if err != nil {
			return nil, err
		}
		name := strings.TrimSpace(stringField(record["domainName"]))
		if name == "" || len(name) > 255 {
			return nil, httperror.New(http.StatusBadRequest, "business_domain_name_invalid", "Business domain name is required and must not exceed 255 characters")
		}
		category := strings.TrimSpace(stringField(record["category"]))
		if category == "" {
			category = "2B"
		}
		if category != "2G" && category != "2B" && category != "2C" {
			return nil, httperror.New(http.StatusBadRequest, "business_domain_category_invalid", "Business domain category must be 2G, 2B, or 2C")
		}
		source := "preset"
		if stringField(record["source"]) == "custom" {
			source = "custom"
		}
		inputs = append(inputs, createDomain{code, name, category, source, intField(record["sortOrder"], 100)})
	}
	session, replay, err := a.beginMutation(ctx, "console.business-domain.create", meta.IdempotencyKey, meta.RequestID, meta.ActorID, inputs)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	for _, input := range inputs {
		var exists int
		err := session.tx.QueryRowContext(ctx, "SELECT 1 FROM org_business_domains WHERE domain_code=? FOR UPDATE", input.DomainCode).Scan(&exists)
		if err == nil {
			return nil, httperror.New(http.StatusConflict, "business_domain_exists", "Business domain already exists: "+input.DomainCode)
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if _, err := session.tx.ExecContext(ctx, `
			INSERT INTO org_business_domains (
				domain_code,domain_name,category,source,sort_order,status,revision,created_at,updated_at
			) VALUES (?,?,?,?,?,'active',1,UTC_TIMESTAMP(),UTC_TIMESTAMP())
		`, input.DomainCode, input.DomainName, input.Category, input.Source, input.SortOrder); err != nil {
			return nil, err
		}
	}
	response := map[string]any{"code": 0, "data": map[string]any{"count": len(inputs)}}
	if err := a.finishMutation(ctx, session, "tenant_profile", "create", "business_domain", "", map[string]any{
		"count": len(inputs),
	}, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) UpdateBusinessDomain(ctx context.Context, code string, body map[string]any, meta MutationMeta) (map[string]any, error) {
	code, err := validOrganizationCode(code, "domainCode")
	if err != nil {
		return nil, err
	}
	revision, ok := positiveRevision(body["expectedRevision"])
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "expected_revision_required", "expectedRevision must be a positive integer")
	}
	alias := nullableBodyString(body["aliasName"])
	sortOrder := intField(body["sortOrder"], 100)
	payload := struct {
		Code             string  `json:"domainCode"`
		AliasName        *string `json:"aliasName"`
		SortOrder        int     `json:"sortOrder"`
		ExpectedRevision uint64  `json:"expectedRevision"`
	}{code, alias, sortOrder, revision}
	session, replay, err := a.beginMutation(ctx, "console.business-domain.update", meta.IdempotencyKey, meta.RequestID, meta.ActorID, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	result, err := session.tx.ExecContext(ctx, `
		UPDATE org_business_domains
		SET alias_name=?,sort_order=?,revision=revision+1,updated_at=UTC_TIMESTAMP()
		WHERE domain_code=? AND revision=?
	`, alias, sortOrder, code, revision)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		if exists, err := domainExistsTx(ctx, session.tx, code); err != nil {
			return nil, err
		} else if !exists {
			return nil, httperror.New(http.StatusNotFound, "business_domain_not_found", "Business domain not found")
		}
		return nil, httperror.New(http.StatusConflict, "business_domain_revision_conflict", "Business domain has changed; reload it before saving")
	}
	response := map[string]any{"code": 0, "data": map[string]any{"domainCode": code, "revision": revision + 1}}
	if err := a.finishMutation(ctx, session, "tenant_profile", "update", "business_domain", code, map[string]any{
		"previousRevision": revision, "revision": revision + 1,
	}, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) DeleteBusinessDomain(ctx context.Context, code string, body map[string]any, meta MutationMeta) (map[string]any, error) {
	code, err := validOrganizationCode(code, "domainCode")
	if err != nil {
		return nil, err
	}
	revision, ok := positiveRevision(body["expectedRevision"])
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "expected_revision_required", "expectedRevision must be a positive integer")
	}
	payload := map[string]any{"domainCode": code, "expectedRevision": revision}
	session, replay, err := a.beginMutation(ctx, "console.business-domain.delete", meta.IdempotencyKey, meta.RequestID, meta.ActorID, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	result, err := session.tx.ExecContext(ctx, "DELETE FROM org_business_domains WHERE domain_code=? AND revision=?", code, revision)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		if exists, err := domainExistsTx(ctx, session.tx, code); err != nil {
			return nil, err
		} else if !exists {
			return nil, httperror.New(http.StatusNotFound, "business_domain_not_found", "Business domain not found")
		}
		return nil, httperror.New(http.StatusConflict, "business_domain_revision_conflict", "Business domain has changed; reload it before deleting")
	}
	response := map[string]any{"code": 0, "data": map[string]any{"domainCode": code, "deleted": true}}
	if err := a.finishMutation(ctx, session, "tenant_profile", "delete", "business_domain", code, map[string]any{
		"revision": revision,
	}, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) Regions(ctx context.Context, query url.Values) (map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT r.id,r.region_code,r.region_name,r.description,r.sort_order,r.status,r.revision,
			COUNT(rd.id)
		FROM regions r
		LEFT JOIN region_divisions rd ON rd.region_id=r.id
		WHERE r.status='active'
		GROUP BY r.id,r.region_code,r.region_name,r.description,r.sort_order,r.status,r.revision
		ORDER BY r.sort_order,r.id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]region, 0)
	companyCode := strings.TrimSpace(query.Get("companyCode"))
	for rows.Next() {
		var item region
		var description sql.NullString
		var status string
		if err := rows.Scan(&item.ID, &item.RegionCode, &item.RegionName, &description, &item.SortOrder, &status, &item.Revision, &item.DivisionCount); err != nil {
			return nil, err
		}
		item.Description = nullableString(description)
		if status == "active" {
			item.Status = 1
		}
		if companyCode != "" {
			value := companyCode
			item.CompanyCode = &value
		}
		items = append(items, item)
	}
	return map[string]any{"code": 0, "data": items}, rows.Err()
}

func (a *Adapter) CreateRegion(ctx context.Context, body map[string]any, fromTemplate bool, meta MutationMeta) (map[string]any, error) {
	payload := map[string]any{"fromTemplate": fromTemplate, "body": body}
	session, replay, err := a.beginMutation(ctx, "console.region.create", meta.IdempotencyKey, meta.RequestID, meta.ActorID, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	count := 0
	if fromTemplate {
		for _, template := range standardRegions {
			result, err := session.tx.ExecContext(ctx, `
				INSERT INTO regions (
					region_code,region_name,region_type,sort_order,status,revision,created_at,updated_at
				) VALUES (?,?,'template',?,'active',1,UTC_TIMESTAMP(),UTC_TIMESTAMP())
				ON DUPLICATE KEY UPDATE region_code=regions.region_code
			`, template.Code, template.Name, template.SortOrder)
			if err != nil {
				return nil, err
			}
			affected, _ := result.RowsAffected()
			if affected > 0 {
				count++
			}
			var regionID uint64
			if err := session.tx.QueryRowContext(ctx, "SELECT id FROM regions WHERE region_code=?", template.Code).Scan(&regionID); err != nil {
				return nil, err
			}
			for _, divisionCode := range template.Divisions {
				if _, err := session.tx.ExecContext(ctx, `
					INSERT IGNORE INTO region_divisions (region_id,division_code,created_at)
					VALUES (?,?,UTC_TIMESTAMP())
				`, regionID, divisionCode); err != nil {
					return nil, err
				}
			}
		}
	} else {
		code, err := validOrganizationCode(body["regionCode"], "regionCode")
		if err != nil {
			return nil, err
		}
		name := strings.TrimSpace(stringField(body["regionName"]))
		if name == "" || len(name) > 255 {
			return nil, httperror.New(http.StatusBadRequest, "region_name_invalid", "Region name is required and must not exceed 255 characters")
		}
		description := nullableBodyString(body["description"])
		sortOrder := intField(body["sortOrder"], 100)
		if _, err := session.tx.ExecContext(ctx, `
			INSERT INTO regions (
				region_code,region_name,region_type,description,sort_order,status,revision,created_at,updated_at
			) VALUES (?,?,'custom',?,?,'active',1,UTC_TIMESTAMP(),UTC_TIMESTAMP())
		`, code, name, description, sortOrder); err != nil {
			return nil, err
		}
		count = 1
	}
	response := map[string]any{"code": 0, "data": map[string]any{"count": count}}
	if err := a.finishMutation(ctx, session, "tenant_profile", "create", "region", "", map[string]any{
		"count": count, "fromTemplate": fromTemplate,
	}, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) UpdateRegion(ctx context.Context, code string, body map[string]any, meta MutationMeta) (map[string]any, error) {
	code, err := validOrganizationCode(code, "regionCode")
	if err != nil {
		return nil, err
	}
	revision, ok := positiveRevision(body["expectedRevision"])
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "expected_revision_required", "expectedRevision must be a positive integer")
	}
	name := strings.TrimSpace(stringField(body["regionName"]))
	if name == "" || len(name) > 255 {
		return nil, httperror.New(http.StatusBadRequest, "region_name_invalid", "Region name is required and must not exceed 255 characters")
	}
	description := nullableBodyString(body["description"])
	sortOrder := intField(body["sortOrder"], 100)
	payload := map[string]any{"regionCode": code, "regionName": name, "description": description, "sortOrder": sortOrder, "expectedRevision": revision}
	session, replay, err := a.beginMutation(ctx, "console.region.update", meta.IdempotencyKey, meta.RequestID, meta.ActorID, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	result, err := session.tx.ExecContext(ctx, `
		UPDATE regions
		SET region_name=?,description=?,sort_order=?,revision=revision+1,updated_at=UTC_TIMESTAMP()
		WHERE region_code=? AND revision=?
	`, name, description, sortOrder, code, revision)
	if err != nil {
		return nil, err
	}
	if response, err := a.finishVersionedRegionMutation(ctx, session, result, code, revision, "update"); err != nil {
		return nil, err
	} else {
		return response, nil
	}
}

func (a *Adapter) DeleteRegion(ctx context.Context, code string, body map[string]any, meta MutationMeta) (map[string]any, error) {
	code, err := validOrganizationCode(code, "regionCode")
	if err != nil {
		return nil, err
	}
	revision, ok := positiveRevision(body["expectedRevision"])
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "expected_revision_required", "expectedRevision must be a positive integer")
	}
	session, replay, err := a.beginMutation(ctx, "console.region.delete", meta.IdempotencyKey, meta.RequestID, meta.ActorID, map[string]any{
		"regionCode": code, "expectedRevision": revision,
	})
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	var regionID uint64
	var currentRevision uint64
	if err := session.tx.QueryRowContext(ctx, "SELECT id,revision FROM regions WHERE region_code=? FOR UPDATE", code).Scan(&regionID, &currentRevision); errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "region_not_found", "Region not found")
	} else if err != nil {
		return nil, err
	}
	if currentRevision != revision {
		return nil, httperror.New(http.StatusConflict, "region_revision_conflict", "Region has changed; reload it before deleting")
	}
	if _, err := session.tx.ExecContext(ctx, "DELETE FROM region_divisions WHERE region_id=?", regionID); err != nil {
		return nil, err
	}
	if _, err := session.tx.ExecContext(ctx, "DELETE FROM regions WHERE id=? AND revision=?", regionID, revision); err != nil {
		return nil, err
	}
	response := map[string]any{"code": 0, "data": map[string]any{"regionCode": code, "deleted": true}}
	if err := a.finishMutation(ctx, session, "tenant_profile", "delete", "region", code, map[string]any{"revision": revision}, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) RegionDivisions(ctx context.Context, code string) (map[string]any, error) {
	code, err := validOrganizationCode(code, "regionCode")
	if err != nil {
		return nil, err
	}
	var revision uint64
	if err := a.db.QueryRowContext(ctx, "SELECT revision FROM regions WHERE region_code=?", code).Scan(&revision); errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "region_not_found", "Region not found")
	} else if err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT rd.id,rd.division_code,rd.division_name
		FROM region_divisions rd
		INNER JOIN regions r ON r.id=rd.region_id
		WHERE r.region_code=?
		ORDER BY rd.division_code
	`, code)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]division, 0)
	for rows.Next() {
		var item division
		var name sql.NullString
		if err := rows.Scan(&item.ID, &item.DivisionCode, &name); err != nil {
			return nil, err
		}
		item.DivisionName = nullableString(name)
		item.IncludeChildren = true
		items = append(items, item)
	}
	return map[string]any{
		"code": 0,
		"data": items,
		"meta": map[string]any{"revision": revision},
	}, rows.Err()
}

func (a *Adapter) ReplaceRegionDivisions(ctx context.Context, code string, body map[string]any, meta MutationMeta) (map[string]any, error) {
	code, err := validOrganizationCode(code, "regionCode")
	if err != nil {
		return nil, err
	}
	revision, ok := positiveRevision(body["expectedRevision"])
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "expected_revision_required", "expectedRevision must be a positive integer")
	}
	raw, ok := body["divisions"].([]any)
	if !ok || len(raw) > 500 {
		return nil, httperror.New(http.StatusBadRequest, "region_divisions_invalid", "divisions must be an array with at most 500 items")
	}
	type divisionInput struct {
		Code string  `json:"divisionCode"`
		Name *string `json:"divisionName"`
	}
	inputs := make([]divisionInput, 0, len(raw))
	seen := map[string]bool{}
	for _, value := range raw {
		record, ok := value.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "region_division_invalid", "Division item must be an object")
		}
		divisionCode := strings.TrimSpace(stringField(record["divisionCode"]))
		if !regexp.MustCompile(`^[0-9A-Za-z_.-]{1,32}$`).MatchString(divisionCode) {
			return nil, httperror.New(http.StatusBadRequest, "region_division_invalid", "Invalid divisionCode")
		}
		if !seen[divisionCode] {
			inputs = append(inputs, divisionInput{divisionCode, nullableBodyString(record["divisionName"])})
			seen[divisionCode] = true
		}
	}
	payload := map[string]any{"regionCode": code, "expectedRevision": revision, "divisions": inputs}
	session, replay, err := a.beginMutation(ctx, "console.region.divisions.replace", meta.IdempotencyKey, meta.RequestID, meta.ActorID, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	var regionID uint64
	var currentRevision uint64
	if err := session.tx.QueryRowContext(ctx, "SELECT id,revision FROM regions WHERE region_code=? FOR UPDATE", code).Scan(&regionID, &currentRevision); errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "region_not_found", "Region not found")
	} else if err != nil {
		return nil, err
	}
	if currentRevision != revision {
		return nil, httperror.New(http.StatusConflict, "region_revision_conflict", "Region has changed; reload it before saving divisions")
	}
	if _, err := session.tx.ExecContext(ctx, "DELETE FROM region_divisions WHERE region_id=?", regionID); err != nil {
		return nil, err
	}
	for _, input := range inputs {
		if _, err := session.tx.ExecContext(ctx, `
			INSERT INTO region_divisions (region_id,division_code,division_name,created_at)
			VALUES (?,?,?,UTC_TIMESTAMP())
		`, regionID, input.Code, input.Name); err != nil {
			return nil, err
		}
	}
	if _, err := session.tx.ExecContext(ctx, "UPDATE regions SET revision=revision+1,updated_at=UTC_TIMESTAMP() WHERE id=? AND revision=?", regionID, revision); err != nil {
		return nil, err
	}
	response := map[string]any{"code": 0, "data": map[string]any{"count": len(inputs), "revision": revision + 1}}
	if err := a.finishMutation(ctx, session, "tenant_profile", "replace_divisions", "region", code, map[string]any{
		"count": len(inputs), "previousRevision": revision, "revision": revision + 1,
	}, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) finishVersionedRegionMutation(ctx context.Context, session *mutationSession, result sql.Result, code string, revision uint64, action string) (map[string]any, error) {
	affected, _ := result.RowsAffected()
	if affected != 1 {
		var exists int
		err := session.tx.QueryRowContext(ctx, "SELECT 1 FROM regions WHERE region_code=?", code).Scan(&exists)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(http.StatusNotFound, "region_not_found", "Region not found")
		}
		if err != nil {
			return nil, err
		}
		return nil, httperror.New(http.StatusConflict, "region_revision_conflict", "Region has changed; reload it before saving")
	}
	response := map[string]any{"code": 0, "data": map[string]any{"regionCode": code, "revision": revision + 1}}
	if err := a.finishMutation(ctx, session, "tenant_profile", action, "region", code, map[string]any{
		"previousRevision": revision, "revision": revision + 1,
	}, response); err != nil {
		return nil, err
	}
	return response, nil
}

func domainExistsTx(ctx context.Context, tx *sql.Tx, code string) (bool, error) {
	var exists int
	err := tx.QueryRowContext(ctx, "SELECT 1 FROM org_business_domains WHERE domain_code=?", code).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func validOrganizationCode(value any, field string) (string, error) {
	code := strings.TrimSpace(stringField(value))
	if !organizationCodePattern.MatchString(code) {
		return "", httperror.New(http.StatusBadRequest, "organization_code_invalid", "Invalid "+field)
	}
	return code, nil
}

func stringField(value any) string {
	text, _ := value.(string)
	return text
}

func nullableBodyString(value any) *string {
	text := strings.TrimSpace(stringField(value))
	if text == "" {
		return nil
	}
	return &text
}

func intField(value any, fallback int) int {
	switch candidate := value.(type) {
	case float64:
		return int(candidate)
	case int:
		return candidate
	case string:
		parsed, err := strconv.Atoi(candidate)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func positiveRevision(value any) (uint64, bool) {
	revision, ok := nonNegativeRevision(value)
	return revision, ok && revision > 0
}

func firstValue(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

var _ = time.RFC3339
