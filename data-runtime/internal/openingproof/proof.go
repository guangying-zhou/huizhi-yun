// Package openingproof decodes the frozen wizbiz-opening-plan.v1 evidence.
// This read-only wire schema does not import the offline migration engine.
// Cross-package parity tests pin serialization to its reviewed format.
package openingproof

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"unicode/utf8"
)

var ErrInput = errors.New("opening_evidence_invalid")

type OpeningCustomerSummary struct {
	SourcePK  string `json:"sourcePk"`
	Contracts int    `json:"contracts"`
	Amount    string `json:"amount"`
}
type OpeningConfirmation struct {
	Customers       []OpeningCustomerSummary `json:"customers,omitempty"`
	SourceType      string                   `json:"sourceType,omitempty"`
	SourceSQLSHA256 string                   `json:"sourceSqlSha256,omitempty"`
	RulesVersion    string                   `json:"rulesVersion,omitempty"`
	AsOfDate        string                   `json:"asOfDate,omitempty"`
	BatchCode       string                   `json:"batchCode"`
	MainReviewHash  string                   `json:"mainReviewHash"`
	SnapshotSHA256  string                   `json:"snapshotSha256"`
	Approver        string                   `json:"approver"`
	Date            string                   `json:"date"`
	Contracts       []OpeningConfirmedRow    `json:"contracts"`
}
type OpeningConfirmedRow struct {
	SourcePK string  `json:"sourcePk"`
	Amount   string  `json:"amount"`
	DueDate  *string `json:"dueDate"`
}
type OpeningRow struct {
	SourcePK     string  `json:"sourcePk"`
	ContractCode string  `json:"contractCode"`
	Code         string  `json:"code"`
	Candidate    string  `json:"candidate"`
	Amount       string  `json:"amount"`
	DueDate      *string `json:"dueDate"`
	Differs      bool    `json:"differs"`
}
type OpeningPlan struct {
	Audit               *FollowupAudit           `json:"audit,omitempty"`
	Version             string                   `json:"version"`
	BatchCode           string                   `json:"batchCode"`
	MainReviewHash      string                   `json:"mainReviewHash"`
	ProfileSHA256       string                   `json:"profileSha256"`
	RuntimeConfigSHA256 string                   `json:"runtimeConfigSha256"`
	SnapshotSHA256      string                   `json:"snapshotSha256"`
	ConfirmationSHA256  string                   `json:"confirmationSha256"`
	Rows                []OpeningRow             `json:"rows"`
	Total               string                   `json:"total"`
	Baseline            map[string][]BaselineRow `json:"baseline"`
	ReviewHash          string                   `json:"reviewHash"`
}
type BaselineRow struct {
	Key        string            `json:"key"`
	SHA256     string            `json:"sha256"`
	PrimaryKey map[string]string `json:"primaryKey"`
}
type AuditDifferenceClass struct {
	Table string `json:"table"`
	Check string `json:"check"`
}
type FollowupAuditProof struct {
	Table          string `json:"table"`
	Field          string `json:"field"`
	AuditID        int64  `json:"auditId"`
	ReceiptID      string `json:"receiptId"`
	Action         string `json:"action"`
	ActorSHA256    string `json:"actorSha256"`
	AuditTime      string `json:"auditTime"`
	PostMigration  bool   `json:"postMigration"`
	FormalReceipt  bool   `json:"formalReceipt"`
	CurrentVersion int64  `json:"currentVersion"`
}
type FollowupAudit struct {
	Version               string                 `json:"version"`
	ApprovedDate          string                 `json:"approvedDate"`
	MainReviewHash        string                 `json:"mainReviewHash"`
	Verified              bool                   `json:"verified"`
	Proofs                []FollowupAuditProof   `json:"proofs"`
	DifferenceClasses     []AuditDifferenceClass `json:"differenceClasses"`
	AdditionalAuditRows   int                    `json:"additionalAuditRows"`
	AdditionalReceiptRows int                    `json:"additionalReceiptRows"`
}

func Digest(v []byte) string { h := sha256.Sum256(v); return hex.EncodeToString(h[:]) }
func ReviewOpeningPlan(p OpeningPlan, hash string) error {
	if p.ReviewHash != hash {
		return ErrInput
	}
	p.ReviewHash = ""
	raw, e := json.Marshal(p)
	if e != nil || p.Version != "wizbiz-opening-plan.v1" || len(hash) != 64 || Digest(raw) != hash {
		return ErrInput
	}
	return nil
}
func CanonicalRow(row map[string]any) ([]byte, error) {
	keys := []string{}
	for k := range row {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var out bytes.Buffer
	out.WriteByte('{')
	for n, k := range keys {
		if n > 0 {
			out.WriteByte(',')
		}
		if e := writeString(&out, k); e != nil {
			return nil, e
		}
		out.WriteByte(':')
		if row[k] == nil {
			out.WriteString("null")
		} else {
			v, ok := row[k].(string)
			if !ok {
				return nil, ErrInput
			}
			if e := writeString(&out, v); e != nil {
				return nil, e
			}
		}
	}
	out.WriteByte('}')
	return out.Bytes(), nil
}
func writeString(out *bytes.Buffer, value string) error {
	if !utf8.ValidString(value) {
		return ErrInput
	}
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if encoder.Encode(value) != nil {
		return ErrInput
	}
	// Restore only JSON's separator escapes, not user-provided literal escape
	// sequences: decoding the quoted string below is avoided by counting slashes.
	raw := bytes.TrimSuffix(encoded.Bytes(), []byte{'\n'})
	for i := 0; i < len(raw); {
		if raw[i] == '\\' && i+1 < len(raw) {
			if raw[i+1] == '\\' {
				out.Write(raw[i : i+2])
				i += 2
				continue
			}
			if i+6 <= len(raw) && (string(raw[i:i+6]) == `\u2028` || string(raw[i:i+6]) == `\u2029`) {
				if raw[i+5] == '8' {
					out.WriteString("\u2028")
				} else {
					out.WriteString("\u2029")
				}
				i += 6
				continue
			}
			out.Write(raw[i : i+2])
			i += 2
			continue
		}
		out.WriteByte(raw[i])
		i++
	}
	return nil
}
