package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Portfolio documents (document asset design DOC-05, batch 5b-1, read only).
//
// Runtime-only typed facts, derived by Aims from its own rows and the signed
// actor. No Service API route exposes these methods. Aims is authoritative for
// which portfolio owns a document; the policy row only contributes its
// confidentiality, permission and inheritance settings, and only when it was
// explicitly written for that portfolio.
type EnterprisePortfolioDocumentFacts struct {
	ActorUID      string
	PortfolioCode string
	// Relation is the actor's current relation to the portfolio: manager,
	// contributor or viewer for a direct relation, inherited for a member of a
	// project that currently belongs to the portfolio.
	Relation string
}

const portfolioRelationInherited = "inherited"

var portfolioDocumentRelations = map[string]bool{"manager": true, "contributor": true, "viewer": true, portfolioRelationInherited: true}

// The two policy columns are installed by a separate migration. Until then
// portfolio documents fail closed; project documents do not read them.
func portfolioPolicyUnavailable() error {
	return httperror.New(http.StatusServiceUnavailable, "codocs_portfolio_policy_unavailable", "Portfolio document policy is not installed")
}

func portfolioPolicyColumnMissing(err error) bool {
	var mysqlErr *mysql.MySQLError
	return errors.As(err, &mysqlErr) && (mysqlErr.Number == 1054 || mysqlErr.Number == 1146)
}

// CheckEnterprisePortfolioDocument decides whether the actor may view one
// portfolio document.
//
//   - A direct relation may view every document of the portfolio.
//   - An inherited relation may view only when the policy row is explicitly
//     owned by this portfolio, is L0 or L1 and has inherit_to_member_projects.
//   - A policy row that is missing, owned by a project or owned by another
//     portfolio is treated as the restrictive default (L2, not inherited). The
//     source-project-member rule is never consulted here, so a project whose
//     code equals the portfolio code gains nothing from a legacy row.
//
// Download follows default_permission of a matching policy and is never
// widened by the relation. 5b-1 is read only: the result is always readonly.
func (a *Adapter) CheckEnterprisePortfolioDocument(ctx context.Context, uuid, refType string, f EnterprisePortfolioDocumentFacts) (map[string]any, error) {
	if f.ActorUID == "" || f.PortfolioCode == "" || !portfolioDocumentRelations[f.Relation] || refType != "codocs_document" || !isValidDocumentUUID(uuid) {
		return nil, httperror.New(400, "portfolio_document_acl_input_invalid", "Invalid internal document access context")
	}
	// Missing/deleted references are omitted, even if a policy survives the doc.
	if _, err := a.documentByUUID(ctx, uuid, false); err != nil {
		var h httperror.Error
		if errors.Is(err, sql.ErrNoRows) || (errors.As(err, &h) && h.Status == 404) {
			return map[string]any{"allowed": false}, nil
		}
		return nil, err
	}
	out, _, err := a.decidePortfolioDocument(ctx, uuid, refType, f)
	return out, err
}

