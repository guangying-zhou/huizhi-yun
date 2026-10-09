package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Portfolio documents, read only (document asset design DOC-05, batch 5b-1).
//
// Aims owns which documents belong to a portfolio and who is currently related
// to it. The relation is computed here from the signed actor; it is never
// accepted from the caller. Whether a single document may be viewed is then
// decided by the Codocs policy through an in-process typed callback.

// EnterprisePortfolioDocumentAccessFacts is the internal owning-domain context
// handed to the document policy check. Never decoded from a transport body.
type EnterprisePortfolioDocumentAccessFacts struct {
	ActorUID      string
	PortfolioCode string
	Relation      string // manager, contributor, viewer or inherited
}

type EnterprisePortfolioDocumentACL func(context.Context, string, string, EnterprisePortfolioDocumentAccessFacts) (map[string]any, error)

type enterprisePortfolioDocumentACLKey struct{}

func WithEnterprisePortfolioDocumentACL(ctx context.Context, check EnterprisePortfolioDocumentACL) context.Context {
	return context.WithValue(ctx, enterprisePortfolioDocumentACLKey{}, check)
}

const portfolioRelationInherited = "inherited"

type portfolioDocumentAccess struct {
	id            int64
	code          string
	relation      string // empty: no current relation
	ownerInactive bool
}

func (p portfolioDocumentAccess) direct() bool {
	return p.relation != "" && p.relation != portfolioRelationInherited
}

// portfolioDocumentAccess reads the actor's current relation to a portfolio:
// the owner (unless Directory says the owner is no longer an active employee)
// and effective manager rows are managers, other effective member rows keep
// their relation, and a current member or leader of a project that currently
// belongs to the portfolio inherits. Everything is evaluated now: a removed
// member, an expired row or a project moved out of the portfolio stops
// counting immediately.
func (a *Adapter) portfolioDocumentAccess(ctx context.Context, portfolioID int64, actor string) (portfolioDocumentAccess, error) {
	access := portfolioDocumentAccess{id: portfolioID}
	facts, err := a.portfolioOwnerPreRead(ctx, portfolioID)
	if err != nil {
		return access, err
	}
	tx, tables, err := a.beginPortfolioMemberTx(ctx)
	if err != nil {
		return access, err
	}
	defer tx.Rollback()
	var owner sql.NullString
	if err = tx.QueryRowContext(ctx, "SELECT code,owner_uid FROM project_portfolios WHERE id=?", portfolioID).Scan(&access.code, &owner); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return access, httperror.New(http.StatusNotFound, "portfolio_not_found", "项目集不存在")
		}
		return access, err
	}
	ownerUID := strings.TrimSpace(owner.String)
	if err = facts.matches(ownerUID); err != nil {
		return access, err
	}
	access.ownerInactive = facts.inactive
	if ownerUID != "" && !facts.inactive && ownerUID == actor {
		access.relation = "manager"
		return access, nil
	}
	switch err = tx.QueryRowContext(ctx, "SELECT relation_type FROM "+tables.members+" WHERE portfolio_id=? AND uid=? AND "+portfolioMemberEffective, portfolioID, actor).Scan(&access.relation); {
	case err == nil:
		if !portfolioMemberRelations[access.relation] {
			access.relation = ""
		}
		return access, nil
	case !errors.Is(err, sql.ErrNoRows):
		return access, err
	}
	var one int
	switch err = tx.QueryRowContext(ctx, `SELECT 1 FROM aims_projects p WHERE p.portfolio_id=? AND (p.leader_uid=? OR EXISTS (
		SELECT 1 FROM aims_project_members m WHERE m.project_id=p.id AND m.uid=? AND m.status='active')) LIMIT 1`, portfolioID, actor, actor).Scan(&one); {
	case err == nil:
		access.relation = portfolioRelationInherited
	case !errors.Is(err, sql.ErrNoRows):
		return access, err
	}
	return access, nil
}

