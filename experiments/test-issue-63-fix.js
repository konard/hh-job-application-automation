#!/usr/bin/env node

/**
 * Experiment to demonstrate the fix for issue #63
 *
 * This script simulates the sequence of operations to show that:
 * 1. Before fix: Button disabled check happened BEFORE entering message -> Error
 * 2. After fix: Button disabled check happens AFTER entering message -> Success
 */

console.log('=== Issue #63 Fix Demonstration ===\n');

// Simulate modal state
class MockModal {
  constructor() {
    this.coverLetterText = '';
    this.coverLetterRequired = true;
  }

  enterCoverLetter(text) {
    this.coverLetterText = text;
    console.log(`📝 Entered cover letter: "${text.substring(0, 50)}..."`);
  }

  isSubmitButtonDisabled() {
    // Button is disabled if cover letter is required but not provided
    const disabled = this.coverLetterRequired && (!this.coverLetterText || this.coverLetterText.trim() === '');
    console.log(`🔘 Submit button disabled: ${disabled}`);
    return disabled;
  }
}

// Before fix: Check button BEFORE entering message
console.log('❌ BEFORE FIX (Incorrect Order):');
console.log('─'.repeat(50));
const modalBefore = new MockModal();
console.log('1. Modal opened');
console.log('2. Checking if button is disabled...');
if (modalBefore.isSubmitButtonDisabled()) {
  console.log('   ⛔ ERROR: Application button is disabled!');
  console.log('   Process would exit with error here.');
} else {
  console.log('3. Would enter cover letter...');
  console.log('4. Would click submit button');
}
console.log('\n');

// After fix: Check button AFTER entering message
console.log('✅ AFTER FIX (Correct Order):');
console.log('─'.repeat(50));
const modalAfter = new MockModal();
console.log('1. Modal opened');
console.log('2. Entering cover letter...');
modalAfter.enterCoverLetter('Sample cover letter message for the application');
console.log('3. Checking if button is disabled...');
if (modalAfter.isSubmitButtonDisabled()) {
  console.log('   ⛔ ERROR: Application button is still disabled after entering message!');
  console.log('   Process would exit with error here.');
} else {
  console.log('   ✅ Button is enabled!');
  console.log('4. Clicking submit button');
  console.log('   ✅ Application submitted successfully!');
}
console.log('\n');

console.log('=== Conclusion ===');
console.log('The fix ensures that we check if the button is disabled');
console.log('AFTER entering the required cover letter, not before.');
console.log('This allows the automation to proceed for vacancies that');
console.log('require a cover letter message.');
