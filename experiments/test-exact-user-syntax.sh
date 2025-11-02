#!/bin/bash

# Test the exact syntax requested by the user
TEST_URL="https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist"

echo "=== Testing exact user syntax ==="
echo "Command: npm run playwright --url $TEST_URL"
echo ""

# Create a temporary package.json entry for testing
cat > /tmp/test-package.json <<EOF
{
  "scripts": {
    "test-playwright": "node experiments/test-playwright-args.js"
  }
}
EOF

# Test with npm config approach (user requested syntax without --)
echo "Test Result:"
npm_config_url="$TEST_URL" node experiments/test-playwright-args.js
echo ""

echo "=== Testing with -- separator (alternative syntax) ==="
echo "Command: npm run playwright -- --url $TEST_URL"
echo ""
echo "Test Result:"
node experiments/test-playwright-args.js --url "$TEST_URL"
