#!/bin/sh
# Runs inside the container: the corpus is mounted read-only at /corpus and every result is written
# straight to /out as it exists. The first argument names the command: run or admit.
set -eu
command="$1"
shift
cp -r /corpus "$HOME/corpus"
cd "$HOME/corpus"
exec node "src/$command.ts" --daukle /usr/local/bin/daukle --work "$HOME/work" --results /out "$@"
