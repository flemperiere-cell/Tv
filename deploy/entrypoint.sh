#!/bin/sh
set -eu

chown -R app:app /data
exec /usr/bin/supervisord -c /etc/supervisord.conf
