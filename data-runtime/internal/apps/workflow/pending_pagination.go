package workflow

import (
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"strconv"
)

// page_size is the legacy Workflow protocol. Camel-case pageSize (or page
// without page_size) opts into the bounded snapshot pagination contract.
func pendingTaskPage(q url.Values) (workflowPage, bool, error) {
	_, p := q["page"]
	_, size := q["pageSize"]
	_, legacy := q["page_size"]
	if !size && (!p || legacy) {
		return workflowPageParams(q, 20), false, nil
	}
	bad := httperror.New(400, "pending_pagination_invalid", "Invalid pagination")
	if legacy {
		return workflowPage{}, true, bad
	}
	page, n := 1, 20
	for key, dest := range map[string]*int{"page": &page, "pageSize": &n} {
		if values, ok := q[key]; ok {
			if len(values) != 1 {
				return workflowPage{}, true, bad
			}
			value, e := strconv.Atoi(values[0])
			if e != nil || value < 1 || strconv.Itoa(value) != values[0] || key == "page" && value > 1000000 || key == "pageSize" && value > 100 {
				return workflowPage{}, true, bad
			}
			*dest = value
		}
	}
	return workflowPage{page: page, pageSize: n, offset: (page - 1) * n}, true, nil
}
