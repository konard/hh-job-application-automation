# hh-apply
Automation of job application in hh.ru

## Video demonstration

https://github.com/user-attachments/assets/6884b2fe-e322-4358-aab8-7f3c20ccdc46

## Application message example

The cover letter is always your choice: pass `--message-file <file>` (`MESSAGE_FILE`) or
`--message "<text>"` (`MESSAGE`); the run does not start without one. The Russian version below
is in `data/cover-letter.txt`:

```bash
bun run apply -- --message-file data/cover-letter.txt
```

Russian version:
```
Здравствуйте,

Мне понравилась ваша компания, я думаю моя кандидатура будет вам полезна и я смогу привнести ценность в работу компании.

В какой форме предлагается юридическое оформление удалённой работы?

Посмотреть мой код на GitHub можно тут:

github.com/konard
github.com/link-assistant
github.com/linksplatform
github.com/link-foundation

Для оперативной связи предлагаю использовать мой Telegram: @drakonard (+79582000567).

С уважением,
Константин Дьяченко
```

English version:
```
Hello,

I like your company, and I believe my candidacy would be useful to you and that I could bring value to the company’s work.

In what form is the legal arrangement for remote work offered?

You can view my code on GitHub here:

github.com/konard
github.com/link-assistant
github.com/linksplatform
github.com/link-foundation

For quick communication, I suggest using my Telegram: @drakonard (+7 958 200-05-67).

Kind regards,
Konstantin Dyachenko
```

## Configuration

### Using .lenv File (Recommended)

