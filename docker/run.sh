#!/bin/sh
# Runs inside the container. The corpus is mounted read-only at /corpus, every result is written
# straight to /out as it exists, and /cache is a volume that outlives the container: the stored
# references and every download cache, so a second run rebuilds no original project and fetches
# no dependency twice. The first argument names the command: run or admit.
set -eu
command="$1"
shift
for tool in .gradle .m2 .npm .cache; do
  mkdir -p "/cache/home/$tool"
  ln -sfn "/cache/home/$tool" "$HOME/$tool"
done
cp -r /corpus "$HOME/corpus"
cd "$HOME/corpus"
exec node "src/$command.ts" --daukle /usr/local/bin/daukle --work "$HOME/work" --results /out \
  --references /cache/references --daukle-cache /cache/daukle "$@"
