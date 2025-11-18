/**
 * Test script to verify issue #80 fix: Q&A textarea filling with click() + type()
 * This simulates the hh.ru textarea framework behavior and tests the fix
 */

console.log('=== Testing Issue #80 Fix: Q&A Textarea Filling with click() + type() ===\n');

// Simulate hh.ru textarea HTML structure and framework behavior
function simulateHhTextarea() {
  const container = {
    textarea: {
      value: '',
      _events: {},
      _focused: false,
      _clicked: false,
      addEventListener: function(event, callback) {
        if (!this._events[event]) this._events[event] = [];
        this._events[event].push(callback);
      },
      dispatchEvent: function(event) {
        if (this._events[event.type]) {
          this._events[event.type].forEach(callback => callback(event));
        }
      },
      focus: function() {
        this._focused = true;
        this.dispatchEvent({ type: 'focus' });
      },
      click: function() {
        this._clicked = true;
        this.focus(); // Clicking also focuses
        this.dispatchEvent({ type: 'click' });
      },
      type: function(text) {
        // Simulate typing character by character
        for (let i = 0; i < text.length; i++) {
          this.value += text[i];
          this.dispatchEvent({ type: 'input' });
          // Also trigger keydown/keyup events
          this.dispatchEvent({ type: 'keydown' });
          this.dispatchEvent({ type: 'keyup' });
        }
        // Trigger change event at the end
        this.dispatchEvent({ type: 'change' });
      },
    },
    label: {
      textContent: 'Писать тут',
      style: { display: 'block' },
    },
    valueCloneContainer: {
      innerHTML: '&ZeroWidthSpace;',
    },
  };

  // Simulate hh.ru framework behavior based on the HTML structure
  const updateUiState = () => {
    const hasContent = container.textarea.value.trim().length > 0;

    // Update value clone (this mirrors textarea content)
    if (hasContent) {
      container.valueCloneContainer.innerHTML = container.textarea.value;
    } else {
      container.valueCloneContainer.innerHTML = '&ZeroWidthSpace;';
    }

    // Update label visibility - this is the key behavior that was broken
    if (hasContent) {
      container.label.style.display = 'none';
      container.label.textContent = '';
    } else {
      container.label.style.display = 'block';
      container.label.textContent = 'Писать тут';
    }
  };

  // Listen for input events to update UI state
  container.textarea.addEventListener('input', updateUiState);

  // Focus/blur events might also affect UI
  container.textarea.addEventListener('focus', updateUiState);
  container.textarea.addEventListener('blur', updateUiState);

  return container;
}

console.log('Testing OLD method (focus() + type() - current buggy implementation):');
const oldTextarea = simulateHhTextarea();
console.log('Initial - Label display:', oldTextarea.label.style.display);
console.log('Initial - Label text:', oldTextarea.label.textContent);
console.log('Initial - Value clone:', oldTextarea.valueCloneContainer.innerHTML);

// Simulate old method (what was implemented before the fix)
oldTextarea.textarea.focus();
oldTextarea.textarea.type('От $5500 ежемесячно на руки.');

console.log('After old method - Label display:', oldTextarea.label.style.display);
console.log('After old method - Label text:', oldTextarea.label.textContent);
console.log('After old method - Value clone:', oldTextarea.valueCloneContainer.innerHTML);
console.log('Textarea value:', oldTextarea.textarea.value);
console.log('');

console.log('Testing NEW method (click() + type() - the fix):');
const newTextarea = simulateHhTextarea();
console.log('Initial - Label display:', newTextarea.label.style.display);
console.log('Initial - Label text:', newTextarea.label.textContent);
console.log('Initial - Value clone:', newTextarea.valueCloneContainer.innerHTML);

// Simulate new method (the fix)
newTextarea.textarea.click();
newTextarea.textarea.type('От $5500 ежемесячно на руки.');

console.log('After new method - Label display:', newTextarea.label.style.display);
console.log('After new method - Label text:', newTextarea.label.textContent);
console.log('After new method - Value clone:', newTextarea.valueCloneContainer.innerHTML);
console.log('Textarea value:', newTextarea.textarea.value);
console.log('');

console.log('=== Test Results ===');
const oldMethodFailed = oldTextarea.label.style.display === 'block';
const newMethodWorked = newTextarea.label.style.display === 'none';

if (oldMethodFailed && newMethodWorked) {
  console.log('🎯 SUCCESS: Issue #80 fix verified!');
  console.log('   - Old method: Label incorrectly remains visible');
  console.log('   - New method: Label properly hides when textarea has content');
  console.log('');
  console.log('The click() method ensures the textarea is properly activated,');
  console.log('triggering all the events that hh.ru framework expects for UI updates.');
} else if (oldMethodFailed && !newMethodWorked) {
  console.log('❌ Fix did not work - need to investigate further');
} else {
  console.log('❓ Unexpected results - both methods behaved the same');
}

console.log('\n=== Implementation Summary ===');
console.log('Changed Q&A prefilling in both playwright-apply.mjs and puppeteer-apply.mjs:');
console.log('FROM: await textarea.focus(); await textarea.type(answer);');
console.log('TO:   await textarea.click(); await textarea.type(answer);');
console.log('');
console.log('This matches the working cover letter filling code and ensures');
console.log('proper event triggering for hh.ru textarea framework.');
