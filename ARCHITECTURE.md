# HH Job Application Automation - Architecture

This document describes the architecture of the HH.ru job application automation system.

## Overview

The system automates job applications on HH.ru (HeadHunter) using browser automation. It consists of two main layers:

1. **[browser-commander](https://github.com/link-foundation/browser-commander)** - External npm package for generic browser automation supporting Playwright and Puppeteer
2. **Application Layer** - HH.ru-specific automation logic

## Directory Structure

```
src/
├── apply.mjs                 # Entry point - CLI parsing, initialization
├── browser-session.mjs       # Start or reuse the automation Chrome (keep-open option)
├── browser-watchdog.mjs      # Detached process closing a kept-open Chrome when idle
├── login.mjs                 # Detect logins in installed browsers, sign in to hh.ru
├── resumes.mjs               # Pick the most recently updated resume, its suggested vacancies
├── tracing.mjs               # browser-commander trace + network log in logs/traces
├── confirmations.mjs         # Per-step confirmations on stdin, waiting for missing answers
├── orchestrator.mjs          # Main coordination logic and state machine
├── page-triggers.mjs         # Declarative page handlers (browser-commander pageTrigger)
├── page-handlers.mjs         # Redirect safety check used by the main loop
├── vacancies.mjs             # Vacancy button finding and processing
├── vacancy-response.mjs      # Response form handling (cover letter, Q&A)
├── qa.mjs                    # Q&A matching logic
├── qa-database.mjs           # Q&A database operations (Links Notation format)
├── deferred-questions.mjs    # Questions answered later and the vacancies waiting for them
├── config.mjs                # Configuration using lino-arguments
├── logging.mjs               # Logging using log-lazy
├── hh-selectors.mjs          # Centralized CSS selectors and URL patterns
├── ignored-vacancies-db.mjs  # Persisted IDs of vacancies with questionnaires
├── migrate-qa.mjs            # Rewrites qa.lino in canonical format
└── helpers/
    ├── modal-helpers.mjs     # Modal detection and closing helpers
    ├── page-helpers.mjs      # Shared hh.ru page checks (first matching selector, sent response, ...)
    ├── session-tracker.mjs   # Apply-button click tracking (binds browser-commander helpers)
    └── mutex.mjs             # Serializes database file writes
```

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              apply.mjs                                   │
│                         (Entry Point & CLI)                              │
│  • Parse CLI arguments (lino-arguments)                                  │
│  • Initialize browser and commander                                      │
│  • Create and start orchestrator                                         │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          orchestrator.mjs                                │
│                     (Main Coordination Logic)                            │
│  • State machine for page navigation                                     │
│  • URL condition waiting with redirect detection                         │
│  • Session storage flag management                                       │
│  • Coordinates page handlers                                             │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
          ▼                     ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐
│ page-handlers   │  │  vacancies.mjs  │  │  vacancy-response.mjs       │
│     .mjs        │  │                 │  │                             │
│                 │  │ • Find vacancy  │  │ • Fill cover letter         │
│ • Navigation    │  │   buttons       │  │ • Handle Q&A questions      │
│   handlers      │  │ • Process       │  │ • Detect required fields    │
│ • Click         │  │   applications  │  │ • Submit form               │
│   listeners     │  │ • Handle modals │  │                             │
│ • URL change    │  │                 │  │ Helper functions:           │
│   callbacks     │  │                 │  │ • findCoverLetterTextarea() │
└─────────────────┘  └─────────────────┘  │ • expandCoverLetterSection()│
                                          │ • waitForTextareaSelector() │
                                          │ • findSubmitButton()        │
                                          │ • getSubmitButtonState()    │
                                          └─────────────────────────────┘
```

## Data Flow

```
1. User starts application with CLI arguments
                    │
                    ▼
2. Browser launched, commander created
                    │
                    ▼
3. Navigate to vacancy search page
                    │
                    ▼
4. Main loop starts (orchestrator)
         ┌─────────┴──────────┐
         │                    │
         ▼                    ▼
5a. Search Page         5b. Vacancy Page
    │                       │
    └──► Find & click       └──► Install click
         vacancy button          listener
         │                       │
         ▼                       ▼
6. Vacancy Response Page
    │
    ▼
7. Fill form (cover letter, Q&A)
    │
    ▼
8. Submit (if auto-submit enabled)
    │
    ▼
9. Return to search page → Loop
```

## Key Design Principles Applied

### Separation of Concerns
- **Entry Point** (`apply.mjs`): Only CLI parsing and initialization
- **Coordination** (`orchestrator.mjs`): State management, no business logic
- **Business Logic**: Distributed across `vacancies.mjs`, `vacancy-response.mjs`
- **Infrastructure**: `browser-commander` (npm package), `logging.mjs`, `config.mjs`

### Single Source of Truth
- **Selectors**: All CSS selectors in `hh-selectors.mjs`
- **URL Patterns**: All URL regexes in `hh-selectors.mjs`
- **Configuration**: Single `config.mjs` module using lino-arguments

### DRY (Don't Repeat Yourself)
- **Modal handling**: `closeModalIfPresent()` helper
- **Logging**: Centralized through `log-lazy` library
- **Session tracking**: `session-tracker.mjs` binds browser-commander's `installClickListener` / `checkAndClearFlag`
- **Generic browser logic lives in browser-commander**: URL waiting (`waitForUrlCondition`),
  toggle search (`findToggleButton`), enabled checks (`isEnabled`), page triggers and launch restrictions

### Small Units
- Large functions split into focused helpers
- `apply.mjs` reduced from 729 to ~100 lines
- `src/` reduced from ~5400 to ~3000 lines by delegating generic code to dependencies

## Configuration

The application uses [lino-arguments](https://github.com/link-foundation/lino-arguments) for configuration:

| Option | Description | Default |
|--------|-------------|---------|
| `--engine` | Browser engine (playwright/puppeteer) | playwright |
| `--url` | Starting URL for job search | suggested vacancies of the most recently updated resume |
| `--manual-login` | Skip automatic login, wait for a manual one | false |
| `--login-from` | Only import the login from this browser/profile | any |
| `--keep-browser-open` | Keep Chrome running after exit, reuse it next run | false |
| `--browser-idle-timeout` | Minutes before a kept-open Chrome closes when unused | 30 |
| `--browser-port` | Remote debugging port of the automation Chrome | 9322 |
| `--test-mode` | Preset: `--max-applications 1`, also confirm answers | false |
| `--confirm` | Steps to confirm on stdin: answers, cover-letter, send, popup, or none | send |
| `--on-missing-answers` | `wait` for the user or `skip` the vacancy (kept in `deferred-questions.lino`) | wait |
| `--skip-question` | Skip vacancies that ask a matching question for now; repeatable | - |
| `--max-applications` | Stop after this many applications (0 = no limit) | 0 |
| `--trace` | Record a browser-commander trace in `logs/traces` | true |
| `--user-data-dir` | Browser profile directory | `~/.hh-automation/chrome-profile` |
| `--message` / `--message-file` | Cover letter (one of them is required) | - |
| `--verbose` | Enable debug logging | false |
| `--job-application-interval` | Seconds between opened vacancies (plus random up to a quarter; see `pacing.mjs`) | 240 |
| `--auto-submit-vacancy-response-form` | Auto-submit forms whose questions are all answered | false |

## Startup Flow

1. `browser-session.mjs` attaches to Chrome on `--browser-port` if it runs, or starts it detached
   with the dedicated profile. Without `--keep-browser-open` it is closed on exit; with it, a
   detached `browser-watchdog.mjs` closes it after `--browser-idle-timeout` unused minutes.
2. `login.mjs` returns at once when the profile is logged in (it stays logged in across restarts). Otherwise it lists browser profiles holding hh.ru or VK/Mail.ru/OK/Google/
   Gosuslugi cookies (names and counts only), starts a temporary snapshot of the best Chromium profile
   (Chrome decrypts its own cookies, so there is no Keychain prompt), signs in through hh.ru's social
   login when needed, and copies the hh.ru cookies into the automation browser.
3. `resumes.mjs` reads the resumes on the profile page and opens the suggested vacancies of the most
   recently updated one. hh.ru shows no update date now, so its list order is used.
4. Vacancies in `data/deferred-questions.lino` whose question has no answer in `qa.lino` yet (or
   matches `--skip-question`) are marked as processed, so they are not opened.
5. The orchestrator opens vacancies an even pause apart (`pacing.mjs`), pauses while a captcha is shown and
   stops when hh.ru does not confirm an application.

## Logging

Uses [log-lazy](https://github.com/link-foundation/log-lazy) for lazy-evaluated logging:

```javascript
import { log } from './logging.mjs';

// Zero-cost when disabled - message function not called
log.debug(() => `Processing vacancy: ${vacancyId}`);
```

## Q&A Database

Q&A pairs stored in Links Notation format (`data/qa.lino`):

```
"Question text here"
  "Answer text here"

"Multi-option question"
  option1
  option2
  option3
```

## Deferred Questions

Questions to answer later, with the vacancies that ask them (`data/deferred-questions.lino`, same
format as `qa.lino`):

```
Какой портфель автоматизаций и AI-продуктов вам удалось реализовать? Как считали эффекты для бизнеса?
  137956393
```

A vacancy is added when the user types `s` at an open-questions prompt, when an open question
matches a deferred one (a contained fragment, or fuzzy score >= 0.7), when a question matches
`--skip-question`, or with `--on-missing-answers skip`. It is removed once an application to it is
sent. See [the case study](docs/case-studies/hard-question-ai-portfolio/case-study.md).

## Testing

- **Unit Tests**: 120+ tests using Bun test runner
- **Test Database**: Separate test fixtures in `tests/fixtures/`
- **CI**: GitHub Actions runs lint + tests on every push

## Related Documentation

- [browser-commander on npm](https://www.npmjs.com/package/browser-commander)
- [browser-commander on GitHub](https://github.com/link-foundation/browser-commander)

## Future Improvements

See GitHub issues for planned enhancements:
- [#89](https://github.com/konard/hh-job-application-automation/issues/89) - Migrate to pageTrigger pattern
- [#90](https://github.com/konard/hh-job-application-automation/issues/90) - Split findAndProcessVacancyButton
- [#91](https://github.com/konard/hh-job-application-automation/issues/91) - Add helper unit tests