// portfolioOnlyDocuments lists the documents owned by the portfolio itself.
// Project, milestone and work-item documents are never part of it.
func (a *Adapter) portfolioOnlyDocuments(ctx context.Context, portfolioID int64) ([]map[string]any, error) {
	rows, err := a.documentDB(ctx).QueryContext(ctx, `
		SELECT d.id, d.uuid, d.portfolio_id, d.project_id, d.project_code,
		       d.milestone_id, d.work_item_id, d.parent_id, d.title, d.doc_category,
		       d.is_folder, d.oss_path, d.codocs_uuid, d.document_source,
		       d.repo_project_code, d.repo_file_path, d.repo_commit_id,
		       d.content_size, d.sort_order,
		       d.created_by, d.updated_by,
		       DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
		       DATE_FORMAT(d.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM project_documents d
		WHERE d.portfolio_id = ? AND d.project_id IS NULL AND d.milestone_id IS NULL AND d.work_item_id IS NULL
		ORDER BY d.is_folder DESC, d.sort_order ASC, d.created_at ASC, d.id ASC`, portfolioID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	docs := make([]map[string]any, 0)
	for rows.Next() {
		item, err := scanDirectDocumentListItem(rows)
		if err != nil {
			return nil, err
		}
		raw, err := json.Marshal(item)
		if err != nil {
			return nil, err
		}
		var doc map[string]any
		if err = json.Unmarshal(raw, &doc); err != nil {
			return nil, err
		}
		delete(doc, "children")
		if projectDocText(doc["documentSource"]) == "" {
			doc["documentSource"] = "codocs"
		}
		doc["virtual"] = false
		doc["accessSummary"] = "项目集文档"
		docs = append(docs, doc)
	}
	return docs, rows.Err()
}

// enterprisePortfolioDocuments returns the documents of a portfolio the actor
// may currently view, or nil when the actor has no relation to it.
//
// With an inherited relation, repository documents and every document the
// policy does not open to member projects are left out entirely: neither their
// titles nor their number are observable, and a folder appears only as the
// ancestor of a visible document. 5b-1 is read only.
func (a *Adapter) enterprisePortfolioDocuments(ctx context.Context, portfolioID int64, actor string, check EnterprisePortfolioDocumentACL) (map[string]any, error) {
	access, err := a.portfolioDocumentAccess(ctx, portfolioID, actor)
	if err != nil {
		return nil, err
	}
	if access.relation == "" {
		return nil, nil
	}
	docs, err := a.portfolioOnlyDocuments(ctx, portfolioID)
	if err != nil {
		return nil, err
	}
	facts := EnterprisePortfolioDocumentAccessFacts{ActorUID: actor, PortfolioCode: access.code, Relation: access.relation}
	// Policy maintenance state, reported by the policy owner for direct
	// relations only (5b-2). Content stays read only in every case.
	policies := map[string]any{}
	// A reference whose Codocs document no longer exists (or never existed) is
	// omitted for inherited relations. Direct relations must still see it,
	// flagged, or nobody could ever clean it up.
	missing := map[string]bool{}
	out, err := filterEnterpriseProjectDocuments(ctx, docs, access.direct(), EnterpriseProjectDocumentAccessFacts{ActorUID: actor},
		func(ctx context.Context, uuid, ref string, _ EnterpriseProjectDocumentAccessFacts) (map[string]any, error) {
			acl, err := check(ctx, uuid, ref, facts)
			if err != nil || !access.direct() {
				return acl, err
			}
			if acl["allowed"] != true {
				missing[uuid] = true
				return map[string]any{"allowed": true, "readonly": true, "reason": "portfolio_source_missing", "permission": "none", "lifecycleStage": "draft", "confidentialityLevel": "L2"}, nil
			}
			if acl["policy"] != nil {
				policies[uuid] = acl["policy"]
			}
			return acl, nil
		})
	if err != nil {
		return nil, err
	}
	for _, doc := range out["items"].([]map[string]any) {
		doc["accessReadonly"] = true
		doc["policy"] = nil
		doc["missingSource"] = false
		source := firstNonEmptyProjectDoc(projectDocText(doc["codocsUuid"]), projectDocText(doc["uuid"]))
		codocs := !projectDocBool(doc["isFolder"]) && projectDocText(doc["documentSource"]) != "repo"
		if policy, ok := policies[source]; ok && codocs {
			doc["policy"] = policy
		}
		if codocs && missing[source] {
			doc["missingSource"] = true
			doc["accessPermission"] = "none"
		}
		if doc["accessReason"] == "project_member_direct" {
			doc["accessReason"] = "portfolio_member_direct"
		}
	}
	out["portfolioId"] = portfolioID
	out["portfolioCode"] = access.code
	out["relation"] = access.relation
	out["ownerInactive"] = access.ownerInactive
	out["readonly"] = true
	// total counts what items holds (folders included), so "共 N 项" matches the
	// list; documentTotal counts documents only.
	out["documentTotal"] = out["total"]
	out["total"] = len(out["items"].([]map[string]any))
	// What the actor may do through the write entry points; each write
	// rechecks the relation on locked rows.
	out["canLink"] = access.relation == "manager" || access.relation == "contributor"
	out["canManagePolicy"] = access.relation == "manager"
	return out, nil
}

// listPortfolioDocuments serves the Host portfolio document list. The Host has
// checked portfolios:view; the relation is required in addition, never instead.
func (a *Adapter) listPortfolioDocuments(ctx context.Context, rawID string, query url.Values) (map[string]any, error) {
	actor := strings.TrimSpace(query.Get("current_user"))
	if actor == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	id, err := parseID(rawID, "portfolio_id")
	if err != nil {
		return nil, err
	}
	check, _ := ctx.Value(enterprisePortfolioDocumentACLKey{}).(EnterprisePortfolioDocumentACL)
	if check == nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "document_acl_unavailable", "Document access check unavailable")
	}
	out, err := a.enterprisePortfolioDocuments(ctx, id, actor, check)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, httperror.New(http.StatusForbidden, "portfolio_document_relation_required", "需要是该项目集的成员，或组内项目的成员")
	}
	return out, nil
}