The application supports configuration via `.lenv` files using the [lino-arguments](https://github.com/link-foundation/lino-arguments) library. This allows you to set default values without typing them every time.

**Requirements:** [Bun](https://bun.sh) 1.4.2 or newer (older Bun versions cannot attach Playwright
to the browser) and Chrome for Testing (`npx playwright install chromium`). The automation runs in
that browser, an app of its own: your Google Chrome is never used, so a click on Chrome in the Dock
or a new tab there is yours, the macOS keychain is never asked (`--use-mock-keychain`), and its
«Chrome for Testing is only for automated testing» bar is not shown (`--test-type=gpu`). A profile
Google Chrome used before is moved once, its logins kept (the cookies are read by Google Chrome
without a window and set in Chrome for Testing, in memory only). The browser is started the way a
person would start it (no automation infobars), and a resized window shows the page at its new size
(the recording's screenshots are taken by Chrome without a clip, browser-commander #180); the profile is kept in `~/.hh-automation/chrome-profile`.
A restart keeps the hh.ru login: hh.ru keeps it in a session cookie, and the browser keeps session
cookies like «Continue where you left off» does (`--restore-last-session`, until browser-commander
keeps them for every persistent profile by default: browser-commander #187).

**Run with defaults:** `bun run apply -- --message-file data/cover-letter.txt` needs no other option
(the cover letter is the one choice the run asks of you): it logs in, picks your most recently updated
resume and applies to the vacancies hh.ru suggests for it:

- **Alerts** - on macOS, whenever the run waits for you (a question to answer or confirm, a
  login, a captcha that still needs manual input after background work has finished, a form to fill by hand), it plays a sound and
  shows a short notification («The job application automation needs your attention»; what is
  needed is told in the terminal) with two buttons: «Show browser» brings the window
  that waits for you to the front (un-minimized, on its tab), «Later» shows it again in 15 minutes
  if the run still waits. The notification comes from a small app of the automation, «hh.ru
  automation», built from `src/notifier/notifier.swift` into `~/.hh-automation/notifier` on the
  first run (Xcode Command Line Tools); allow its notifications in System Settings →
  Notifications, and pick the «Alerts» style to keep them on screen. When it cannot be shown (a
  Focus or Do Not Disturb is on, the app is not allowed or not built) an alert window with the
  same buttons opens instead; «Show browser» is its default button, so a Return typed by mistake
  only brings the browser forward. No alert is shown while the browser window that waits for you
  is the app in front (checked again every 5 minutes). The sound is heard with a Focus on too; an
  alert not answered is shown again every 5 minutes, and it is taken away once the wait is over. `NOTIFY=0` turns
  them off. To mute sound while keeping visual alerts, use `--no-notification-sound` or set
  `NOTIFY_SOUND: false` in `.lenv` (`NOTIFY_SOUND=false` in the environment). Sound is enabled
  by default; set it back to `true` or remove the setting to restore it.
- **Login** - if the automation profile is not logged in yet, the browsers on this machine are
  checked for an hh.ru session or a VK, Mail.ru, OK, Google or Gosuslugi session (only cookie names
  are counted). The hh.ru session of any browser you use (Google Chrome, Safari, Firefox, Edge,
  Brave, Yandex, Arc, …) is tried first, most hh.ru cookies first: Chrome-family cookies are read by
  the browser itself from a copy of its profile (no Keychain prompt), Safari's and Firefox's from
  their cookie files (Safari needs Full Disk Access for the terminal). Else a social sign-in through
  a Chromium-based profile is copied into the automation profile. Use `--login-from chrome` to pick
  a browser, or `--manual-login` to log in yourself. Every other browser slot (chats, forms,
  experience, LinkedIn) starts signed in the same way: with its own login, the login of another
  automation window, or else with a browser of yours. Log in once: a login made in any hh.ru window
  of the automation (main, chat, forms) is copied into the others that show signed out, checked
  every minute. Cookie values are never printed or stored outside the profiles.
- **Resume** - the suggested vacancies of the most recently updated resume are opened, unless `--url`
  is given. The update dates come from hh.ru's own state embedded in the resumes page (the page shows
  none), so choosing costs no extra request; the log names the resume and why it was chosen. A
  kept-open browser already on a search page keeps its filters and only switches the resume.
- **Pace** - the pause between opened vacancies adapts: it starts at 2 minutes, each application
  sent takes 10-20 s off it (down to 1 minute), and each hh.ru captcha adds twice that (up to 7
  minutes). After a captcha the pace is held for 15 minutes before it is tried faster again; the
  hold doubles while captchas keep coming, but never passes a day, so a faster pace is tried at
  least once a day. A random extra of up to a quarter is added to each pause. The pace is worked
  out from `logs/stats.jsonl`, so it carries over restarts; `bun run stats` shows it and the
  captchas per 100 applications at each pace. `--job-application-interval <seconds>` sets a fixed
  pace instead.
- **One tab** - the automation browser keeps a single tab: when a run attaches, every other
  tab is closed (the tab the automation used last is kept, else an hh.ru one), and tabs opened
  during the run are closed as they appear. Turn it off with `--no-single-tab`.
- **Browser lifecycle** - Chrome is closed when the script exits. With `--keep-browser-open` it keeps
  running, the next run reuses it and its open page, and it closes itself after
  `--browser-idle-timeout` minutes (default 30) without use.
- **Debug traces** - every run records, in `logs/traces/<time>/`, a browser-commander trace (DOM
  snapshots, DOM mutations, interactions, console messages, page errors, failed requests) with its
  Links Notation export `trace.lino`, plus two Links Notation logs written alongside it:
  `network.lino` (document/XHR/fetch requests and responses with headers and bodies) and `dom.lino`
  (the DOM after every page load and every DOM mutation). Cookies, authorization and CSRF headers,
  password/token form fields and hidden input values are redacted (names kept), long bodies are cut
  with a truncation marker and binary bodies are skipped with their size. `logs/` is gitignored, but
  the traces still hold page content: keep them local. Disable with `--no-trace`.

**Quick setup:**

1. Copy the example configuration:
   ```bash
   cp .lenv.example .lenv
   ```

2. Edit `.lenv` and uncomment/modify the options you want:
   ```
   # Enable verbose logging by default
   VERBOSE: true

   # Seconds between opened vacancies (default 240; a random extra up to a quarter is added)
   JOB_APPLICATION_INTERVAL: 300

   # Keep the browser open between runs (closed after 30 idle minutes)
   KEEP_BROWSER_OPEN: true

   # Load a multi-line application message from a UTF-8 text file
   MESSAGE_FILE: ./message.txt
   ```

3. Run the application (it will automatically load `.lenv`):
   ```bash
   bun run apply
   ```

**Configuration priority:**
1. CLI arguments (highest priority) - e.g., `--verbose`
2. Environment variables - e.g., `export VERBOSE=true`
3. `.lenv` file - local configuration
4. Default values (lowest priority)

**Note:** The `.lenv` file is gitignored to keep your personal settings private.

### Available Configuration Options

See `.lenv.example` for all available options with detailed comments.

## Run

**Note:** It's recommended to use `--verbose` flag for debugging to see detailed logs about which buttons are being clicked and which textareas are being detected.

The application now supports both Playwright and Puppeteer through a single unified command. Use the `--engine` flag to choose between them (default: playwright).

### Auto-Submit Behavior

By default, the script will, on the short popup and on the full form alike:
- **Auto-submit** if the form has ONLY a cover letter (no test questions)
- **Auto-submit** a form with questions only when autofill answered every question with the saved
  answer of the very same question (`--auto-send-exact-answers`, see below)
- **Wait for you** with any other form with questions: it is autofilled from `data/qa.lino` by
  similarity and waits for your `y` on stdin, or, in an unattended run (`--confirm none`), for you to
  send or close it in the browser. Answers you type are saved to `data/qa.lino`; an autofilled answer
  of a similar question is saved under the form's wording only when the form is sent

To send forms with non-exact answers unattended anyway, use the `--auto-submit-vacancy-response-form` flag:

```bash
bun run apply -- --auto-submit-vacancy-response-form --verbose
```

**Safety Note:** The default behavior (manual review) is recommended to ensure test answers are correct before submission.

Questions that the QA database cannot answer are never skipped by default: the form waits for
you (`--on-missing-answers wait`). Use `--on-missing-answers skip` for fully unattended runs.

When a popup or full application form shows hh.ru's generic submission error («Произошла ошибка,
попробуйте ещё раз» / “An error occurred, please try again”), its answers are saved before leaving
and the vacancy waits five hours in an in-memory queue. Other applications continue. The vacancy
is excluded from the search list during the cooldown and is reopened for retry after it expires,
even if it is no longer on the current search page. Retries respect the normal pacing and answer
review rules; another generic failure starts another five-hour wait. The queue stays in RAM only
and is cleared when the application process restarts. These errors are not written to
`skipped-vacancies.lino`. Daily limits, blocks, captchas and field validation keep their own
handling. An unconfirmed application without a recognized generic error still stops an unattended
run or waits for the user in a supervised run.

### Vacancy collection, résumé matching and technology statistics

By default, before applying, the browser visits the full vacancy page, saves its description,
HTML, skills, employer and other visible job details in `data/vacancies/<id>.lino`, and returns
to the application flow. This private directory is ignored by Git: employer descriptions are
not published. Each selected vacancy is collected, including ones the filters later exclude.
Updates use the same vacancy ID, so repeated reads do not inflate demand statistics. Successful
applications are marked in the cache. If the full description cannot be read, that application
is left unsent on this pass.

A separate terminal report shows the technology coverage of the résumé, matched technologies,
names without résumé evidence, and alternative spellings. This is a keyword comparison, not a
prediction of hiring outcomes, and a low score does not block an application. Explicit skills and
requirement sections take priority over general prose; preferred requirements are kept separately.
The complete original text remains available for later analysis.

Known equivalent names are listed in `data/technology-aliases.lino`. For example, Golang can match
Go and Postgres can match PostgreSQL. Related technologies and versions are kept distinct: knowing
Angular does not establish AngularJS experience, and .NET does not establish .NET Core experience.
When a vacancy uses a verified equivalent spelling absent from the résumé, it is added to an
additive technology-names section of the résumé's About text in its own browser slot (9352).
Existing prose is retained; no missing technology is added as experience. The original text and
changes are backed up under private `data/resume/alias-updates/`, and the local résumé export is
updated after the site confirms the save. An already-open edit draft is left for the user.

```bash
bun run vacancy-stats                     # ranked technologies, spellings, gaps and requirements
bun run vacancy-stats -- --top 50 --json  # machine-readable statistics from the private cache
bun run apply -- --message-file data/cover-letter.txt --no-vacancy-insights
bun run apply -- --message-file data/cover-letter.txt --no-update-resume-aliases
```

Individual switches are `--no-collect-vacancies`, `--no-compare-resume`, and
`--no-update-resume-aliases`; `--no-vacancy-insights` disables the whole pre-application check.
The comparisons and statistics run locally and use no AI tokens.

Optional Oxion credentials belong in ignored `.lenv`: `OXION_BASE_URL`, `OXION_API_KEY`, and
`OXION_MODEL`. `bun run ai-status` checks the authenticated catalog;
`bun run ai-status -- --probe` also makes a four-token text request to confirm model access.
An authenticated key does not mean every model is available. Unsupported models are reported
explicitly, and a different model is never substituted silently. Credentials are not logged.

### Test Mode and Confirmations

To check what will be sent, apply to a single vacancy step by step:

```bash
bun run apply -- --test-mode
```

By default the run asks before sending a form with questions (`--confirm send`) and waits
for you when a question has no saved answer. A form is sent without asking only when autofill
alone answered it exactly: every question is a saved question word for word and its field holds
the saved answer (the same text, the same checked options). Any other form is autofilled as far as
possible and waits for you; turn the exception off with `--no-auto-send-exact-answers`. `--test-mode` is a preset: `--max-applications 1`
and also confirm `answers`. Each part can be set
on its own:

| Option | Values | Effect |
|--------|--------|--------|
| `--confirm` | `answers`, `cover-letter`, `send` (default), `popup` (comma-separated), or `none` | Steps that wait for `y` on stdin: typed answers and radio/checkbox choices on the full form, its cover letter, the click that sends a form with questions (full form or popup; forms with only a cover letter are sent right away), everything in the short popup form |
| `--on-missing-answers` | `wait` (default), `skip` | Questions without a saved answer: wait for you to answer them in the browser, or skip the vacancy (kept in `data/deferred-questions.lino`) |
| `--auto-send-exact-answers` | `true` (default), `false` | Send forms whose every question autofill answered with the saved answer of the very same question, without asking |
| `--auto-reuse-answers` | `false` (default), `true` | When a recruiter bot in a chat offers the answers you gave it before («Похоже, вы отвечали на часть вопросов… Используем эти ответы?»), each is compared with your saved answer and the comparison is printed (✓ the same, ✗ differs, ? not saved); by default you choose, with this «Да» is clicked when all are the same and «Нет» when one differs (the bot then asks again and the saved answers are given) |
| `--skip-question` | text, repeatable | Skip vacancies that ask a matching question for now (see below) |
| `--max-applications` | number, `0` = no limit | Stop after sending this many applications |

Other buttons are clicked right away. Before a confirmed step the field is scrolled into view
(nothing is drawn on the page, so screenshots and recordings stay clean), and the terminal shows
the field and the exact value. Type `y` to go on or `q` to stop. When confirmations are on and a
question has no saved answer, the run lists it and waits until you have answered it in the
browser; your answers are saved to `data/qa.lino`.

A continuous supervised run, which only asks before sending forms with questions and when an
answer is missing:

```bash
bun run apply -- --message-file data/cover-letter.txt --keep-browser-open
```

Alongside the application loop, unread rejections («Отказ») in hh.ru chats are opened every 2
hours in the separate chat browser slot (port 9340), so they leave the unread chats; nothing is
typed in them. Between those checks, the unread list is checked every 10 seconds while the chat
window is inactive. The pass covers the whole unread list, including rejections below the visible
rows, and returns to the selected chat with its draft, selection, unread filter and scroll position
restored. A draft does not block this background cleanup. The pass pauses when you return to the
browser; choosing another chat keeps your new selection. A conversation ending with a clear
review-and-follow-up acknowledgement is finished: without a draft, it is not reopened after cleanup.
On macOS the actual foreground browser
process determines whether the window is active. Turn cleanup off with `--no-clear-rejections`,
or use `--no-live-rejections` with `answer-chats` to keep only the scheduled passes.
Rejections are recognized by either the status badge or explicit rejection wording in the full
message preview, even when it has the normal text color. Messages asking a question or requesting
a reply remain unread. Cleanup leaves the window alone while it is active, even after an idle pause.

The same pass handles unread template messages: a chat whose last message, as the chat list shows it,
is a saved template of `data/chat-templates.lino` word for word (greeting and signature aside, «Спасибо
за отклик! Мы рассмотрим Ваше резюме и позже сообщим о своем решении.») is opened and answered with
its reply (one of those you gave to it, with `--auto-send-exact-answers`, on by default), or only read
when it needs none. A chat with anything else waiting is left for you, and other chats stay unread.

To also answer unread hh.ru chats automatically, add `--process-chats` (the rejections are always
cleared first). The chat processor runs in the separate chat browser slot (port 9340, never
the application browser) and checks for unread messages every 2 hours (change with
`--chats-interval-minutes`). Chats with a known reply or no reply needed are handled quietly;
when a chat cannot be handled it is left open in the chat slot with any available draft, and
`apply` prints `💬 Chat needs your reply: <title> <url>` — applications keep running meanwhile:

```bash
bun run apply -- --message-file data/cover-letter.txt --process-chats
bun run apply -- --message-file data/cover-letter.txt --process-chats --chats-interval-minutes 60
```

You can also send a form yourself in the browser: the run notices the sent application (it
counts towards `--max-applications`), withdraws its pending question, keeps the interval
pause and returns to the vacancy list.

### Answer Hard Questions Later

Some questions take time to answer well (see
[the case study](docs/case-studies/hard-question-ai-portfolio/case-study.md)). The run does not
have to wait for them:

- At the open-questions prompt type `s`: the vacancy is skipped for now, and its ID is kept under
  each open question in `data/deferred-questions.lino`.
- A later form whose open question matches a deferred one is skipped right away and added there.
- A question added to the file while its form waits at the prompt skips that form too: only that
  question is kept for it, not the form's other open questions.
- `--skip-question "<text>"` skips forms that ask a matching question (a part of it is enough),
  answered or not. Repeat it for several questions, or pass several values after it:

  ```bash
  bun run apply -- --message-file data/cover-letter.txt --skip-question "портфель автоматизаций"
  bun run apply -- --message-file data/cover-letter.txt \
    --skip-question "портфель автоматизаций" --skip-question "руководить командой"
  ```

  In `.lenv` or the environment: `SKIP_QUESTIONS: портфель автоматизаций|руководить командой`.

The file has the format of `qa.lino`, with vacancy IDs under each question:

```
Какой портфель автоматизаций и AI-продуктов вам удалось реализовать? Как считали эффекты для бизнеса?
  137956393
```

Its vacancies are not opened again while the question has no answer in `data/qa.lino`. Once you
add the answer, they are opened like any other vacancy and the answer is filled in; a vacancy you
have applied to is removed from the file.

### Filter Out Vacancies Automatically

Vacancies that are not programming jobs (electrical installation, circuit design), and manual or
field work that needs physical presence, are skipped without asking, by the rules in
`data/vacancy-filters.lino`. A part of the text is enough; case and ё/е do not matter:

```
vacancy
  схемотехник
question
  дифавтомат
on-site
  выезды на объект
  работа на складе
programming
  разработчик
remote
  можно удаленно
```

- `vacancy`: the vacancy card in the search list (title, company, labels), checked before the
  vacancy is opened, so it costs no request; and the vacancy name on its response form
- `question`: a question of the response form (full form or popup)
- `page`: any text of the response form
- `on-site`: physical presence (installation, field trips, warehouse, production line, shifts),
  looked for in the card, the vacancy description, the questions and the form. It filters only a
  vacancy that is clearly not programming: when its card, name or description has a `programming`
  or `remote` fragment, on-site rules do not apply. So a Moscow office Go developer is never filtered,
  even when its description mentions the warehouses it automates
- `programming`, `remote`: those guards

With vacancy insights disabled, the vacancy description is read only when it is needed: the card has no programming or remote sign
and no rule matched it already (a «Сервисный инженер» card, not a «Go-разработчик» one). Then the run
requests the vacancy page once, from the vacancy list (a same-origin request for the HTML only, no
navigation and no images or scripts), reads its title, work format and description, and keeps the
usual pause between vacancies after it. The search card and the response forms do not show the
description, so this is the cheapest way to it.

Every filtered vacancy is logged with the rule (`🚫 Vacancy … filtered out by vacancy-filters.lino
(question "кв.мм": …)`) and kept in `data/filtered-vacancies.lino` with its title and the time, so
it is not opened again. Add a line to the rules when you see a vacancy that should have been skipped.

### hh.ru in Any Language

hh.ru can show its interface in Russian or English (the account's setting). The tool reads it by
its markup, the same in every language: the «Откликнуться» (Apply) buttons, the «Только
непрочитанные» (Unread only) filter, a rejection in the chat list (its status in red), the vacancy
of a chat, the chat link of a sent application, the hidden resume notice and the direct
application popup. Where only the text tells (a message titled «Отказ» / "Rejection", the
application «Отклик на вакансию» / "Vacancy application", a chat the employer turned off, the
captcha, «Вам недоступна эта вакансия»), the words are in `src/hh-words.mjs`, in both languages.
Drafted answers are written in the language of the question, and a question or a message in English
is never answered in Russian: a saved answer in Russian is not reused for it (a similar question, a
`pattern:`, a chat template), a salary question gets an English answer («From $7 500 gross per month
($6 000 net).»), and an acknowledgement gets an English thanks («Hello, thank you.», or the one you
saved). A question in Russian may take an answer in English («Docker, Kubernetes»).

### Applications Sent at Once, and the Cover Letter

hh.ru sometimes sends the application at the click on «Откликнуться», with no popup: the card says
«Вы откликнулись» / «Ваш отклик отправлен работодателю». This is taken as a sent application at
once (no waiting for a popup), and the cover letter is attached right away:

1. by the card's «Приложить письмо» on the list (no page is opened);
2. else by «Приложить сопроводительное письмо» on the vacancy page, then back to the list;
3. else the vacancy is kept in `data/skipped-vacancies.lino` as `letter_not_attached` with its link,
   tried again at the start of the next runs (a few a run) until it is attached or hh.ru no longer
   offers it.

The letter counts as delivered once its popup has closed and hh.ru no longer offers to attach it.
The same check runs after every application from the list and after a full form: a letter that did
not go with the application is attached the same way.

### Skipped Vacancies

No vacancy is skipped silently. Every other skip is logged and kept in
`data/skipped-vacancies.lino` with the reason, the vacancy title, the employer's link when there is
one, the time and the number of attempts:

```
138295841
  "reason: external_site"
  "title: Go-разработчик | Ромашка"
  "url: https://career.example.com/jobs/1"
  "time: 2026-10-10T12:00:00.000Z"
  "attempts: 1"
```

Whether a skipped vacancy is opened again on the next run depends on the reason:

| Reason | Opened again |
|--------|--------------|
| `external_site` (applied on the employer's site), `resume_not_visible`, `skipped_by_user` (`s`, or a popup you closed) | No, until you clear it |
| `questionnaire_ignored` | No, while `--ignore-vacancies-with-questionnaire` is on |
| `questions_deferred` | Once its questions are answered (`data/deferred-questions.lino`) |
| `modal_timeout`, `apply_button_disabled`, `apply_click_failed`, `button_not_found`, `button_disabled`, `click_failed`, `timeout`, `unanswered_questions` | Once more on a later run; skipped a second time, no |

A vacancy you apply to is removed from the file. List the skipped vacancies, with the
`bun run prefill-form -- <url>` command for each one applied on the employer's site, or clear a
reason or a vacancy so it is opened again:

```bash
bun run skipped
bun run skipped -- --clear resume_not_visible
bun run skipped -- --clear 138295841
```

The file holds only public vacancy data (IDs, titles from the vacancy card, the employer's link) and
can be committed like `data/deferred-questions.lino`.

A vacancy with hh.ru's notice «поменяйте видимость резюме на «Видно всем работодателям…»» is skipped
without asking (`resume_not_visible`). Only a rendered notice counts: every response popup carries it
in a collapsed `hidden-resume-warning` block that opens only for a hidden resume.

### Prefill External Forms

Questionnaires that employers send outside hh.ru (Google Forms, Yandex Forms, a company's own job
form) are prefilled for review, each in its own browser slot:

```bash
bun run prefill-form -- https://forms.gle/... https://practicum.yandex.ru/job/vacancy-364
```

- Slot `n` is a separate Chrome (profile `~/.hh-automation/form-slot-<n>`, port 9330+n), apart from
  the hh.ru automation browser; it stays open for review. `--first-slot <n>` picks the first slot.
- Contacts come from the exported resume (`bun run resume`); `data/profile.lino` (not committed)
  overrides or adds values. Other answers come from `data/qa.lino` by the same matching as hh.ru
  forms; the rest are drafted by local Claude Code from the resume and saved answers, with
  «[уточнить: …]» where only you know the fact (`--no-draft` turns drafts off).
- A site captcha is left to you; the slot fills the form after it. Nothing is ever submitted.
- What you finally send is learned: a small detached watcher per slot (`src/form-watch.mjs`)
  attaches to the slot browser, reads the answers on every page (a multi-page Google Form's «Далее»
  pages too) and, once the form is really sent (its confirmation such as «Ваш ответ записан» or
  «Спасибо», or the form gone after a click on its send button), saves them to `data/qa.lino` and
  adds the saved questions to the report. Contacts are stored as `{{placeholders}}`; empty answers,
  answers with «[уточнить: …]» left in, contacts the prefill took from the profile and you did not
  change, test assignment links, and answers `qa.lino` already gives are not saved. The watcher
  exits after the send, when the slot browser closes, or when the slot is prefilled again; its log
  is `logs/forms/watch-slot-<n>.log`. `--no-learn` turns it off (also in `answer-chats`).
- Contacts that are public anyway (Telegram, phone, LinkedIn, GitHub) are kept in
  `data/contacts.lino`. Saved answers and the cover letter can use them as placeholders
  (`{{telegram}}`, `{{phone}}`, `{{linkedin}}`, `{{github}}`), so a changed contact is changed in
  one place; contact values in answers you save are stored as placeholders.
- Answers that depend on the vacancy are set in `data/answer-contexts.lino`: each context (in a
  group) lists the words that show it and the placeholders it gives other values. A salary saved
  as `{{salary_net}}` is typed in dollars when the question, the vacancy card, its description or
  the form's other questions speak of dollars («$», «USD», «в валюте»), and in rubles otherwise,
  whichever currency it was saved in. The question's own words decide first, then the vacancy's
  (the card with its pay first, then the description and the form's other questions), then the
  group's `(default)` context. This works everywhere answers are typed: hh.ru forms and popups,
  the chat panel after an application, chats (`answer-chats`: the employer's messages, else the
  vacancy page, read only when the reply depends on it) and forms prefilled in slots. Sums you type
  («$6000», «6000 USDT», «450 000 ₽») are saved as placeholders, so they follow the vacancy too.
  Euros work the same way («€», «EUR», «евро»): the minimum is `salary_net_eur` in
  `data/contacts.lino`, and «до вычета НДФЛ» becomes «до вычета налогов» in dollars and euros.
  A gross in dollars or euros is what a contract pays your own company so that you get the net:
  the company's taxes are set in `data/company-taxes.lino` (personal, not committed): the profit
  tax by the company's revenue a year (`15% up to 3000000000 VND`, the band's sum in any currency
  the Central Bank has), then `payout` (the tax on the profit paid to you); it is rounded up to
  100. Without that file the ruble tax's brackets are used at the Central Bank's rate.
  A blockchain vacancy («blockchain», «блокчейн», «криптовалют», «web3», «USDT»…) is paid in
  USDT: the dollar sums are typed as «6 000 USDT», unless the question names its own currency.
- A salary question not saved word for word is answered by pattern (`src/salary-questions.mjs`),
  learned from `qa.lino`: it is a salary question by its words (built in, and those found in saved
  salary questions only), it asks for the gross by «gross», «брутто», «до вычета», and the answer
  is one of your own saved wordings of that kind (net; gross with net), the one picked by the
  question, so different questions get a bit different wordings with the same sums. Questions about
  a past job's pay, a given range («устраивает?»), a year or an hour are left to the saved answers.
  When the currency is told (by the question, the vacancy's pay or its description), such an
  answer counts as saved, so a form whose other answers are saved too is sent without asking. The
  answer is saved under the new question once the form is sent.
- The report (every question, its source and answer) is printed and saved to `logs/forms/`.
- `bun run formalize-qa` checks how [Formal AI](https://github.com/link-assistant/formal-ai)
  (its JavaScript version, nothing to compile; cloned into `~/.hh-automation/formal-ai`)
  formalizes every saved question and answer: the kinds of mistakes are counted with examples,
  every result goes to `logs/formalize-qa.json`. Answers are not matched through it until it can
  formalize them ([#1222](https://github.com/link-assistant/formal-ai/issues/1222),
  [#1223](https://github.com/link-assistant/formal-ai/issues/1223)).

See [the requirements](docs/requirements/forms-and-chats.md) for what is done and what is planned,
and [the full list of requirements](docs/requirements/README.md) for everything else.

### Test Assignments

```bash
bun run test-assignment -- ai-business-management-system --dry-run   # show the issue only
bun run test-assignment -- ai-business-management-system             # create the repository and issue
```

When a form contains a test assignment, it gets its own GitHub repository before the questions are
answered. The tool takes the assignment from the form open in a form slot (or `--from <file>`, `-` for
stdin), has local Claude Code restate it in English in its own words, and checks the result before
publishing: no employer name (the form title and «quoted» names, in any case ending), English only,
no six words in a row from the original.

The vacancy sets the stack: `--vacancy <id>` (or, for a form sent in an hh.ru chat, the chat's vacancy,
remembered by `answer-chats`) is read once in the chat slot. The language it names (or, when it names
none, the most fitting one, chosen by local Claude Code from the vacancy and the assignment;
`--language` overrides) picks the CI/CD template recommended by
[hive-mind](https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md)
(`link-foundation/<language>-ai-driven-development-pipeline-template`), and the issue ends with a
«Stack» section that asks for the most fitting stack and keeping the template's checks green.

Then `gh` creates the repository from the template (public unless `--private`; the owner is the gh
user unless `--owner`; an existing repository without a pipeline gets the template merged in) and
the issue (a rerun updates the issue it created). The next prefill of that form puts the repository
link into the question asking for the completed assignment.

### Answer Chats

```bash
bun run answer-chats -- https://hh.ru/chat/5698827730   # one chat
bun run answer-chats -- --watch                        # every chat waiting for an answer, one at a time
```

Chats open in their own browser slot (port 9340), logged in with the hh.ru session of the automation
browser. For the message waiting for an answer the reply is typed into the message field, never sent:

- a template message (the same text from many companies, greeting and signature aside) gets its saved
  reply from `data/chat-templates.lino`, or one of the replies you have given to it before, picked at
  random (those you used more often more likely; a reply to someone by name or a long one of its own
  is not repeated elsewhere); a template you only thank for gets one of all the thanks you have given
  to templates or saved for them («Здравствуйте, благодарю.», «Здравствуйте, благодарю, ожидаю.», …);
  a rejection gets the saved question about its reason (`Отказ`),
  a closed chat is only read;
- a question gets the saved answer of a close question in `data/qa.lino`, otherwise local Claude Code
  drafts the reply from the chat, the resume and saved answers;
- questionnaire links (and hh.ru's employer rating poll) are prefilled in form slots;
- what you have answered in chats is learned into `qa.lino` and `chat-templates.lino`, and what you
  send in those questionnaires into `qa.lino` (`--no-learn` turns the questionnaire part off);
  Template messages you answered the same way are generalized into patterns, e.g.
  `pattern: ваше резюме … опыт* … позиции … свяже* с вами` (shared words in order, `…` for any
  words, `*` for any ending), which match other companies' wordings of the same message. A pattern
  match counts as an exact one (sent with `--auto-send`) when the message says nothing more than the
  pattern (up to 40 words, or 3 times the pattern's, a company's and a vacancy's names in the gaps)
  and asks nothing: no invitation, test, form, link or call.
  An acknowledgement of the application in any company's words («Спасибо за интерес к нашей
  вакансии! Мы рассмотрим ваше резюме… мы свяжемся с вами», «ознакомимся с резюме и дадим обратную
  связь», «продолжаем рассматривать кандидатов и анализировать результаты собеседований… свяжемся с
  вами») is thanked for exactly, as the saved ones, unless it asks something, invites or rejects.
  A status such as «Ваше резюме находится на этапе рассмотрения» / “Your application is under review”
  is handled the same way, including from the chat list, without requiring a promise to contact you.
  An optional sentence offering other vacancies on an hh.ru employer page is allowed; surveys,
  tests and other links still need review. The full list preview is checked before opening a chat,
  and its actual message checked again before replying. Thanks replies count as the same reply
  when templates are generalized.
  A template inside a longer message is an exact one when what the company adds asks nothing (no
  more question marks, no «расскажите», «уточните», invitation, form or link). The closing and
  the signature («С уважением, Егор / HR команды Нонтон») are left out, and «позиции», «вакансии»
  and «должности» are the same word in templates. Templates are answered as they show in the chat
  window, as rejections are read.

`--watch` waits until you send the reply (or type `s` to skip) before the next chat. With `--auto-send`,
buttons are selected for exact saved answers and unambiguous salary ranges, including in the live
chat window and the application panel. A contradictory net/gross question is answered automatically
only when both configured amounts fit the same range. Ambiguous ranges and unknown answers wait
for review. Explicit choice-only questions never get a free-text draft, and a bot repeating the
question after an answer does not get the same text suggested again. Buttons arriving after their
question are detected too; clearing an unsent draft retries the choice. Saved answers and frequency counts are retained; plain salary
suggestions are filtered to the requested net or gross basis.
Salary follow-ups such as «цифры в долларах и до вычета налогов» inherit the recent salary
topic even without repeating «зарплата». The reply's language, currency and net/gross basis are
chosen independently: Russian messages can request USD gross, and a new explicit currency
overrides an earlier one. Unrelated questions stop that inheritance. A missing amount in the
requested currency is left for review, never replaced by an amount in rubles. Inferred follow-ups
are prefilled for review under the same rules as other salary patterns.
Answer alternatives differing only by a single final period are combined into the version with
the period by default. Use `--answer-final-period without` or `ANSWER_FINAL_PERIOD: without` in
`.lenv` to prefer the version without it. This preference applies on save, load and frequency
sorting only when **both versions exist**. The first save keeps the answer exactly as entered;
an individual answer never gains or loses a period just because of the setting. Usage counts
are combined; original chat transcripts, other punctuation and different answers remain intact.

The “You've viewed the vacancy but haven't applied. Why?” survey automatically gets “Maybe
I'll apply later”, even if it appears while the application loop is waiting. Use
`--no-auto-answer-viewed-vacancy` or `AUTO_ANSWER_VIEWED_VACANCY: false` in `.lenv` to disable
this. A different reason already selected by the user is left alone.

While the chat window is open (`--watch`, and the rejection checks of `apply`), each sent message
is captured as the page changes, including delivery-status and bubble-style updates, without
requests to hh.ru. Switching chats immediately after sending does not lose the reply. The
application browser's chat frames are recorded too. Navigation waits for the conversation pane
to match its URL, so the previous chat's messages are not recorded under the next chat's ID. A new
question in the chat window is prefilled from saved answers, leaving text you already typed alone.
Full-history learning scrolls toward older messages using the negative scroll position of hh.ru's
reversed message column; it keeps reading older pages until the original application is reached.
Recruiter questions containing private access links stay in the local transcript and are excluded
from the shared Q&A file.
Prefills run one at a time, including at startup, to prevent duplicate text.
Questions seen while automatic chat processing owns the window are queued and retried when it
finishes, even if the conversation does not change again. A newer chat replaces the pending one;
existing drafts stay untouched. Restarting a signed-in chat slot keeps its current page open.
A bot's question is saved without its acknowledgement of your last answer («Понял, спасибо. А
есть ли у вас опыт с NestJS?» is saved as «Есть ли у вас опыт с NestJS?»), so it is answered word for
word next time, whatever the bot says first; hh.ru's AI assistant's summary («В разговоре с
кандидатом я узнал: …») is learned too and needs no reply. Salary inference uses the question after
the acknowledgement, so thanking you for your salary information before asking for GitHub does
not produce another salary answer. Inferred answers stay subject to review and never become
exact template matches. A short confirmation to «Можем продолжить общение?» is learned for that
reminder; a substantive answer after it still belongs to the earlier technical question. A bare
«Да» does not prefill a request for examples or an explanation. A check waits while you are typing or
moving around in that window. `bun run answer-chats -- --learn-all` reads the chats you answered
before, slowly, in a window of its own (port 9341). It opens unread chats too (marking them read),
scrolls through older message pages, and records each page before it scrolls out of view. A chat
is marked complete only when its original application is reached; an incomplete load is logged
and remains eligible for another pass. Repeated last-message previews do not skip conversations.

Every chat read (in the chat window, the chat panel after an application, or `--learn-all`) is kept
as it is in `logs/chat-history.json` (personal, not committed), with writes locked across processes.
Changed messages are updated and earlier versions of your sent text kept. Replies sent in several
bubbles are learned together. Existing answers in `qa.lino` are kept as you wrote them; every
distinct answer from the archive is also available to prefill, separated by ` | ` when there are
several, sorted by how often you sent each wording (most frequent first; ties keep their existing
order). Each chat stores `answerCounts` alongside its transcript. A sent reply counts once by its
message IDs, even when read repeatedly; a bot repeating it in a summary adds no use. An answer
known only from a summary or the saved Q&A file has count 0 until a sent occurrence is found.
Such alternatives wait for review. Checkbox selections keep their existing meaning.
`bun run answer-chats -- --relearn` learns the answers again from the archive without opening hh.ru.

Messages and form fields with several questions retain the complete question and reply. When
numbered replies align with numbered, bulleted or separate questions, each individual pair is
also saved to `qa.lino` and counted separately in chat history. Conditional follow-ups stay with
their parent question; code fences and instructions are not treated as extra questions. Ambiguous
replies remain intact rather than being guessed into separate answers.

Chats, hh.ru applications and external forms can reuse individual answers from a questionnaire,
or assemble a complete draft from saved individual answers. Each component uses its own salary
and contact context. A newly assembled block requires review; it is not an exact saved reply for
automatic submission. Missing components leave the block open. Answer variants retain their
frequency order. Existing saved questionnaires are indexed when the app or form tools start;
to backfill both saved Q&A and archived chat counts without opening a browser, run:

```bash
bun run backfill-questionnaires
```

### Sync Work Experience with LinkedIn

```bash
bun run experience -- export              # hh.ru and LinkedIn work experience → data/resume/experience.json
bun run experience -- diff                # differences per job, report in logs/experience/
bun run experience -- sync --to linkedin  # prefill LinkedIn from hh.ru (or --to hh)
bun run experience -- sync --to hh --auto # export again, diff and sync in one go
bun run experience -- edit --company Evirma --stack "PHP 8, Symfony 7, Go, ClickHouse"
bun run experience -- edit --company Capico --add "OpenAI Codex CLI"  # appended to its list
```

- **Edit one job's technologies**: `edit` opens that job's hh.ru edit form (company in Cyrillic or
  Latin, «ООО "ЕВИРМА"» is found by `Evirma`) in the hh.ru slot (port 9351) and sets its
  «Используемые технологии:» list under the description, the rest of the text kept as hh.ru has it
  (`--add` appends to the list the job has, skipping what it lists already).
  It is saved only when you type `y`, or when you click «Сохранить» in the slot window yourself. The
  technologies missing from the resume's «Навыки» (one list for the whole resume) are listed.

- **Export**: hh.ru jobs come from `bun run resume` (`data/resume/resume.json`, exported first when
  missing, `--refresh-hh` exports again). LinkedIn's experience page
  (https://www.linkedin.com/in/konard/details/experience/, `--profile`) is read in its own browser
  slot (profile `~/.hh-automation/linkedin-slot`, port 9350). When the slot has no LinkedIn session
  (no `li_at` cookie, or a login wall), the run says so and waits: log in in that window yourself;
  passwords are never read or typed. Both sides are saved in one shape (company, title, location,
  dates, description, skills) to `data/resume/experience.json` (gitignored).
- **Diff**: jobs are matched by company (Cyrillic or Latin spelling, legal forms ignored) and time;
  titles and descriptions are compared through translations; skills, dates and locations are
  compared directly. Jobs only on one side are listed.
- **Translation**: every text is translated by three translators, shown side by side in the report:
  Claude Haiku (`claude -p --model claude-haiku-5-5`), Codex with the latest Luna model (as the
  captcha prefill picks it), and [Formal AI](https://github.com/link-assistant/formal-ai)
  (`cargo install formal-ai`, run with `FORMAL_AI_LIVE_API=1`). The chosen translation is Haiku's,
  else Luna's, else Formal AI's; an answer that is no translation is passed over. Results are cached
  in `data/resume/translations.json`. `--translators haiku,luna,formal-ai` picks them.
- **Formal AI failures** (an error, an empty or placeholder answer, «I could not translate», a web
  search instead of a translation, text not in the target language) are reported to
  `link-assistant/formal-ai`: an open issue on the same failure gets one comment per Formal AI
  version, otherwise a new issue is filed with the version, the input, the command, the output and
  what the other translators gave. `--dry-run-issues` only prints them, `--no-report-formal-ai`
  turns it off.
- **Sync**: the changes that bring the target in line with the source (titles, dates, descriptions,
  missing skills, jobs only on the source) are translated and prefilled one by one in the target's
  form in a browser slot (LinkedIn: port 9350; hh.ru: `hh-experience-slot`, port 9351, logged in by
  copying the automation browser's hh.ru cookies). Each is saved only after you type `y`; `s`
  discards it, `q` stops and leaves the current form prefilled for you. Nothing is ever deleted;
  hh.ru keeps skills per resume, so missing skills are only listed.

See [the requirements](docs/requirements/experience-sync.md).

### Export the Resume and Collect the Stack

```bash
bun run resume                          # the most recently updated resume
bun run resume -- --resume <hash>       # a specific one, from https://hh.ru/resume/<hash>
bun run resume -- --formats pdf,doc,rtf,txt --out ~/cv
```

The export runs in its own headless Chrome. It copies the hh.ru login, in memory only, from
the automation browser on `--browser-port` (9322), so an application run in progress, with its
half-filled answers, is left untouched. It writes to `data/resume/`, which is gitignored
because it holds personal data:

| File | Content |
|---|---|
| `resume.pdf`, `resume.rtf` (`resume.doc`) | hh.ru's own exports; hh.ru's "doc" is the same RTF file, so it is only downloaded on request |
| `resume.html` | hh.ru's HTML ("txt") export |
| `resume.md`, `resume.txt` | Markdown and plain text converted from it |
| `resume.json` | Name, position, update date, key skills, jobs and the collected stack |
| `stack.md` | Every technology once, key skills, "Технические навыки" categories, and per job the listed technologies ("Используемые технологии", "Использовавшиеся навыки", …) plus those only mentioned in the description |

`bun run resume -- --all` exports every resume of the account, each to `<out>/<hash>/`.

### The Resume as .lino Files (Export and Import)

```bash
bun run cv -- export                       # every resume to examples/cv.<language>.lino
bun run cv -- import --lang en             # bring hh.ru in line with examples/cv.en.lino
bun run cv -- import ~/my-cv.ru.lino --resume <hash>
```

Each resume becomes one indented file: title, «Навыки», «Обо мне» and the jobs, a text line
per line (`' '` is an empty line), dates as `2026-05` or `present`. The Russian and English
files have the same layout, so they compare line by line:
[examples/cv.ru.lino](examples/cv.ru.lino), [examples/cv.en.lino](examples/cv.en.lino).
Contacts, salary and birth date are never written: the export stops when a text holds one.

`import` reads the resume again and goes to the one with the file's title (else the only one in
its language, or `--resume`). Each changed or new job is prefilled in the hh.ru slot (port 9351)
and saved only when you type `y` or click «Сохранить» there; `s` leaves it unsaved. Then the
resume is read again and what still differs is shown. hh.ru keeps jobs for the whole profile:
editing a job that other resumes show changes it there too (it says so), and a new job is shown
in the target resume only. Title, «Навыки» and «Обо мне» differences are listed for you to
change.

### Captcha, Pauses and the Chat Panel

- **Captcha**: when hh.ru shows a captcha, the run touches nothing on the page (no clicks,
  page scripts or navigation) and waits until you have solved it in the browser.
- **Captcha prefill**: meanwhile local Claude Code (Haiku) and Codex (the newest Luna model of
  your account) read the captcha picture, only the picture and in its original size (copied from
  the already loaded image, no new request; a screenshot of the picture is the fallback), the way
  [image-to-number](https://github.com/link-assistant/image-to-number) does, and their guess is
  typed into the empty captcha field: one answer when they agree, both as `haiku|luna` when they
  don't. **Auto-send once** (`--captcha-auto-send`, on by default): on the first picture of a
  captcha only Haiku's reading is typed in and «Отправить» is clicked, once. If hh.ru does not
  accept it (a new picture appears), nothing more is sent: from then on the guess is only
  prefilled, and you check it, fix it and send it yourself. With `--no-captcha-auto-send` it is
  never sent. The picture is taken once
  it has loaded and the dialog has faded in, and kept in `logs/captcha/` for checking. Each
  picture is read until there is an answer, at most three times; a field you are typing in is
  left alone. The only clicks are the one that focuses the field for typing and the single send. A reply that is not a captcha answer (one to three Russian or English words,
  e.g. "злеат вьюнить") is dropped: Luna usually declines, Haiku usually answers. Both run at
  low reasoning effort (`READER_EFFORT` in `src/captcha-solver.mjs`), whatever your own Claude
  Code and Codex settings are. Needs `claude` and `codex` on `PATH`; turn it off with
  `--no-captcha-prefill`.
- **Unconfirmed application**: if hh.ru does not mark a vacancy as responded after sending,
  the run waits for you (or stops in unattended runs) instead of opening the next vacancy.
- **Pauses**: after every opened vacancy, sent or not, the next one waits the same even
  pause (default 4-5 minutes), so hh.ru sees few requests and 200 applications a day still fit.
  The pause counts from the start of work on the vacancy, so an application takes 4-5 minutes in
  all, under 7: a long form or a captcha is not followed by a whole pause, only by 30-60 s.
- **Stats**: `bun run stats` (`-- --days <n>`, 14 by default) shows each day: applications, per
  hour, the time of work on one (typical and longest), how many took over 7 minutes with the pause,
  captchas (how many AI solved, and per 100 applications), skipped vacancies, rejections read (how
  many as they came) and letters attached later; then the pace and the captchas per 100
  applications at each pace. A captcha is written when it shows, in any window (the main one, the
  chat window, a form slot), with the site, page and window, and again once it is gone. A run
  prints today's line when it starts. The events are kept in `logs/stats.jsonl` (not in git).
- **Chat panel**: hh.ru opens the employer chat after an application; the run closes it. When the
  employer turns the conversation off («Работодатель отключил переписку по данной вакансии») while
  the run waits for your answer there, the panel is closed and the run goes on.

### Ignore Questionnaire Vacancies

If you want to skip vacancies that require any additional questionnaire fields beyond the cover letter, use:

```bash
bun run apply -- --ignore-vacancies-with-questionnaire --verbose
```

This works for both modal response forms and full `vacancy_response` pages. The vacancy will be skipped as soon as the script detects extra questionnaire fields, and kept in `data/skipped-vacancies.lino` (reason `questionnaire_ignored`; the former `data/ignored-vacancy-ids.txt` is moved there on the next run).

### Using Playwright (default)

Using bun script (with verbose logging for debugging):
```bash
bun run puppeteer -- --url "https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist" --manual-login --job-application-interval 5 --verbose 2>&1 | tee log.txt
```

Or explicitly specify Playwright:
```bash
bun run playwright -- --url "https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist" --manual-login --job-application-interval 5 --verbose 2>&1 | tee log.txt
```

With custom search parameters:

```bash
bun run puppeteer -- --url "https://hh.ru/search/vacancy?from=resumelist&order_by=salary_desc&work_format=REMOTE&enable_snippets=false&professional_role=96&professional_role=104&professional_role=125&salary=375000" --manual-login --job-application-interval 5 --verbose 2>&1 | tee log.txt
```

And for Playwright:

```bash
bun run playwright -- --url "https://hh.ru/search/vacancy?from=resumelist&order_by=salary_desc&work_format=REMOTE&enable_snippets=false&professional_role=96&professional_role=104&professional_role=125&salary=375000" --manual-login --job-application-interval 5 --verbose 2>&1 | tee log.txt
```

With custom message:

```bash
bun run apply -- --url "https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist" --manual-login --job-application-interval 5 --message "Your custom application message here" --verbose
```

With multi-line message from file:

```bash
bun run apply -- --url "https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist" --manual-login --job-application-interval 5 --message-file ./message.txt --verbose
```

Direct execution:
```bash
./src/apply.mjs --url "https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist" --manual-login --job-application-interval 5 --verbose
```

Using globally installed CLI (after `bun install -g`):
```bash
hh-apply --url "https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist" --manual-login --job-application-interval 5 --verbose
```

### Using Puppeteer

Using bun script (with verbose logging for debugging):
```bash
bun run puppeteer -- --url "https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist" --manual-login --job-application-interval 5 --verbose
```

With custom message:

```bash
bun run apply -- --engine puppeteer --url "https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist" --manual-login --job-application-interval 5 --message "Your custom application message here" --verbose
```

Direct execution:
```bash
./src/apply.mjs --engine puppeteer --url "https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist" --manual-login --job-application-interval 5 --verbose
```

Using globally installed CLI (after `bun install -g`):
```bash
hh-apply --engine puppeteer --url "https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist" --manual-login --job-application-interval 5 --verbose
```
