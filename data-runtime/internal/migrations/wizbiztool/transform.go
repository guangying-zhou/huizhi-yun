package wizbiztool

import (
	"encoding/json"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/enterpriseapf"
)

type Reference struct {
	Table string `json:"table"`
	Code  string `json:"code"`
}
type PreparedObject struct {
	Step               string
	SourceTable        string
	SourcePK           string
	Table              string
	Role               string
	KeyColumn          string
	Key                any
	VaultContentSHA256 string
	Values             map[string]any
}
type Exception struct {
	Kind        string         `json:"kind"`
	Table       string         `json:"table"`
	PK          string         `json:"pk"`
	Detail      map[string]any `json:"detail"`
	Domain      string         `json:"domain"`
	TargetTable *string        `json:"targetTable"`
	TargetKey   *string        `json:"targetKey"`
}
type Prepared struct {
	Objects    []PreparedObject
	Exceptions []Exception
	Codes      map[string]string
	Identity   map[string]IdentityState
}
type IdentityConfirmation struct {
	DirectoryUID string `json:"directoryUid"`
	ConfirmedBy  string `json:"confirmedBy"`
	ConfirmedAt  string `json:"confirmedAt"`
}
type IdentityState struct {
	UID         string
	Status      string
	Department  *string
	ConfirmedBy string
	ConfirmedAt string
}

