#!/usr/bin/env bash
# Run by the Deploy workflow before `wrangler deploy`: makes what a new Cloudflare account is missing, and only that.
# It is best effort and never fails the deploy: a deploy that can't check or make something says so and goes on.
#   - the photo bucket, if there isn't one
#   - the tables (schema.sql), only when the database says "no such table". A database in use is never touched, and a
#     check that fails for any other reason (a token without D1 permission, a network error) is not taken for "empty".
set -u

if ! npx wrangler r2 bucket info techo-photos >/dev/null 2>&1; then
  echo "R2 bucket techo-photos not found: creating it"
  npx wrangler r2 bucket create techo-photos >/dev/null 2>&1 \
    || echo "::warning::couldn't create the R2 bucket techo-photos (the token needs R2 edit permission); create it by hand if it is missing"
fi

if out=$(npx wrangler d1 execute DB --remote --command "SELECT 1 FROM entries LIMIT 1" 2>&1); then
  echo "D1 tables exist: nothing to do"
elif grep -qi "no such table" <<<"$out"; then
  echo "D1 has no tables: creating them from schema.sql"
  npx wrangler d1 execute DB --remote --file=schema.sql \
    || echo "::warning::couldn't create the tables; run \`npm run db:init:remote\` by hand"
else
  echo "::warning::couldn't check the D1 tables, leaving them alone (a token needs D1 edit permission for this step):"
  echo "$out" | tail -4
fi
exit 0
