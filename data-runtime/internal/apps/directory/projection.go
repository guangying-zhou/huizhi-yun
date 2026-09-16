package directory

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
)

// Keep each Cloudflare request deliberately small so tenant projections stay
// below the Workers Free CPU ceiling even when membership writes are involved.
const projectionChunkSize = 10

type subjectProjectionItem struct {
	SubjectType       string  `json:"subjectType"`
	SubjectCode       string  `json:"subjectCode"`
	ExternalRef       *string `json:"externalRef"`
	ParentSubjectType *string `json:"parentSubjectType"`
	ParentSubjectCode *string `json:"parentSubjectCode"`
	Status            string  `json:"status"`
	SnapshotHash      string  `json:"snapshotHash"`
}

type subjectProjectionMembership struct {
	SubjectType          string `json:"subjectType"`
	SubjectCode          string `json:"subjectCode"`
	ContainerSubjectType string `json:"containerSubjectType"`
	ContainerSubjectCode string `json:"containerSubjectCode"`
	RelationType         string `json:"relationType"`
	IsPrimary            bool   `json:"isPrimary"`
	Status               string `json:"status"`
}

func nullableString(value sql.NullString) *string {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	result := value.String
	return &result
}

func pointerText(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func projectionSnapshotHash(items []subjectProjectionItem, memberships []subjectProjectionMembership) string {
	lines := make([]string, 0, len(items)+len(memberships))
	for _, item := range items {
		lines = append(lines, strings.Join([]string{
			item.SubjectType, item.SubjectCode, pointerText(item.ExternalRef),
			pointerText(item.ParentSubjectType), pointerText(item.ParentSubjectCode),
			item.Status, item.SnapshotHash,
		}, "|"))
	}
	for _, membership := range memberships {
		primary := "0"
		if membership.IsPrimary {
			primary = "1"
		}
		lines = append(lines, strings.Join([]string{
			membership.SubjectType, membership.SubjectCode, membership.ContainerSubjectType,
			membership.ContainerSubjectCode, membership.RelationType, primary, membership.Status,
		}, "|"))
	}
	sort.Strings(lines)
	digest := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	return "sha256_" + hex.EncodeToString(digest[:])
}

func (a *Adapter) loadSubjectProjection(ctx context.Context) ([]subjectProjectionItem, []subjectProjectionMembership, error) {
	rows, err := a.db.QueryContext(ctx, `SELECT subject_type,subject_code,external_ref,parent_subject_type,
		parent_subject_code,status,snapshot_hash FROM directory_subject_exports
		WHERE subject_type IN ('user','department','committee','project')
		ORDER BY CASE subject_type WHEN 'department' THEN 0 WHEN 'committee' THEN 0 WHEN 'project' THEN 1 ELSE 2 END,id`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	items := make([]subjectProjectionItem, 0)
	for rows.Next() {
		var item subjectProjectionItem
		var externalRef, parentType, parentCode sql.NullString
		if err := rows.Scan(&item.SubjectType, &item.SubjectCode, &externalRef, &parentType, &parentCode, &item.Status, &item.SnapshotHash); err != nil {
			return nil, nil, err
		}
		item.ExternalRef = nullableString(externalRef)
		item.ParentSubjectType = nullableString(parentType)
		item.ParentSubjectCode = nullableString(parentCode)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	membershipRows, err := a.db.QueryContext(ctx, `SELECT ud.uid,ud.dept_code,
		CASE WHEN d.org_type='committee' THEN 'committee' ELSE 'department' END,
		ud.relation_type,ud.is_primary,
		CASE WHEN ud.status='active' AND u.status='active' AND (
			d.status='active' OR EXISTS (
				SELECT 1 FROM directory_department_aliases alias
				WHERE alias.alias_dept_code=d.dept_code AND alias.status='active'
			)
		) THEN 'active' ELSE 'inactive' END
		FROM directory_user_departments ud
		INNER JOIN directory_users u ON u.uid=ud.uid
		INNER JOIN directory_departments d ON d.dept_code=ud.dept_code
		WHERE ud.relation_type='member'
		UNION ALL
		SELECT pm.uid,pm.project_code,'project',
		CASE pm.member_role
			WHEN 'owner' THEN 'leader'
			WHEN 'admin' THEN 'manager'
			WHEN 'viewer' THEN 'observer'
			ELSE 'member'
		END,
		CASE WHEN pm.member_role='owner' THEN 1 ELSE 0 END,
		CASE WHEN pm.status='active' AND u.status='active' AND p.status='active' THEN 'active' ELSE 'inactive' END
		FROM directory_project_members pm
		INNER JOIN directory_users u ON u.uid=pm.uid
		INNER JOIN directory_projects p ON p.project_code=pm.project_code
		ORDER BY 3,2,1`)
	if err != nil {
		return nil, nil, err
	}
	defer membershipRows.Close()
	memberships := make([]subjectProjectionMembership, 0)
	for membershipRows.Next() {
		var membership subjectProjectionMembership
		if err := membershipRows.Scan(&membership.SubjectCode, &membership.ContainerSubjectCode, &membership.ContainerSubjectType,
			&membership.RelationType, &membership.IsPrimary, &membership.Status); err != nil {
			return nil, nil, err
		}
		membership.SubjectType = "user"
		memberships = append(memberships, membership)
	}
	if err := membershipRows.Err(); err != nil {
		return nil, nil, err
	}
	return items, memberships, nil
}

func (a *Adapter) postSubjectProjectionChunk(
	ctx context.Context,
	identity ConnectorIdentity,
	cursor, snapshotHash string,
	items []subjectProjectionItem,
	memberships []subjectProjectionMembership,
	resetMemberships, finalize bool,
) (map[string]any, error) {
	if items == nil {
		items = []subjectProjectionItem{}
	}
	if memberships == nil {
		memberships = []subjectProjectionMembership{}
	}
	payload := map[string]any{
		"tenantCode": identity.TenantCode, "deploymentId": identity.DeploymentCode,
		"cursor": cursor, "snapshotHash": snapshotHash,
		"items": items, "memberships": memberships,
		"resetMemberships": resetMemberships, "finalize": finalize,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.platformURL+"/api/v1/runtime/subjects/sync", bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	req.Header.Set("authorization", "Bearer "+a.runtimeToken)
	req.Header.Set("content-type", "application/json")
	req.Header.Set("user-agent", "hzy-data-runtime-directory/1.0")
	resp, err := a.projectionHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	content, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail := strings.Join(strings.Fields(string(content)), " ")
		if len(detail) > 300 {
			detail = detail[:300]
		}
		if detail != "" {
			return nil, fmt.Errorf("Platform subject sync returned HTTP %d: %s", resp.StatusCode, detail)
		}
		return nil, fmt.Errorf("Platform subject sync returned HTTP %d", resp.StatusCode)
	}
	var result struct {
		Code int            `json:"code"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(content, &result); err != nil || result.Code != 0 || result.Data == nil {
		return nil, errors.New("Platform subject sync response is invalid")
	}
	return result.Data, nil
}

func projectionCount(result map[string]any, key string) int64 {
	switch value := result[key].(type) {
	case float64:
		return int64(value)
	case int64:
		return value
	case int:
		return int64(value)
	default:
		return 0
	}
}

func projectionBool(result map[string]any, key string) bool {
	value, _ := result[key].(bool)
	return value
}

func (a *Adapter) pushSubjectProjection(ctx context.Context, identity ConnectorIdentity, cursor string) (map[string]any, error) {
	if a.platformURL == "" || a.runtimeToken == "" {
		return nil, errors.New("data-runtime Platform URL or runtime credential is not configured")
	}
	items, memberships, err := a.loadSubjectProjection(ctx)
	if err != nil {
		return nil, err
	}
	type projectionChunk struct {
		items       []subjectProjectionItem
		memberships []subjectProjectionMembership
	}
	chunks := make([]projectionChunk, 0, (len(items)+len(memberships))/projectionChunkSize+2)
	for start := 0; start < len(items); start += projectionChunkSize {
		end := start + projectionChunkSize
		if end > len(items) {
			end = len(items)
		}
		chunks = append(chunks, projectionChunk{items: items[start:end]})
	}
	for start := 0; start < len(memberships); start += projectionChunkSize {
		end := start + projectionChunkSize
		if end > len(memberships) {
			end = len(memberships)
		}
		chunks = append(chunks, projectionChunk{memberships: memberships[start:end]})
	}
	if len(chunks) == 0 {
		chunks = append(chunks, projectionChunk{})
	}

	snapshotHash := projectionSnapshotHash(items, memberships)
	var accepted, upserted, membershipAccepted, membershipUpserted int64
	for index, chunk := range chunks {
		result, err := a.postSubjectProjectionChunk(
			ctx, identity, cursor, snapshotHash, chunk.items, chunk.memberships,
			index == 0, index == len(chunks)-1,
		)
		if err != nil {
			return nil, fmt.Errorf("Platform projection chunk %d/%d failed: %w", index+1, len(chunks), err)
		}
		if index == 0 && projectionBool(result, "unchanged") {
			return map[string]any{
				"snapshotHash": snapshotHash, "chunkCount": 1, "unchanged": true,
				"sentCount": 0, "acceptedCount": int64(0), "upsertedCount": int64(0),
				"membershipSentCount": 0, "membershipAcceptedCount": int64(0),
				"membershipUpsertedCount": int64(0),
			}, nil
		}
		accepted += projectionCount(result, "acceptedCount")
		upserted += projectionCount(result, "upsertedCount")
		membershipAccepted += projectionCount(result, "membershipAcceptedCount")
		membershipUpserted += projectionCount(result, "membershipUpsertedCount")
	}
	return map[string]any{
		"snapshotHash": snapshotHash, "chunkCount": len(chunks),
		"sentCount": len(items), "acceptedCount": accepted, "upsertedCount": upserted,
		"membershipSentCount": len(memberships), "membershipAcceptedCount": membershipAccepted,
		"membershipUpsertedCount": membershipUpserted,
	}, nil
}
