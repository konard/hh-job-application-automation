// Test script to verify URL redirect handling logic
console.log('Testing URL redirect detection logic...\n');

// Test cases for URL validation
const testCases = [
  {
    url: 'https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist',
    expectedMatch: true,
    description: 'Valid target page URL with query params'
  },
  {
    url: 'https://hh.ru/search/vacancy',
    expectedMatch: true,
    description: 'Valid target page URL without query params'
  },
  {
    url: 'https://hh.ru/applicant/vacancy_response?vacancyId=127227959&employerId=723714&hhtmFrom=vacancy_search_list',
    expectedMatch: false,
    description: 'Redirect to separate application form page'
  },
  {
    url: 'https://hh.ru/applicant/resumes',
    expectedMatch: false,
    description: 'Different page on same domain'
  },
  {
    url: 'https://hh.ru/search/vacancy/advanced',
    expectedMatch: true,
    description: 'Target page with additional path'
  }
];

const targetPagePattern = /^https:\/\/hh\.ru\/search\/vacancy/;

console.log('Target page pattern:', targetPagePattern.toString());
console.log('');

let passCount = 0;
let failCount = 0;

testCases.forEach((testCase, index) => {
  const matches = targetPagePattern.test(testCase.url);
  const passed = matches === testCase.expectedMatch;

  console.log(`Test ${index + 1}: ${testCase.description}`);
  console.log(`  URL: ${testCase.url}`);
  console.log(`  Expected: ${testCase.expectedMatch ? 'MATCH' : 'NO MATCH'}`);
  console.log(`  Actual: ${matches ? 'MATCH' : 'NO MATCH'}`);
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log('');

  if (passed) {
    passCount++;
  } else {
    failCount++;
  }
});

console.log('='.repeat(50));
console.log(`Total tests: ${testCases.length}`);
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);
console.log('='.repeat(50));

if (failCount === 0) {
  console.log('\n✅ All URL redirect detection tests passed!');
} else {
  console.log('\n❌ Some tests failed. Please review the logic.');
  process.exit(1);
}
