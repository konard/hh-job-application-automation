#!/bin/bash

echo "=== Test 1: npm run with --url parameter ==="
npm run playwright -- --url https://example.com --help

echo ""
echo "=== Test 2: Check if help works ==="
npm run playwright -- --help

echo ""
echo "=== Test 3: Using alias -u ==="
npm run playwright -- -u https://example.com --help
