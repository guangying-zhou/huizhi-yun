package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"strconv"
	"strings"
)

// Internal owning-domain context, never decoded from a transport body.
type EnterpriseProjectDocumentAccessFacts struct {
	ActorUID     string
	ProjectCode  string
	ProjectCodes []string
	Roles        []string
}
type EnterpriseProjectDocumentACL func(context.Context, string, string, EnterpriseProjectDocumentAccessFacts) (map[string]any, error)

// Aims derives candidates and relations; the internal Codocs callback can only
// see a UUID selected here after project visibility has been checked.
func (a *Adapter) ListEnterpriseAccessibleProjectDocuments(ctx context.Context, projectID, actor string, managementDeptCodes []string, projectAdmin bool, check EnterpriseProjectDocumentACL) (map[string]any, error) {
	q := url.Values{"current_user": {actor}}
	if projectAdmin {
		q.Set("current_user_is_project_admin", "1")
	}
	if len(managementDeptCodes) > 0 {
		q.Set("current_user_management_dept_codes", strings.Join(managementDeptCodes, ","))
	}
	if err := a.requireProjectReadAccess(ctx, projectID, q); err != nil {
		return nil, err
	}
	id, err := parseID(projectID, "project_id")
	if err != nil {
		return nil, err
	}
	p, err := a.projectDocumentProject(ctx, id)
	if err != nil {
		return nil, err
	}
	var role string
	err = a.DB().QueryRowContext(ctx, "SELECT role FROM aims_project_members WHERE project_id=? AND uid=? AND status='active' LIMIT 1", id, actor).Scan(&role)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	manager := projectAdmin || p.LeaderUID.String == actor || p.CreatedBy == actor || role == "manager"
	member := manager || role != ""
	facts := EnterpriseProjectDocumentAccessFacts{ActorUID: actor, ProjectCode: p.ProjectCode, Roles: []string{"employee"}}
	if manager {
		facts.Roles = []string{"project_manager"}
	} else if member {
		facts.Roles = []string{"project_member"}
	}
	// Same project visibility predicate as the existing Aims list, with facts
	// derived from the signed actor rather than caller query scope markers.
	// Admin is bound to this project only, never applied to other projects.
	projectQuery := url.Values{"current_user": {actor}}
	if len(managementDeptCodes) > 0 {
		projectQuery.Set("current_user_management_dept_codes", strings.Join(managementDeptCodes, ","))
	}
	where, args := projectVisibilityWhere(projectQuery, "p", actor)
	rows, err := a.DB().QueryContext(ctx, "SELECT p.project_code FROM aims_projects p WHERE "+where, args...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var code string
		if err = rows.Scan(&code); err != nil {
			rows.Close()
			return nil, err
		}
		facts.ProjectCodes = append(facts.ProjectCodes, code)
	}
	if projectAdmin {
		facts.ProjectCodes = append(facts.ProjectCodes, p.ProjectCode)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	docs := []map[string]any{}
	seenID := map[int64]bool{}
	for _, filter := range []url.Values{{"current_user": {actor}, "project_id": {projectID}}, {"current_user": {actor}, "project_code": {p.ProjectCode}}} {
		if filter.Get("project_code") == "" && filter.Get("project_id") == "" {
			continue
		}
		if len(managementDeptCodes) > 0 {
			filter.Set("current_user_management_dept_codes", strings.Join(managementDeptCodes, ","))
		}
		if projectAdmin {
			filter.Set("current_user_is_project_admin", "1")
		}
		items, e := a.listDirectDocuments(ctx, filter)
		if e != nil {
			return nil, e
		}
		var flatten func([]*directDocumentListItem) error
		flatten = func(items []*directDocumentListItem) error {
			for _, item := range items {
				if !seenID[item.ID] {
					seenID[item.ID] = true
					b, e := json.Marshal(item)
					if e != nil {
						return e
					}
					var d map[string]any
					if e = json.Unmarshal(b, &d); e != nil {
						return e
					}
					delete(d, "children")
					if projectDocText(d["documentSource"]) == "" {
						d["documentSource"] = "codocs"
					}
					d["virtual"] = false
					d["accessSummary"] = "仅项目成员"
					docs = append(docs, d)
				}
				if e := flatten(item.Children); e != nil {
					return e
				}
			}
			return nil
		}
		if e = flatten(items); e != nil {
			return nil, e
		}
	}
	milestones := map[int64]int64{}
	rows, err = a.DB().QueryContext(ctx, "SELECT id,milestone_id FROM work_items WHERE project_id=? AND milestone_id IS NOT NULL", id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var work, ms int64
		if err = rows.Scan(&work, &ms); err != nil {
			rows.Close()
			return nil, err
		}
		milestones[work] = ms
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	dedup := map[string]bool{}
	for _, d := range docs {
		if !projectDocBool(d["isFolder"]) {
			dedup[projectDocDedup(d)] = true
		}
		if d["milestoneId"] == nil {
			if ms := milestones[projectDocID(d["workItemId"])]; ms > 0 {
				d["milestoneId"] = ms
			}
		}
	}
	// Bounded full pagination: never turn an incomplete list into success.
	complete := false
	for page := 1; page <= 100; page++ {
		deliverableQuery := url.Values{"current_user": {actor}, "project_id": {projectID}, "deliverable_type": {"document"}, "page": {strconv.Itoa(page)}, "pageSize": {"100"}}
		if len(managementDeptCodes) > 0 {
			deliverableQuery.Set("current_user_management_dept_codes", strings.Join(managementDeptCodes, ","))
		}
		if projectAdmin {
			deliverableQuery.Set("current_user_is_project_admin", "1")
		}
		data, e := a.listDeliverables(ctx, deliverableQuery)
		if e != nil {
			return nil, e
		}
		out, ok := data.(map[string]any)
		if !ok {
			return nil, httperror.New(503, "project_document_page_invalid", "Invalid deliverable page")
		}
		items, ok := out["items"].([]deliverableListItem)
		if !ok {
			return nil, httperror.New(503, "project_document_page_invalid", "Invalid deliverable page")
		}
		for _, d := range items {
			text := func(v *string) string {
				if v == nil {
					return ""
				}
				return *v
			}
			uuid := text(d.DocumentUUID)
			repo := d.DocumentSource == "repo"
			if (!repo && uuid == "") || (repo && (text(d.RepoProjectCode) == "" || text(d.RepoFilePath) == "")) {
				continue
			}
			title := text(d.DocumentTitle)
			if title == "" {
				title = d.Name
			}
			if title == "" {
				title = "任务交付文档"
			}
			work := int64(0)
			if d.MatterID != nil {
				work = *d.MatterID
			} else if d.TargetID != nil {
				work = *d.TargetID
			}
			stamp := text(d.SubmittedAt)
			if stamp == "" {
				stamp = d.UpdatedAt
			}
			v := map[string]any{"id": -d.ID, "uuid": uuid, "title": title, "projectId": id, "projectCode": p.ProjectCode, "workItemId": work, "parentId": nil, "docCategory": "delivery_doc", "isFolder": false, "codocsUuid": uuid, "documentSource": d.DocumentSource, "repoProjectCode": d.RepoProjectCode, "repoFilePath": d.RepoFilePath, "repoCommitId": d.RepoCommitID, "contentSize": 0, "createdBy": d.SubmittedBy, "createdAt": stamp, "updatedAt": stamp, "sortOrder": 0, "accessLifecycleStage": "draft", "accessConfidentialityLevel": "L2", "accessSummary": "任务交付文档", "virtual": true, "virtualSource": "deliverable"}
			if ms := milestones[work]; ms > 0 {
				v["milestoneId"] = ms
			} else {
				v["milestoneId"] = nil
			}
			if repo {
				v["uuid"] = "deliverable-repo-" + strconv.FormatInt(d.ID, 10)
				v["codocsUuid"] = nil
			}
			key := projectDocDedup(v)
			if dedup[key] {
				continue
			}
			dedup[key] = true
			docs = append(docs, v)
		}
		total := projectDocID(out["total"])
		if int64(page*100) >= total {
			complete = true
			break
		}
		if len(items) == 0 {
			return nil, httperror.New(503, "project_document_pages_incomplete", "Incomplete deliverable list")
		}
	}
	if !complete {
		return nil, httperror.New(503, "project_document_page_limit", "Deliverable page limit exceeded")
	}
	return filterEnterpriseProjectDocuments(ctx, docs, member, facts, check)
}
func projectDocID(v any) int64 {
	switch x := v.(type) {
	case int64:
		return x
	case int:
		return int64(x)
	case float64:
		return int64(x)
	}
	return 0
}
func projectDocBool(v any) bool { x, _ := v.(bool); return x }
func projectDocText(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case *string:
		if x != nil {
			return *x
		}
	}
	return ""
}
func projectDocDedup(d map[string]any) string {
	if projectDocText(d["documentSource"]) == "repo" {
		return "repo:" + projectDocText(d["repoProjectCode"]) + ":" + projectDocText(d["repoFilePath"])
	}
	return "codocs:" + firstNonEmptyProjectDoc(projectDocText(d["codocsUuid"]), projectDocText(d["uuid"]))
}
func firstNonEmptyProjectDoc(v ...string) string {
	for _, x := range v {
		if strings.TrimSpace(x) != "" {
			return x
		}
	}
	return ""
}
func filterEnterpriseProjectDocuments(ctx context.Context, docs []map[string]any, member bool, facts EnterpriseProjectDocumentAccessFacts, check EnterpriseProjectDocumentACL) (map[string]any, error) {
	allowed := map[int64]bool{}
	access := map[int64]map[string]any{}
	byID := map[int64]map[string]any{}
	for _, d := range docs {
		id := projectDocID(d["id"])
		byID[id] = d
		if projectDocBool(d["isFolder"]) {
			allowed[id] = member
			continue
		}
		var acl map[string]any
		if projectDocText(d["documentSource"]) == "repo" {
			if !member {
				continue
			}
			acl = map[string]any{"allowed": true, "readonly": true, "reason": "project_member_direct", "permission": "view", "lifecycleStage": "draft", "confidentialityLevel": "L2"}
		} else {
			uuid := firstNonEmptyProjectDoc(projectDocText(d["codocsUuid"]), projectDocText(d["uuid"]))
			if uuid == "" {
				continue
			}
			var err error
			acl, err = check(ctx, uuid, "codocs_document", facts)
			if err != nil {
				return nil, err
			}
			if acl["allowed"] != true {
				continue
			}
		}
		allowed[id] = true
		access[id] = acl
	}
	for id, yes := range allowed {
		if !yes {
			continue
		}
		seen := map[int64]bool{}
		parent := projectDocID(byID[id]["parentId"])
		for parent != 0 && !seen[parent] {
			seen[parent] = true
			d, ok := byID[parent]
			if !ok {
				break
			}
			allowed[parent] = true
			parent = projectDocID(d["parentId"])
		}
	}
	items := []map[string]any{}
	total := 0
	for _, d := range docs {
		id := projectDocID(d["id"])
		if !allowed[id] {
			continue
		}
		acl := access[id]
		folder := projectDocBool(d["isFolder"])
		d["accessAllowed"] = folder || acl != nil
		d["accessReadonly"] = false
		d["accessReason"] = nil
		d["accessPermission"] = nil
		d["accessLifecycleStage"] = "draft"
		d["accessConfidentialityLevel"] = "L2"
		if acl != nil {
			d["accessReadonly"] = acl["readonly"]
			d["accessReason"] = acl["reason"]
			d["accessPermission"] = acl["permission"]
			d["accessLifecycleStage"] = acl["lifecycleStage"]
			d["accessConfidentialityLevel"] = acl["confidentialityLevel"]
		}
		if !folder {
			total++
		}
		items = append(items, d)
	}
	return map[string]any{"items": items, "total": total}, nil
}
