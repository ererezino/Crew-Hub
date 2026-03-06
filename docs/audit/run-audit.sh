#!/bin/bash
set -e

BRANCH="design-audit"
AUDIT_DIR="docs/audit"

echo "Creating branch: ${BRANCH}"
git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"
echo "On branch: $(git branch --show-current)"
echo ""

for i in 01 02 03 04 05 06 07; do
  FILE=$(ls ${AUDIT_DIR}/${i}-*.md 2>/dev/null | head -1)
  if [ -z "$FILE" ]; then
    echo "ERROR: No file found for phase ${i}"
    exit 1
  fi

  PHASE_NAME=$(basename "$FILE" .md)
  echo ""
  echo "========================================"
  echo "  RUNNING: ${PHASE_NAME}"
  echo "========================================"
  echo ""

  cat "$FILE" | claude --dangerously-skip-permissions

  echo ""
  echo "Committing phase ${i}..."
  git add -A
  git commit -m "Design audit: ${PHASE_NAME}" --allow-empty
  echo "Phase ${i} committed."
  echo ""
done

echo "========================================"
echo "  ALL 7 PHASES COMPLETE"
echo "  Branch: ${BRANCH}"
echo "  To merge: git checkout main && git merge ${BRANCH}"
echo "========================================"
