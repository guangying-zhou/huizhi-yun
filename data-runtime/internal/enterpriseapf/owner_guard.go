package enterpriseapf

import (
	"context"
	"strings"
	"unicode"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Owner assignment guard (WizBiz migration W2, prerequisite 2).
//
// An owner is the subject of object-relation authorization, so a write may
// only assign an owner who is a real, currently active Directory user. The
// Directory check runs inside the owning write entry, before its business
// transaction opens. Explicit assignments use the exact payload being written;
// inherited assignments bind the pre-read result to the actual uid at insertion.
//
// ReservedUnassignedOwner marks an object whose historical owner could not be
// mapped to a Directory user. Nobody can be that subject. It can never be
// written through any user-reachable entry; only the migration lane may, and it
// must validate with ValidateMigrationOwner.
const ReservedUnassignedOwner = "system:unassigned"

// OwnerDirectory reports whether uid is a currently active Directory user. A
// dependency failure must be returned as an error (503), never as false.
type OwnerDirectory func(ctx context.Context, uid string) (bool, error)

func (s *Service) ConfigureOwnerDirectory(check OwnerDirectory) { s.ownerDirectory = check }

// ownerPayloadKeys is the closed set of direct payload owner/assignee fields.
// TestOwnerPayloadKeysAreClosed fails when a write reads another owner field.
var ownerPayloadKeys = []string{"owner_uid", "owner_user_id", "responsibleUid"}

// ReservedOwner reports subjects that are never people: platform and client
// identities, including the unassigned marker.
func ReservedOwner(uid string) bool {
	lower := strings.ToLower(uid)
	return strings.HasPrefix(lower, "system:") || strings.HasPrefix(lower, "client:") || lower == "system"
}

func ownerShapeInvalid(uid string) bool {
	if uid == "" || len(uid) > 64 || strings.TrimSpace(uid) != uid || strings.EqualFold(uid, "@all") {
		return true
	}
	for _, r := range uid {
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return true
		}
	}
	return false
}

// OwnerTargets returns the owners a payload assigns. A present but empty or
// non-string owner field is left to the operation's own validation.
func OwnerTargets(payload map[string]any) []string {
	var out []string
	for _, key := range ownerPayloadKeys {
		if value, ok := payload[key].(string); ok && value != "" {
			out = append(out, value)
		}
	}
	return out
}

// verifyOwnerTargets rejects reserved or malformed owners and owners who are
// not active Directory users. Without a configured Directory it fails closed.
func (s *Service) verifyOwnerTargets(ctx context.Context, payload map[string]any) error {
	for _, uid := range OwnerTargets(payload) {
		if err := s.verifyOwnerTarget(ctx, uid); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) verifyOwnerTarget(ctx context.Context, uid string) error {
	if ownerShapeInvalid(uid) || ReservedOwner(uid) {
		return httperror.New(400, "apf_owner_invalid", "负责人无效")
	}
	if s.ownerDirectory == nil {
		return httperror.New(503, "apf_owner_directory_unavailable", "Directory is required to assign an owner")
	}
	active, err := s.ownerDirectory(ctx, uid)
	if err != nil {
		return err
	}
	if !active {
		return httperror.New(400, "apf_owner_not_active", "负责人不是有效的目录用户")
	}
	return nil
}

// ValidateMigrationOwner is the only sanctioned way to accept the unassigned
// marker: the migration lane calls it for every owner it writes. A mapped
// owner must still be a plain, non-reserved uid; whether that user is active
// is decided by the confirmed identity mapping, not here.
func ValidateMigrationOwner(uid string) error {
	if uid == ReservedUnassignedOwner {
		return nil
	}
	if ownerShapeInvalid(uid) || ReservedOwner(uid) {
		return httperror.New(400, "apf_owner_invalid", "Invalid migration owner")
	}
	return nil
}

// Only query arguments may use this reserved owner; user writes still fail above.
func unassignedOwnerReadFilter() string { return ReservedUnassignedOwner }
