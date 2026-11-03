# CLI reference

Start with the [operating guide](OPERATING_GUIDE.md) for setup, daily commands, review, shutdown
and troubleshooting. Run from the repository root. The application entry point is
`bun run apply -- [options]` or `bun src/apply.mjs [options]`.

## Main application options

This table covers every `.option(...)` in [`src/config.mjs`](../src/config.mjs). Defaults are
the built-in values before personal configuration. Boolean options accept `--no-NAME` to disable
them. `--url` also has `-u`; `--message` has `-m`. `--configuration FILE` / `-c FILE` is provided
by `lino-arguments`, loaded after `.lenv`; `--help` / `-h` prints help without starting applications.

Precedence with the installed library is: explicit CLI arguments, then a supplied configuration
file's values, then `.lenv` values, then ambient environment values, then built-in defaults.
Only the environment keys listed below are read for these options. In particular, `--questions`
and `--user-data-dir` are CLI-only in the current implementation. These main-CLI flags are not
automatically accepted by the independently parsed auxiliary commands.

| Option | Type | Environment / `.lenv` key | Built-in default | Behavior |
|---|---|---|---|---|
| `--engine` | string | `ENGINE` | `playwright` | Browser automation engine to use: playwright or puppeteer |
| `--url` | string | `START_URL` | `unset` | Vacancy search URL (default: suggested vacancies for the Russian CV, or the latest CV if unavailable) |
| `--salary-ladder` | boolean | `SALARY_LADDER` | `true` | Matching search: start at the target salary, lower by 50000 RUB after exhausting each tier, keep unspecified pay; exclude caps below half target |
| `--manual-login` | boolean | `MANUAL_LOGIN` | `false` | Do not import logins from other browsers; wait for a manual login instead |
| `--login-from` | string | `LOGIN_FROM` | `unset` | Only use logins from browser profiles whose name contains this text (e.g. "chrome Default") |
| `--keep-browser-open` | boolean | `KEEP_BROWSER_OPEN` | `false` | Keep the browser running after exit so the next run reuses it |
| `--browser-idle-timeout` | number | `BROWSER_IDLE_TIMEOUT` | `30` | Minutes after which a kept-open, unused browser is closed |
| `--browser-port` | number | `BROWSER_PORT` | `9322` | Remote debugging port of the automation browser |
| `--test-mode` | boolean | `TEST_MODE` | `false` | Preset for a supervised run: --max-applications 1 and also confirm answers |
| `--confirm` | string | `CONFIRM` | `send` | Steps to confirm on stdin, comma-separated: answers, cover-letter, send, popup, or none |
| `--notification-sound` | boolean | `NOTIFY_SOUND` | `true` | Play a sound when attention is needed; disable sound while keeping visual alerts |
| `--on-missing-answers` | string | `ON_MISSING_ANSWERS` | `wait` | Questions without a saved answer: wait for the user to answer them, or skip the vacancy |
| `--auto-send-exact-answers` | boolean | `AUTO_SEND_EXACT_ANSWERS` | `true` | Send a form with questions without asking when every question is a saved question word for word and autofill answered it with the saved answer; other forms are autofilled and wait for you |
| `--auto-select-resume-language` | boolean | `AUTO_SELECT_RESUME_LANGUAGE` | `true` | Select and verify the English CV for dollar pay or English questions; use Russian for Russian applications |
| `--answer-final-period` | string | `ANSWER_FINAL_PERIOD` | `with` | When both answer variants exist, resolve a final-period conflict with or without the period; first saves keep their wording |
| `--auto-answer-viewed-vacancy` | boolean | `AUTO_ANSWER_VIEWED_VACANCY` | `true` | Answer the viewed-but-not-applied vacancy survey with "Maybe I'll apply later" |
| `--network-idle-ms` | number | `NETWORK_IDLE_MS` | `2000` | How long the page has no requests before it counts as ready for the next step (browser-commander waits 30000 by default) |
| `--answer-instant-chats` | boolean | `ANSWER_INSTANT_CHATS` | `true` | Answer the chat hh.ru opens after an application (a recruiter bot's questions) before the next vacancy: perfect matches of saved answers are sent (with --auto-send-exact-answers), others wait for you in the panel |
| `--auto-reuse-answers` | boolean | `AUTO_REUSE_ANSWERS` | `false` | When a recruiter bot offers the answers given to it before («Используем эти ответы?»), choose «Да» when each is your saved answer and «Нет» when one differs; by default they are compared and you choose |
| `--single-tab` | boolean | `SINGLE_TAB` | `true` | Keep the automation browser to one tab: other tabs are closed when the run attaches, new ones as they open |
| `--captcha-prefill` | boolean | `CAPTCHA_PREFILL` | `true` | Prefill the captcha with the guesses of local Claude Code (Haiku) and Codex (latest Luna) for you to check and send |
| `--vacancy-insights` | boolean | `VACANCY_INSIGHTS` | `true` | Collect private vacancy descriptions, compare the résumé and add verified technology aliases; application entry is controlled separately |
| `--apply-from-vacancy-page` | boolean | `APPLY_FROM_VACANCY_PAGE` | `true` | Show and collect the vacancy page, then open its application directly; disable to return to search before opening the form |
| `--vacancy-preview-seconds` | number | `VACANCY_PREVIEW_SECONDS` | `3` | Show the collected vacancy before its application (seconds, 0 disables the pause) |
| `--collect-vacancies` | boolean | `COLLECT_VACANCIES` | `true` | Cache full vacancy descriptions locally in Links Notation (never committed) |
| `--compare-resume` | boolean | `COMPARE_RESUME` | `true` | Print a separate technology coverage comparison with the résumé before each application |
| `--update-resume-aliases` | boolean | `UPDATE_RESUME_ALIASES` | `true` | Add verified alternate spellings of existing résumé technologies to the résumé; never infer new experience |
| `--vacancy-cache-dir` | string | `VACANCY_CACHE_DIR` | `~/.hh-automation/vacancies` | Private local vacancy cache directory |
| `--captcha-auto-send` | boolean | `CAPTCHA_AUTO_SEND` | `true` | With --captcha-prefill: send Haiku's reading of a captcha once; if hh.ru does not accept it, the captcha is only prefilled and waits for you |
| `--skip-question` | string | `SKIP_QUESTIONS` | `unset` | Skip vacancies that ask this question (or a part of it) for now; repeat for several. They are kept in data/deferred-questions.lino |
| `--max-applications` | number | `MAX_APPLICATIONS` | `0` | Stop after sending this many applications (0 = no limit) |
| `--trace` | boolean | `TRACE` | `true` | Record browser diagnostics locally in ~/.hh-automation/traces (three-day retention by default) |
| `--trace-retention-days` | number | `TRACE_RETENTION_DAYS` | `3` | Maximum age of local browser traces in days (positive; default 3) |
| `--user-data-dir` | string | CLI only | `~/.hh-automation/chrome-profile` | Path to user data directory for persistent session storage |
| `--job-application-interval` | number | `JOB_APPLICATION_INTERVAL` | `0` | Seconds between opened vacancies, a fixed pace (a random extra of up to a quarter is added); 0, the default: adaptive pacing within 1-4 min, including jitter, with a bounded CAPTCHA hold |
| `--message` | string | `MESSAGE` | `unset` | Cover letter to send with every application (this or --message-file is required) |
| `--message-file` | string | `MESSAGE_FILE` | `unset` | Path to a UTF-8 text file with the cover letter, e.g. data/cover-letter.txt |
| `--message-file-en` | string | `MESSAGE_FILE_EN` | `unset` | The English cover letter, used when the vacancy's questions are in English (default: <message-file>.en.txt when it exists) |
| `--verbose` | boolean | `VERBOSE` | `false` | Enable verbose logging for debugging |
| `--auto-submit-vacancy-response-form` | boolean | `AUTO_SUBMIT_VACANCY_RESPONSE_FORM` | `false` | Send forms with questions (popup or full form) unattended even when not every answer is the saved answer of the very same question (default: false for safety) |
| `--questions` | boolean | CLI only | `true` | Allow questionnaires (default). --no-questions skips them in RAM for this run, without changing saved skip lists |
| `--ignore-vacancies-with-questionnaire` | boolean | `IGNORE_VACANCIES_WITH_QUESTIONNAIRE` | `false` | Skip vacancies that require additional questionnaire fields beyond the cover letter (kept in data/skipped-vacancies.lino) |
| `--clear-rejections` | boolean | `CLEAR_REJECTIONS` | `true` | Handle unread rejections in the inactive chat browser slot (port 9340); closed chats are read, open chats may get the configured reason request |
| `--ask-rejection-reason` | boolean | `ASK_REJECTION_REASON` | `true` | Ask once for the reason when a rejected application still allows replies, only in an inactive window without a draft |
| `--rejection-reason-reply` | string | `REJECTION_REASON_REPLY` | `Здравствуйте, могу я узнать причину?` | Message sent once to an open rejection chat |
| `--process-chats` | boolean | `PROCESS_CHATS` | `false` | Also answer unread chats alongside the application loop in the chat browser slot (port 9340), always after the rejections are cleared |
| `--chats-interval-minutes` | number | `CHATS_INTERVAL_MINUTES` | `120` | How often the rejections are cleared and, with --process-chats, unread chats answered (minutes) |

`--test-mode` additionally includes `answers` and `send` in confirmation steps and sets the
maximum to one only when it was otherwise zero. Cover-letter-only forms can still auto-submit.
`--confirm send` does not disable the exact-saved-answer exception; add
`--no-auto-send-exact-answers` when you want that review too. `--confirm none` leaves uncertain
questionnaires waiting in the browser unless unattended questionnaire submission is explicitly enabled.

`--skip-question` is repeatable; `SKIP_QUESTIONS` splits fragments on `|`. It differs from the
RAM-only `--no-questions` switch. Trace retention must be positive, vacancy preview seconds
non-negative. A selected English letter defaults to the sibling `<base>.en.txt` file when present.

The checked-in [operator profile](../examples/operator.lenv) deliberately changes some defaults:
silent sound, manual CAPTCHA handling, kept-open browser and browser-only review of uncertain forms.
`NOTIFY=0` suppresses visual alerts (not a yargs option). `TRACE=0` is also honored by standalone
browser slots. The daily account cooldown and adaptive pace bounds are policies, not CLI options.

## Other package commands

These commands are declared in [`package.json`](../package.json). `--help` is available for
`apply`, `answer-chats`, `prefill-form`, `cv`, `experience`, `skipped`, `vacancy-stats`,
`ai-status`, `test-assignment` and `linkedin-login`. Do not use `--help` as a dry run for commands
with no help handler: `backfill-questionnaires`, `contacts-migrate`, `formalize-qa` and `industries`
execute their normal maintenance/dictionary action. `stats --days N` reads statistics.

| Command | Accepted user options / arguments |
|---|---|
| `bun run resume` | `--resume HASH` (default latest CV), `--all`, `--browser-port 9322`, `--out DIR` (default `data/resume`), `--formats pdf,rtf,txt` (also `doc`); env keys `RESUME`, `BROWSER_PORT`, `RESUME_OUT`, `RESUME_FORMATS` |
| `bun run answer-chats -- [CHAT_URL_OR_ID ...]` | `--watch`, `--auto`, `--clear-rejections`, `--no-live-rejections`, `--ask-rejection-reason` / `--no-ask-rejection-reason`, `--rejection-reason-reply TEXT`, `--auto-reuse`, `--auto-send`, `--no-draft`, `--no-forms`, `--no-learn`, `--answer-final-period with\|without`, `--learn-all`, `--relearn`, `--poll SECONDS` (default 300) |
| `bun run prefill-form -- URL [URL ...]` | `--first-slot N` (first free by default), `--no-draft`, `--no-learn`, `--keep-open-hours N` (default 24) |
| `bun run skipped` | Repeat `--clear REASON_OR_VACANCY_ID`; `--ignore-vacancies-with-questionnaire` changes the displayed classification |
| `bun run stats` | `--days N` (default 14) |
| `bun run vacancy-stats` | `--top N` (default 30), `--json`, `--cache-dir DIR`, `--resume FILE` (default `data/resume/resume.json`) |
| `bun run ai-status` | `--probe`; optional settings `OXION_BASE_URL`, `OXION_API_KEY`, `OXION_MODEL` from ignored `.lenv` |
| `bun run industries` | `--locale RU\|EN` (default RU), `--refresh`, `--json`; normal invocation fetches/reads the dictionary and prints counts/location |
| `bun run linkedin-login` | `--from BROWSER`, `--profile NAME`, `--manual`, `--port N` (default 9350) |
| `bun run test-assignment -- REPOSITORY_NAME` | `--from URL\|FILE\|-`, `--vacancy ID_OR_URL`, `--language NAME`, `--owner LOGIN`, repeatable `--company NAME`, `--private` (default public), `--dry-run` |
| `bun run contacts-migrate` | `--dry-run`; otherwise writes contact placeholders into Q&A, templates and the primary cover letter |
| `bun run backfill-questionnaires` | No CLI options; reindexes local compound questions and history counts |
| `bun run formalize-qa` | `--formal-ai DIR`, `--limit N` (default all); uses Node via the package script, can clone Formal AI, writes an experiment report |
| `bun run playwright` / `bun run puppeteer` | Application shortcuts selecting the engine; accept the main options |
| `bun run test` | Bun test suite under `tests/` |
| `bun run lint` / `bun run lint:fix` | ESLint / ESLint with edits |
| `bun run check` | Lint, test suite and application help |

`answer-chats --auto-send` can send exact answers; its default is draft-only. `--auto` implies
watching unread chats and pauses on one needing your review. `--clear-rejections` also implies
watching; its background cleanup can send a reason request unless disabled. `--no-learn` controls
learning from linked external questionnaires; it is not a switch to erase/disable the chat archive.
Main `--chats-interval-minutes` uses minutes; standalone `--poll` uses seconds.

## CV command

```text
bun run cv -- <export|import|edit|batch|watch|technologies> [file] [options]
```

| Subcommand | Behavior |
|---|---|
| `export` | Export every saved CV as sanitized Links Notation |
| `import [FILE]` | Default desired file `<out>/cv.<lang>.lino`; prepare positions/About one at a time |
| `edit FILE.json` | Prepare an `add`, `update`, `copy`, `detach` or `about` change |
| `batch FILE.json` | Review an array of changes, with per-item `resumeHash` when needed |
| `watch` | Observe the existing editor; export after verified saves without navigating/editing it |
| `technologies` | Audit saved CVs and write private plans; `--review` also reviews planned changes |

Common options: `--lang ru|en` (ru), `--out DIR` (examples; technology plans use a private default
when not explicitly overridden), `--resume HASH`, `--hh-port N` (9351), `--hh-browser-port N`
(9322 login/export source), `--keep-open-hours N` (24), `--no-trace`.

`edit`, `batch`, `watch` and `technologies --review` require the existing editor slot to be open;
the [operating guide](OPERATING_GUIDE.md#cv-export-editing-and-technology-maintenance) includes its
setup command. The export source port and editing slot port serve different purposes.

Workflow options: `--one`, `--detach-extra`, `--confirm-save`, `--snapshots-out DIR`, `--publish`,
`--once`, `--state-file FILE`, `--after-checkpoint FILE`, `--review`.
Final saving is by the owner in the browser by default. Import's older `--confirm-save` path
permits a terminal `y` to trigger it; edit/batch/technology review retain owner-only browser Save.
The operator workflow keeps owner-only final CV Save.
`--publish` performs a Git commit of the sanitized snapshots and pushes the current branch;
it must be explicitly selected. See the operating guide's publication and shared-workplace notes.

The automatic singleton alias reviewer is also available through
`ensureCvAliasSync` in `src/cv-alias-sync.mjs`; the operating guide gives its invocation.
Its direct worker entry point accepts `--hh-port` (9352), `--from-port` (9322), `--state-file`
and `--publish`. Do not start a second direct worker on a slot already owned by a reviewer.

## Experience command

```text
bun run experience -- <export|diff|sync|edit> [options]
```

Options: `--to linkedin|hh`, `--company NAME`, `--stack LIST`, `--add LIST`, `--auto`,
`--refresh-hh`, `--skip-linkedin`, `--profile URL`, `--translators LIST`,
`--no-report-formal-ai`, `--dry-run-issues`, `--linkedin-port N` (9350), `--hh-port N` (9351),
`--hh-browser-port N` (9322), `--keep-open-hours N` (24), `--no-trace`.

`diff` can export if no previous export exists. `--auto` refreshes/compares/syncs but still asks
before saving. HH edits use the shared reviewed CV workflow. LinkedIn login has a separate
command. Translation providers are selected by `--translators`; consult the command help for
the implemented provider names. Formal AI failure issue reporting is enabled unless explicitly
disabled. The experiment and the GitHub assignment publisher have external effects; neither
is needed to run applications.
