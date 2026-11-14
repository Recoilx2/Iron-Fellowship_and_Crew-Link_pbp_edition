#!/bin/sh
# Fails the site container start when the built client's image cap disagrees
# with the deployment setting the bucket follows (spec #9, ticket #118).
#
# Both caps come from the one setting CHAT_IMAGE_MAX_MB: the bucket reads it
# on every start (supabase/migrate/apply.sh rewrites file_size_limit and
# fails when the stored cap disagrees), and the site bakes it in at build
# time as VITE_CHAT_IMAGE_MAX_MB (supabase/site/Dockerfile records the baked
# value in dist/chat-image-max-mb.txt). A stale site image -- rebuilt without
# the new setting, or started with a different env file -- would otherwise
# let the browser and the server refuse different files. Comparing the baked
# value against the runtime setting here fails the start instead, so the
# bucket and the client can never drift apart silently.
set -eu

baked=""
if [ -f /usr/share/nginx/html/chat-image-max-mb.txt ]; then
  baked="$(cat /usr/share/nginx/html/chat-image-max-mb.txt)"
fi
# Fall back to the baked image env when the marker file is missing (older
# images built before the marker existed).
if [ -z "$baked" ]; then
  baked="${VITE_CHAT_IMAGE_MAX_MB:-10}"
fi
runtime="${CHAT_IMAGE_MAX_MB:-10}"

case "$baked" in
  ''|*[!0-9]*|0*)
    echo "site: invalid baked chat image cap '${baked}' (want a positive integer, megabytes)" >&2
    exit 1
    ;;
esac
case "$runtime" in
  ''|*[!0-9]*|0*)
    echo "site: invalid CHAT_IMAGE_MAX_MB '${CHAT_IMAGE_MAX_MB:-}' (want a positive integer, megabytes)" >&2
    exit 1
    ;;
esac
if [ "$baked" != "$runtime" ]; then
  echo "site: built client cap VITE_CHAT_IMAGE_MAX_MB=${baked} disagrees with deployment CHAT_IMAGE_MAX_MB=${runtime} (the bucket uses ${runtime}); rebuild the site image with VITE_CHAT_IMAGE_MAX_MB=${runtime}" >&2
  exit 1
fi
echo "site: chat image cap agrees at ${baked} MB (bucket and client)"
exec /docker-entrypoint.sh "$@"