// projectPortfolioDocuments is the read-only portfolio section of a project's
// document list: the documents of the portfolio the project currently belongs
// to, filtered for the actor. It never fails the project list: when the
// portfolio facts cannot be evaluated the section is omitted and flagged.
func (a *Adapter) projectPortfolioDocuments(ctx context.Context, projectID int64, actor string) (section map[string]any, unavailable bool, err error) {
	check, _ := ctx.Value(enterprisePortfolioDocumentACLKey{}).(EnterprisePortfolioDocumentACL)
	if check == nil {
		return nil, false, nil
	}
	var portfolioID sql.NullInt64
	if err = a.DB().QueryRowContext(ctx, "SELECT portfolio_id FROM aims_projects WHERE id=?", projectID).Scan(&portfolioID); err != nil {
		return nil, false, err
	}
	if !portfolioID.Valid {
		return nil, false, nil
	}
	section, err = a.enterprisePortfolioDocuments(ctx, portfolioID.Int64, actor, check)
	if err != nil {
		var h httperror.Error
		if errors.As(err, &h) && (h.Status == http.StatusServiceUnavailable || h.Status == http.StatusConflict || h.Status == http.StatusNotFound) {
			return nil, true, nil
		}
		return nil, false, err
	}
	if section != nil {
		section["inheritedFrom"] = "portfolio"
	}
	return section, false, nil
}

// PortfolioPolicyOwners lists the Codocs documents owned by a portfolio only,
// for the policy owner reconcile command.
func (a *Adapter) PortfolioPolicyOwners(ctx context.Context) ([][2]string, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT COALESCE(NULLIF(d.codocs_uuid,''), d.uuid), pf.code
		FROM project_documents d
		INNER JOIN project_portfolios pf ON pf.id = d.portfolio_id
		WHERE d.project_id IS NULL AND d.milestone_id IS NULL AND d.work_item_id IS NULL
		  AND d.is_folder = 0 AND COALESCE(d.document_source,'codocs') = 'codocs'
		ORDER BY d.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([][2]string, 0)
	for rows.Next() {
		var uuid, code string
		if err = rows.Scan(&uuid, &code); err != nil {
			return nil, err
		}
		out = append(out, [2]string{uuid, code})
	}
	return out, rows.Err()
}

// PortfolioDocumentReader returns, in process, the Codocs metadata and body
// reference of a document the relation may read (DOC-05, 5c-2). It answers a
// fixed 404 both for a missing document and for one the relation may not read.
type PortfolioDocumentReader func(ctx context.Context, documentUUID string, facts EnterprisePortfolioDocumentAccessFacts) (map[string]any, error)