// decidePortfolioDocument is the single place where the portfolio document
// rule is evaluated; the list check and the content read both use it. It reads
// the policy, decides, audits (actor, relation, portfolio, document) and
// returns the decision map together with whether access is allowed.
func (a *Adapter) decidePortfolioDocument(ctx context.Context, uuid, refType string, f EnterprisePortfolioDocumentFacts) (map[string]any, bool, error) {
	var ownerType, ownerCode, stage, level, permission string
	var code sql.NullString
	var inherit bool
	err := a.db.QueryRowContext(ctx, `
		SELECT source_owner_type, source_project_code, lifecycle_stage, confidentiality_level,
		       default_permission, inherit_to_member_projects
		FROM document_access_policies
		WHERE document_ref_type = ? AND document_uuid = ?
		LIMIT 1`, refType, uuid).Scan(&ownerType, &code, &stage, &level, &permission, &inherit)
	switch {
	case err == nil:
		ownerCode = code.String
	case errors.Is(err, sql.ErrNoRows):
	case portfolioPolicyColumnMissing(err):
		return nil, false, portfolioPolicyUnavailable()
	default:
		return nil, false, err
	}
	matched := err == nil && ownerType == "portfolio" && ownerCode == f.PortfolioCode
	if !matched {
		stage, level, permission, inherit = "draft", "L2", "none", false
	}
	result := documentAccessCheckResult{Permission: "none", Readonly: true, Reason: "portfolio_inherit_not_allowed", LifecycleStage: stage, ConfidentialityLevel: level}
	switch {
	case f.Relation != portfolioRelationInherited:
		result.Allowed, result.Reason = true, "portfolio_member_direct"
	case matched && (level == "L0" || level == "L1") && inherit:
		result.Allowed, result.Reason = true, "portfolio_member_project_inherited"
	}
	if result.Allowed {
		result.Permission = "view"
		if permissionRank(permission) >= permissionRank("download") {
			result.Permission = "download"
		}
	}
	a.recordDocumentAccessAudit(ctx, documentAccessPolicy{DocumentRefType: refType, DocumentUUID: uuid, SourceProjectCode: f.PortfolioCode}, f.ActorUID, "view", result, nil, nil, []string{"portfolio:" + f.Relation})
	out := resultToMap(result)
	if f.Relation != portfolioRelationInherited {
		// Policy maintenance facts for direct relations only. A policy owned
		// elsewhere exposes nothing but that fact.
		exists := err == nil
		state := map[string]any{"exists": exists && matched, "ownedElsewhere": exists && !matched, "etag": "", "defaultPermission": permission, "inheritToMemberProjects": inherit}
		if matched {
			state["etag"] = portfolioPolicyEtag(stage, level, permission, inherit)
		}
		out["policy"] = state
	}
	return out, result.Allowed, nil
}

func portfolioDocumentNotFound() error {
	return httperror.New(http.StatusNotFound, "portfolio_document_not_found", "项目集文档不存在")
}

// ReadEnterprisePortfolioDocument returns the metadata and body reference the
// Host needs to load the content of one portfolio document (DOC-05, 5c-2),
// after the same decision as the list. Runtime-only typed call.
//
// "Not allowed" and "does not exist" are one and the same answer: the document
// row and the policy are always both read and the decision is always audited
// before the outcome is looked at, so neither the response nor the query path
// tells an inherited reader whether a document he may not see exists. Nothing
// about the document is returned unless access is allowed.
func (a *Adapter) ReadEnterprisePortfolioDocument(ctx context.Context, uuid string, f EnterprisePortfolioDocumentFacts) (map[string]any, error) {
	if f.ActorUID == "" || f.PortfolioCode == "" || !portfolioDocumentRelations[f.Relation] || !isValidDocumentUUID(uuid) {
		return nil, httperror.New(400, "portfolio_document_acl_input_invalid", "Invalid internal document access context")
	}
	source := map[string]any{}
	var id int64
	var title, docType, updatedAt string
	var path sql.NullString
	var status int64
	var deleted bool
	exists := true
	err := a.db.QueryRowContext(ctx, "SELECT id, title, doc_type, oss_path, status, deleted_at IS NOT NULL, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') FROM documents WHERE uuid = ? LIMIT 1", uuid).Scan(&id, &title, &docType, &path, &status, &deleted, &updatedAt)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		exists = false
	case err != nil:
		return nil, err
	default:
		exists = status != 0 && !deleted
	}
	access, allowed, err := a.decidePortfolioDocument(ctx, uuid, "codocs_document", f)
	if err != nil {
		return nil, err
	}
	if !exists || !allowed {
		return nil, portfolioDocumentNotFound()
	}
	source["uuid"], source["title"], source["doc_type"], source["oss_path"], source["updated_at"], source["status"] = uuid, title, docType, path.String, updatedAt, status
	// Trusted server caller: the exact published head, never sent to a browser.
	if err = a.annotateSnapshotState(ctx, []map[string]any{source}, true); err != nil {
		return nil, err
	}
	delete(access, "policy")
	return map[string]any{"source": source, "access": access}, nil
}

func portfolioPolicyEtag(stage, level, permission string, inherit bool) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{"portfolio-policy.v1", stage, level, permission, strconv.FormatBool(inherit)}, "\x00")))
	return hex.EncodeToString(sum[:8])
}

// PortfolioDocumentLinkFacts is what Aims learns before it links a Codocs
// document into a portfolio.
type PortfolioDocumentLinkFacts struct {
	Title                string
	PolicyOwnedElsewhere bool
}

