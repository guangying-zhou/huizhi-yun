FROM golang:1.24-alpine AS build

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/hzy-data-runtime ./cmd/hzy-data-runtime

FROM alpine:3.20

WORKDIR /app
COPY --from=build /out/hzy-data-runtime /usr/local/bin/hzy-data-runtime

EXPOSE 8080
CMD ["hzy-data-runtime"]
