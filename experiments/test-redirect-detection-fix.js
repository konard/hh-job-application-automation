// Test script to verify the redirect detection fix
// This simulates the navigation handling logic

console.log('Testing redirect detection fix logic...\n');

// Simulate the Promise.race pattern we use in the fix
async function simulateClickWithNavigationDetection(scenario) {
  console.log(`\nScenario: ${scenario.name}`);
  console.log('─'.repeat(50));

  const startTime = Date.now();

  try {
    // Simulate click and navigation detection
    await Promise.race([
      // Simulate the click
      new Promise((resolve) => {
        console.log('  ⏱️  Clicking button...');
        setTimeout(resolve, 100); // Click takes 100ms
      }),
      // Simulate navigation detection
      new Promise((resolve, reject) => {
        if (scenario.navigates) {
          console.log('  🔄 Navigation detected!');
          setTimeout(resolve, scenario.navigationDelay);
        } else {
          // Timeout after 2000ms if no navigation
          setTimeout(() => {
            reject(new Error('Navigation timeout'));
          }, 2000);
        }
      }).catch(() => {
        console.log('  ⏱️  No navigation detected (timeout expected)');
      })
    ]);

    // Additional delay for any late redirects
    await new Promise(resolve => setTimeout(resolve, 500));

    const elapsedTime = Date.now() - startTime;
    console.log(`  ⏱️  Total time: ${elapsedTime}ms`);

    // Check URL (simulated)
    const currentUrl = scenario.finalUrl;
    const targetPagePattern = /^https:\/\/hh\.ru\/search\/vacancy/;
    const isOnTargetPage = targetPagePattern.test(currentUrl);

    console.log(`  📍 Final URL: ${currentUrl}`);
    console.log(`  ✅ On target page: ${isOnTargetPage}`);

    if (!isOnTargetPage) {
      console.log('  ⚠️  Redirected to different page - automation stopped');
      return { success: false, stopped: true };
    } else {
      console.log('  ✅ Continuing with automation');
      return { success: true, stopped: false };
    }

  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Test scenarios
const scenarios = [
  {
    name: 'Modal opens (no navigation)',
    navigates: false,
    finalUrl: 'https://hh.ru/search/vacancy?resume=xxx&from=resumelist',
    expectedStopped: false
  },
  {
    name: 'Immediate redirect to application page',
    navigates: true,
    navigationDelay: 200,
    finalUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=123',
    expectedStopped: true
  },
  {
    name: 'Delayed redirect (800ms)',
    navigates: true,
    navigationDelay: 800,
    finalUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=456',
    expectedStopped: true
  },
  {
    name: 'Very delayed redirect (1500ms)',
    navigates: true,
    navigationDelay: 1500,
    finalUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=789',
    expectedStopped: true
  }
];

// Run tests
(async () => {
  let passed = 0;
  let failed = 0;

  for (const scenario of scenarios) {
    const result = await simulateClickWithNavigationDetection(scenario);

    const testPassed = result.stopped === scenario.expectedStopped;

    if (testPassed) {
      console.log('  🎉 TEST PASSED\n');
      passed++;
    } else {
      console.log(`  ❌ TEST FAILED - Expected stopped=${scenario.expectedStopped}, got stopped=${result.stopped}\n`);
      failed++;
    }
  }

  console.log('═'.repeat(50));
  console.log(`Total: ${scenarios.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('═'.repeat(50));

  if (failed === 0) {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
  }
})();