// ConfirmEnterprisePortfolioDocumentSharer answers whether actor may place a
// Codocs document into a portfolio (DOC-05, 5b-2). Linking makes the document
// readable by the portfolio's members, so it requires the same capability as
// sharing: the actor must be the document's owner, and the document must not be
// deleted, recycled or read-only locked. An edit share is not enough. Called by
// Aims in process before its write transaction.
func (a *Adapter) ConfirmEnterprisePortfolioDocumentSharer(ctx context.Context, uuid, actor, portfolioCode string) (PortfolioDocumentLinkFacts, error) {
	var facts PortfolioDocumentLinkFacts
	if actor == "" || portfolioCode == "" || !isValidDocumentUUID(uuid) {
		return facts, httperror.New(400, "portfolio_document_acl_input_invalid", "Invalid internal document access context")
	}
	var owner string
	var readonly int64
	var deleted bool
	err := a.db.QueryRowContext(ctx, "SELECT title, owner_uid, COALESCE(readonly_flag,0), deleted_at IS NOT NULL FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1", uuid).Scan(&facts.Title, &owner, &readonly, &deleted)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && deleted) {
		return facts, httperror.New(http.StatusNotFound, "portfolio_document_source_not_found", "文档不存在或已删除")
	}
	if err != nil {
		return facts, err
	}
	if owner != actor {
		return PortfolioDocumentLinkFacts{}, httperror.New(http.StatusForbidden, "portfolio_document_share_required", "只有文档所有者可以把文档挂入项目集")
	}
	if readonly == 1 {
		return PortfolioDocumentLinkFacts{}, httperror.New(http.StatusForbidden, "document_readonly", "Document is readonly")
	}
	var ownerType string
	var code sql.NullString
	switch err = a.db.QueryRowContext(ctx, "SELECT source_owner_type, source_project_code FROM document_access_policies WHERE document_ref_type='codocs_document' AND document_uuid=? LIMIT 1", uuid).Scan(&ownerType, &code); {
	case err == nil:
		facts.PolicyOwnedElsewhere = !(ownerType == "portfolio" && code.String == portfolioCode)
	case errors.Is(err, sql.ErrNoRows):
	case portfolioPolicyColumnMissing(err):
		return PortfolioDocumentLinkFacts{}, portfolioPolicyUnavailable()
	default:
		return PortfolioDocumentLinkFacts{}, err
	}
	return facts, nil
}

// PortfolioDocumentPolicyInput is the desired policy of one portfolio document.
// Every field is required; ExpectedEtag is empty when no policy row exists yet.
type PortfolioDocumentPolicyInput struct {
	ActorUID, PortfolioCode, DocumentUUID              string
	LifecycleStage, Confidentiality, DefaultPermission string
	InheritToMemberProjects                            bool
	ExpectedEtag                                       string
}

