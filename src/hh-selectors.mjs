/**
 * HH.ru specific selectors - centralized configuration
 *
 * This module provides a single source of truth for all CSS selectors
 * used throughout the application, making maintenance easier and
 * reducing duplication.
 *
 * @module hh-selectors
 */

/**
 * CSS selectors for HH.ru elements
 */
export const SELECTORS = {
  // Modal close buttons
  responsePopupClose: '[data-qa="response-popup-close"]',
  modalClose: '[data-qa="modal-close"]',
  modalOverlay: '[data-qa="modal-overlay"]',

  // Application form
  applicationForm: 'form#RESPONSE_MODAL_FORM_ID[name="vacancy_response"]',

  // Application buttons
  applyButton: 'button[data-qa="vacancy-response-link-top"], button[data-qa="vacancy-serp__vacancy_response"]',
  submitButtonPopup: '[data-qa="vacancy-response-submit-popup"]',
  submitButtonLetter: '[data-qa="vacancy-response-letter-submit"]',
  submitButtonWithoutQuestions: '[data-qa="vacancy-response-link-no-questions"]',

  // Cover letter
  coverLetterToggle: '[data-qa="vacancy-response-letter-toggle"]',
  addCoverLetterButton: '[data-qa="add-cover-letter"]',
  coverLetterTextareaPopup: 'textarea[data-qa="vacancy-response-popup-form-letter-input"]',
  coverLetterTextareaForm: 'textarea[data-qa="vacancy-response-form-letter-input"]',

  // Error states
  limitExceededError: '[data-qa-popup-error-code="negotiations-limit-exceeded"]',

  // Direct application (external site) modal
  // The modal uses "magritte-alert" as container, not "modal-overlay"
  directApplicationCancelButton: '[data-qa="vacancy-response-link-advertising-cancel"]',
  directApplicationAlert: '[data-qa="magritte-alert"]',

  // Question blocks
  questionBlock: '[data-qa="task-body"]',
  radioOption: 'input[type="radio"]',
  checkboxOption: 'input[type="checkbox"]',

  // Navigation
  loginLink: 'a[data-qa="login"]',

  // Pagination
  pagerBlock: '[data-qa="pager-block"]',
  pagerPage: 'a[data-qa="pager-page"]',
};

/**
 * URL patterns for page detection
 */
export const URL_PATTERNS = {
  /**
   * Search vacancy page - matches any search page with or without specific parameters
   * @example https://hh.ru/search/vacancy?from=resumelist&resume=abc123
   * @example https://hh.ru/search/vacancy?from=resumelist&order_by=salary_desc&work_format=REMOTE
   * @example https://hh.ru/search/vacancy
   */
  searchVacancy: /^https:\/\/hh\.ru\/search\/vacancy(\?|$)/,

  /**
   * Vacancy response page
   * @example https://hh.ru/applicant/vacancy_response?vacancyId=123456
   */
  vacancyResponse: /^https:\/\/hh\.ru\/applicant\/vacancy_response\?vacancyId=/,

  /**
   * Vacancy details page
   * @example https://hh.ru/vacancy/123456
   */
  vacancyPage: /^https:\/\/hh\.ru\/vacancy\/(\d+)/,

  /**
   * Login page
   * @example https://hh.ru/account/login
   */
  loginPage: /^https:\/\/hh\.ru\/account\/login/,
};

/**
 * Extract vacancy ID from URL
 * @param {string} url - The URL to extract from
 * @returns {string|null} - The vacancy ID or null if not found
 */
export function extractVacancyId(url) {
  const match = url.match(URL_PATTERNS.vacancyPage);
  return match ? match[1] : null;
}

/**
 * Extract vacancy ID from response URL
 * @param {string} url - The vacancy response URL
 * @returns {string|null} - The vacancy ID or null if not found
 */
export function extractVacancyIdFromResponseUrl(url) {
  const match = url.match(/vacancyId=(\d+)/);
  return match ? match[1] : null;
}
