/**
 * More accurate test for issue #80 based on actual hh.ru HTML structure
 */

console.log('=== Testing Issue #80 with Accurate hh.ru HTML Structure Simulation ===\n');

// Simulate the exact HTML structure from the issue
function simulateHhTextareaStructure() {
  const structure = {
    // Main textarea
    textarea: {
      value: '',
      _events: {},
      addEventListener: function(event, callback) {
        if (!this._events[event]) this._events[event] = [];
        this._events[event].push(callback);
      },
      dispatchEvent: function(event) {
        if (this._events[event.type]) {
          this._events[event.type].forEach(callback => callback(event));
        }
      },
    },

    // The value clone container that mirrors textarea content
    valueCloneContainer: {
      innerHTML: '&ZeroWidthSpace;',
    },

    // The label that should hide when textarea has content
    label: {
      textContent: 'Писать тут',
      style: { display: 'block' },
    },
  };

  // Simulate hh.ru framework behavior based on the HTML structure
  // The framework likely uses the value clone to detect content changes
  const updateUiState = () => {
    const hasContent = structure.textarea.value.trim().length > 0;

    // Update value clone (this might be how the framework detects content)
    if (hasContent) {
      structure.valueCloneContainer.innerHTML = structure.textarea.value;
    } else {
      structure.valueCloneContainer.innerHTML = '&ZeroWidthSpace;';
    }

    // Update label visibility based on content
    if (hasContent) {
      structure.label.style.display = 'none';
    } else {
      structure.label.style.display = 'block';
    }
  };

  // Listen for input events
  structure.textarea.addEventListener('input', updateUiState);

  // Also listen for focus/blur events which might affect the UI
  structure.textarea.addEventListener('focus', () => {
    // On focus, framework might do additional UI updates
    updateUiState();
  });

  structure.textarea.addEventListener('blur', () => {
    updateUiState();
  });

  return structure;
}

console.log('Testing with accurate HTML structure simulation...\n');

console.log('OLD METHOD (direct assignment):');
const oldStructure = simulateHhTextareaStructure();
console.log('Initial - Label display:', oldStructure.label.style.display);
console.log('Initial - Value clone:', oldStructure.valueCloneContainer.innerHTML);

// Simulate old method
oldStructure.textarea.value = 'От $5500 ежемесячно на руки.';
oldStructure.textarea.dispatchEvent({ type: 'input' });

console.log('After old method - Label display:', oldStructure.label.style.display);
console.log('After old method - Value clone:', oldStructure.valueCloneContainer.innerHTML);
console.log('Textarea value:', oldStructure.textarea.value);
console.log('');

console.log('NEW METHOD (type simulation):');
const newStructure = simulateHhTextareaStructure();
console.log('Initial - Label display:', newStructure.label.style.display);
console.log('Initial - Value clone:', newStructure.valueCloneContainer.innerHTML);

// Simulate new method - focus first, then type
newStructure.textarea.dispatchEvent({ type: 'focus' });
const answer = 'От $5500 ежемесячно на руки.';
for (let i = 0; i < answer.length; i++) {
  newStructure.textarea.value += answer[i];
  newStructure.textarea.dispatchEvent({ type: 'input' });
}
newStructure.textarea.dispatchEvent({ type: 'blur' });

console.log('After new method - Label display:', newStructure.label.style.display);
console.log('After new method - Value clone:', newStructure.valueCloneContainer.innerHTML);
console.log('Textarea value:', newStructure.textarea.value);
console.log('');

console.log('=== Analysis ===');
console.log('Both methods work in this simulation, but the real hh.ru framework might:');
console.log('1. Check for content in a different way');
console.log('2. Require specific timing of events');
console.log('3. Need additional events (change, keyup, keydown)');
console.log('4. Have CSS that depends on :focus state');
console.log('5. Use the value clone container for validation');
console.log('');

console.log('The key difference in the fix:');
console.log('- OLD: Direct value assignment + single input event');
console.log('- NEW: Focus + character-by-character typing + multiple input events + blur');
console.log('');
console.log('The new method more closely simulates real user behavior, which is');
console.log('likely what the hh.ru framework expects for proper UI state management.');
