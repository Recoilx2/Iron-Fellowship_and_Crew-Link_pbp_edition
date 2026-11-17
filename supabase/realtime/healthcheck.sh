#!/bin/sh
# Liveness probe for the realtime container (ticket #152).
#
# Realtime's /api/tenants/<tenant>/health endpoint authenticates every
# caller with an HS256 token signed with the app-level API_JWT_SECRET.
# This stack deliberately configures no such secret (see docker-compose.yml):
# with none set, the /api endpoints refuse every caller, so no HS256 token
# is accepted anywhere in realtime. Liveness is therefore the
# unauthenticated /healthcheck route.
#
# Depth is covered elsewhere: the seed runs before the server binds its
# port (so a failed tenant setup never answers this probe), the
# realtime-auth one-shot polls until the tenant's tables exist, and the
# live tests join real channels with real RS256 tokens.
#
# Mounted into the realtime container by docker-compose.yml; the smoke test
# and the CI wait steps exec the same script so all three probes agree.
set -eu

exec curl -sSfL --head -o /dev/null http://localhost:4000/healthcheck
