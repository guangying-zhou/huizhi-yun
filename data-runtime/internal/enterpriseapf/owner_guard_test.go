package enterpriseapf

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// testOwnerState is the Directory stand-in shared by the isolated suites: every
// uid is an active user unless listed, and the Directory can be made unavailable.
var testOwnerState = struct {
	sync.Mutex
	inactive    map[string]bool
	unavailable bool
	calls       []string
}{inactive: map[string]bool{}}

func testOwnerDirectory(_ context.Context, uid string) (bool, error) {
	testOwnerState.Lock()
	defer testOwnerState.Unlock()
	testOwnerState.calls = append(testOwnerState.calls, uid)
	if testOwnerState.unavailable {
		return false, httperror.New(503, "directory_subject_status_unavailable", "down")
	}
	return !testOwnerState.inactive[uid], nil
}

func setTestOwners(inactive []string, unavailable bool) func() {
	testOwnerState.Lock()
	previousInactive, previousUnavailable := testOwnerState.inactive, testOwnerState.unavailable
	testOwnerState.inactive, testOwnerState.unavailable, testOwnerState.calls = map[string]bool{}, unavailable, nil
	for _, uid := range inactive {
		testOwnerState.inactive[uid] = true
	}
	testOwnerState.Unlock()
	return func() {
		testOwnerState.Lock()
		testOwnerState.inactive, testOwnerState.unavailable = previousInactive, previousUnavailable
		testOwnerState.Unlock()
	}
}

func ownerErrorCode(err error) (int, string) {
	var h httperror.Error
	if errors.As(err, &h) {
		return h.Status, h.Code
	}
	return 0, ""
}

func TestOwnerTargetsAndReservedSubjects(t *testing.T) {
	if got := OwnerTargets(map[string]any{"owner_uid": "u1", "owner_user_id": "u2", "name": "x", "owner_dept_code": "D1"}); len(got) != 2 || got[0] != "u1" || got[1] != "u2" {
		t.Fatalf("targets=%v", got)
	}
	// Absent, empty or non-string fields are not targets; the operation validates them.
	if got := OwnerTargets(map[string]any{"owner_uid": "", "owner_user_id": 7}); len(got) != 0 {
		t.Fatalf("targets=%v", got)
	}
	if OwnerTargets(nil) != nil {
		t.Fatal("nil payload has no targets")
	}
	for _, uid := range []string{ReservedUnassignedOwner, "system:anything", "SYSTEM:x", "client:aims.runtime", "Client:X", "system"} {
		if !ReservedOwner(uid) {
			t.Fatalf("%q must be reserved", uid)
		}
	}
	for _, uid := range []string{"zhang.san", "systematic", "clientele", "u1"} {
		if ReservedOwner(uid) {
			t.Fatalf("%q must not be reserved", uid)
		}
	}
}

func TestVerifyOwnerTargets(t *testing.T) {
	ctx := context.Background()
	var asked []string
	s := &Service{}
	s.ConfigureOwnerDirectory(func(_ context.Context, uid string) (bool, error) {
		asked = append(asked, uid)
		switch uid {
		case "gone":
			return false, nil
		case "down":
			return false, httperror.New(503, "directory_subject_status_unavailable", "down")
		}
		return true, nil
	})
	check := func(payload map[string]any) (int, string) {
		return ownerErrorCode(s.verifyOwnerTargets(ctx, payload))
	}
	if status, code := check(map[string]any{"owner_uid": "alice"}); status != 0 || code != "" {
		t.Fatalf("active owner %d %s", status, code)
	}
	if status, code := check(map[string]any{"name": "no owner change"}); status != 0 || code != "" {
		t.Fatalf("no owner %d %s", status, code)
	}
	asked = nil
	// Reserved and malformed owners are rejected without asking Directory.
	for _, uid := range []string{ReservedUnassignedOwner, "system:x", "client:aims.runtime", "system", " alice", "alice ", "a b", "a\tb", "a\nb", "@all", "@ALL", strings.Repeat("x", 65)} {
		if status, code := check(map[string]any{"owner_uid": uid}); status != 400 || code != "apf_owner_invalid" {
			t.Fatalf("%q -> %d %s", uid, status, code)
		}
		if status, code := check(map[string]any{"owner_user_id": uid}); status != 400 || code != "apf_owner_invalid" {
			t.Fatalf("owner_user_id %q -> %d %s", uid, status, code)
		}
		if status, code := check(map[string]any{"responsibleUid": uid}); status != 400 || code != "apf_owner_invalid" {
			t.Fatalf("responsibleUid %q -> %d %s", uid, status, code)
		}
	}
	if len(asked) != 0 {
		t.Fatalf("Directory was asked about reserved owners: %v", asked)
	}
	if status, code := check(map[string]any{"owner_uid": "gone"}); status != 400 || code != "apf_owner_not_active" {
		t.Fatalf("inactive owner %d %s", status, code)
	}
	// A Directory failure stays a 503; it is never read as "not active" or allowed.
	if status, code := check(map[string]any{"owner_uid": "down"}); status != 503 || code != "directory_subject_status_unavailable" {
		t.Fatalf("directory down %d %s", status, code)
	}
	// Both fields are checked when both are present.
	if status, code := check(map[string]any{"owner_uid": "alice", "owner_user_id": "gone"}); status != 400 || code != "apf_owner_not_active" {
		t.Fatalf("second field %d %s", status, code)
	}
	// Without a Directory an owner cannot be assigned at all.
	if status, code := ownerErrorCode((&Service{}).verifyOwnerTargets(ctx, map[string]any{"owner_uid": "alice"})); status != 503 || code != "apf_owner_directory_unavailable" {
		t.Fatalf("no directory %d %s", status, code)
	}
	if err := (&Service{}).verifyOwnerTargets(ctx, map[string]any{"name": "x"}); err != nil {
		t.Fatalf("a write that assigns no owner needs no Directory: %v", err)
	}
}