func sourceText(row map[string]any, key string) string { value, _ := row[key].(string); return value }
func textOrNull(row map[string]any, key string) any {
	if row[key] == nil {
		return nil
	}
	return sourceText(row, key)
}
func requireString(row map[string]any, key string, max int) error {
	value, ok := row[key].(string)
	if !ok || strings.TrimSpace(value) == "" || utf8.RuneCountInString(value) > max {
		return ErrValue
	}
	return nil
}
func optionalString(row map[string]any, key string, max int) error {
	if row[key] == nil {
		return nil
	}
	value, ok := row[key].(string)
	if !ok || utf8.RuneCountInString(value) > max {
		return ErrValue
	}
	return nil
}
func decimal(value any) (*big.Rat, error) {
	text, ok := value.(string)
	if !ok || !regexp.MustCompile(`^-?[0-9]{1,16}\.[0-9]{2}$`).MatchString(text) {
		return nil, ErrValue
	}
	r, ok := new(big.Rat).SetString(text)
	if !ok {
		return nil, ErrValue
	}
	return r, nil
}
func localDate(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	text, ok := value.(string)
	if !ok {
		return nil, ErrValue
	}
	parsed, err := time.Parse("2006-01-02", text)
	if err != nil || parsed.Format("2006-01-02") != text {
		return nil, ErrValue
	}
	return text, nil
}
func sourceInstant(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	text, ok := value.(string)
	if !ok {
		return nil, ErrValue
	}
	parsed, err := time.ParseInLocation("2006-01-02 15:04:05", text, time.FixedZone("Asia/Shanghai", 8*3600))
	if err != nil || parsed.Year() < 1992 || parsed.Format("2006-01-02 15:04:05") != text {
		return nil, ErrValue
	}
	return parsed.UTC().Format("2006-01-02 15:04:05.000"), nil
}
func fixedEnum(value any, choices map[string]string) (string, error) {
	text, ok := value.(string)
	if !ok {
		return "", ErrValue
	}
	mapped, ok := choices[text]
	if !ok {
		return "", ErrValue
	}
	return mapped, nil
}
func zeroReference(row map[string]any, key string) bool {
	return row[key] == nil || sourceText(row, key) == "0"
}
func tableIndex(data SourceData, table, key string) map[string]map[string]any {
	out := map[string]map[string]any{}
	for _, row := range data[table] {
		out[sourceText(row, key)] = row
	}
	return out
}
func (p *Prepared) add(step, sourceTable, pk, table, role, keyColumn string, key any, values map[string]any) {
	p.Objects = append(p.Objects, PreparedObject{Step: step, SourceTable: sourceTable, SourcePK: pk, Table: table, Role: role, KeyColumn: keyColumn, Key: key, Values: values})
}
func (p *Prepared) exception(kind, table, pk string, detail map[string]any) {
	p.Exceptions = append(p.Exceptions, Exception{Kind: kind, Table: table, PK: pk, Detail: detail})
}
func (p *Prepared) owner(row map[string]any, table, pk string, active bool) (string, any) {
	source := sourceText(row, "employee_id")
	identity := p.Identity["employee:"+source]
	owner := enterpriseapf.ReservedUnassignedOwner
	var dept any
	if identity.UID != "" && identity.Status == "active" {
		owner = identity.UID
		if identity.Department != nil {
			dept = *identity.Department
		}
	}
	if owner == enterpriseapf.ReservedUnassignedOwner && active {
		p.exception("owner_unmatched", table, pk, map[string]any{"sourceUserId": textOrNull(row, "employee_id")})
	}
	return owner, dept
}
func (p *Prepared) audit(row map[string]any) any {
	id := p.Identity["user:"+sourceText(row, "operator_id")]
	if id.UID != "" {
		return id.UID
	}
	return nil
}
func identityStates(data SourceData, confirmations map[string]IdentityConfirmation, directory map[string]IdentityState) (map[string]IdentityState, error) {
	out := map[string]IdentityState{}
	source := map[string]bool{}
	for _, row := range data["wb_employee"] {
		source["employee:"+sourceText(row, "employee_id")] = true
	}
	for _, row := range data["sys_user"] {
		source["user:"+sourceText(row, "user_id")] = true
	}
	for id, confirmation := range confirmations {
		if !source[id] || confirmation.DirectoryUID == "" || confirmation.ConfirmedBy == "" {
			return nil, ErrValue
		}
		if _, err := time.Parse(time.RFC3339, confirmation.ConfirmedAt); err != nil {
			return nil, ErrValue
		}
		state, ok := directory[confirmation.DirectoryUID]
		if !ok {
			return nil, ErrValue
		}
		state.UID = confirmation.DirectoryUID
		state.ConfirmedBy = confirmation.ConfirmedBy
		state.ConfirmedAt = confirmation.ConfirmedAt
		out[id] = state
	}
	return out, nil
}
func BuildPrepared(data SourceData, p Profile, identities map[string]IdentityState) (Prepared, error) {
	declarations := Declarations()
	result := Prepared{Codes: map[string]string{}, Identity: identities}
	organizations := tableIndex(data, "wb_organization", "org_id")
	contacts := tableIndex(data, "wb_contactman", "contactman_id")
	banks := tableIndex(data, "wb_bank_account", "ba_id")
	employees := tableIndex(data, "wb_employee", "employee_id")
	users := tableIndex(data, "sys_user", "user_id")
	for _, table := range SortedTableNamesFromData(data) {
		for _, row := range data[table] {
			declaration := declarations[table]
			if len(declaration.PrimaryKey) != 1 {
				return result, ErrValue
			}
			pk := sourceText(row, declaration.PrimaryKey[0])
			if pk == "" {
				return result, ErrValue
			}
			for _, field := range declaration.Columns {
				if !field.Nullable && field.Disposition != "vault" && row[field.Name] == nil {
					return result, ErrValue
				}
				if strings.Contains(field.Type, "decimal") && row[field.Name] != nil {
					if err := validateSourceDecimal(row[field.Name], field.Type); err != nil {
						return result, err
					}
				}
				if field.Type == "date" {
					if _, err := localDate(row[field.Name]); err != nil {
						return result, err
					}
				}
				if field.Type == "datetime" {
					if _, err := sourceInstant(row[field.Name]); err != nil {
						return result, err
					}
				}
			}
			if _, has := row["employee_id"]; has && !zeroReference(row, "employee_id") && employees[sourceText(row, "employee_id")] == nil {
				result.exception("identity_source_missing", "wb_employee", sourceText(row, "employee_id"), map[string]any{"referencedBy": []string{table}})
			}
			if _, has := row["operator_id"]; has && !zeroReference(row, "operator_id") && users[sourceText(row, "operator_id")] == nil {
				result.exception("identity_source_missing", "sys_user", sourceText(row, "operator_id"), map[string]any{"referencedBy": []string{table}})
			}
		}
	}
	for _, row := range data["wb_organization"] {
		pk := sourceText(row, "org_id")
		family, err := fixedEnum(row["org_type"], map[string]string{"0": "legal-entity", "1": "customer", "2": "customer"})
		if err != nil {
			return result, err
		}
		code, err := ObjectCode(family, pk)
		if err != nil {
			return result, err
		}
		result.Codes["wb_organization/"+pk] = code
		status, err := fixedEnum(row["org_status"], map[string]string{"0": "active", "1": "archived"})
		if err != nil {
			return result, err
		}
		if requireString(row, "org_name", 200) != nil || optionalString(row, "short_name", 100) != nil {
			return result, ErrValue
		}
		created, err := sourceInstant(row["operate_time"])
		if err != nil {
			return result, err
		}
		if family == "legal-entity" {
			entityType := "company"
			result.add("legal-entity", "wb_organization", pk, "finance_legal_entity", "primary", "code", code, map[string]any{"code": code, "name": row["org_name"], "short_name": row["short_name"], "invoice_title": row["org_name"], "entity_type": entityType, "status": map[string]string{"active": "active", "archived": "inactive"}[status], "sort_no": row["order_num"], "remark": row["description"], "created_by": result.audit(row), "created_at": created})
			continue
		}
		owner, dept := result.owner(row, "wb_organization", pk, status == "active")
		if enterpriseapf.ValidateMigrationOwner(owner) != nil {
			return result, ErrValue
		}
		values := map[string]any{"code": code, "name": row["org_name"], "short_name": row["short_name"], "status": status, "owner_uid": owner, "owner_dept_code": dept, "is_partner": map[string]int{"1": 0, "2": 1}[sourceText(row, "org_type")], "customer_level_id": nil, "website": row["web_site"], "telephone": row["telephone"], "province": row["province"], "city": row["city"], "wechat_official_account": row["weixin_number"], "description": row["description"], "started_at": row["start_date"], "contact_name_text": row["contactman"], "sort_no": row["order_num"], "source_system": "import:wizbiz", "external_ref": pk, "created_by": result.audit(row), "created_at": created}
		for field, max := range map[string]int{"web_site": 300, "telephone": 30, "province": 50, "city": 50, "weixin_number": 100, "contactman": 50} {
			if optionalString(row, field, max) != nil {
				return result, ErrValue
			}
		}
		result.add("customer", "wb_organization", pk, "altoc_customer", "primary", "code", code, values)
		snapshot := map[string]any{"customer_id": Reference{"altoc_customer", code}, "snapshot_at": snapshotTime(p), "source_note": "原系统缓存，口径不保证一致", "batch_code": p.BatchCode}
		for _, field := range declarations["wb_organization"].Columns {
			if field.Disposition == "snapshot" {
				snapshot[field.Target] = row[field.Name]
			}
		}
		result.add("snapshots", "wb_organization", pk, "altoc_customer_migration_snapshot", "snapshot", "customer_id", Reference{"altoc_customer", code}, snapshot)
	}
	// Parent and primary-contact resolution are a distinct, deterministic pass.
	for _, row := range data["wb_organization"] {
		pk := sourceText(row, "org_id")
		if sourceText(row, "org_type") == "0" {
			continue
		}
		code := result.Codes["wb_organization/"+pk]
		relations := map[string]any{"parent_customer_id": nil, "primary_contact_id": nil}
		if !zeroReference(row, "parent_id") {
			parent := organizations[sourceText(row, "parent_id")]
			if parent == nil || sourceText(parent, "org_type") == "0" {
				return result, ErrValue
			}
			parentCode := result.Codes["wb_organization/"+sourceText(row, "parent_id")]
			relations["parent_customer_id"] = Reference{"altoc_customer", parentCode}
		}
		if !zeroReference(row, "contactman_id") {
			contact := contacts[sourceText(row, "contactman_id")]
			if contact == nil || sourceText(contact, "org_id") != pk {
				actualOrg := any(nil)
				if contact != nil {
					actualOrg = textOrNull(contact, "org_id")
				}
				result.exception("primary_contact_mismatch", "wb_organization", pk, map[string]any{"sourceContactId": textOrNull(row, "contactman_id"), "contactSourceOrgId": actualOrg})
			} else {
				cn, _ := ObjectCode("contact", sourceText(contact, "contactman_id"))
				relations["primary_contact_id"] = Reference{"altoc_contact", cn}
			}
		}
		// Primary contact cannot precede contact creation; set it during snapshots.
		contactRef := relations["primary_contact_id"]
		delete(relations, "primary_contact_id")
		result.add("customer-hierarchy", "wb_organization", pk, "altoc_customer", "hierarchy", "code", code, relations)
		result.add("snapshots", "wb_organization", pk, "altoc_customer", "primary-contact", "code", code, map[string]any{"primary_contact_id": contactRef})
		visited := map[string]bool{}
		cursor := pk
		for cursor != "" && cursor != "0" {
			if visited[cursor] {
				return result, ErrValue
			}
			visited[cursor] = true
			node := organizations[cursor]
			if node == nil {
				return result, ErrValue
			}
			cursor = sourceText(node, "parent_id")
		}
	}
	for _, row := range data["wb_contactman"] {
		pk := sourceText(row, "contactman_id")
		if zeroReference(row, "org_id") {
			result.exception("contact_without_customer", "wb_contactman", pk, map[string]any{"sourceUserId": textOrNull(row, "employee_id")})
			continue
		}
		customer := organizations[sourceText(row, "org_id")]
		if customer == nil || sourceText(customer, "org_type") == "0" {
			return result, ErrValue
		}
		if requireString(row, "cm_name", 50) != nil {
			return result, ErrValue
		}
		for field, max := range map[string]int{"department": 100, "post": 100, "phone": 30, "mobile": 30, "mobile2": 30, "weixin_number": 100, "remarks": 500} {
			if optionalString(row, field, max) != nil {
				return result, ErrValue
			}
		}
		starLevel, err := contactStarLevel(row["stars"])
		if err != nil {
			return result, err
		}
		chief, err := fixedEnum(row["chief"], map[string]string{"0": "0", "1": "1"})
		if err != nil {
			return result, err
		}
		code, err := ObjectCode("contact", pk)
		if err != nil {
			return result, err
		}
		result.Codes["wb_contactman/"+pk] = code
		owner, _ := result.owner(row, "wb_contactman", pk, false)
		if enterpriseapf.ValidateMigrationOwner(owner) != nil {
			return result, ErrValue
		}
		created, _ := sourceInstant(row["operate_time"])
		result.add("contact", "wb_contactman", pk, "altoc_contact", "primary", "code", code, map[string]any{"code": code, "customer_id": Reference{"altoc_customer", result.Codes["wb_organization/"+sourceText(row, "org_id")]}, "name": row["cm_name"], "dept_name": row["department"], "job_title": row["post"], "phone": row["phone"], "mobile": row["mobile"], "alternate_mobile": row["mobile2"], "mailing_address": row["address"], "wechat": row["weixin_number"], "star_level": starLevel, "is_key_contact": chief, "remark": row["remarks"], "owner_uid": owner, "created_by": result.audit(row), "created_at": created})
	}
	for _, row := range data["wb_bank_account"] {
		pk := sourceText(row, "ba_id")
		code, err := ObjectCode("bank-account", pk)
		if err != nil {
			return result, err
		}
		result.Codes["wb_bank_account/"+pk] = code
		if organizations[sourceText(row, "org_id")] == nil || sourceText(organizations[sourceText(row, "org_id")], "org_type") != "0" {
			return result, ErrValue
		}
		if requireString(row, "account_name", 200) != nil || optionalString(row, "bank_name", 200) != nil || optionalString(row, "short_name", 50) != nil {
			return result, ErrValue
		}
		subtype, err := fixedEnum(row["ba_type"], map[string]string{"0": "basic", "1": "general", "2": "special", "3": "cash", "4": "loan"})
		if err != nil {
			return result, err
		}
		status, err := fixedEnum(row["ba_status"], map[string]string{"0": "active", "1": "inactive"})
		if err != nil {
			return result, err
		}
		accountType := "bank"
		var secret, mask any
		var subtypeValue any = subtype
		if subtype == "cash" {
			accountType = "cash"
			subtypeValue = nil
		} else {
			if p.VaultWrite == "forbidden" {
				return result, ErrValue
			}
			secret, _ = SecretRef(code)
			synthetic := "WIZBIZ-TEST-" + pk
			if p.VaultWrite == "real" {
				synthetic = sourceText(row, "account_number")
				if synthetic == "" || synthetic != strings.TrimSpace(synthetic) {
					return result, ErrVault
				}
			}
			mask = maskAccount(synthetic)
		}
		created, _ := sourceInstant(row["operate_time"])
		result.add("bank-account", "wb_bank_account", pk, "finance_bank_account", "primary", "code", code, map[string]any{"code": code, "account_name": row["account_name"], "bank_name": row["bank_name"], "account_type": accountType, "account_subtype": subtypeValue, "account_no_secret_ref": secret, "account_no_masked": mask, "legal_entity_code": result.Codes["wb_organization/"+sourceText(row, "org_id")], "short_name": row["short_name"], "bank_branch_code": row["bank_code"], "sort_no": bankAccountSortNumber(row["account_sn"]), "status": status, "opened_at": row["create_time"], "currency_code": "CNY", "remark": row["remark"], "created_by": result.audit(row), "created_at": created})
		if subtype != "cash" {
			value := "WIZBIZ-TEST-" + pk
			if p.VaultWrite == "real" {
				value = sourceText(row, "account_number")
			}
			result.Objects[len(result.Objects)-1].VaultContentSHA256 = Digest([]byte(value))
		}

	}
	if err := prepareBalances(data, &result, p, banks); err != nil {
		return result, err
	}
	if err := prepareContracts(data, &result, p, organizations, contacts, banks); err != nil {
		return result, err
	}
	sort.Slice(result.Objects, func(i, j int) bool {
		a, b := result.Objects[i], result.Objects[j]
		if stepIndex(a.Step) != stepIndex(b.Step) {
			return stepIndex(a.Step) < stepIndex(b.Step)
		}
		if a.SourceTable != b.SourceTable {
			return a.SourceTable < b.SourceTable
		}
		ai, _ := strconv.ParseUint(a.SourcePK, 10, 64)
		bi, _ := strconv.ParseUint(b.SourcePK, 10, 64)
		if ai != bi {
			return ai < bi
		}
		return a.Role < b.Role
	})
	// Deduplicate identical source-missing exception keys without losing evidence.
	unique := map[string]Exception{}
	for _, e := range result.Exceptions {
		key := e.Kind + "/" + e.Table + "/" + e.PK
		if old, ok := unique[key]; ok && factsHash(old.Detail) != factsHash(e.Detail) {
			old.Detail = mergeExceptionReferences(old.Detail, e.Detail)
			unique[key] = old
		} else if !ok {
			unique[key] = e
		}
	}
	result.Exceptions = nil
	for _, e := range unique {
		result.Exceptions = append(result.Exceptions, e)
	}
	sort.Slice(result.Exceptions, func(i, j int) bool { return factsHash(result.Exceptions[i]) < factsHash(result.Exceptions[j]) })
	if err := finalizeExceptions(&result); err != nil {
		return result, err
	}

	return result, nil
}
func snapshotTime(p Profile) string { return p.snapshotAt }
func maskAccount(value string) string {
	chars := []rune(value)
	if len(chars) <= 4 {
		return strings.Repeat("*", len(chars))
	}
	return strings.Repeat("*", len(chars)-4) + string(chars[len(chars)-4:])
}

