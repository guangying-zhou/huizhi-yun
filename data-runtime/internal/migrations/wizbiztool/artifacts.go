package wizbiztool

import (
	"bytes"
	"fmt"
	"os"
)

// WritePlanArtifacts binds coverage in plan itself and writes the separately
// reviewable matrix plus a counts-only text summary. All files are exclusive.
func WritePlanArtifacts(path string, plan Plan) error {
	paths := []string{path, path + ".coverage.json", path + ".review.txt"}
	written := []string{}
	ok := false
	defer func() {
		if !ok {
			for _, p := range written {
				os.Remove(p)
			}
		}
	}()
	for i, value := range []any{plan, plan.Coverage} {
		if err := WriteJSON(paths[i], value); err != nil {
			return err
		}
		written = append(written, paths[i])
	}
	var review bytes.Buffer
	fmt.Fprintf(&review, "batch=%s\nobjects=%d\ncoverageFields=%d\nreviewHash=%s\n", plan.BatchCode, len(plan.Objects), len(plan.Coverage), plan.ReviewHash)
	for _, step := range plan.Steps {
		fmt.Fprintf(&review, "step=%s rows=%d\n", step.Step, step.Rows)
	}
	file, err := os.OpenFile(paths[2], os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return ErrProfile
	}
	written = append(written, paths[2])
	defer file.Close()
	if file.Chmod(0600) != nil {
		return ErrProfile
	}
	if _, err = file.Write(review.Bytes()); err != nil {
		return ErrProfile
	}
	if file.Sync() != nil {
		return ErrProfile
	}
	ok = true
	return nil
}