func TestAPFResponsibilityWriteSurfaceClosed(t *testing.T) {
	// Contacts do not have a user-assignable owner; bank accounts belong to a
	// department, not a uid. Neither may smuggle an owner through a loose map.
	for _, key := range []string{"owner_uid", "owner_user_id", "responsibleUid"} {
		if err := ValidateCustomerInput("contacts-create", CustomerInput{CustomerID: "1", Payload: map[string]any{"name": "contact", key: ReservedUnassignedOwner}}); err == nil {
			t.Fatalf("contact accepted %s", key)
		}
		i := accountInput()
		i.Payload[key] = ReservedUnassignedOwner
		if err := ValidateFinanceInput("accounts-create", i); err == nil {
			t.Fatalf("bank account accepted %s", key)
		}
	}
	// Billing schedules have no collection-assignment command. Their generated
	// responsibility stays NULL; payloads and payment-term rows are closed.
	for _, key := range []string{"collection_responsible_uid", "collectionResponsibleUid", "responsibleUid"} {
		i := ContractInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(1)}, Rows: []map[string]any{{"term_name": "payment", "term_type": "one_time", "amount": "10.00", "trigger_type": "manual", "invoice_required": true}}}
		if err := ValidateContractInput("payment-terms-replace", i); err != nil {
			t.Fatal("invalid baseline", err)
		}
		i.Rows[0][key] = ReservedUnassignedOwner
		if err := ValidateContractInput("payment-terms-replace", i); err == nil {
			t.Fatalf("payment term accepted %s", key)
		}
		i.Rows = nil
		i.Payload[key] = ReservedUnassignedOwner
		if err := ValidateContractInput("contracts-update", i); err == nil {
			t.Fatalf("contract accepted %s", key)
		}
		if err := ValidateContractInput("billing-schedules-update", i); err == nil {
			t.Fatal("unregistered billing write accepted")
		}
	}
}

func TestValidateMigrationOwner(t *testing.T) {
	for _, uid := range []string{ReservedUnassignedOwner, "zhang.san"} {
		if err := ValidateMigrationOwner(uid); err != nil {
			t.Fatalf("%q: %v", uid, err)
		}
	}
	for _, uid := range []string{"", "system:other", "client:x", "system", " x", "@all"} {
		if _, code := ownerErrorCode(ValidateMigrationOwner(uid)); code != "apf_owner_invalid" {
			t.Fatalf("%q must be rejected", uid)
		}
	}
}

func packageSources(t *testing.T) map[string]string {
	t.Helper()
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		out[file] = string(raw)
	}
	return out
}

