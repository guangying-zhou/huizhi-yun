package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/documentcatalog"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Portfolio document writes (document asset design DOC-05, batch 5b-2):
// linking an existing Codocs document or a file of the registered document
// repository, folders, removing a reference and maintaining the access policy.
// Creating document content inside a portfolio is deliberately not offered:
// Codocs has no portfolio ownership yet.
//
// The Host has checked portfolios:edit. The relation is rechecked here on
// locked rows from the signed actor, so a replay after the relation was revoked
// is rejected like a first attempt. The project document entry points still
// refuse portfolio-owned documents; these are the only writers.

// PortfolioDocumentSharer confirms, in process and before the Aims write
// transaction, that the actor may place a Codocs document into the portfolio.
type PortfolioDocumentSharer func(ctx context.Context, documentUUID, actor, portfolioCode string) (policyOwnedElsewhere bool, err error)

// PortfolioDocumentPolicy is the desired access policy of one document.
type PortfolioDocumentPolicy struct {
	ActorUID, PortfolioCode, DocumentUUID              string
	LifecycleStage, Confidentiality, DefaultPermission string
	InheritToMemberProjects                            bool
	ExpectedEtag                                       string
}

// PortfolioDocumentPolicySaver writes the authoritative Codocs policy.
type PortfolioDocumentPolicySaver func(ctx context.Context, policy PortfolioDocumentPolicy) (map[string]any, error)

type portfolioDocumentSharerKey struct{}
type portfolioDocumentPolicySaverKey struct{}

func WithPortfolioDocumentSharer(ctx context.Context, check PortfolioDocumentSharer) context.Context {
	return context.WithValue(ctx, portfolioDocumentSharerKey{}, check)
}

func WithPortfolioDocumentPolicySaver(ctx context.Context, save PortfolioDocumentPolicySaver) context.Context {
	return context.WithValue(ctx, portfolioDocumentPolicySaverKey{}, save)
}

var (
	portfolioDocumentUUID     = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	portfolioDocumentRepoFile = regexp.MustCompile(`^[^\x00-\x1f\\]+$`)
	portfolioDocumentCommit   = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)
)

const portfolioOnlyDocument = "portfolio_id=? AND project_id IS NULL AND milestone_id IS NULL AND work_item_id IS NULL"

type portfolioDocumentWriter struct {
	id       int64
	code     string
	actor    string
	relation string // manager, contributor, viewer or empty
	tables   portfolioMemberTables
}

// lockPortfolioDocumentWriter locks the portfolio row and reads the actor's
// direct relation inside the write transaction. An inherited relation never
// writes. facts is the Directory pre-read of the owner, bound to the locked row.
func lockPortfolioDocumentWriter(ctx context.Context, tx *sql.Tx, tables portfolioMemberTables, portfolioID int64, actor string, facts portfolioOwnerFacts) (portfolioDocumentWriter, error) {
	writer := portfolioDocumentWriter{id: portfolioID, actor: actor, tables: tables}
	var owner sql.NullString
	if err := tx.QueryRowContext(ctx, "SELECT code,owner_uid FROM project_portfolios WHERE id=? FOR UPDATE", portfolioID).Scan(&writer.code, &owner); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return writer, httperror.New(http.StatusNotFound, "portfolio_not_found", "项目集不存在")
		}
		return writer, err
	}
	ownerUID := strings.TrimSpace(owner.String)
	if err := facts.matches(ownerUID); err != nil {
		return writer, err
	}
	if ownerUID != "" && !facts.inactive && ownerUID == actor {
		writer.relation = "manager"
		return writer, nil
	}
	err := tx.QueryRowContext(ctx, "SELECT relation_type FROM "+tables.members+" WHERE portfolio_id=? AND uid=? AND "+portfolioMemberEffective+" FOR UPDATE", portfolioID, actor).Scan(&writer.relation)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return writer, err
	}
	if !portfolioMemberRelations[writer.relation] {
		writer.relation = ""
	}
	return writer, nil
}

