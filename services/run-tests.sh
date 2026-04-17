#!/bin/bash
# Run all microservice tests
set -e

echo "========================================="
echo "  Microservice Test Suite"
echo "========================================="
echo ""

TOTAL_PASS=0
TOTAL_FAIL=0
SERVICES=("auth" "users" "products" "orders" "payments" "notifications" "analytics" "search")

for svc in "${SERVICES[@]}"; do
  echo "--- Testing: $svc ---"
  OUTPUT=$(bun test "services/$svc/" 2>&1) || true
  echo "$OUTPUT" | tail -3

  PASS=$(echo "$OUTPUT" | grep -oP '\d+ pass' | grep -oP '\d+' || echo "0")
  FAIL=$(echo "$OUTPUT" | grep -oP '\d+ fail' | grep -oP '\d+' || echo "0")

  TOTAL_PASS=$((TOTAL_PASS + PASS))
  TOTAL_FAIL=$((TOTAL_FAIL + FAIL))
  echo ""
done

echo "--- Testing: integration ---"
OUTPUT=$(bun test "services/integration/" 2>&1) || true
echo "$OUTPUT" | tail -3
INT_PASS=$(echo "$OUTPUT" | grep -oP '\d+ pass' | grep -oP '\d+' || echo "0")
INT_FAIL=$(echo "$OUTPUT" | grep -oP '\d+ fail' | grep -oP '\d+' || echo "0")
TOTAL_PASS=$((TOTAL_PASS + INT_PASS))
TOTAL_FAIL=$((TOTAL_FAIL + INT_FAIL))

echo ""
echo "========================================="
echo "  TOTAL: $TOTAL_PASS pass, $TOTAL_FAIL fail"
echo "========================================="

if [ "$TOTAL_FAIL" -gt 0 ]; then
  exit 1
fi
