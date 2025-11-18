/**
 * Experiment to reproduce issue #80: textarea with answer to question is not really filled
 * This tests the difference between setting textarea.value directly vs triggering input events
 */

console.log('=== Testing Issue #80: Textarea filling methods ===\n');

// Simulate the textarea behavior without browser
function simulateTextarea() {
  const textarea = {
    value: '',
    _listeners: {},
    addEventListener: function(event, callback) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(callback);
    },
    dispatchEvent: function(event) {
      if (this._listeners[event.type]) {
        this._listeners[event.type].forEach(callback => callback(event));
      }
    },
  };

  return textarea;
}

// Test method 1: Direct value assignment (current buggy method)
console.log('Testing direct value assignment...');
const textarea1 = simulateTextarea();
let eventsTriggered1 = false;

textarea1.addEventListener('input', () => {
  eventsTriggered1 = true;
  console.log('Input event triggered on direct assignment');
});

textarea1.value = 'Test answer from direct assignment';
// Simulate what the current code does - manually trigger input event
const inputEvent = { type: 'input' };
textarea1.dispatchEvent(inputEvent);

console.log('Direct assignment result:', {
  value: textarea1.value,
  eventsTriggered: eventsTriggered1,
});

// Test method 2: Simulating type() method behavior
console.log('\nTesting simulated type() method...');
const textarea2 = simulateTextarea();
let eventsTriggered2 = false;

textarea2.addEventListener('input', () => {
  eventsTriggered2 = true;
  console.log('Input event triggered on type() simulation');
});

// Simulate what type() does - set value and trigger events for each character
const text = 'Test answer from type() method';
for (let i = 0; i < text.length; i++) {
  textarea2.value += text[i];
  textarea2.dispatchEvent({ type: 'input' });
}

console.log('Type method result:', {
  value: textarea2.value,
  eventsTriggered: eventsTriggered2,
});

console.log('\n=== Analysis ===');
console.log('Direct value assignment triggers events:', eventsTriggered1);
console.log('Type method triggers events:', eventsTriggered2);

if (eventsTriggered1 && eventsTriggered2) {
  console.log('✅ Both methods trigger events - issue might be elsewhere');
} else if (!eventsTriggered1 && eventsTriggered2) {
  console.log('🎯 ISSUE CONFIRMED: Direct value assignment does not trigger events properly!');
  console.log('💡 The current code manually dispatches input events, but this may not be enough');
  console.log('💡 for modern web frameworks that expect real keystroke events.');
} else {
  console.log('❓ Unexpected results - need further investigation');
}

console.log('\n=== Current Code Analysis ===');
console.log('In playwright-apply.mjs setupQAHandling():');
console.log('  textarea.value = knownAnswer;');
console.log('  // Then manually dispatches input event...');
console.log('  const inputEvent = document.createEvent(\'Event\');');
console.log('  inputEvent.initEvent(\'input\', true, true);');
console.log('  textarea.dispatchEvent(inputEvent);');

console.log('\nFor cover letter (working code):');
console.log('  await textarea.type(MESSAGE);');

console.log('\n=== Proposed Fix ===');
console.log('Change the Q&A prefilling to use:');
console.log('  await textarea.type(knownAnswer);');
console.log('Instead of direct value assignment + manual event dispatch.');
