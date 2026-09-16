package httperror

import "fmt"

type Error struct {
	Status  int
	Code    string
	Message string
}

func (e Error) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func New(status int, code string, message string) Error {
	return Error{Status: status, Code: code, Message: message}
}