// SaveEnterprisePortfolioDocumentPolicy creates or updates the access policy
// of a portfolio document (DOC-05, 5b-2). Aims has already verified, on locked
// rows, that the actor is a current manager of the portfolio and that the
// document belongs to it.
//
// It only ever touches a policy that does not exist yet or is already owned by
// this portfolio. A row owned by a project or by another portfolio is left
// alone (409): taking it over would silently remove the document from its
// owner's policy. Saving the state that is already stored is a no-op, which
// makes a replay after a lost response safe.
func (a *Adapter) SaveEnterprisePortfolioDocumentPolicy(ctx context.Context, in PortfolioDocumentPolicyInput) (map[string]any, error) {
	stages := map[string]bool{"draft": true, "formal": true, "archived": true}
	levels := map[string]bool{"L0": true, "L1": true, "L2": true, "L3": true}
	permissions := map[string]bool{"none": true, "view": true, "download": true}
	if in.ActorUID == "" || in.PortfolioCode == "" || len(in.PortfolioCode) > 100 || !isValidDocumentUUID(in.DocumentUUID) ||
		!stages[in.LifecycleStage] || !levels[in.Confidentiality] || !permissions[in.DefaultPermission] {
		return nil, httperror.New(400, "portfolio_document_policy_input_invalid", "Invalid portfolio document policy")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var one int
	if err = tx.QueryRowContext(ctx, "SELECT 1 FROM documents WHERE uuid = ? AND status <> 0 AND deleted_at IS NULL LIMIT 1 FOR SHARE", in.DocumentUUID).Scan(&one); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(http.StatusNotFound, "portfolio_document_source_not_found", "文档不存在或已删除")
		}
		return nil, err
	}
	desired := portfolioPolicyEtag(in.LifecycleStage, in.Confidentiality, in.DefaultPermission, in.InheritToMemberProjects)
	out := map[string]any{"documentUuid": in.DocumentUUID, "lifecycleStage": in.LifecycleStage, "confidentialityLevel": in.Confidentiality,
		"defaultPermission": in.DefaultPermission, "inheritToMemberProjects": in.InheritToMemberProjects, "etag": desired, "changed": true}
	var id int64
	var ownerType, stage, level, permission string
	var code sql.NullString
	var inherit bool
	err = tx.QueryRowContext(ctx, `
		SELECT id, source_owner_type, source_project_code, lifecycle_stage, confidentiality_level, default_permission, inherit_to_member_projects
		FROM document_access_policies WHERE document_ref_type='codocs_document' AND document_uuid=? FOR UPDATE`, in.DocumentUUID).Scan(&id, &ownerType, &code, &stage, &level, &permission, &inherit)
	conflict := httperror.New(http.StatusConflict, "portfolio_document_policy_conflict", "访问策略已变化，请刷新后重试")
	switch {
	case errors.Is(err, sql.ErrNoRows):
		if in.ExpectedEtag != "" {
			return nil, conflict
		}
		if _, err = tx.ExecContext(ctx, `
			INSERT INTO document_access_policies
			(document_ref_type, document_uuid, source_app, source_owner_type, source_project_code,
			 lifecycle_stage, confidentiality_level, default_permission,
			 allow_internal_access, allow_cross_project, inherit_to_member_projects, readonly, created_by, updated_by)
			VALUES ('codocs_document', ?, 'aims', 'portfolio', ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
			in.DocumentUUID, in.PortfolioCode, in.LifecycleStage, in.Confidentiality, in.DefaultPermission, boolInt(in.InheritToMemberProjects), boolInt(in.LifecycleStage == "archived"), in.ActorUID, in.ActorUID); err != nil {
			var duplicate *mysql.MySQLError
			if errors.As(err, &duplicate) && duplicate.Number == 1062 {
				return nil, conflict
			}
			if portfolioPolicyColumnMissing(err) {
				return nil, portfolioPolicyUnavailable()
			}
			return nil, err
		}
	case err != nil:
		if portfolioPolicyColumnMissing(err) {
			return nil, portfolioPolicyUnavailable()
		}
		return nil, err
	case ownerType != "portfolio" || code.String != in.PortfolioCode:
		return nil, httperror.New(http.StatusConflict, "portfolio_document_policy_owned_elsewhere", "该文档的访问策略属于其它项目或项目集，不能在此修改")
	default:
		current := portfolioPolicyEtag(stage, level, permission, inherit)
		if current == desired {
			out["changed"] = false
			return out, nil
		}
		if in.ExpectedEtag != current {
			return nil, conflict
		}
		if _, err = tx.ExecContext(ctx, `
			UPDATE document_access_policies
			SET lifecycle_stage=?, confidentiality_level=?, default_permission=?, inherit_to_member_projects=?,
			    readonly=IF(?='archived', 1, readonly), updated_by=?
			WHERE id=?`, in.LifecycleStage, in.Confidentiality, in.DefaultPermission, boolInt(in.InheritToMemberProjects), in.LifecycleStage, in.ActorUID, id); err != nil {
			return nil, err
		}
	}
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO document_access_audit_logs
		(document_ref_type, document_uuid, actor_uid, action, decision, reason, source_project_code, actor_project_codes)
		VALUES ('codocs_document', ?, ?, 'policy_update', 'allow', 'portfolio_policy_updated', ?, JSON_OBJECT('lifecycleStage', ?, 'confidentialityLevel', ?, 'defaultPermission', ?, 'inheritToMemberProjects', ?))`,
		in.DocumentUUID, in.ActorUID, in.PortfolioCode, in.LifecycleStage, in.Confidentiality, in.DefaultPermission, in.InheritToMemberProjects); err != nil {
		return nil, err
	}
	return out, tx.Commit()
}

