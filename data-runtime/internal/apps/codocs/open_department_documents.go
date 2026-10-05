package codocs

import (
	"context"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// openDepartmentDocuments is the dedicated read contract for folders that a
// department manager has explicitly opened to every authenticated Codocs user.
// It deliberately does not weaken the ordinary folder/document ACL predicates.
func (a *Adapter) openDepartmentDocuments(ctx context.Context, query url.Values) (map[string]any, error) {
	if _, _, err := requireTrustedDocumentListActor(query); err != nil {
		return nil, err
	}

	hasOpenColumn, err := a.columnExists(ctx, "folders", "is_open")
	if err != nil {
		return nil, err
	}
	if !hasOpenColumn {
		return nil, httperror.New(http.StatusInternalServerError, "schema_mismatch", "folders.is_open column is required")
	}

	rows, err := a.db.QueryContext(ctx, `
      SELECT id, name, folder_type, owner_uid, dept_code, project_code,
             parent_id, sort_order, is_open, created_at, updated_at
      FROM folders
      WHERE folder_type = 'department'
      ORDER BY sort_order ASC, created_at DESC`)
	if err != nil {
		return nil, err
	}
	allFolders, err := rowsToMaps(rows)
	rows.Close()
	if err != nil {
		return nil, err
	}

	visibleFolders, visibleFolderIDs := visibleOpenDepartmentFolders(allFolders)
	result := map[string]any{
		"folders":   visibleFolders,
		"documents": []map[string]any{},
	}
	if len(visibleFolderIDs) == 0 {
		return result, nil
	}

	where := []string{
		"d.status = 1",
		"d.doc_type = 'department'",
		"d.publish_info IS NULL",
		"d.oss_path NOT LIKE '%/weekly-reports/%'",
		"d.folder_id IN (" + placeholders(len(visibleFolderIDs)) + ")",
	}
	args := make([]any, 0, len(visibleFolderIDs)+1)
	for _, id := range visibleFolderIDs {
		args = append(args, id)
	}
	if uuid := strings.TrimSpace(query.Get("uuid")); uuid != "" {
		where = append(where, "d.uuid = ?")
		args = append(args, uuid)
	}

	documentRows, err := a.db.QueryContext(ctx, `
      SELECT d.id, d.uuid, d.title, d.doc_type, d.oss_path, d.owner_uid,
             d.dept_code, d.project_code, d.folder_id, d.content_size,
             d.last_editor_uid, d.status, d.star_flag, d.home_flag,
             d.readonly_flag, d.publish_info, d.ai_abstract,
             d.created_at, d.updated_at, f.name AS folder_name
      FROM documents d
      LEFT JOIN folders f ON d.folder_id = f.id
      WHERE `+strings.Join(where, " AND ")+`
      ORDER BY d.updated_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	documents, err := rowsToMaps(documentRows)
	documentRows.Close()
	if err != nil {
		return nil, err
	}
	result["documents"] = documents
	return result, nil
}

// visibleOpenDepartmentFolders includes each explicitly open folder and all of
// its descendants in the same department. The department equality check keeps
// malformed cross-department parent links from widening visibility.
func visibleOpenDepartmentFolders(folders []map[string]any) ([]map[string]any, []int64) {
	byID := make(map[int64]map[string]any, len(folders))
	childrenByParent := make(map[int64][]int64)
	openFolderIDs := make([]int64, 0)

	for _, folder := range folders {
		id := int64Value(folder["id"])
		if id <= 0 || stringValue(folder["dept_code"]) == "" {
			continue
		}
		byID[id] = folder
		if parentID := int64Value(folder["parent_id"]); parentID > 0 {
			childrenByParent[parentID] = append(childrenByParent[parentID], id)
		}
		if boolValue(folder["is_open"]) {
			openFolderIDs = append(openFolderIDs, id)
		}
	}

	visible := make(map[int64]bool)
	queue := append([]int64(nil), openFolderIDs...)
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		if visible[id] {
			continue
		}
		folder := byID[id]
		if folder == nil {
			continue
		}
		visible[id] = true
		deptCode := stringValue(folder["dept_code"])
		for _, childID := range childrenByParent[id] {
			child := byID[childID]
			if child != nil && stringValue(child["dept_code"]) == deptCode {
				queue = append(queue, childID)
			}
		}
	}

	visibleFolders := make([]map[string]any, 0, len(visible))
	visibleFolderIDs := make([]int64, 0, len(visible))
	for _, folder := range folders {
		id := int64Value(folder["id"])
		if !visible[id] {
			continue
		}
		visibleFolders = append(visibleFolders, folder)
		visibleFolderIDs = append(visibleFolderIDs, id)
	}
	sort.Slice(visibleFolderIDs, func(i, j int) bool { return visibleFolderIDs[i] < visibleFolderIDs[j] })
	return visibleFolders, visibleFolderIDs
}
