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
to the browser) and an installed Google Chrome. The browser is started the way a person would start
it (no automation infobars); the profile is kept in `~/.hh-automation/chrome-profile`.

**Zero-configuration run:** `bun run apply` logs in, picks your most recently updated resume and
applies to the vacancies hh.ru suggests for it:

- **Login** - if the automation profile is not logged in yet, the browsers on this machine are
  checked for an hh.ru session or a VK, Mail.ru, OK, Google or Gosuslugi session (only cookie names
  are counted). The best Chromium-based profile is opened as a temporary copy (no Keychain prompt) and
  its hh.ru login, or a social sign-in through it, is copied into the automation profile. Use
  `--login-from chrome` to pick a browser, or `--manual-login` to log in yourself.
- **Resume** - the suggested vacancies of the most recently updated resume are opened, unless `--url`
  is given.
- **Pace** - `--job-application-interval` seconds (default 240) plus a random extra of up to a
  quarter of it pass between opened vacancies: 4-5 minutes, which still fits hh.ru's 200
  applications a day (261-320 a day of continuous work).
- **One tab** - the automation browser keeps a single tab: when a run attaches, every other
  tab is closed (the tab the automation used last is kept, else an hh.ru one), and tabs opened
  during the run are closed as they appear. Turn it off with `--no-single-tab`.
- **Browser lifecycle** - Chrome is closed when the script exits. With `--keep-browser-open` it keeps
  running, the next run reuses it and its open page, and it closes itself after
  `--browser-idle-timeout` minutes (default 30) without use.
- **Debug traces** - every run records a browser-commander trace (DOM snapshots, DOM mutations,
  interactions, console) with a Links Notation export, plus a `network.lino` request log, in
  `logs/traces/<time>/`. Disable with `--no-trace`.

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

By default, the script will:
- **Auto-submit** if the form has ONLY a cover letter (no test questions)
- **Wait for manual review** if the form has test questions, even if all answers are auto-filled from the QA database

To enable auto-submission for forms with test questions (when all answers are auto-filled), use the `--auto-submit-vacancy-response-form` flag:

```bash
bun run apply -- --auto-submit-vacancy-response-form --verbose
```

**Safety Note:** The default behavior (manual review) is recommended to ensure test answers are correct before submission.

Questions that the QA database cannot answer are never skipped by default: the form waits for
you (`--on-missing-answers wait`). Use `--on-missing-answers skip` for fully unattended runs.

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

Vacancies that are not programming jobs (electrical installation, circuit design) are skipped
without asking, by the rules in `data/vacancy-filters.lino`. A part of the text is enough; case and
ё/е do not matter:

```
vacancy
  схемотехник
question
  дифавтомат
```

- `vacancy`: the vacancy card in the search list (title, company, labels), checked before the
  vacancy is opened, so it costs no request; and the vacancy name on its response form
- `question`: a question of the response form (full form or popup)
- `page`: any text of the response form

Every filtered vacancy is logged with the rule (`🚫 Vacancy … filtered out by vacancy-filters.lino
(question "кв.мм": …)`) and kept in `data/filtered-vacancies.lino`, so it is not opened again. Add a
line to the rules when you see a vacancy that should have been skipped.

hh.ru's notice «поменяйте видимость резюме на «Видно всем работодателям…»» is not a filter: it
depends on the resume, so once it shows, every such vacancy shows it. Only a rendered notice counts:
every response popup carries it in a collapsed `hidden-resume-warning` block that opens only for a
hidden resume. The run asks you to make the
resume visible (on hh.ru in your own browser or the app; the automation browser keeps to one tab)
and then goes on, or `s` skips the vacancy. Unattended runs skip it.

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
- Contacts that are public anyway (Telegram, phone, LinkedIn, GitHub) are kept in
  `data/contacts.lino`. Saved answers and the cover letter can use them as placeholders
  (`{{telegram}}`, `{{phone}}`, `{{linkedin}}`, `{{github}}`), so a changed contact is changed in
  one place; contact values in answers you save are stored as placeholders.
- The report (every question, its source and answer) is printed and saved to `logs/forms/`.

See [the requirements](docs/requirements/forms-and-chats.md) for what is done and what is planned,
and [the full list of requirements](docs/requirements/README.md) for everything else.

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
- **Chat panel**: hh.ru opens the employer chat after an application; the run closes it.

### Ignore Questionnaire Vacancies

If you want to skip vacancies that require any additional questionnaire fields beyond the cover letter, use:

```bash
bun run apply -- --ignore-vacancies-with-questionnaire --verbose
```

This works for both modal response forms and full `vacancy_response` pages. The vacancy will be skipped as soon as the script detects extra questionnaire fields.

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
