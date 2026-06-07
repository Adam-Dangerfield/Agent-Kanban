# ============================================================
#  Kanban backup sidecar
#
#  Runs a long-lived loop that pg_dumps the Postgres database
#  every 24 h, gzips the output, and uploads it to S3.
#
#  Environment variables (all required unless noted):
#    DATABASE_URL          postgres://user:pass@host:port/db
#    S3_BACKUP_BUCKET      name of the S3 bucket (no s3:// prefix)
#    AWS_REGION            e.g. us-east-1
#    BACKUP_INTERVAL_SECONDS  (optional, default 86400)
#    RUN_ONCE              (optional) set to "1" to dump once and exit
#
#  AWS credentials: from the EC2 instance IAM role — no keys needed.
# ============================================================

FROM alpine:3.20

# postgresql16-client provides pg_dump 16.x.
# aws-cli is the official AWS CLI v2 packaged for Alpine 3.19+.
RUN apk add --no-cache \
    postgresql16-client \
    aws-cli \
    # gzip is part of busybox on alpine; explicitly ensure it's present.
    gzip

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

ENTRYPOINT ["/backup.sh"]