var steps = []string{"ledger-preserve", "identity", "legal-entity", "customer", "customer-hierarchy", "contact", "bank-account", "balance", "contract", "contract-relations", "snapshots", "exceptions"}

func stepIndex(step string) int {
	for i, s := range steps {
		if s == step {
			return i
		}
	}
	return 100
}
func SortedTableNamesFromData(data SourceData) []string {
	names := []string{}
	for name := range data {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
func preparedDigest(value any) string { raw, _ := json.Marshal(value); return Digest(raw) }

func validateMigrationOwner(owner string) error { return enterpriseapf.ValidateMigrationOwner(owner) }

func validateSourceDecimal(value any, columnType string) error {
	match := regexp.MustCompile(`^decimal\(([0-9]+),([0-9]+)\)$`).FindStringSubmatch(columnType)
	text, ok := value.(string)
	if !ok || len(match) != 3 {
		return ErrValue
	}
	precision, _ := strconv.Atoi(match[1])
	scale, _ := strconv.Atoi(match[2])
	pattern := `^-?[0-9]{1,` + strconv.Itoa(precision-scale) + `}`
	if scale > 0 {
		pattern += `\.[0-9]{` + strconv.Itoa(scale) + `}`
	}
	if !regexp.MustCompile(pattern + `$`).MatchString(text) {
		return ErrValue
	}
	return nil
}

// Source 0 means unrated, not a seventh rating. The source row stays unchanged
// and is preserved verbatim in mig_source_row by the ledger writer.
func contactStarLevel(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	text, ok := value.(string)
	if ok && text == "0" {
		return nil, nil
	}
	if !ok || len(text) != 1 || text[0] < '1' || text[0] > '6' {
		return nil, ErrValue
	}
	return text, nil
}

func bankAccountSortNumber(value any) any {
	if value == nil {
		return "0"
	}
	return value
}
