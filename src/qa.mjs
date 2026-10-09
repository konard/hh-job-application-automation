/**
 * Q&A handling module for hh.ru job application forms
 * Handles extraction, matching, and auto-filling of questions and answers
 */

/**
 * Extract all questions from page (textareas, radios, checkboxes)
 * @param {Object} options - Configuration options
 * @param {Function} options.evaluate - Browser commander evaluate function
 * @returns {Promise<Array>} - Array of question objects
 */
export async function extractPageQuestions(options = {}) {
  const { evaluate } = options;

  return await evaluate({
    fn: () => {
      const questions = [];

      // Extract textarea questions - only from task-body elements to avoid mixing with cover letter
      const taskBodies = document.querySelectorAll('[data-qa="task-body"]');
      taskBodies.forEach((taskBody, taskIndex) => {
        const questionEl = taskBody.querySelector('[data-qa="task-question"]');
        if (!questionEl) return;

        const question = questionEl.textContent.trim();
        if (!question) return;

        // Find textarea within this specific task-body
        const textarea = taskBody.querySelector('textarea');
        if (!textarea) return;

        // Generate a unique selector - prefer name attribute for reliability
        // Using name attribute ensures we target the exact textarea without index confusion
        let selector;
        if (textarea.name) {
          selector = `textarea[name="${textarea.name}"]`;
        } else if (textarea.id) {
          selector = `textarea#${textarea.id}`;
        } else {
          // Fallback: Mark the textarea with a temporary attribute for identification
          // This ensures we target the exact element even if page structure is complex
          const uniqueId = `qa-temp-${Date.now()}-${taskIndex}`;
          textarea.setAttribute('data-qa-temp-id', uniqueId);
          selector = `textarea[data-qa-temp-id="${uniqueId}"]`;
        }

        questions.push({
          type: 'textarea',
          question,
          selector,
          index: taskIndex,
          currentValue: textarea.value.trim(),
        });
      });

      // Extract radio and checkbox questions (reuse taskBodies from above)
      taskBodies.forEach((taskBody) => {
        const question = taskBody.querySelector('[data-qa="task-question"]')?.textContent.trim();
        if (!question) return;

        for (const type of ['radio', 'checkbox']) {
          // Group inputs by name
          const optionsByName = {};
          taskBody.querySelectorAll(`input[type="${type}"]`).forEach((input) => {
            if (!input.name) return;
            const optionText = input.closest('[data-qa="cell"]')
              ?.querySelector('[data-qa="cell-text-content"]')?.textContent.trim() || '';
            (optionsByName[input.name] ??= []).push({ value: input.value, optionText, checked: input.checked });
          });

          Object.entries(optionsByName).forEach(([name, options]) => {
            const checked = options.filter(opt => opt.checked).map(opt => opt.optionText);
            questions.push({
              type,
              question,
              name,
              options,
              ...(type === 'radio' ? { currentAnswer: checked[0] || '' } : { currentAnswers: checked }),
              selector: `input[name="${name}"]`,
            });
          });
        }
      });

      return questions;
    },
  });
}

/**
 * Questions on the form that still have no answer
 * @param {Object} options
 * @param {Function} options.evaluate - Browser commander evaluate function
 * @returns {Promise<string[]>}
 */
export async function listOpenQuestions({ evaluate }) {
  const items = await extractPageQuestions({ evaluate });
  const choices = new Map(items.filter(({ type }) => type !== 'textarea').map((item) => [item.question, item]));
  const open = items.filter((item) => {
    if (item.type !== 'textarea') {
      return !item.options.some(({ checked }) => checked);
    }
    const choice = choices.get(item.question);
    // The text box of a choice question needs text only for its "Свой вариант" option
    return choice
      ? choice.options.some(({ checked, value }) => checked && value === 'open') && !item.currentValue
      : !item.currentValue;
  });
  return [...new Set(open.map(({ question }) => question))];
}

