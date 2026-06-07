#!/bin/sh
# ============================================================
#  Kanban backup sidecar — backup.sh
#
#  Long-running loop: pg_dump → gzip → s3 cp every 24 h.
#  On the 1st of the month, also copies the dump to monthly/.
#  On any failure, logs the error and continues — a failed
#  backup never kills the sidecar; the next cycle retries.
#
#  Environment variables:
#    DATABASE_URL              postgres://user:pass@host:port/db  (required)
#    S3_BACKUP_BUCKET          bucket name without s3:// prefix   (required)
#    AWS_REGION                e.g. us-east-1                     (required)
#    BACKUP_INTERVAL_SECONDS   seconds between cycles (default: 86400)
#    RUN_ONCE                  set to "1" to dump once and exit
#
#  AWS credentials come from the EC2 instance IAM role via IMDS.
# ============================================================
set -u

BACKUP_INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
RUN_ONCE="${RUN_ONCE:-0}"

log() {
    printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

# ---------------------------------------------------------------------------
# wait_for_db: attempt pg_isready until the database accepts connections.
# pg_dump accepts the full URI directly — we extract host + port for pg_isready.
# ---------------------------------------------------------------------------
wait_for_db() {
    # Extract host and port from DATABASE_URL (postgres://user:pass@host:port/db)
    # Strip scheme
    _without_scheme="${DATABASE_URL#postgres://}"
    # Strip user:pass@
    _host_port_db="${_without_scheme##*@}"
    # Strip /db
    _host_port="${_host_port_db%%/*}"
    _db_host="${_host_port%%:*}"
    _db_port="${_host_port##*:}"
    # Default port if not specified
    if [ "$_db_host" = "$_db_port" ]; then
        _db_port=5432
    fi

    log "Waiting for Postgres at ${_db_host}:${_db_port} ..."
    _attempts=0
    until pg_isready -h "$_db_host" -p "$_db_port" -q; do
        _attempts=$((_attempts + 1))
        if [ "$_attempts" -ge 60 ]; then
            log "ERROR: Postgres not reachable after 5 minutes — giving up this cycle."
            return 1
        fi
        sleep 5
    done
    log "Postgres is ready."
    return 0
}

# ---------------------------------------------------------------------------
# run_backup: perform one pg_dump → gzip → S3 upload cycle.
# Returns 0 on full success, non-zero if the dump OR upload failed.
# ---------------------------------------------------------------------------
run_backup() {
    TIMESTAMP="$(date -u '+%Y%m%d_%H%M%S')"
    DAY="$(date -u '+%d')"
    MONTH="$(date -u '+%Y%m')"

    DAILY_KEY="daily/kanban_${TIMESTAMP}.sql.gz"
    DUMP_FILE="/tmp/kanban_${TIMESTAMP}.sql.gz"

    log "Starting backup: ${DAILY_KEY}"

    # --- pg_dump -----------------------------------------------------------------
    # pg_dump accepts a connection URI directly; no need to parse credentials.
    if ! pg_dump "$DATABASE_URL" | gzip > "$DUMP_FILE"; then
        log "ERROR: pg_dump failed for timestamp ${TIMESTAMP}."
        rm -f "$DUMP_FILE"
        return 1
    fi

    DUMP_SIZE="$(du -sh "$DUMP_FILE" 2>/dev/null | cut -f1)"
    log "Dump complete: ${DUMP_FILE} (${DUMP_SIZE})."

    # --- S3 upload (daily) -------------------------------------------------------
    _upload_ok=0
    if aws s3 cp "$DUMP_FILE" \
            "s3://${S3_BACKUP_BUCKET}/${DAILY_KEY}" \
            --sse AES256 \
            --region "$AWS_REGION" 2>&1; then
        log "Uploaded to s3://${S3_BACKUP_BUCKET}/${DAILY_KEY}"
    else
        log "ERROR: S3 upload failed for ${DAILY_KEY}. Dump file at ${DUMP_FILE} is retained for debugging."
        # Keep the dump file so the next cycle's cleanup doesn't hide the failure.
        return 1
    fi

    rm -f "$DUMP_FILE"

    # --- Monthly copy (1st of month only) ----------------------------------------
    if [ "$DAY" = "01" ]; then
        MONTHLY_KEY="monthly/kanban_${MONTH}.sql.gz"
        log "First of month — copying to ${MONTHLY_KEY}"
        if aws s3 cp \
                "s3://${S3_BACKUP_BUCKET}/${DAILY_KEY}" \
                "s3://${S3_BACKUP_BUCKET}/${MONTHLY_KEY}" \
                --sse AES256 \
                --region "$AWS_REGION" 2>&1; then
            log "Monthly copy uploaded to s3://${S3_BACKUP_BUCKET}/${MONTHLY_KEY}"
        else
            log "WARNING: Monthly copy failed for ${MONTHLY_KEY}. Daily backup is intact."
            # Not a fatal error — daily succeeded; monthly failure is a warning only.
        fi
    fi

    log "Backup cycle complete."
    return 0
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
log "Kanban backup sidecar starting. BACKUP_INTERVAL_SECONDS=${BACKUP_INTERVAL_SECONDS} RUN_ONCE=${RUN_ONCE}"
log "Target bucket: s3://${S3_BACKUP_BUCKET}/ (region: ${AWS_REGION})"

while true; do

    # Wait for Postgres to be reachable before attempting a dump.
    if wait_for_db; then
        # Run the backup; if it fails, log and continue — never crash the sidecar.
        if ! run_backup; then
            log "Backup cycle FAILED. Will retry after ${BACKUP_INTERVAL_SECONDS}s."
        fi
    else
        log "Skipping backup cycle — database not reachable."
    fi

    if [ "$RUN_ONCE" = "1" ]; then
        log "RUN_ONCE=1 — exiting after single cycle."
        exit 0
    fi

    log "Sleeping ${BACKUP_INTERVAL_SECONDS}s until next backup cycle."
    sleep "$BACKUP_INTERVAL_SECONDS"

done
