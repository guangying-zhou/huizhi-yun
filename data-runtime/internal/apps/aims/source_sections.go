package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type sourceSectionAnchor struct {
	ID                  int64  `json:"id"`
	SourceDocumentUUID  string `json:"sourceDocumentUuid"`
	SourceDocumentTitle string `json:"sourceDocumentTitle"`
	HeadingAnchor       string `json:"headingAnchor"`
	HeadingDepth        int64  `json:"headingDepth"`
	SortOrder           int64  `json:"sortOrder"`
}

func (a *Adapter) workItemSourceSectionAnchors(ctx context.Context, workItemID string, query url.Values) (map[string]any, error) {
	workItemID = strings.TrimSpace(workItemID)
	if workItemID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_work_item_id", "work item id is required")
	}
	if strings.TrimSpace(query.Get("current_user")) == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, source_document_uuid, source_document_title, heading_anchor, heading_depth, sort_order
		FROM work_item_source_anchors
		WHERE work_item_id = ?
		ORDER BY sort_order ASC, id ASC
	`, workItemID)
	if err != nil {
		return nil, fmt.Errorf("query source section anchors: %w", err)
	}
	defer rows.Close()

	anchors := make([]sourceSectionAnchor, 0)
	for rows.Next() {
		var anchor sourceSectionAnchor
		var sourceDocumentTitle sql.NullString
		if err := rows.Scan(
			&anchor.ID,
			&anchor.SourceDocumentUUID,
			&sourceDocumentTitle,
			&anchor.HeadingAnchor,
			&anchor.HeadingDepth,
			&anchor.SortOrder,
		); err != nil {
			return nil, fmt.Errorf("scan source section anchor: %w", err)
		}
		anchor.SourceDocumentTitle = nullStringOr(sourceDocumentTitle, "")
		anchors = append(anchors, anchor)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return map[string]any{"anchors": anchors}, nil
}
