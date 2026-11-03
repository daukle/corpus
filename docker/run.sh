#!/bin/sh
# Runs inside the container: the corpus is mounted read-only at /corpus and results leave through /out.
set -eu
cp -r /corpus "$HOME/corpus"
cd "$HOME/corpus"
status=0
node src/run.ts --daukle /usr/local/bin/daukle --work "$HOME/work" "$@" || status=$?
cp -r results/. /out/
for log in "$HOME"/work/*/*.log "$HOME"/work/*/report.json; do
  [ -f "$log" ] || continue
  entry=$(basename "$(dirname "$log")")
  mkdir -p "/out/logs/$entry"
  cp "$log" "/out/logs/$entry/"
done
exit "$status"