/**
 * Whether every question on the form is a saved question word for word and the form holds
 * exactly its saved answer, so the form can be sent without asking the user
 * @param {Array} items - extractPageQuestions result (after filling)
 * @param {Map<string, string|string[]>} qaMap - Saved answers
 * @returns {boolean}
 */
export function allAnswersExact(items, qaMap) {
  if (items.length === 0) {
    return false;
  }
  const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();
  const choices = new Map(items.filter(({ type }) => type !== 'textarea').map((item) => [item.question, item]));
  return items.every((item) => {
    if (!qaMap.has(item.question)) {
      return false;
    }
    const saved = qaMap.get(item.question);
    const savedList = [saved].flat().map((answer) => String(answer).trim());
    if (item.type === 'textarea') {
      const choice = choices.get(item.question);
      // The text box of a choice question holds the answer only for its "Свой вариант" option
      if (choice && !choice.options.some(({ checked, value }) => checked && value === 'open')) {
        return true;
      }
      return same(item.currentValue, savedList.join('\n'));
    }
    const checked = item.options.filter((option) => option.checked);
    if (checked.some(({ value }) => value === 'open')) {
      // "Свой вариант": the saved answer is the text in its box, checked above
      return checked.length === 1;
    }
    const checkedTexts = checked.map(({ optionText }) => optionText.trim()).sort();
    return checkedTexts.length === savedList.length && [...savedList].sort().every((answer, i) => answer === checkedTexts[i]);
  });
}

/**
 * Extract Q&A pairs from filled forms
 * @param {Object} options - Configuration options
 * @param {Function} options.evaluate - Browser commander evaluate function
 * @returns {Promise<Array>} - Array of {question, answer} pairs
 */
export async function extractQAPairs(options = {}) {
  const { evaluate } = options;

  return await evaluate({
    fn: () => {
      const pairs = [];

      // Extract textarea answers
      const textareas = document.querySelectorAll('textarea');
      textareas.forEach((textarea) => {
        const taskBody = textarea.closest('[data-qa="task-body"]');
        if (!taskBody) return;

        const questionEl = taskBody.querySelector('[data-qa="task-question"]');
        if (!questionEl) return;

        const question = questionEl.textContent.trim();
        const answer = textarea.value.trim();

        if (question && answer) {
          pairs.push({ question, answer });
        }
      });

      // Extract radio and checkbox answers
      const taskBodies = document.querySelectorAll('[data-qa="task-body"]');
      taskBodies.forEach((taskBody) => {
        const questionEl = taskBody.querySelector('[data-qa="task-question"]');
        if (!questionEl) return;

        const question = questionEl.textContent.trim();
        if (!question) return;

        // Extract checked radio
        const checkedRadio = taskBody.querySelector('input[type="radio"]:checked');
        if (checkedRadio) {
          const cell = checkedRadio.closest('[data-qa="cell"]');
          if (!cell) return;

          const textContent = cell.querySelector('[data-qa="cell-text-content"]');
          if (!textContent) return;

          let answer = textContent.textContent.trim();

          // Check for custom text
          if (checkedRadio.value === 'open') {
            const customTextarea = taskBody.querySelector(`textarea[name="${checkedRadio.name}_text"]`);
            if (customTextarea && customTextarea.value.trim()) {
              answer = customTextarea.value.trim();
            }
          }

          if (answer) {
            pairs.push({ question, answer });
          }
        }

        // Extract checked checkboxes
        const checkedCheckboxes = taskBody.querySelectorAll('input[type="checkbox"]:checked');
        if (checkedCheckboxes.length > 0) {
          const answers = [];

          checkedCheckboxes.forEach((checkbox) => {
            const cell = checkbox.closest('[data-qa="cell"]');
            if (!cell) return;

            const textContent = cell.querySelector('[data-qa="cell-text-content"]');
            if (!textContent) return;

            let answer = textContent.textContent.trim();

            if (checkbox.value === 'open') {
              const customTextarea = taskBody.querySelector(`textarea[name="${checkbox.name}_text"]`);
              if (customTextarea && customTextarea.value.trim()) {
                answer = customTextarea.value.trim();
              }
            }

            if (answer) {
              answers.push(answer);
            }
          });

          if (answers.length > 0) {
            const finalAnswer = answers.length === 1 ? answers[0] : answers;
            pairs.push({ question, answer: finalAnswer });
          }
        }
      });

      return pairs;
    },
  });
}

