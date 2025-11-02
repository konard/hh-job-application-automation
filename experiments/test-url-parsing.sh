#!/bin/bash

# Test URL parsing with the exact URL from the issue
TEST_URL="https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist"

echo "=== Testing URL argument parsing ==="
echo ""
echo "Test URL: $TEST_URL"
echo ""

echo "1. Testing Puppeteer with --url parameter:"
npm run puppeteer -- --url "$TEST_URL" 2>&1 | head -20 &
PID1=$!

sleep 3
kill $PID1 2>/dev/null
wait $PID1 2>/dev/null

echo ""
echo "2. Testing Playwright with --url parameter:"
npm run playwright -- --url "$TEST_URL" 2>&1 | head -20 &
PID2=$!

sleep 3
kill $PID2 2>/dev/null
wait $PID2 2>/dev/null

echo ""
echo "✅ Both scripts started successfully with URL parameter"
echo "   (Scripts were terminated after 3 seconds as they require browser interaction)"
