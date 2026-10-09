package codocs

import (
	"context"
	"database/sql"
)

// snapshotPolicy is the authorization strategy of v2 snapshot prepare/publish.
// The transaction skeleton (locks, generation/epoch CAS, candidates, history)
// is shared; who may write, and what proves it, differs by document type:
//
//   - privateSnapshotPolicy: the personal owner/share model. The acting
//     identity (the Host user, or the session opener for Collab) must be the
//     owner or hold a write share. This is the original behaviour, unchanged.
//   - departmentSnapshotPolicy: see enterprise_department_document_collaboration.go.
//     Department authorization depends on a Directory relation that changes
//     without any Codocs transaction, so it is re-verified per participant.
//
// Lock order for every policy: Directory (outside, shared) -> document row ->
// snapshot head -> candidate. begin runs before the Codocs transaction opens
// and is the only place a policy may take Directory locks.
type snapshotPolicy interface {
	begin(ctx context.Context, a *Adapter, id PersonalFolderCreationIdentity, uuid string) (release func(), err error)
	lockDocument(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, uuid string) (int64, error)
	checkWrite(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, cmd SnapshotCommand, epoch int64) error
	recordPublication(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, candidateKey string) error
}

type privateSnapshotPolicy struct{}

func (privateSnapshotPolicy) begin(context.Context, *Adapter, PersonalFolderCreationIdentity, string) (func(), error) {
	return func() {}, nil
}

func (privateSnapshotPolicy) lockDocument(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, uuid string) (int64, error) {
	return lockSnapshotDocument(ctx, tx, id, uuid)
}

func (privateSnapshotPolicy) checkWrite(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, cmd SnapshotCommand, epoch int64) error {
	return checkCollaborationForWrite(ctx, tx, id, cmd, epoch)
}

func (privateSnapshotPolicy) recordPublication(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, candidateKey string) error {
	if id.Client == "collab.runtime" {
		return recordCollaborationPublication(ctx, tx, id, candidateKey)
	}
	return nil
}
