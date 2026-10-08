# hh-apply
Automation of job application in hh.ru

## Video demonstration

https://github.com/user-attachments/assets/6884b2fe-e322-4358-aab8-7f3c20ccdc46

## Application message example

Russian version:
```
Здравствуйте,

Мне понравилась ваша компания, я думаю моя кандидатура будет вам полезна и я смогу привнести ценность в работу компании.

В какой форме предлагается юридическое оформление удалённой работы?

Посмотреть мой код на GitHub можно тут:

github.com/konard
github.com/deep-assistant
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
github.com/deep-assistant
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

   # Minimum seconds between applications (a random extra up to the same is added)
   JOB_APPLICATION_INTERVAL: 90

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

With this flag the run is unattended: forms with questions that the QA database cannot answer are
skipped instead of waiting for you.

### Test Mode

To check what will be sent, apply to a single vacancy step by step:

```bash
bun run apply -- --test-mode
```

Before every click and every typed value the target is scrolled into view and outlined in the
browser, and the terminal shows what will happen (the vacancy, the button, the exact text). Type `y`
to do it or `q` to stop. The run ends after that one application.

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