// PortfolioPolicyOwner states that the policy of one Codocs document belongs to
// a portfolio. Aims derives it from its portfolio-only document rows.
type PortfolioPolicyOwner struct {
	DocumentUUID  string `json:"documentUuid"`
	PortfolioCode string `json:"portfolioCode"`
}

type PortfolioPolicyOwnerChange struct {
	PortfolioPolicyOwner
	FromOwnerType string `json:"fromOwnerType"`
	FromOwnerCode string `json:"fromOwnerCode"`
}

type PortfolioPolicyOwnerReport struct {
	Applied   bool                         `json:"applied"`
	Desired   int                          `json:"desired"`
	NoPolicy  int                          `json:"noPolicy"`
	Unchanged int                          `json:"unchanged"`
	Changes   []PortfolioPolicyOwnerChange `json:"changes"`
}

// ReconcilePortfolioPolicyOwners marks existing policy rows of portfolio-only
// documents as owned by their portfolio. It only updates the two owner fields
// of rows that already exist: a document without a policy row keeps the
// restrictive default. Dry run unless apply is set; applying is idempotent.
// Used by the reconcile command only.
func (a *Adapter) ReconcilePortfolioPolicyOwners(ctx context.Context, owners []PortfolioPolicyOwner, operator string, apply bool) (PortfolioPolicyOwnerReport, error) {
	report := PortfolioPolicyOwnerReport{Applied: apply, Desired: len(owners), Changes: []PortfolioPolicyOwnerChange{}}
	if a == nil || a.db == nil {
		return report, portfolioPolicyUnavailable()
	}
	owners = append([]PortfolioPolicyOwner(nil), owners...)
	sort.Slice(owners, func(i, j int) bool { return owners[i].DocumentUUID < owners[j].DocumentUUID })
	seen := map[string]bool{}
	for _, owner := range owners {
		if !isValidDocumentUUID(owner.DocumentUUID) || owner.PortfolioCode == "" || len(owner.PortfolioCode) > 100 || seen[owner.DocumentUUID] || operator == "" {
			return report, httperror.New(400, "portfolio_policy_owner_input_invalid", "Invalid portfolio policy owner input")
		}
		seen[owner.DocumentUUID] = true
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return report, err
	}
	defer tx.Rollback()
	for _, owner := range owners {
		var id int64
		var ownerType string
		var code sql.NullString
		query := "SELECT id, source_owner_type, source_project_code FROM document_access_policies WHERE document_ref_type='codocs_document' AND document_uuid=?"
		if apply {
			query += " FOR UPDATE"
		}
		err = tx.QueryRowContext(ctx, query, owner.DocumentUUID).Scan(&id, &ownerType, &code)
		if errors.Is(err, sql.ErrNoRows) {
			report.NoPolicy++
			continue
		}
		if err != nil {
			if portfolioPolicyColumnMissing(err) {
				return report, portfolioPolicyUnavailable()
			}
			return report, err
		}
		if ownerType == "portfolio" && code.String == owner.PortfolioCode {
			report.Unchanged++
			continue
		}
		report.Changes = append(report.Changes, PortfolioPolicyOwnerChange{PortfolioPolicyOwner: owner, FromOwnerType: ownerType, FromOwnerCode: code.String})
		if !apply {
			continue
		}
		if _, err = tx.ExecContext(ctx, "UPDATE document_access_policies SET source_owner_type='portfolio', source_project_code=?, updated_by=? WHERE id=?", owner.PortfolioCode, operator, id); err != nil {
			return report, err
		}
		if _, err = tx.ExecContext(ctx, `
			INSERT INTO document_access_audit_logs
			(document_ref_type, document_uuid, actor_uid, action, decision, reason, source_project_code, actor_project_codes)
			VALUES ('codocs_document', ?, ?, 'policy_update', 'allow', 'portfolio_owner_reconciled', ?, JSON_OBJECT('fromOwnerType', ?, 'fromOwnerCode', ?))`,
			owner.DocumentUUID, operator, owner.PortfolioCode, ownerType, code.String); err != nil {
			return report, err
		}
	}
	if !apply {
		return report, nil
	}
	return report, tx.Commit()
}