type portfolioDocumentReaderKey struct{}

func WithPortfolioDocumentReader(ctx context.Context, read PortfolioDocumentReader) context.Context {
	return context.WithValue(ctx, portfolioDocumentReaderKey{}, read)
}

// portfolioDocumentProbeUUID is read when there is nothing to read, so that a
// missing or unsupported reference takes the same query path as a real one.
const portfolioDocumentProbeUUID = "00000000-0000-4000-8000-000000000000"

func portfolioDocumentNotFound() error {
	return httperror.New(http.StatusNotFound, "portfolio_document_not_found", "项目集文档不存在")
}

// readPortfolioDocumentContent resolves one portfolio document for reading.
// The Host has checked portfolios:view; the relation is computed here.
//
// For an inherited relation every negative outcome is the same fixed 404: the
// reference does not exist, belongs to another owner, is a folder or a
// repository file (never inherited), or its policy does not open it to member
// projects. Direct relations get a specific answer for unsupported kinds.
func (a *Adapter) readPortfolioDocumentContent(ctx context.Context, rawID, rawDocumentID string, query url.Values) (map[string]any, error) {
	actor := strings.TrimSpace(query.Get("current_user"))
	if actor == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	id, err := parseID(rawID, "portfolio_id")
	if err != nil {
		return nil, err
	}
	documentID, err := parseID(rawDocumentID, "document_id")
	if err != nil {
		return nil, err
	}
	read, _ := ctx.Value(portfolioDocumentReaderKey{}).(PortfolioDocumentReader)
	if read == nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "document_acl_unavailable", "Document access check unavailable")
	}
	access, err := a.portfolioDocumentAccess(ctx, id, actor)
	if err != nil {
		return nil, err
	}
	if access.relation == "" {
		return nil, httperror.New(http.StatusForbidden, "portfolio_document_relation_required", "需要是该项目集的成员，或组内项目的成员")
	}
	var uuid, title, source, updatedAt string
	var folder int
	var parent sql.NullInt64
	err = a.documentDB(ctx).QueryRowContext(ctx, "SELECT COALESCE(NULLIF(codocs_uuid,''),uuid),title,is_folder,document_source,parent_id,DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') FROM project_documents WHERE id=? AND "+portfolioOnlyDocument, documentID, id).Scan(&uuid, &title, &folder, &source, &parent, &updatedAt)
	found := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	readable := found && folder == 0 && source == "codocs"
	if found && !readable && access.direct() {
		return nil, httperror.New(http.StatusConflict, "portfolio_document_content_unsupported", "文件夹与仓库文件暂不支持在线查看")
	}
	facts := EnterprisePortfolioDocumentAccessFacts{ActorUID: actor, PortfolioCode: access.code, Relation: access.relation}
	if !readable {
		// Same path as a real read; the answer is discarded.
		if _, err = read(ctx, portfolioDocumentProbeUUID, facts); err != nil {
			var h httperror.Error
			if !errors.As(err, &h) || h.Status != http.StatusNotFound {
				return nil, err
			}
		}
		return nil, portfolioDocumentNotFound()
	}
	out, err := read(ctx, uuid, facts)
	if err != nil {
		var h httperror.Error
		if errors.As(err, &h) && h.Status == http.StatusNotFound {
			return nil, portfolioDocumentNotFound()
		}
		return nil, err
	}
	accessOut, _ := out["access"].(map[string]any)
	sourceOut, _ := out["source"].(map[string]any)
	if accessOut == nil || sourceOut == nil || sourceOut["uuid"] != uuid || accessOut["allowed"] != true {
		return nil, httperror.New(http.StatusServiceUnavailable, "portfolio_document_content_unavailable", "Document content reference unavailable")
	}
	accessOut["relation"] = access.relation
	var parentID any
	if parent.Valid {
		parentID = parent.Int64
	}
	return map[string]any{
		"portfolioId": id, "portfolioCode": access.code,
		"document": map[string]any{"id": documentID, "title": title, "parentId": parentID, "updatedAt": updatedAt},
		"source":   sourceOut, "access": accessOut,
	}, nil
}
