#!/bin/sh
set -eu

envsubst '${PORT} ${API_UPSTREAM}' \
  < /opt/render/default.conf.template \
  > /etc/nginx/conf.d/default.conf