func portfolioDocumentActor(query url.Values) (string, error) {
	actor := strings.TrimSpace(query.Get("current_user"))
	if actor == "" {
		return "", httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	return actor, nil
}

func portfolioDocumentInputInvalid(message string) error {
	return httperror.New(http.StatusBadRequest, "portfolio_document_input_invalid", message)
}

// createPortfolioDocument links a document into a portfolio or creates a folder.
//
// The owner is the portfolio in the path and nothing else: the body cannot name
// a project, milestone, work item or portfolio. uuid is the caller-generated
// identity of the reference and makes a retry return the same row.
func (a *Adapter) createPortfolioDocument(ctx context.Context, rawID string, query url.Values, body map[string]any) (map[string]any, error) {
	actor, err := portfolioDocumentActor(query)
	if err != nil {
		return nil, err
	}
	id, err := parseID(rawID, "portfolio_id")
	if err != nil {
		return nil, err
	}
	for key := range body {
		switch key {
		case "uuid", "title", "parentId", "isFolder", "docCategory", "documentSource", "codocsUuid", "repoFilePath", "repoCommitId":
		default:
			return nil, portfolioDocumentInputInvalid("Unsupported document field")
		}
	}
	uuid, title := firstBodyText(body, "uuid"), strings.TrimSpace(firstBodyText(body, "title"))
	if !portfolioDocumentUUID.MatchString(uuid) || title == "" || len([]rune(title)) > 255 {
		return nil, portfolioDocumentInputInvalid("Document uuid and title are required")
	}
	folder := false
	if raw, has := body["isFolder"]; has {
		value, ok := raw.(bool)
		if !ok {
			return nil, portfolioDocumentInputInvalid("isFolder must be a boolean")
		}
		folder = value
	}
	var parentID int64
	if raw, has := body["parentId"]; has && raw != nil {
		if parentID = portfolioBodyInt(body, "parentId"); parentID <= 0 {
			return nil, portfolioDocumentInputInvalid("Invalid parent folder")
		}
	}
	category := firstBodyText(body, "docCategory")
	if len(category) > 50 {
		return nil, portfolioDocumentInputInvalid("Invalid document category")
	}
	source := firstBodyText(body, "documentSource")
	codocsUUID, repoFile, repoCommit := firstBodyText(body, "codocsUuid"), firstBodyText(body, "repoFilePath"), firstBodyText(body, "repoCommitId")
	switch {
	case folder:
		if source != "" || codocsUUID != "" || repoFile != "" || repoCommit != "" {
			return nil, portfolioDocumentInputInvalid("A folder has no content reference")
		}
		source = "codocs"
	case source == "repo":
		if codocsUUID != "" || repoFile == "" || len(repoFile) > 500 || strings.HasPrefix(repoFile, "/") || strings.Contains(repoFile, "..") || !portfolioDocumentRepoFile.MatchString(repoFile) ||
			!portfolioDocumentCommit.MatchString(repoCommit) {
			return nil, portfolioDocumentInputInvalid("A repository file and its commit are required")
		}
	case source == "" || source == "codocs":
		source = "codocs"
		if !portfolioDocumentUUID.MatchString(codocsUUID) || repoFile != "" || repoCommit != "" {
			return nil, portfolioDocumentInputInvalid("The Codocs document to link is required")
		}
	default:
		return nil, portfolioDocumentInputInvalid("Invalid document source")
	}

	facts, err := a.portfolioOwnerPreRead(ctx, id)
	if err != nil {
		return nil, err
	}
	// Share capability first, outside the Aims transaction: linking exposes the
	// document to the portfolio, so only its Codocs owner may do it.
	ownedElsewhere := false
	var checkedCode string
	if !folder && source == "codocs" {
		check, _ := ctx.Value(portfolioDocumentSharerKey{}).(PortfolioDocumentSharer)
		if check == nil {
			return nil, httperror.New(http.StatusServiceUnavailable, "document_acl_unavailable", "Document access check unavailable")
		}
		if err = a.DB().QueryRowContext(ctx, "SELECT code FROM project_portfolios WHERE id=?", id).Scan(&checkedCode); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, httperror.New(http.StatusNotFound, "portfolio_not_found", "项目集不存在")
			}
			return nil, err
		}
		if ownedElsewhere, err = check(ctx, codocsUUID, actor, checkedCode); err != nil {
			return nil, err
		}
	}

	tx, tables, err := a.beginPortfolioMemberTx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	writer, err := lockPortfolioDocumentWriter(ctx, tx, tables, id, actor, facts)
	if err != nil {
		return nil, err
	}
	if writer.relation != "manager" && writer.relation != "contributor" {
		return nil, httperror.New(http.StatusForbidden, "portfolio_document_write_denied", "需要是该项目集的管理者或参与者")
	}
	if checkedCode != "" && checkedCode != writer.code {
		return nil, httperror.New(http.StatusConflict, "portfolio_changed", "项目集已变化，请刷新后重试")
	}
	var parent any
	if parentID > 0 {
		var isFolder int
		err = tx.QueryRowContext(ctx, "SELECT is_folder FROM project_documents WHERE id=? AND "+portfolioOnlyDocument+" FOR SHARE", parentID, id).Scan(&isFolder)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && isFolder == 0) {
			return nil, portfolioDocumentInputInvalid("The parent must be a folder of this portfolio")
		}
		if err != nil {
			return nil, err
		}
		parent = parentID
	}
	var repoCode, codocsRef, repoFileRef, repoCommitRef any
	switch {
	case folder:
	case source == "repo":
		var path string
		err = tx.QueryRowContext(ctx, "SELECT repo_path FROM "+tables.repos+" WHERE portfolio_id=? FOR SHARE", id).Scan(&path)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(http.StatusConflict, "portfolio_doc_repo_required", "请先为项目集登记文档仓库")
		}
		if err != nil {
			return nil, err
		}
		if len(path) > 50 {
			// project_documents.repo_project_code is VARCHAR(50).
			return nil, httperror.New(http.StatusConflict, "portfolio_doc_repo_unsupported", "登记的文档仓库路径超过 50 个字符，暂不能引用其文件")
		}
		repoCode, repoFileRef, repoCommitRef = path, repoFile, repoCommit
	default:
		var linked int64
		err = tx.QueryRowContext(ctx, "SELECT id FROM project_documents WHERE "+portfolioOnlyDocument+" AND codocs_uuid=? AND uuid<>? LIMIT 1 FOR SHARE", id, codocsUUID, uuid).Scan(&linked)
		if err == nil {
			return nil, httperror.New(http.StatusConflict, "portfolio_document_already_linked", "该文档已在此项目集中")
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		codocsRef = codocsUUID
	}
	var categoryRef any
	if category != "" {
		categoryRef = category
	}
	args := []any{uuid, id, parent, title, categoryRef, boolToInt(folder), codocsRef, source, repoCode, repoFileRef, repoCommitRef, actor}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO project_documents
		  (uuid, portfolio_id, parent_id, title, doc_category, is_folder, codocs_uuid, document_source,
		   repo_project_code, repo_file_path, repo_commit_id, content_size, created_by, updated_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`, append(args, actor)...)
	var documentID int64
	replayed := false
	if err != nil {
		var duplicate *mysql.MySQLError
		if !errors.As(err, &duplicate) || duplicate.Number != 1062 {
			return nil, err
		}
		// Same uuid: only the identical creation by the same actor is a replay.
		err = tx.QueryRowContext(ctx, `SELECT id FROM project_documents WHERE uuid=? AND portfolio_id=? AND project_id IS NULL
			AND milestone_id IS NULL AND work_item_id IS NULL AND parent_id <=> ? AND title=? AND doc_category <=> ? AND is_folder=?
			AND codocs_uuid <=> ? AND document_source=? AND repo_project_code <=> ? AND repo_file_path <=> ? AND repo_commit_id <=> ?
			AND created_by=? LIMIT 1`, args...).Scan(&documentID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(http.StatusConflict, "document_uuid_conflict", "Document UUID already belongs to a different creation")
		}
		if err != nil {
			return nil, err
		}
		replayed = true
	} else if documentID, err = result.LastInsertId(); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	if source == "repo" {
		a.syncDocumentCatalog(catalogKindRepoDocument, documentcatalog.Filter{OwnerType: "portfolio", OwnerCode: writer.code})
	}
	return map[string]any{"id": documentID, "uuid": uuid, "title": title, "isFolder": folder, "parentId": parent, "documentSource": source,
		"portfolioId": id, "policyOwnedElsewhere": ownedElsewhere, "replayed": replayed}, nil
}

// deletePortfolioDocument removes a reference (or an empty folder tree) from
// the portfolio. Codocs content, shares and policies are never touched.
func (a *Adapter) deletePortfolioDocument(ctx context.Context, rawID, rawDocumentID string, query url.Values) (map[string]any, error) {
	actor, err := portfolioDocumentActor(query)
	if err != nil {
		return nil, err
	}
	id, err := parseID(rawID, "portfolio_id")
	if err != nil {
		return nil, err
	}
	documentID, err := parseID(rawDocumentID, "document_id")
	if err != nil {
		return nil, err
	}
	facts, err := a.portfolioOwnerPreRead(ctx, id)
	if err != nil {
		return nil, err
	}
	tx, tables, err := a.beginPortfolioMemberTx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	writer, err := lockPortfolioDocumentWriter(ctx, tx, tables, id, actor, facts)
	if err != nil {
		return nil, err
	}
	if writer.relation != "manager" && writer.relation != "contributor" {
		return nil, httperror.New(http.StatusForbidden, "portfolio_document_write_denied", "需要是该项目集的管理者或参与者")
	}
	var creator string
	var folder int
	err = tx.QueryRowContext(ctx, "SELECT created_by,is_folder FROM project_documents WHERE id=? AND "+portfolioOnlyDocument+" FOR UPDATE", documentID, id).Scan(&creator, &folder)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "portfolio_document_not_found", "项目集文档不存在")
	}
	if err != nil {
		return nil, err
	}
	if writer.relation != "manager" && (folder != 0 || creator != actor) {
		return nil, httperror.New(http.StatusForbidden, "portfolio_document_delete_denied", "仅项目集管理者或登记人可以移除该文档")
	}
	// Verify every descendant before deleting any row; never leave an owner
	// boundary to a database cascade.
	ids := []int64{documentID}
	for cursor := 0; cursor < len(ids); cursor++ {
		if len(ids) > 1000 {
			return nil, httperror.New(http.StatusServiceUnavailable, "portfolio_document_tree_limit", "Document tree exceeds the verification limit")
		}
		rows, e := tx.QueryContext(ctx, "SELECT id,is_folder,("+portfolioOnlyDocument+") FROM project_documents WHERE parent_id=? ORDER BY id FOR UPDATE", id, ids[cursor])
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var child int64
			var childFolder int
			var same bool
			if e = rows.Scan(&child, &childFolder, &same); e != nil {
				rows.Close()
				return nil, e
			}
			if !same {
				rows.Close()
				return nil, httperror.New(http.StatusForbidden, "portfolio_document_owner_mismatch", "A descendant belongs to another owner")
			}
			if childFolder == 0 {
				rows.Close()
				return nil, httperror.New(http.StatusConflict, "portfolio_document_folder_not_empty", "请先移出或移除文件夹内的文档")
			}
			for _, seen := range ids {
				if seen == child {
					rows.Close()
					return nil, httperror.New(http.StatusConflict, "portfolio_document_tree_invalid", "Document tree contains a cycle")
				}
			}
			ids = append(ids, child)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
	}
	for i := len(ids) - 1; i >= 0; i-- {
		if _, err = tx.ExecContext(ctx, "DELETE FROM project_documents WHERE id=?", ids[i]); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	a.syncDocumentCatalog(catalogKindRepoDocument, documentcatalog.Filter{OwnerType: "portfolio", OwnerCode: writer.code})
	return map[string]any{"id": documentID, "portfolioId": id, "removed": len(ids)}, nil
}

// savePortfolioDocumentPolicy maintains the access policy of one linked Codocs
// document. Managers only.
//
// Codocs holds the authoritative policy and is written first, in process, while
// this transaction keeps the portfolio and member rows locked; the Aims columns
// are a display mirror updated afterwards. If the mirror update is lost, saving
// the same state again repairs it: Codocs treats the stored state as a no-op.
func (a *Adapter) savePortfolioDocumentPolicy(ctx context.Context, rawID, rawDocumentID string, query url.Values, body map[string]any) (map[string]any, error) {
	actor, err := portfolioDocumentActor(query)
	if err != nil {
		return nil, err
	}
	id, err := parseID(rawID, "portfolio_id")
	if err != nil {
		return nil, err
	}
	documentID, err := parseID(rawDocumentID, "document_id")
	if err != nil {
		return nil, err
	}
	text := map[string]string{}
	for _, key := range []string{"lifecycleStage", "confidentialityLevel", "defaultPermission", "expectedEtag"} {
		value, ok := body[key].(string)
		if !ok {
			return nil, portfolioDocumentInputInvalid("Policy fields are required")
		}
		text[key] = value
	}
	inherit, ok := body["inheritToMemberProjects"].(bool)
	if !ok || len(body) != 5 || len(text["expectedEtag"]) > 64 {
		return nil, portfolioDocumentInputInvalid("Policy fields are required")
	}
	stage, level, permission := text["lifecycleStage"], text["confidentialityLevel"], text["defaultPermission"]
	if (stage != "draft" && stage != "formal" && stage != "archived") || (level != "L0" && level != "L1" && level != "L2" && level != "L3") ||
		(permission != "none" && permission != "view" && permission != "download") {
		return nil, portfolioDocumentInputInvalid("Invalid policy field")
	}
	save, _ := ctx.Value(portfolioDocumentPolicySaverKey{}).(PortfolioDocumentPolicySaver)
	if save == nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "document_acl_unavailable", "Document policy service unavailable")
	}
	facts, err := a.portfolioOwnerPreRead(ctx, id)
	if err != nil {
		return nil, err
	}
	tx, tables, err := a.beginPortfolioMemberTx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	writer, err := lockPortfolioDocumentWriter(ctx, tx, tables, id, actor, facts)
	if err != nil {
		return nil, err
	}
	if writer.relation != "manager" {
		return nil, httperror.New(http.StatusForbidden, "portfolio_document_manager_required", "仅项目集管理者可以维护文档访问策略")
	}
	var uuid string
	var folder int
	var source string
	err = tx.QueryRowContext(ctx, "SELECT COALESCE(NULLIF(codocs_uuid,''),uuid),is_folder,document_source FROM project_documents WHERE id=? AND "+portfolioOnlyDocument+" FOR UPDATE", documentID, id).Scan(&uuid, &folder, &source)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "portfolio_document_not_found", "项目集文档不存在")
	}
	if err != nil {
		return nil, err
	}
	if folder != 0 || source != "codocs" {
		return nil, httperror.New(http.StatusConflict, "portfolio_document_policy_unsupported", "文件夹与仓库文档没有可维护的访问策略")
	}
	out, err := save(ctx, PortfolioDocumentPolicy{ActorUID: actor, PortfolioCode: writer.code, DocumentUUID: uuid, LifecycleStage: stage,
		Confidentiality: level, DefaultPermission: permission, InheritToMemberProjects: inherit, ExpectedEtag: text["expectedEtag"]})
	if err != nil {
		return nil, err
	}
	summary := "项目集成员"
	if inherit && (level == "L0" || level == "L1") {
		summary = "项目集成员及组内项目成员"
	}
	if _, err = tx.ExecContext(ctx, "UPDATE project_documents SET access_lifecycle_stage=?,access_confidentiality_level=?,access_summary=?,updated_by=? WHERE id=?", stage, level, summary, actor, documentID); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	out["id"] = documentID
	out["portfolioId"] = id
	out["accessSummary"] = summary
	return out, nil
}

// portfolioDocumentSubroute splits "documents/{id}" and "documents/{id}/policy".
func portfolioDocumentSubroute(sub string) (documentID string, policy bool, ok bool) {
	rest := strings.TrimPrefix(sub, "documents/")
	if rest == sub || rest == "" {
		return "", false, false
	}
	documentID, tail, found := strings.Cut(rest, "/")
	if _, err := strconv.ParseInt(documentID, 10, 64); err != nil || (found && tail != "policy") {
		return "", false, false
	}
	return documentID, found, true
}
