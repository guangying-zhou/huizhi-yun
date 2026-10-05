package aims

import (
	"context"
	"database/sql"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strconv"
)

// Called only after the signed project's scoped read and member checks. UUID
// input selects an index, never supplies an owner or grants Codocs access.
func (a *Adapter) EnterpriseProjectDocumentUUIDTitle(ctx context.Context, projectID, uuid string) (string, error) {
	rows, err := a.documentDB(ctx).QueryContext(ctx, "SELECT id,title FROM project_documents WHERE (BINARY codocs_uuid=BINARY ? OR (codocs_uuid IS NULL AND document_source='codocs' AND BINARY uuid=BINARY ?)) AND is_folder=0", uuid, uuid)
	if err != nil {
		return "", err
	}
	type candidate struct {
		id    int64
		title string
	}
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if err = rows.Scan(&c.id, &c.title); err != nil {
			rows.Close()
			return "", err
		}
		candidates = append(candidates, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return "", err
	}
	for _, c := range candidates {
		owner, e := a.ResolveEnterpriseProjectDocumentOwner(ctx, nil, strconv.FormatInt(c.id, 10))
		if e != nil {
			var h httperror.Error
			if errors.As(e, &h) && h.Code == "project_document_portfolio_owner_unsupported" {
				continue
			}
			return "", e
		}
		if owner == projectID {
			return c.title, nil
		}
	}
	var title string
	err = a.DB().QueryRowContext(ctx, "SELECT COALESCE(NULLIF(document_title,''),name) FROM deliverables WHERE project_id=? AND deliverable_type='document' AND BINARY document_uuid=BINARY ? LIMIT 1", projectID, uuid).Scan(&title)
	if errors.Is(err, sql.ErrNoRows) {
		return "", httperror.New(403, "project_document_not_linked", "Document is not linked to this project")
	}
	return title, err
}
