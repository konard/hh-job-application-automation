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
- **Pace** - at least `--job-application-interval` seconds (default 60) plus a random extra of up to
  the same amount pass between applications.
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

   # Minimum seconds between opened vacancies (default 180; a random extra up to the same is added)
   JOB_APPLICATION_INTERVAL: 240

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
for you when a question has no saved answer. `--test-mode` is a preset: `--max-applications 1`
and also confirm `answers`. Each part can be set
on its own:

| Option | Values | Effect |
|--------|--------|--------|
| `--confirm` | `answers`, `cover-letter`, `send` (default), `popup` (comma-separated), or `none` | Steps that wait for `y` on stdin: typed answers and radio/checkbox choices on the full form, its cover letter, the click that sends a form with questions (full form or popup; forms with only a cover letter are sent right away), everything in the short popup form |
| `--on-missing-answers` | `wait` (default), `skip` | Questions without a saved answer: wait for you to answer them in the browser, or skip the vacancy |
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
counts towards `--max-applications`), withdraws its pending question, keeps the 1-2 interval
pause and returns to the vacancy list.

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
  typing, page scripts or navigation) and waits until you have solved it in the browser.
- **Unconfirmed application**: if hh.ru does not mark a vacancy as responded after sending,
  the run waits for you (or stops in unattended runs) instead of opening the next vacancy.
- **Pauses**: after every opened vacancy, sent or not, the next one waits 1-2
  `--job-application-interval`s (default 180 s, so 3-6 minutes), so hh.ru sees few requests.
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
