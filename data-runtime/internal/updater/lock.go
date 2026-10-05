package updater

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

var ErrUpdateExecutionBusy = errors.New("data-runtime update execution is busy")

type ExecutionLock struct {
	file *os.File
}

func AcquireExecutionLock(ctx context.Context, path string, wait bool) (*ExecutionLock, error) {
	if path == "" || !filepath.IsAbs(path) {
		return nil, fmt.Errorf("update execution lock path must be absolute")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0750); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := file.Chmod(0600); err != nil {
		_ = file.Close()
		return nil, err
	}
	for {
		err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			if truncateErr := file.Truncate(0); truncateErr != nil {
				_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
				_ = file.Close()
				return nil, truncateErr
			}
			if _, writeErr := fmt.Fprintf(file, "%d\n", os.Getpid()); writeErr != nil {
				_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
				_ = file.Close()
				return nil, writeErr
			}
			if syncErr := file.Sync(); syncErr != nil {
				_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
				_ = file.Close()
				return nil, syncErr
			}
			return &ExecutionLock{file: file}, nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EAGAIN) {
			_ = file.Close()
			return nil, err
		}
		if !wait {
			_ = file.Close()
			return nil, ErrUpdateExecutionBusy
		}
		select {
		case <-ctx.Done():
			_ = file.Close()
			return nil, errors.Join(ErrUpdateExecutionBusy, ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func (lock *ExecutionLock) Release() error {
	if lock == nil || lock.file == nil {
		return nil
	}
	unlockErr := syscall.Flock(int(lock.file.Fd()), syscall.LOCK_UN)
	closeErr := lock.file.Close()
	lock.file = nil
	return errors.Join(unlockErr, closeErr)
}
