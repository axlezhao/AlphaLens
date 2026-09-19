#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alphalens-a31-d1.XXXXXX")"
CONFIG_PATH="$ROOT_DIR/wrangler.local.jsonc"
export WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH:-$ROOT_DIR/.wrangler/wrangler.log}"

run_d1() {
  pnpm --dir "$ROOT_DIR" exec wrangler d1 execute DB --local --config "$CONFIG_PATH" --persist-to "$STATE_DIR" --command "$1"
}

expect_rejected() {
  local label="$1"
  local expected_code="$2"
  local statement="$3"
  local output
  local status
  set +e
  output="$(run_d1 "$statement" 2>&1)"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    echo "Expected tenant-integrity rejection: $label" >&2
    exit 1
  fi
  if [[ "$output" != *"$expected_code"* ]]; then
    echo "Unexpected rejection for $label: $output" >&2
    exit 1
  fi
}

echo "Applying migrations to an isolated local D1 state: $STATE_DIR"
pnpm --dir "$ROOT_DIR" exec wrangler d1 migrations apply DB --local --config "$CONFIG_PATH" --persist-to "$STATE_DIR" >/dev/null

run_d1 "INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES ('usr_a','a@fixture.invalid','A','2026-09-19T00:00:00.000Z','2026-09-19T00:00:00.000Z'),('usr_b','b@fixture.invalid','B','2026-09-19T00:00:00.000Z','2026-09-19T00:00:00.000Z');" >/dev/null
run_d1 "INSERT INTO workspaces (id,name,owner_user_id,created_at,updated_at) VALUES ('wsp_a','Workspace A','usr_a','2026-09-19T00:00:00.000Z','2026-09-19T00:00:00.000Z'),('wsp_b','Workspace B','usr_b','2026-09-19T00:00:00.000Z','2026-09-19T00:00:00.000Z');" >/dev/null

owner_row="$(run_d1 "SELECT role FROM workspace_members WHERE workspace_id='wsp_a' AND user_id='usr_a';")"
if [[ "$owner_row" != *"owner"* ]]; then
  echo "Workspace creation did not create the controlling owner membership" >&2
  exit 1
fi

run_d1 "INSERT INTO securities (id,workspace_id,ticker,exchange,created_at,updated_at) VALUES ('sec_a','wsp_a','ALPA','US','2026-09-19T00:00:00.000Z','2026-09-19T00:00:00.000Z'),('sec_b','wsp_b','ALPB','US','2026-09-19T00:00:00.000Z','2026-09-19T00:00:00.000Z');" >/dev/null
run_d1 "INSERT INTO portfolios (id,workspace_id,name,base_currency,created_at,updated_at) VALUES ('por_a','wsp_a','A Portfolio','USD','2026-09-19T00:00:00.000Z','2026-09-19T00:00:00.000Z');" >/dev/null
run_d1 "INSERT INTO research_jobs (id,workspace_id,requested_by_user_id,security_id,question,status,as_of,idempotency_key,trace_id,model_version,prompt_version,next_run_at,timeout_at,created_at,updated_at) VALUES ('job_a','wsp_a','usr_a','sec_a','Validate a local tenant integrity fixture','queued','2026-09-19T00:00:00.000Z','fixture-job-a','trace-a','fixture','fixture','2026-09-19T00:00:00.000Z','2026-09-19T01:00:00.000Z','2026-09-19T00:00:00.000Z','2026-09-19T00:00:00.000Z');" >/dev/null

expect_rejected "invalid workspace role" "workspace_member_role_invalid" "INSERT INTO workspace_members (workspace_id,user_id,role,created_at) VALUES ('wsp_a','usr_b','admin','2026-09-19T00:00:00.000Z');"
expect_rejected "cross-workspace research security" "research_job_workspace_mismatch" "INSERT INTO research_jobs (id,workspace_id,requested_by_user_id,security_id,question,status,as_of,idempotency_key,trace_id,model_version,prompt_version,next_run_at,timeout_at,created_at,updated_at) VALUES ('job_cross','wsp_a','usr_a','sec_b','Cross workspace record must fail','queued','2026-09-19T00:00:00.000Z','fixture-job-cross','trace-cross','fixture','fixture','2026-09-19T00:00:00.000Z','2026-09-19T01:00:00.000Z','2026-09-19T00:00:00.000Z','2026-09-19T00:00:00.000Z');"
expect_rejected "cross-workspace portfolio" "portfolio_position_workspace_mismatch" "INSERT INTO portfolio_positions (id,workspace_id,portfolio_id,security_id,position_type,created_at,updated_at) VALUES ('pos_cross','wsp_b','por_a','sec_b','long','2026-09-19T00:00:00.000Z','2026-09-19T00:00:00.000Z');"
expect_rejected "owner transfer without membership" "workspace_owner_must_be_member" "UPDATE workspaces SET owner_user_id='usr_b' WHERE id='wsp_a';"
expect_rejected "controlling owner membership removal" "workspace_controlling_owner_immutable" "DELETE FROM workspace_members WHERE workspace_id='wsp_a' AND user_id='usr_a';"

echo '{"ok":true,"checks":["owner_membership","role_guard","research_job_tenant_guard","portfolio_tenant_guard","owner_transfer_guard","controlling_owner_delete_guard"]}'