// Every payload field that assigns an owner must be in ownerPayloadKeys, so
// that what the guard checks is exactly what the writes consume.
func TestOwnerPayloadKeysAreClosed(t *testing.T) {
	// owner_unmatched is a migration queue kind, not a field that assigns an owner.
	known := map[string]bool{"owner_dept_code": true, "owner_unmatched": true}
	for _, key := range ownerPayloadKeys {
		known[key] = true
	}
	pattern := regexp.MustCompile(`"(owner_[a-z_]+|ownerUid|ownerUserId|ownerUserID|responsibleUid)"`)
	found := map[string][]string{}
	for file, source := range packageSources(t) {
		for _, match := range pattern.FindAllStringSubmatch(source, -1) {
			found[match[1]] = append(found[match[1]], file)
		}
	}
	var unknown []string
	for key, files := range found {
		if !known[key] {
			unknown = append(unknown, key+" in "+strings.Join(files, ","))
		}
	}
	sort.Strings(unknown)
	if len(unknown) != 0 {
		t.Fatalf("owner-like fields not covered by the owner guard: %v", unknown)
	}
	for _, key := range ownerPayloadKeys {
		if len(found[key]) == 0 {
			t.Fatalf("ownerPayloadKeys lists %q but no write uses it", key)
		}
	}
}

// The guard sits in every public write entry directly after input validation
// and before any transaction, on the very payload the entry writes.
func TestOwnerGuardIsInEveryWriteEntry(t *testing.T) {
	sources := packageSources(t)
	guard := "if e := s.verifyOwnerTargets(ctx, i.Payload); e != nil {\n\t\treturn nil, e\n\t}"
	for file, entry := range map[string][2]string{
		"finance_ledger.go":   {"func (s *Service) FinanceLedger(", "ValidateFinanceLedgerInput(op, i)"},
		"altoc_customers.go":  {"func (s *Service) Customer(", "ValidateCustomerInput(op, i)"},
		"altoc_sales.go":      {"func (s *Service) Sales(", "ValidateSalesInput(op, i)"},
		"altoc_renewals.go":   {"func (s *Service) Renewals(", "validateRenewal(op, i)"},
		"altoc_tickets.go":    {"func (s *Service) Tickets(", "validateTicket(op, i)"},
		"altoc_services.go":   {"func (s *Service) ServiceAgreements(", "validateServiceAgreement(op, i)"},
		"altoc_tenders.go":    {"func (s *Service) Tenders(", "validateTender(op, i)"},
		"altoc_quotations.go": {"func (s *Service) Quotation(", "ValidateQuotationInput(op, i)"},
		"altoc_contracts.go":  {"func (s *Service) Contract(", "ValidateContractInput(op, i)"},
	} {
		source := sources[file]
		start := strings.Index(source, entry[0])
		if start < 0 {
			t.Fatalf("%s: entry %q not found", file, entry[0])
		}
		body := source[start:]
		validated, guarded, transaction := strings.Index(body, entry[1]), strings.Index(body, guard), strings.Index(body, "BeginWriteTransaction")
		if validated < 0 || guarded < validated || (transaction >= 0 && transaction < guarded) {
			t.Fatalf("%s: owner guard must follow validation and precede the transaction (validated=%d guarded=%d tx=%d)", file, validated, guarded, transaction)
		}
	}
	// Any other file that reads an owner field from a payload must be reached
	// through one of the guarded entries above.
	for file, source := range sources {
		if file == "owner_guard.go" {
			continue
		}
		reads := strings.Contains(source, `Payload["owner_uid"]`) || strings.Contains(source, `Payload, "owner_uid"`) || strings.Contains(source, `"owner_user_id"`) || strings.Contains(source, `Payload["responsibleUid"]`)
		if !reads {
			continue
		}
		switch file {
		case "finance_ledger.go", "altoc_sales_owner.go", "altoc_customers.go", "altoc_sales.go", "altoc_renewals.go", "altoc_tickets.go", "altoc_services.go", "altoc_tenders.go", "altoc_quotations.go", "altoc_contracts.go",
			"altoc_sales_transition.go",               // called only from Sales
			"altoc_feedback.go", "altoc_knowledge.go": // read an existing ticket owner for scope facts; no payload owner
		default:
			t.Fatalf("%s reads an owner field but is not a guarded write entry", file)
		}
	}
}

// The unassigned marker is written by no user-reachable code: its literal
// lives only in the guard.
func TestUnassignedOwnerLiteralIsConfined(t *testing.T) {
	for file, source := range packageSources(t) {
		if file != "owner_guard.go" && (strings.Contains(source, "system:unassigned") || strings.Contains(source, "ReservedUnassignedOwner")) {
			t.Fatalf("%s must not reference the unassigned owner marker", file)
		}
	}
}
