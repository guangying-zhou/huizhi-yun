package altoc

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// normalizeCollectionResponsibleMutation validates only an explicitly assigned
// collection owner. NULL is intentional for historical/generated plans and is
// never filled from owner_user_id or a contract owner.
func normalizeCollectionResponsibleMutation(body map[string]any) error {
	value, present := body["collection_responsible_uid"]
	if !present {
		value, present = body["collectionResponsibleUid"]
	}
	if !present {
		return nil
	}
	if value == nil {
		body["collection_responsible_uid"] = nil
		delete(body, "collectionResponsibleUid")
		return nil
	}
	uid, ok := value.(string)
	if !ok || !validCollectionResponsibleUID(uid) {
		return httperror.New(http.StatusBadRequest, "altoc_collection_responsible_invalid", "collectionResponsibleUid is invalid")
	}
	// Do not silently trim: identity evidence must be exact.
	if uid != strings.TrimSpace(fmt.Sprint(value)) {
		return httperror.New(http.StatusBadRequest, "altoc_collection_responsible_invalid", "collectionResponsibleUid is invalid")
	}
	body["collection_responsible_uid"] = uid
	delete(body, "collectionResponsibleUid")
	return nil
}
