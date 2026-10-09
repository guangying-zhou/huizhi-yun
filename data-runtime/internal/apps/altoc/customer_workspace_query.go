package altoc

import (
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strings"
	"time"
)

// Customer-only extensions remain absent from older permit byte sequences.
func (q BasicReadQuery) ValidateCustomerWorkspace(resource string) error {
	invalid := func() error {
		return httperror.New(400, "altoc_basic_input_invalid", "Invalid customer workspace query")
	}
	extras := q.IndustryCode + q.RegionCode + q.UpdatedDateFrom + q.UpdatedDateTo + q.CustomerSort + q.DecisionRole
	if (extras != "" || q.Workspace || q.ContactsOnly || q.PrimaryOnly || q.StarredOnly) && resource != "customer" {
		return invalid()
	}
	for _, v := range []string{q.IndustryCode, q.RegionCode, q.DecisionRole} {
		if len(v) > 64 || strings.ContainsAny(v, "\x00\r\n") {
			return invalid()
		}
	}
	if q.CustomerSort != "" && q.CustomerSort != "updated_desc" && q.CustomerSort != "updated_asc" && q.CustomerSort != "id_asc" {
		return invalid()
	}
	for _, v := range []string{q.UpdatedDateFrom, q.UpdatedDateTo} {
		if v != "" {
			d, e := time.Parse("2006-01-02", v)
			if e != nil || d.Format("2006-01-02") != v || v < "1000-01-01" {
				return invalid()
			}
		}
	}
	if q.UpdatedDateFrom != "" && q.UpdatedDateTo != "" && q.UpdatedDateFrom > q.UpdatedDateTo {
		return invalid()
	}
	if q.Workspace && q.ContactsOnly {
		return invalid()
	}
	if q.ContactsOnly {
		if q.ParentID != "" || q.RootsOnly || q.OwnerUnassigned || q.OwnerUID != "" || q.IndustryCode != "" || q.RegionCode != "" || q.UpdatedDateFrom != "" || q.UpdatedDateTo != "" || q.CustomerSort != "" {
			return invalid()
		}
	} else if q.DecisionRole != "" || q.PrimaryOnly || q.StarredOnly {
		return invalid()
	}
	return nil
}
