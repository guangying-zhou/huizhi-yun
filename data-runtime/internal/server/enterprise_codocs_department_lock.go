package server

import (
	"context"
	"net/http"

	directoryapp "github.com/huizhi-yun/data-runtime/internal/apps/directory"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// lockEnterpriseCodocsDepartment reads Directory on its own database connection.
// The shared row locks outlive the Codocs write transaction (including receipt
// replay). Rollback only releases read locks; Directory is never mutated here.
func (s *Server) lockEnterpriseCodocsDepartment(ctx context.Context, actor, department string) (directoryapp.EnterpriseCodocsDepartmentRole, func(), error) {
	if s.directory == nil {
		return directoryapp.CodocsDepartmentNone, nil, httperror.New(http.StatusServiceUnavailable, "department_directory_unavailable", "Directory unavailable")
	}
	role, tx, err := s.directory.LockEnterpriseCodocsDepartmentAccess(ctx, actor, department)
	if err != nil {
		return directoryapp.CodocsDepartmentNone, nil, enterpriseCodocsDirectoryError(err)
	}
	return role, func() { _ = tx.Rollback() }, nil
}

func checkLockedEnterpriseCodocsDepartment(actor, department, expectedActor, expectedDepartment string, role directoryapp.EnterpriseCodocsDepartmentRole) error {
	if actor != expectedActor || department != expectedDepartment {
		return httperror.New(http.StatusForbidden, "department_access_binding_invalid", "Department access binding invalid")
	}
	return nil
}
