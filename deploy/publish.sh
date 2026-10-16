#!/usr/bin/env bash
# Publish an event tree into the dashboard's volume on the cluster (dashboard-plan.md 11): the demo tree on a fresh
# deployment, or any tree the generator wrote.
#
#   deploy/publish.sh <tree>
#   deploy/publish.sh packages/demo-traffic/fixtures
#
# NAMESPACE (default cwa-dashboard) is read from the environment. Needs oc logged in to the cluster, and tar here and
# in the ingest image. The tree is copied into the ingest pod's mount of the volume: the events, the sessions and the
# fleet report first, the closed windows next, and events/index.json last, so the index never names an event that is
# not there yet. The ingest service keeps the index's rows in memory, so it is restarted to read the published index.
#
# The published index replaces the volume's. An event posted to the service before the publish keeps its file but
# leaves the index; publish into a fresh volume, or publish a tree that holds those events too.
set -euo pipefail
if [ $# -ne 1 ] || [ ! -f "$1/events/index.json" ]; then
  echo "usage: $0 <tree, a directory holding events/index.json>" >&2
  exit 2
fi
tree=$1
ns=${NAMESPACE:-cwa-dashboard}
# macOS's tar would add AppleDouble ._ files for extended attributes.
export COPYFILE_DISABLE=1
pod=$(oc -n "$ns" get pod -l app.kubernetes.io/name=dashboard-ingest \
  --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}')
if [ -z "$pod" ]; then
  echo "publish: no running dashboard-ingest pod in $ns" >&2
  exit 1
fi

copy() {
  # The tree's entries by name, never `.`: the volume's root is not the pod user's, so tar there must not try to
  # set its mode or times. Files land owned by the pod's user, with the time they land, and no extended attributes
  # (macOS's tar would carry its own, which GNU tar does not know).
  tar -C "$tree" --no-xattrs -cf - "$@" |
    oc -n "$ns" exec -i "$pod" -- tar -C /srv/data --no-same-owner --no-same-permissions --no-overwrite-dir -m -xf -
}

entries=()
for entry in events sessions fleet.json; do
  if [ -e "$tree/$entry" ]; then entries+=("$entry"); fi
done

echo "publish: $tree into $ns/$pod"
copy --exclude=events/index.json --exclude=events/index "${entries[@]}"
if [ -d "$tree/events/index" ]; then copy events/index; fi
copy events/index.json

oc -n "$ns" rollout restart deployment/dashboard-ingest
oc -n "$ns" rollout status deployment/dashboard-ingest
echo "publish: done"