/**
 * Count unanswered test questions
 * @param {Object} options - Configuration options
 * @param {Function} options.evaluate - Browser commander evaluate function
 * @param {string} options.containerSelector - Optional container selector (for modals)
 * @returns {Promise<Object>} - {totalCount, unansweredCount}
 */
export async function countUnansweredQuestions(options = {}) {
  const { evaluate, containerSelector } = options;

  return await evaluate({
    fn: (container) => {
      const root = container ? document.querySelector(container) : document;
      if (!root) return { totalCount: 0, unansweredCount: 0 };

      const taskBodies = root.querySelectorAll('[data-qa="task-body"]');
      let totalCount = 0;
      let unansweredCount = 0;

      taskBodies.forEach((taskBody) => {
        const radios = taskBody.querySelectorAll('input[type="radio"]');
        const checkboxes = taskBody.querySelectorAll('input[type="checkbox"]');

        // Check radio questions
        if (radios.length > 0) {
          totalCount++;
          const hasSelection = Array.from(radios).some(radio => radio.checked);
          if (!hasSelection) {
            unansweredCount++;
          }
        }

        // Check checkbox questions
        if (checkboxes.length > 0 && radios.length === 0) {
          totalCount++;
          const hasSelection = Array.from(checkboxes).some(checkbox => checkbox.checked);
          if (!hasSelection) {
            unansweredCount++;
          }
        }
      });

      return { totalCount, unansweredCount };
    },
    args: [containerSelector],
  });
}

/**
 * Auto-fill textarea question
 * @param {Object} options - Configuration options
 * @param {Object} options.commander - Browser commander instance
 * @param {Object} options.questionData - Question data with selector and answer
 * @returns {Promise<boolean>} - True if filled
 */
export async function fillTextareaQuestion({ commander, questionData }) {
  // checkEmpty makes fillTextArea skip textareas that already have content
  const result = await commander.fillTextArea({
    selector: questionData.selector,
    text: questionData.answer,
    checkEmpty: true,
    scrollIntoView: true,
    simulateTyping: true,
  });

  if (result?.filled) {
    console.log(`[QA] Prefilled textarea for: ${questionData.question}`);
  } else if (result?.skipped) {
    console.log(`[QA] Textarea was not empty, skipped: ${questionData.question}`);
  }

  return Boolean(result?.filled);
}

/**
 * Find the option whose text matches the answer (fuzzy, case-insensitive)
 * @param {Array} options - Options with optionText
 * @param {string} answer - Answer text
 * @returns {Object|undefined}
 */
function findMatchingOption(options, answer) {
  if (!answer) return undefined;
  const ans = answer.toLowerCase();
  return options.find(({ optionText }) => {
    const text = optionText?.toLowerCase();
    return text && (text.includes(ans.substring(0, 20)) || ans.includes(text));
  });
}

/**
 * Select a radio/checkbox option unless it is already checked, then fill its custom text
 * @returns {Promise<boolean>} - True if the option was clicked
 */
async function selectOption({ commander, questionData, option, customText, verbose }) {
  const selector = `input[name="${questionData.name}"][value="${option.value}"]`;
  const alreadyChecked = await commander.evaluate({
    fn: (sel) => document.querySelector(sel)?.checked ?? false,
    args: [selector],
  });

  if (alreadyChecked) {
    if (verbose) {
      console.log(`[QA] Option "${option.optionText}" already selected for: ${questionData.question}`);
    }
    return false;
  }

  await commander.clickButton({ selector, scrollIntoView: true, smoothScroll: true });
  console.log(`[QA] Selected option "${option.optionText}" for: ${questionData.question}`);
  await commander.wait({ ms: 300, reason: 'visual feedback after option selection' });

  // "open" options have an extra textarea for a custom answer
  const customSelector = `textarea[name="${questionData.name}_text"]`;
  if (option.value === 'open' && customText && await commander.count({ selector: customSelector }) > 0) {
    await commander.fillTextArea({
      selector: customSelector,
      text: customText,
      checkEmpty: true,
      scrollIntoView: true,
      simulateTyping: true,
    });
    console.log(`[QA] Filled custom textarea for: ${questionData.question}`);
  }

  return true;
}

