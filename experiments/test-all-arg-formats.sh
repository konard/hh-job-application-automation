#!/bin/bash

# Script to test various argument passing formats

echo "=== Test 1: Direct node execution with --url ==="
node experiments/test-npm-config.js --url https://direct.example.com
echo ""

echo "=== Test 2: npm run with -- and --url ==="
npm run --silent playwright -- --url https://with-separator.example.com --help
echo ""

echo "=== Test 3: npm run with --url (no --) - npm config approach ==="
npm_config_url=https://npm-config.example.com node experiments/test-npm-config.js
echo ""

echo "=== Test 4: Using -u alias ==="
node experiments/test-npm-config.js -u https://alias.example.com
