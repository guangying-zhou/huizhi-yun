package directory

import (
	"context"
	"fmt"
	"sort"
)

// Runtime-only business facts; the caller supplies signed scope root codes,
// never a browser-selected department graph. No SQL identifiers are accepted.
func (a *Adapter) EnterpriseProjectScopeDepartmentDescendants(ctx context.Context, roots []string) (map[string][]string, error) {
	rows, err := a.consoleDepartments(ctx, "active")
	if err != nil {
		return nil, err
	}
	return enterpriseProjectScopeDescendants(rows, roots)
}

func enterpriseProjectScopeDescendants(rows []consoleDirectoryDepartmentRow, roots []string) (map[string][]string, error) {
	children := map[string][]string{}
	for _, row := range rows {
		if row.ParentCode.Valid {
			children[row.ParentCode.String] = append(children[row.ParentCode.String], row.Code)
		}
	}
	out := map[string][]string{}
	for _, root := range roots {
		visited := map[string]bool{}
		path := map[string]bool{}
		var visit func(string) error
		visit = func(code string) error {
			if path[code] {
				return fmt.Errorf("department scope graph cycle")
			}
			if visited[code] {
				return nil
			}
			visited[code] = true
			path[code] = true
			if len(visited) > 4096 {
				return fmt.Errorf("department scope graph exceeds bound")
			}
			for _, child := range children[code] {
				if err := visit(child); err != nil {
					return err
				}
			}
			delete(path, code)
			return nil
		}
		if err := visit(root); err != nil {
			return nil, err
		}
		codes := []string{}
		for code := range visited {
			codes = append(codes, code)
		}
		sort.Strings(codes)
		out[root] = codes
	}
	return out, nil
}
