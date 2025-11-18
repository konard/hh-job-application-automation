/**
 * Experiment to test the improved selector logic for issue #80
 * Tests that using name attribute for textarea selection works better than nth-of-type
 */

console.log('=== Testing Improved Selector Logic for Issue #80 ===\n');

// Simulate the page.evaluate logic with improved selector
function simulatePageEvaluate() {
  // Mock textareas with different structures
  const mockTextareas = [
    {
      name: 'task_300580794_text',
      closest: () => ({ querySelector: () => ({ textContent: 'Test question?' }) }),
    },
    {
      name: '', // No name attribute
      closest: () => ({ querySelector: () => ({ textContent: 'Another question?' }) }),
    },
    {
      name: 'task_400580795_text',
      closest: () => ({ querySelector: () => ({ textContent: 'Third question?' }) }),
    },
  ];

  const questions = [];

  mockTextareas.forEach((textarea, index) => {
    const taskBody = textarea.closest('[data-qa="task-body"]');
    if (!taskBody) return;

    const questionEl = taskBody.querySelector('[data-qa="task-question"]');
    if (!questionEl) return;

    const question = questionEl.textContent.trim();
    if (question) {
      // Improved selector logic: prefer name attribute, fallback to nth-of-type
      const selector = textarea.name ? `textarea[name="${textarea.name}"]` : `textarea:nth-of-type(${index + 1})`;
      questions.push({ question, selector, index });
    }
  });

  return questions;
}

console.log('Testing selector generation...');
const result = simulatePageEvaluate();

console.log('Generated selectors:');
result.forEach(({ question, selector, index }) => {
  console.log(`- Question: "${question}"`);
  console.log(`  Selector: ${selector}`);
  console.log(`  Index: ${index}`);
  console.log('');
});

console.log('Analysis:');
console.log('1. Textarea with name="task_300580794_text" uses name-based selector');
console.log('2. Textarea without name uses nth-of-type fallback');
console.log('3. Textarea with name="task_400580795_text" uses name-based selector');
console.log('');

console.log('Benefits of improved selector:');
console.log('- Name-based selectors are more reliable and unique');
console.log('- Less prone to DOM structure changes');
console.log('- Works even if textareas are not siblings');
console.log('- Fallback to nth-of-type ensures backward compatibility');
console.log('');

console.log('This should help ensure click() + type() targets the correct textarea element.');

