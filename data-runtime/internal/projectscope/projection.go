// Package projectscope selects Foundation-compiled project facts. It does not
// evaluate roles, grants, action implication or merge authorization scopes.
package projectscope

import (
	"fmt"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

type Projection struct {
	Version             int      `json:"version"`
	ProjectCodes        []string `json:"project_codes"`
	DepartmentCodes     []string `json:"department_codes"`
	DepartmentTreeRoots []string `json:"department_tree_roots"`
	Masks               []int    `json:"masks"`
}

type Facts struct {
	ProjectCode    string   `json:"projectCode"`
	DepartmentCode string   `json:"departmentCode"`
	DepartmentTree []string `json:"departmentTree"`
	Member         bool     `json:"member"`
	Owner          bool     `json:"owner"`
	Creator        bool     `json:"creator"`
	Participant    bool     `json:"participant"`
}

func (p Projection) Validate() error {
	if p.Version != 1 || len(p.ProjectCodes) > 512 || len(p.DepartmentCodes) > 512 || len(p.DepartmentTreeRoots) > 10 {
		return fmt.Errorf("invalid project projection domain")
	}
	for _, codes := range [][]string{p.ProjectCodes, p.DepartmentCodes, p.DepartmentTreeRoots} {
		for i, code := range codes {
			if code == "" || strings.TrimSpace(code) != code || utf8.RuneCountInString(code) > 64 || strings.IndexFunc(code, unicode.IsControl) >= 0 || (i > 0 && codes[i-1] >= code) {
				return fmt.Errorf("invalid project projection code")
			}
		}
	}
	for _, root := range p.DepartmentTreeRoots {
		if !slices.Contains(p.DepartmentCodes, root) {
			return fmt.Errorf("invalid project projection tree root")
		}
	}
	cells := (len(p.ProjectCodes) + 1) * (len(p.DepartmentCodes) + 1) * (1 << len(p.DepartmentTreeRoots))
	if cells > 4096 || len(p.Masks) != cells {
		return fmt.Errorf("invalid project projection table")
	}
	for _, mask := range p.Masks {
		if mask < 0 || mask > 65535 {
			return fmt.Errorf("invalid project projection mask")
		}
	}
	return nil
}

func (p Projection) Allows(f Facts) (bool, error) {
	if err := p.Validate(); err != nil {
		return false, err
	}
	project := slices.Index(p.ProjectCodes, strings.TrimSpace(f.ProjectCode)) + 1
	department := slices.Index(p.DepartmentCodes, strings.TrimSpace(f.DepartmentCode)) + 1
	tree := 0
	for i, root := range p.DepartmentTreeRoots {
		if slices.ContainsFunc(f.DepartmentTree, func(code string) bool { return strings.TrimSpace(code) == root }) {
			tree |= 1 << i
		}
	}
	index := (project*(len(p.DepartmentCodes)+1)+department)*(1<<len(p.DepartmentTreeRoots)) + tree
	state := 0
	if f.Member {
		state |= 1
	}
	if f.Owner {
		state |= 2
	}
	if f.Creator {
		state |= 4
	}
	if f.Participant {
		state |= 8
	}
	return p.Masks[index]&(1<<state) != 0, nil
}