const toArray = (answer) => (Array.isArray(answer) ? answer : [answer]);

/**
 * Auto-fill radio question
 * @param {Object} options - Configuration options
 * @param {Object} options.commander - Browser commander instance
 * @param {Object} options.questionData - Question data with options and answer
 * @param {boolean} options.verbose - Enable verbose logging
 * @returns {Promise<boolean>} - True if filled
 */
export async function fillRadioQuestion({ commander, questionData, verbose = false }) {
  const answers = toArray(questionData.answer);
  const answerIndex = answers.findIndex((ans) => findMatchingOption(questionData.options, ans));

  if (answerIndex === -1) {
    console.log(`[QA] The saved answer fits none of the options, leaving it to you: ${questionData.question}`);
    return false;
  }

  const option = findMatchingOption(questionData.options, answers[answerIndex]);
  return selectOption({ commander, questionData, option, customText: answers[0], verbose });
}

/**
 * Auto-fill checkbox question
 * @param {Object} options - Configuration options
 * @param {Object} options.commander - Browser commander instance
 * @param {Object} options.questionData - Question data with options and answer
 * @param {boolean} options.verbose - Enable verbose logging
 * @returns {Promise<boolean>} - True if any filled
 */
export async function fillCheckboxQuestion({ commander, questionData, verbose = false }) {
  let anyFilled = false;

  for (const ans of toArray(questionData.answer)) {
    const option = findMatchingOption(questionData.options, ans);
    if (option && await selectOption({ commander, questionData, option, customText: ans, verbose })) {
      anyFilled = true;
    }
  }

  return anyFilled;
}

/**
 * Setup auto-save listeners for textareas to mark them for saving on blur
 * @param {Object} options - Configuration options
 * @param {Function} options.evaluate - Browser commander evaluate function
 * @param {Map} options.questionToAnswer - Map of questions to answers
 */
export async function setupAutoSaveListeners(options = {}) {
  const { evaluate, questionToAnswer } = options;

  await evaluate({
    fn: (qaData) => {
      const qaObj = Object.fromEntries(qaData);
      const textareas = document.querySelectorAll('textarea');

      textareas.forEach((textarea) => {
        const taskBody = textarea.closest('[data-qa="task-body"]');
        if (!taskBody) return;

        const questionEl = taskBody.querySelector('[data-qa="task-question"]');
        if (!questionEl) return;

        const question = questionEl.textContent.trim();
        if (!question) return;

        const knownAnswer = qaObj[question]?.answer;

        textarea.addEventListener('blur', async () => {
          const answer = textarea.value.trim();
          if (answer && answer !== knownAnswer) {
            textarea.dataset.qaQuestion = question;
            textarea.dataset.qaAnswer = answer;
            console.log('[QA] Marked for saving:', question, '->', answer);
          }
        });
      });
    },
    args: [Array.from(questionToAnswer.entries())],
  });
}

/**
 * Collect marked Q&A pairs from textareas with data attributes
 * @param {Object} options - Configuration options
 * @param {Function} options.evaluate - Browser commander evaluate function
 * @returns {Promise<Array>} - Array of {question, answer} pairs
 */
export async function collectMarkedQAPairs(options = {}) {
  const { evaluate } = options;

  return await evaluate({
    fn: () => {
      const pairs = [];
      const textareas = document.querySelectorAll('textarea[data-qa-question][data-qa-answer]');
      textareas.forEach((textarea) => {
        pairs.push({
          question: textarea.dataset.qaQuestion,
          answer: textarea.dataset.qaAnswer,
        });
      });
      return pairs;
    },
  });
}
