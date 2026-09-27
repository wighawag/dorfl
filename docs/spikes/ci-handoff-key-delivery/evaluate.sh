#!/usr/bin/env bash
# Score one run of the spike: which keys appear in which job logs.
# Usage: evaluate.sh <owner/repo> <run-id>
set -euo pipefail
R="$1"; RUN="$2"; W="$(mktemp -d)"
gh api "repos/$R/actions/runs/$RUN/logs" > "$W/logs.zip"
python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$W/logs.zip" "$W/logs"
echo "## run $RUN: files in log archive"
find "$W/logs" -type f | sed "s|$W/logs/||" | sort | head -60
echo "## key occurrences (kind-leg, file, count); random part not printed"
grep -rEo 'SPIKEKEY-[A-Z]+-[a-z]+-[0-9a-f]{32}' "$W/logs" | sed -E "s|$W/logs/||; s|(SPIKEKEY-[A-Z]+-[a-z]+)-[0-9a-f]{32}|\1|" | sort | uniq -c || echo "(none)"
echo "## lines showing a key (value redacted)"
grep -rE 'SPIKEKEY-[A-Z]+-[a-z]+-[0-9a-f]{32}' "$W/logs" | sed -E "s|$W/logs/||; s|[0-9a-f]{32}|<32hex>|g; s|^[^:]*:[0-9TZ:.-]* ?||" | sort -u | head -20 || true
echo "## masked-output notices"
grep -rh "Skip output" "$W/logs" | sed -E 's|^[0-9TZ:.-]* ?||' | sort -u || echo "(none)"
echo "## jobs API contains key prefix?"
gh api "repos/$R/actions/runs/$RUN/jobs?per_page=100" | grep -c SPIKEKEY || true
rm -rf "$W"
