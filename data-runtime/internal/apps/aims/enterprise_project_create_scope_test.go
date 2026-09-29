package aims

import (
	"errors"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

func TestEnterpriseProjectCreateScopeUsesProposedCodeDepartmentWithoutFutureRelations(t *testing.T) {
	future := time.Now().Add(15 * time.Second).UnixMilli()
	command := map[string]any{"projectCode": "P-NEW", "deptCode": "DEPT-A", "leaderUid": "U1"}
	identity := EnterpriseProjectCreateIdentity{ActorUID: "U1", ProjectCode: "P-NEW", DeptCode: "DEPT-A", CreateScope: &EnterpriseProjectCommandScope{
		Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{"P-NEW"}, DepartmentCodes: []string{"DEPT-A"}, Masks: []int{0, 0, 0, 1}}, ExpiresAt: future,
	}}
	if err := requireEnterpriseProjectCreateScopeTx(identity, command); err != nil {
		t.Fatal(err)
	}
	assertDenied := func(id EnterpriseProjectCreateIdentity, body map[string]any) {
		t.Helper()
		var denied httperror.Error
		err := requireEnterpriseProjectCreateScopeTx(id, body)
		if !errors.As(err, &denied) || denied.Status != 403 {
			t.Fatalf("scope denied = %v", err)
		}
	}
	assertDenied(identity, map[string]any{"projectCode": "P-NEW", "deptCode": "DEPT-B", "leaderUid": "U1"})
	assertDenied(identity, map[string]any{"projectCode": "P-NEW", "leaderUid": "U1"})
	assertDenied(identity, map[string]any{"projectCode": "P-OTHER", "deptCode": "DEPT-A", "leaderUid": "U1"})
	identity.DeptCode = "DEPT-B"
	assertDenied(identity, map[string]any{"projectCode": "P-NEW", "deptCode": "DEPT-B", "leaderUid": "U1"})
	identity.DeptCode = ""
	assertDenied(identity, map[string]any{"projectCode": "P-NEW", "leaderUid": "U1"})
	identity.DeptCode = "DEPT-A"
	identity.CreateScope.Projection.Masks = []int{0, 0, 0, 65534} // relation/subject states only, not zero-fact creation.
	assertDenied(identity, command)
	identity.CreateScope.Projection.Masks = []int{0, 0, 0, 1}
	identity.CreateScope.ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
	assertDenied(identity, command)
	identity.CreateScope = &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, Masks: []int{1}}, ExpiresAt: future}
	identity.DeptCode = ""
	if err := requireEnterpriseProjectCreateScopeTx(identity, map[string]any{"projectCode": "P-NEW", "leaderUid": "U1"}); err != nil {
		t.Fatalf("unrestricted department grant must allow empty department: %v", err)
	}
}
