package aims

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/documentcatalog"
)

// Document catalog source (document asset design DOC-07).
//
// Aims owns three kinds of documents whose content is not in Codocs: project
// documents that reference a repository file, baselined requirement
// specifications and frozen project weekly reports. This file states which of
// them should be registered right now; the catalog store reconciles to it.
// Only metadata leaves Aims. Reading the content, and deciding who may read
// it, stays with the Aims entry points.
const (
	catalogKindRepoDocument    = "project_repo_document"
	catalogKindRequirementSpec = "requirement_spec"
	catalogKindWeeklyReport    = "project_weekly_report"
)

// DocumentCatalogKinds lists the kinds Aims registers.
func DocumentCatalogKinds() []string {
	return []string{catalogKindRepoDocument, catalogKindRequirementSpec, catalogKindWeeklyReport}
}

// DocumentCatalogSync is injected by Runtime construction. It requests a
// reconcile of the given kind, narrowed by filter, after an Aims transaction
// commits. It must never fail, block or delay the business operation.
type DocumentCatalogSync func(kind string, filter documentcatalog.Filter)

func (a *Adapter) ConfigureDocumentCatalogSync(sync DocumentCatalogSync) {
	a.documentCatalogSync = sync
}

func (a *Adapter) syncDocumentCatalog(kind string, filter documentcatalog.Filter) {
	// Post-commit triggers are always targeted; the whole kind is reserved for
	// the reconcile command.
	if a != nil && a.documentCatalogSync != nil && (len(filter.ObjectIDs) > 0 || filter.OwnerCode != "") {
		a.documentCatalogSync(kind, filter)
	}
}

func catalogIDFilter(column string, ids []string) (string, []any, error) {
	if len(ids) == 0 {
		return "", nil, nil
	}
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		value, err := strconv.ParseInt(id, 10, 64)
		if err != nil || value <= 0 {
			return "", nil, documentcatalog.ErrInvalid
		}
		args = append(args, value)
	}
	return " AND " + column + " IN (" + strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",") + ")", args, nil
}

// DocumentCatalogEntries returns the entries of one kind that should currently
// be registered, narrowed by filter. Repository documents can be narrowed to
// one owning project; the other kinds are narrowed by object.
func (a *Adapter) DocumentCatalogEntries(ctx context.Context, kind string, filter documentcatalog.Filter) ([]documentcatalog.Entry, error) {
	if filter.OwnerCode != "" && (kind != catalogKindRepoDocument || (filter.OwnerType != "project" && filter.OwnerType != "portfolio")) {
		return nil, documentcatalog.ErrInvalid
	}
	switch kind {
	case catalogKindRepoDocument:
		return a.repoDocumentCatalogEntries(ctx, filter.ObjectIDs, filter.OwnerType, filter.OwnerCode)
	case catalogKindRequirementSpec:
		return a.requirementSpecCatalogEntries(ctx, filter.ObjectIDs)
	case catalogKindWeeklyReport:
		return a.weeklyReportCatalogEntries(ctx, filter.ObjectIDs)
	}
	return nil, documentcatalog.ErrInvalid
}

func (a *Adapter) repoDocumentCatalogEntries(ctx context.Context, ids []string, ownerType, ownerCode string) ([]documentcatalog.Entry, error) {
	filter, args, err := catalogIDFilter("d.id", ids)
	if err != nil {
		return nil, err
	}
	switch {
	case ownerCode == "":
	case ownerType == "portfolio":
		// Documents owned by the portfolio itself, never its projects' documents.
		filter += " AND d.project_id IS NULL AND pf.code=?"
		args = append(args, ownerCode)
	default:
		filter += " AND p.project_code=?"
		args = append(args, ownerCode)
	}
	rows, err := a.DB().QueryContext(ctx, `SELECT d.id,d.title,COALESCE(p.project_code,''),COALESCE(pf.code,''),d.repo_project_code,d.repo_file_path,COALESCE(d.repo_commit_id,'')
		FROM project_documents d
		LEFT JOIN aims_projects p ON p.id=d.project_id
		LEFT JOIN project_portfolios pf ON pf.id=d.portfolio_id
		WHERE d.document_source='repo' AND d.is_folder=0 AND COALESCE(d.repo_project_code,'')<>'' AND COALESCE(d.repo_file_path,'')<>''`+filter+` ORDER BY d.id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]documentcatalog.Entry, 0)
	for rows.Next() {
		var id int64
		var title, project, portfolio, repo, file, commit string
		if err = rows.Scan(&id, &title, &project, &portfolio, &repo, &file, &commit); err != nil {
			return nil, err
		}
		entry := documentcatalog.Entry{App: "aims", Kind: catalogKindRepoDocument, ObjectID: strconv.FormatInt(id, 10), Title: title, OwnerType: "project", OwnerCode: project, Revision: commit,
			Locator: map[string]any{"integrationCode": "gitlab.default", "repoPath": repo, "filePath": file}}
		if project == "" {
			// A portfolio-only document; skip rows that have no owner at all.
			if portfolio == "" {
				continue
			}
			entry.OwnerType, entry.OwnerCode = "portfolio", portfolio
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}

// One entry per project that has baselined requirement content. The revision
// is the hash of the baselined chapters in a stable order, so it changes
// exactly when the baseline does.
func (a *Adapter) requirementSpecCatalogEntries(ctx context.Context, ids []string) ([]documentcatalog.Entry, error) {
	filter, args, err := catalogIDFilter("c.project_id", ids)
	if err != nil {
		return nil, err
	}
	rows, err := a.DB().QueryContext(ctx, `SELECT c.project_id,p.project_code,p.name,c.id,c.version_no,c.title,COALESCE(c.content_md,'')
		FROM requirement_contents c JOIN aims_projects p ON p.id=c.project_id
		WHERE c.version_status='baselined'`+filter+` ORDER BY c.project_id,c.id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]documentcatalog.Entry, 0)
	var current int64
	hash := sha256.New()
	var code, name string
	flush := func() {
		if current == 0 {
			return
		}
		sum := hex.EncodeToString(hash.Sum(nil))
		out = append(out, documentcatalog.Entry{App: "aims", Kind: catalogKindRequirementSpec, ObjectID: strconv.FormatInt(current, 10), Title: name + " 需求规格书", OwnerType: "project", OwnerCode: code, Revision: sum, ContentSHA256: sum,
			Locator: map[string]any{"app": "aims", "kind": catalogKindRequirementSpec, "projectId": strconv.FormatInt(current, 10), "objectId": strconv.FormatInt(current, 10)}})
	}
	for rows.Next() {
		var project, id int64
		var version int
		var projectCode, projectName, title, content string
		if err = rows.Scan(&project, &projectCode, &projectName, &id, &version, &title, &content); err != nil {
			return nil, err
		}
		if project != current {
			flush()
			current, code, name = project, projectCode, projectName
			hash = sha256.New()
		}
		// Length-prefixed fields: chapter boundaries cannot be forged by content.
		fmt.Fprintf(hash, "%d:%d:%d:%s%d:%s", id, version, len(title), title, len(content), content)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	flush()
	return out, nil
}

// One entry per weekly report that has a frozen version.
func (a *Adapter) weeklyReportCatalogEntries(ctx context.Context, ids []string) ([]documentcatalog.Entry, error) {
	filter, args, err := catalogIDFilter("r.id", ids)
	if err != nil {
		return nil, err
	}
	rows, err := a.DB().QueryContext(ctx, `SELECT r.id,r.project_id,p.project_code,p.name,r.report_year,r.report_week,v.version_no,v.fact_snapshot_sha256
		FROM project_weekly_reports r
		JOIN project_weekly_report_versions v ON v.id=r.current_frozen_version_id AND v.report_id=r.id
		JOIN aims_projects p ON p.id=r.project_id
		WHERE r.status='frozen'`+filter+` ORDER BY r.id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]documentcatalog.Entry, 0)
	for rows.Next() {
		var id, project int64
		var year, week, version int
		var code, name, snapshot string
		if err = rows.Scan(&id, &project, &code, &name, &year, &week, &version, &snapshot); err != nil {
			return nil, err
		}
		entry := documentcatalog.Entry{App: "aims", Kind: catalogKindWeeklyReport, ObjectID: strconv.FormatInt(id, 10), Title: fmt.Sprintf("%s %d年第%d周项目周报", name, year, week), OwnerType: "project", OwnerCode: code, Revision: strconv.Itoa(version),
			Locator: map[string]any{"app": "aims", "kind": catalogKindWeeklyReport, "projectId": strconv.FormatInt(project, 10), "objectId": strconv.FormatInt(id, 10)}}
		if len(snapshot) == 64 {
			entry.ContentSHA256 = strings.ToLower(snapshot)
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}
