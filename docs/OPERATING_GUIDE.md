# Operating the automation yourself

Run every command from the repository root. This guide describes the implemented workflow;
[CLI reference](CLI_REFERENCE.md) lists every application option and the other commands.
[README](../README.md) has longer feature explanations, and [requirements](requirements/README.md)
link behaviors to their verification. Commands that start applications send real applications.
The shell/process examples target macOS/Linux. They use ripgrep (`rg`); `grep -E` can replace it
in the process-list examples if ripgrep is not installed.

- [Daily commands](#daily-commands) · [First setup](#first-setup)
- [Login/export without applications](#login-and-export-without-applications)
- [Submission controls](#configuration-and-submission-controls) · [Background runs and live switches](#foreground-background-and-live-mode-switches)
- [Stop the entire app](#stop-the-entire-app) · [Skips and retries](#questionnaires-skips-and-retries)
- [Answers and salary](#answers-contacts-and-salary) · [Vacancy context and CV language](#vacancy-context-cv-language-and-salary-ordering)
- [Chats/forms](#chats-and-external-forms) · [CV maintenance](#cv-export-editing-and-technology-maintenance)
- [Other commands](#other-supported-commands) · [Slots/files](#browser-slots-and-files) · [Troubleshooting](#is-it-working-waiting-or-stopped)

## Daily commands

The checked-in [operator profile](../examples/operator.lenv) reproduces the browser-review workflow:
silent visual notifications, manual CAPTCHA handling, adaptive pacing, vacancy collection and
reviewed CV maintenance. It uses your existing private answers, contacts, salary targets and login.

```bash
# Normal run: include questionnaires; uncertain or missing answers wait for browser review.
bun run apply -- --configuration examples/operator.lenv

# Away from the computer: defer ALL questionnaires in RAM; cover-letter-only applications continue.
bun run apply -- --configuration examples/operator.lenv --no-questions

# Inspect activity without starting a browser.
bun run stats -- --days 2

# See the main CLI's resolved options/help without starting applications.
bun run apply -- --help
```

Start only one application worker for a browser profile/port. The normal mode allows questionnaires;
`--no-questions` is an optional session mode. Neither mode removes CAPTCHA, login or account-limit
waits. The operator profile does not enable unattended submission of uncertain questionnaire answers.

With this profile, exact saved answers can be sent automatically. Cover-letter-only applications
also send automatically. Other questionnaires wait for you in the browser because `CONFIRM: none`
disables terminal prompts, not browser review. An editable CV draft always waits for your final Save.
The default rejection cleanup can send one request for a rejection reason in an open chat; use
`--no-ask-rejection-reason` for read-only rejection cleanup, or `--no-clear-rejections` to disable it.

## First setup

1. Install Bun **1.4.2 or newer**, Git, and the repository's dependencies. If using Node for a
   maintenance script, use **22.12 or newer**; the package's primary commands use Bun.

   ```bash
   git clone https://github.com/konard/hh-job-application-automation.git
   cd hh-job-application-automation
   bun install
   bunx playwright install chromium
   ```

2. Review `data/cover-letter.txt` and its English counterpart `data/cover-letter.en.txt`. Choose
   your own text before running. An explicit `--message` takes precedence over `--message-file`.
   Without either a configured message or message file, startup stops with “Choose a cover letter”.
   The operator profile selects the repository's cover-letter file; it does not personalize it.

3. Review the local data described under [Answers and salary](#answers-contacts-and-salary).
   A fresh clone does not contain your current machine's private exports, login or correction policy.
   The supplied CV examples and existing data files describe the repository owner's experience;
   copying the repository does not establish another person's experience.

4. Optionally create local defaults. Do this only if `.lenv` does not already exist:

   ```bash
   cp .lenv.example .lenv
   ```

   Uncomment the settings you need. Keep credentials in this ignored file, never in the operator
   profile. Main-CLI flags win over file settings. With the installed configuration library,
   `.lenv` overrides matching ambient environment variables, and `--configuration <file>` is
   loaded after `.lenv`. Use explicit CLI flags for a one-run override.

5. Start the operator profile. Chrome for Testing opens with its own persistent profile. The app
   attempts session import; `--manual-login` instead waits for you to sign in in that window.
   `--login-from chrome` restricts automatic import to a matching browser/profile name. Session
   cookies are kept in browser profiles; values are not printed. macOS visual notifications may
   need Xcode Command Line Tools (`xcode-select --install`) to build the notification helper and
   notification permission; a visual alert window is the fallback.
   For login or CV work without applications, use the browser-only recipe below instead.

6. After login, export your saved CVs for language selection, matching and drafts:

   ```bash
   bun run cv -- export
   ```

   Keep an authenticated main browser on port 9322 open while exporting. The export uses a separate
   headless browser and does not navigate the application or CV editor. If the main worker is
   running, it may continue applying while you export; this is not a login-only startup command.

For a bounded first run:

```bash
bun run apply -- --configuration examples/operator.lenv --test-mode --max-applications 1 --no-auto-send-exact-answers
```

Test mode is **not a dry run**: it adds answer/send confirmations and defaults the sent-application
maximum to one. Cover-letter-only applications can still submit without a question prompt.
Do not override `--max-applications` with a larger value if you want that one-application bound.

## Login and export without applications

When the application worker is stopped and you have no unfinished form to preserve, open just its
browser through the existing session API. This does not start the application loop:

```bash
bun -e '
import { connectOrLaunchBrowser } from "./src/browser-session.mjs";
import { getUserDataDir } from "./src/config.mjs";
const session = await connectOrLaunchBrowser({
  engine: "playwright", userDataDir: getUserDataDir(), port: 9322,
  keepOpen: true, idleTimeoutMinutes: 30, singleTab: true
});
await session.page.goto("https://hh.ru/applicant/resumes", { waitUntil: "domcontentloaded" });
await session.release();
process.exit(0);
'
```

Log in manually in that window if needed, then run `bun run cv -- export` or the CV audit/review
commands. The browser remains open for 30 idle minutes. This recipe navigates to the CV list;
use ordinary application startup instead when you want an existing unfinished application preserved.
Close the browser through the full-shutdown instructions when finished.

## Configuration and submission controls

The operator profile is optional. The equivalent core foreground command is:

```bash
bun run apply -- --message-file data/cover-letter.txt --keep-browser-open --confirm none \
  --no-notification-sound --no-captcha-prefill --no-captcha-auto-send
```

Useful variations:

```bash
# Terminal review of non-exact questionnaire answers instead of browser-only review.
bun run apply -- --configuration examples/operator.lenv --confirm send

# Also require review when all questions have exact saved answers.
bun run apply -- --configuration examples/operator.lenv --no-auto-send-exact-answers

# Stop after ten confirmed applications in this invocation.
bun run apply -- --configuration examples/operator.lenv --max-applications 10

# Use a search URL copied from your own matching-vacancies page; quote the entire URL.
bun run apply -- --configuration examples/operator.lenv --url 'https://hh.ru/search/vacancy?resume=YOUR_RESUME_HASH&from=resumelist'

# Visual alerts off if NOTIFY is not overridden by your configuration files.
NOTIFY=0 bun src/apply.mjs --configuration examples/operator.lenv --no-notification-sound
```

`--confirm` accepts `answers`, `cover-letter`, `send`, `popup`, comma-separated, or `none`.
At a terminal prompt, `y` continues and `q` stops; the missing-answer prompt also offers `s`
to defer the question. Read the displayed prompt before replying. In a detached run, review
and send non-exact forms in the browser. `--auto-submit-vacancy-response-form` broadens automatic
submission beyond exact saved answers; it is off in both the built-in defaults and operator profile.

## Foreground, background and live mode switches

Foreground is easiest: keep the terminal open and use Ctrl+C to stop the main worker.
For a detached run on macOS/Linux, launch the executable directly so the PID is the application
worker rather than a `bun run` wrapper:

```bash
mkdir -p logs
nohup bun src/apply.mjs --configuration examples/operator.lenv --no-questions \
  > logs/apply.log 2>&1 &
automation_pid=$!
printf '%s\n' "$automation_pid" > logs/apply.pid
```

Check its identity before using the saved PID; a PID file can outlive the process:

```bash
ps -p "$(cat logs/apply.pid)" -o pid=,ppid=,stat=,etime=,command=
tail -n 60 logs/apply.log
```

The command should be this repository's `bun src/apply.mjs`. These signals target that worker:

```bash
kill -USR1 "$(cat logs/apply.pid)"  # Defer all questionnaires in RAM now.
kill -USR2 "$(cat logs/apply.pid)"  # Enable questionnaires and revisit the RAM queue.
kill -INT  "$(cat logs/apply.pid)"  # Stop the main worker (like Ctrl+C).
```

A normal restart clears RAM questionnaire and generic-error retry queues; no-questions mode must
be selected again with `--no-questions`. Already sent applications, saved answers, persistent
exclusions, statistics and confirmed account-limit pauses remain. The internal `HH_*_HANDOFF`
variables used during controlled diagnostic reloads are not required for ordinary startup.
The main CLI does not maintain the assistant's `logs/restarts/current-applications.json`; use
your own PID/log files above, or inspect actual processes.

## Stop the entire app

1. Finish a CV Save or copy unfinished CV/chat/external-form text locally if you want to retain it.
   Stopping a process does not click Save or Send, and arbitrary unsent browser edits are not all
   automatically backed up. Failed HH applications have recovery copies; see the data table below.
2. Stop the main worker with Ctrl+C or its verified PID. Its child chat processor is stopped with it.
3. List any standalone or detached workers; the CV reviewer and form watchers can outlive the main worker:

   ```bash
   ps -axo pid=,ppid=,command= | rg 'src/(apply|answer-chats|cv-alias-sync|cv-watch|cv-sync|form-watch|prefill-form|experience-sync|browser-watchdog)\.mjs'
   ```

   Check each command's repository/profile, then run `kill -TERM PID` for its actual numeric PID.
   Stop the CV reviewer before closing its browser; do not kill every Bun or Chrome process.
4. Close the app's Chrome for Testing windows. With `--keep-browser-open`, stopping the main worker
   intentionally leaves its browser open. Independent slots default to 24 hours of idle retention.
   For the usual three slots, after checking their ownership, this closes them explicitly:

   ```bash
   bun -e '
   import { closeBrowser } from "./src/browser-session.mjs";
   for (const port of [9322, 9340, 9352]) {
     await closeBrowser(port, { reason: "user_requested_shutdown" });
   }
   '
   ```

   Add only other ports you actually opened from the slot table below. Stop this app's listed
   watchdogs as well for immediate full shutdown; otherwise they exit after finding their browser closed.
5. Repeat the process listing to confirm the app's workers are gone. Personal Chrome windows are
   separate from these automation profiles. A later start uses the persistent login/profile again.

The automation is a CLI, not an installed service or an automatic crash-restart supervisor.
Exiting the terminal without a detached launch, or an unexpected fatal error, can end the worker.

## Questionnaires, skips and retries

| Choice | What happens | Survives a normal restart? |
|---|---|---|
| `--no-questions` / SIGUSR1 | Every full-form or popup questionnaire is deferred, including fully known ones; cover-letter-only forms continue | No; pass the flag again |
| SIGUSR2 / normal `--questions` start | Questionnaires are eligible again; the live RAM queue is revisited when enabled | The mode defaults to enabled on a fresh start |
| `--skip-question 'distinctive text'` | Matching questionnaires are deferred; repeat the flag for several fragments | Deferred records persist until their questions are answered |
| `--on-missing-answers skip` or prompt `s` | Save unanswered questions and defer associated vacancy IDs | Yes, in `data/deferred-questions.lino` |
| `--ignore-vacancies-with-questionnaire` | Record a questionnaire exclusion with reason `questionnaire_ignored` | Yes, in `data/skipped-vacancies.lino` |
| Vacancy filter match | Record the matched rule and exclude the vacancy | Yes, in `data/filtered-vacancies.lino` |
| Generic HH “An error occurred, please try again” | Save answers/full recovery copy, defer the vacancy for five hours and continue other applications | The timer/queue is RAM-only; the recovery copy persists |
| Account application limit | Hold all application routes for two hours, preserving the form and answers | Yes, from statistics/events |

```bash
bun run apply -- --configuration examples/operator.lenv --skip-question 'a question to answer later'
bun run skipped
bun run skipped -- --clear questionnaire_ignored
bun run skipped -- --clear 123456789
```

`skipped --clear` only clears the specified skipped-vacancy store; it does not clear filtered or
deferred-question records, reset HH's account limit or recover a dead process's RAM queue.
Answer a deferred question in `data/qa.lino` to make its vacancies eligible again. Review/remove
a filtered record only after changing the relevant rule if you want that vacancy reconsidered.

## Answers, contacts and salary

`data/qa.lino` holds question/answer pairs. Use the existing Links Notation format, for example:

```text
"When could you start?"
  "Within one or two weeks after receiving an offer."
```

Quoted multiline answers preserve text; separate short alternatives can represent checkbox
answers. Do not encode paragraphs as literal `\n`. Contact placeholders such as `{{telegram}}`
and `{{salary_net}}` are expanded from `data/contacts.lino`; changed answers are contracted back
to placeholders where applicable. Quote URLs containing `:` in `.lino` files.

Relevant local contact keys are `salary_net_rub`, `salary_net_usd`, `salary_net_eur` and
`salary_hours_per_month` (default **160**). Each currency has its own target, not just a conversion
of the ruble target. Hourly minimums are calculated in the requested currency/tax basis and
rounded upward in steps of **500 RUB or 5 USD/EUR/USDT**. For example, 450,000 RUB / 160 hours
produces a 3,000 RUB hourly minimum. Monthly/hourly and net/gross placeholders are distinct.

`data/answer-contexts.lino` chooses currency and other context from the question first, then
vacancy/chat context. `data/company-taxes.lino` optionally supplies company-tax assumptions for
foreign gross amounts; exchange rates are cached locally. Missing rates leave uncertain gross
answers open rather than inventing a value. These calculations describe the app's configured
assumptions; update the inputs when your requirements change.

Editing Q&A alone may not remove an older variant learned from chat history. Explicit corrections
belong in the private `~/.hh-automation/answers/corrections.json` policy. For an additive update,
create an ignored `logs/answer-correction.json` with this shape and your actual wording:

```json
{
  "answers": [{ "question": "The exact question", "answer": "The corrected factual answer." }],
  "rejected": ["The old answer that must not be reused."]
}
```

Then merge it with the policy using the app's validated, locked writer:

```bash
bun -e '
import fs from "node:fs/promises";
import { answerCorrections } from "./src/answer-corrections.mjs";
await answerCorrections.update(JSON.parse(await fs.readFile("logs/answer-correction.json", "utf8")));
'
```

Add separate question aliases when the employer phrases the same question differently. Keep a
clean factual answer per topic; a one-time apology/explanation belongs in the conversation, not
future experience answers. The application readers apply corrections before answer selection
and ranking; rejected versions in bot summaries or edited-message history are excluded. The
historical transcript itself is retained. Use the update API rather than overwriting the whole
policy and losing earlier corrections.

## Vacancy context, CV language and salary ordering

The normal route is search-card preview → full vacancy collection/description preview → application.
The full description is cached privately and used by CV language selection, technology comparisons,
question answering and linked questionnaires. A failed description read leaves that application
unsent on the pass. `--no-apply-from-vacancy-page` retains the route back through search.
`--no-vacancy-insights` disables the analysis bundle; the entry route is configured separately.

English vacancy content or dollar pay can select the English CV and cover letter. A Russian
questionnaire can retain Russian answers with an English CV/letter. The selector is accessed only
when the chosen CV needs changing and is verified without repeatedly reopening it. Custom user
CV/letter edits are preserved. `--no-auto-select-resume-language` leaves the choice to you.

The salary ladder adds the target RUB floor when a matching search has no salary filter. An
existing filter is respected. After exhausting a tier, it lowers the floor by 50,000 RUB or its
equivalent and starts that tier's first page. Unspecified pay remains eligible; an advertised
maximum below half the target is excluded. A low minimum without a maximum enters its lower
tier instead of being permanently excluded. `--no-salary-ladder` disables this ordering.

`data/vacancy-filters.lino` contains vacancy/question/page fragments and physical-presence rules,
with programming/remote guards. Keyword coverage is a diagnostic, not a rejection score or proof
of experience. Technology aliases keep products and versions distinct, including .NET variants,
React/React Native and the two meanings of NPM. Dangling separators such as `Yandex Cloud/` are
normalized; `/` is never a separate technology. Internal punctuation such as `CI/CD` is preserved.

## Chats and external forms

```bash
# Prefill one chat for review, or work through pending chats.
bun run answer-chats -- https://hh.ru/chat/CHAT_ID
bun run answer-chats -- --watch

# Add full unread-chat processing alongside applications.
bun run apply -- --configuration examples/operator.lenv --process-chats

# Prefill external questionnaires; review and submit them yourself.
bun run prefill-form -- 'https://forms.gle/YOUR_FORM' --no-draft
```

Standalone chat prefilling does not send by default. `--auto-send` opts into exact saved replies
and verified bot choices. A bot offering strict options must receive its option/button; arbitrary
typed text is not substituted. Unknown experience is left for review. Generic HH suggestion chips
are not strict questionnaire options. `--auto-reuse` compares prior bot answers before choosing
whether to reuse them; its default is manual choice.

Initial screening/“we will review and return with feedback” notices receive the saved acknowledgement
under the configured automatic-template rules. Rejections with an open composer can receive one
reason request, with private receipts preventing repeats. Existing drafts, conversation changes and
an active foreground window prevent background sends. Read-only cleanup is separately available.

External forms open in independent slots. They are not submitted automatically. Unless `--no-learn`
is used, a detached watcher saves submitted answers and stable owner edits before submission;
unknown draft markers are excluded. Reports and watcher logs are under `logs/forms/`.
A linked external questionnaire may be opened from chat processing unless `--no-forms` is set.

`answer-chats --learn-all` reads full chat histories in a separate slot and marks opened unread
chats read. `--relearn` reprocesses the private local archive without opening HH. Both are maintenance
operations that update private answer stores; they are not needed for each application run.

## CV export, editing and technology maintenance

`cv export` and the technology audit need an authenticated source browser (normally 9322).
`edit`, `batch`, `watch` and `technologies --review` additionally attach to an existing CV slot
(normally 9351), rather than opening that slot themselves. `import` can open its editing slot.

```bash
bun run cv -- export
bun run resume -- --all --formats txt
bun run cv -- technologies
bun run cv -- technologies --review --snapshots-out examples
bun run cv -- import /path/to/desired.cv.en.lino --resume YOUR_EN_RESUME_HASH --one
bun run cv -- watch --hh-port 9351 --out examples --once
```

To prepare the editing slot while no other CV workflow owns it, replace the hash below with the
one from your own `https://hh.ru/resume/...` URL. An existing form is left untouched:

```bash
bun -e '
import { openSlot } from "./src/browser-slots.mjs";
import { seedHhSession } from "./src/login.mjs";
import { readHhCvForm } from "./src/hh-cv-editor.mjs";
const session = await openSlot({ name: "hh-experience-slot", port: 9351 });
if (await readHhCvForm(session.page)) {
  console.log("Existing CV draft left open; finish its review first.");
} else {
  if (!await seedHhSession({ page: session.page, fromPort: 9322 })) throw new Error("Log in first");
  await session.page.goto("https://hh.ru/resume/YOUR_RESUME_HASH", { waitUntil: "domcontentloaded" });
}
await session.release();
process.exit(0);
'
```

Then run the appropriate edit/review/watch command. Do not drive one editor concurrently from
an alias reviewer and a manual batch.

`cv export` writes sanitized `examples/cv.ru.lino` / `cv.en.lino` (hash suffixes distinguish multiple
CVs in one language). `resume --all` keeps full private exports by hash under `data/resume/`.
The `.lino` format round-trips About, positions, dates, city, websites and industry IDs/labels.
Import does not change the profile's shared personal name; title and structured skill-tag
differences are reported separately. Keep a desired import file separate from saved snapshots.

Technology maintenance audits both About sections and relevant positions; no missing experience
is invented. Biography, job narrative and metadata remain. The automatic reviewer on port 9352
re-exports after every verified owner Save, retains edits made before Save and prepares the next
change. It can remain open after the application worker stops. Status/plan are
`logs/experience/alias-sync-9352.json` and `.plan.json`; `pending: 0` / `up_to_date` means no planned
changes at that check. An existing unsaved draft is observed, never silently replaced.

To request the same singleton reviewer explicitly without starting applications:

```bash
NOTIFY_SOUND=false bun -e '
import { ensureCvAliasSync } from "./src/cv-alias-sync.mjs";
console.log(await ensureCvAliasSync({ fromPort: 9322, port: 9352 }));
'
```

This needs an authenticated automation session or the slot's saved login. An existing reviewer
is reused with its current settings. `cv technologies --review` offers a foreground alternative
on the CV editing slot (9351).

`--publish` is an explicit opt-in for CV workflows: sanitized saved snapshots are committed and
the current branch is pushed after verified saves. A Git push includes any other unpublished
ancestor commits on that branch too; check `git log origin/main..HEAD` before opting in.
No pending draft is published as though already saved. The automatic reviewer's publication
setting is chosen when it starts, not upgraded by a later `ensureCvAliasSync` call.

For one workplace or a batch, use `cv edit change.json` / `cv batch changes.json`. Shared HH
workplaces are copied for the selected language first and the original is deselected in a separate
reviewed step, never silently deleted. Follow the printed checkpoint/next-step instruction.
`cv edit --after-checkpoint FILE` waits for an already running verified Save, not just a closed editor.

For example, create ignored `logs/my-cv-change.json`, replacing all target placeholders with
the exact current saved entry and your own resume hash:

```json
{
  "kind": "update",
  "resumeHash": "YOUR_RESUME_HASH",
  "target": {
    "company": "EXACT_SAVED_COMPANY",
    "title": "EXACT_SAVED_POSITION",
    "description": "EXACT_CURRENT_DESCRIPTION"
  },
  "fields": { "industries": [{ "id": "7.541" }] }
}
```

```bash
bun run cv -- edit logs/my-cv-change.json --snapshots-out examples
```

Use an industry ID from the dictionary dump, not a guessed translated label. `fields` may also
contain reviewed `company`, `title`, `description`, `start`, `end`, `current`, `area` or `website`.
For About, use `kind: "about"`, `fields.about` and `target.about` with its existing saved text.

Company activity selection uses HH's complete localized industry tree, including virtualized
off-screen choices. Dump it with `bun run industries -- --locale EN --json`. Edit JSON can specify
stable industry IDs; the local chooser Save is automatic, but the final workplace Save is yours.
RU/EN industry labels are compared by stable IDs. City labels are resolved through cached HH area
dictionaries. For the exact change-file schema and copy/detach examples, see
[CV import/edit details](../README.md#the-resume-as-lino-files-export-and-import).

## Other supported commands

| Command | Purpose and effects |
|---|---|
| `bun run stats -- --days 14` | Local application totals, pace, waits and CAPTCHA statistics |
| `bun run vacancy-stats -- --top 50 --json` | Local cached-vacancy technology/requirement statistics; no AI call |
| `bun run ai-status` / `-- --probe` | Authenticated Oxion model catalog; `--probe` additionally sends a small text request |
| `bun run linkedin-login -- --manual` | Sign into the independent LinkedIn slot |
| `bun run experience -- export` / `diff` | Export/compare HH and LinkedIn experience; may open the relevant slots |
| `bun run experience -- sync --to linkedin` / `--to hh` | Prepare translated experience changes for reviewed saves |
| `bun run experience -- edit --company NAME --add 'TECHNOLOGIES'` | Prepare a technology-list change for one job |
| `bun run test-assignment -- REPOSITORY --from /path/to/assignment.txt --dry-run` | Preview assignment issue preparation without creating the repository/issue |
| `bun run test-assignment -- REPOSITORY --from /path/to/assignment.txt --private` | Create/update a GitHub assignment repository and issue using `gh`; default without `--private` is public |
| `bun run contacts-migrate -- --dry-run` | Preview replacing literal contact values with placeholders; omit dry-run to write the Q&A/template/letter files |
| `bun run backfill-questionnaires` | Reindex compound Q&A blocks and local history counts; writes private Q&A/history metadata |
| `bun run formalize-qa -- --limit 10` | Run the Formal AI experiment on local Q&A; may clone its dependency; report under `logs/` |
| `bun run check` | Lint, unit/regression tests and main CLI help; no live application run |

Optional AI drafts use the configured local tooling; they are not required for saved-answer
matching or application pacing. Review factual experience before sending. Model availability is
checked separately; a configured model ID is not proof of access. Oxion credentials use ignored
`.lenv` keys `OXION_BASE_URL`, `OXION_API_KEY`, `OXION_MODEL`. Test-assignment publishing needs GitHub
CLI authentication. Experience translation may report Formal AI failures to its repository by
default; `--no-report-formal-ai` disables that external issue creation.

## Browser slots and files

| Default port | Role | Profile under `~/.hh-automation/` |
|---|---|---|
| 9322 | Main application worker | `chrome-profile` |
| 9331–9339 | External form slots 1–9 | `form-slot-1` … `form-slot-9` |
| 9340 | Chat review/processing | `chat-slot` |
| 9341 | Full chat-history collection | `chat-history-slot` |
| 9350 | LinkedIn login/experience | `linkedin-slot` |
| 9351 | HH CV/experience edit and watch | `hh-experience-slot` |
| 9352 | Automatic bilingual CV alias reviewer | `resume-alias-slot` |

| Location | Contents and restart behavior |
|---|---|
| `.lenv` | Private local defaults/optional credentials; keep existing values when updating |
| `data/contacts.lino`, `qa.lino`, `chat-templates.lino` | Local contact/salary values, saved answers and template replies |
| `data/deferred-questions.lino`, `filtered-vacancies.lino`, `skipped-vacancies.lino` | Persistent deferred/filter/skip records |
| `data/vacancy-filters.lino`, `answer-contexts.lino`, `technology-aliases.lino` | Matching rules, contexts and equivalent technology names |
| `data/resume/` | Private saved CV exports, converted text and technology plans; ignored by Git |
| `examples/cv.*.lino` | Sanitized actual saved CV snapshots, suitable for the configured publication workflow |
| `~/.hh-automation/vacancies/<id>.lino` | Private full vacancy cache; old `data/vacancies/` records are imported without deleting originals |
| `~/.hh-automation/answers/corrections.json` | Private durable approved/rejected answer policy |
| `~/.hh-automation/dictionaries/` | Cached HH industry and area dictionaries |
| `logs/stats.jsonl` | Persistent sent/limit/CAPTCHA/pace events |
| `logs/chat-history.json` | Private transcript and historical answer variants |
| `logs/application-drafts/<vacancyId>.json` | Private failed/deferred application recovery copy, including cover letter and choices |
| `logs/forms/`, `logs/experience/` | Form reports/watchers, CV plans/checkpoints/status and edit requests |
| `logs/browser-lifecycle.jsonl` | Worker shutdowns, requested browser closes, crashes/disconnections; a page-close event does not identify who closed it |
| `~/.hh-automation/traces/` | Machine-local diagnostics with three-day retention, daily rotation and cleanup while recording |
| `~/.hh-automation/backups/` | Backups made during assisted wrap-ups; ordinary CLI shutdown does not automatically create these |

Logs, profiles, vacancy text, credentials and drafts stay local. The six runtime `.lino` stores
listed in the first two data rows may appear modified in Git because they are historically tracked;
they are intentionally not part of source/CV publication. Review `git diff --cached --name-only`
and stage source/CV paths explicitly rather than using `git add .`.

## Is it working, waiting or stopped?

| Evidence | Meaning / action |
|---|---|
| “Next vacancy to check” / “Reading the full vacancy” | Working; the next card/description is shown before applying |
| “Application sent” / `application_sent` event | Confirmed send; a button click alone is not confirmation |
| “next vacancy in …” | Normal adaptive pause, usually 1–4 minutes between opened vacancies; long manual review adds time |
| CAPTCHA or login wait | Complete it in the indicated browser; the operator profile leaves CAPTCHA handling manual |
| “Waiting for your review” / unknown draft marker | Inspect facts/options and send or finish the review yourself |
| CV `awaiting_user_save` / `awaiting_existing_user_save` | Review that slot and click its final Save; the app does not auto-save the CV |
| Daily 200-application refusal | Preserved account-wide two-hour wait; no recurring application-window reminders; chats can continue |
| Generic error / five-hour RAM deferral | Other vacancies continue; this vacancy can be retried from its recovery copy later |
| “Unexpected error, shutting down” and no matching PID | Stopped; inspect the error/stack and lifecycle log, then start again after resolving it |
| Browser open, no worker PID | An idle browser is not an active application process |
| “No existing resume editor page” / connection refused on 9351 | Prepare the CV editing slot above, or select the port of the slot you actually opened |

The main worker rechecks expected navigation-interrupted error reads; it does not treat a failed
read as success. Stable unreadable/validation states remain blocking. If a worker is gone, do not
assume a log's last “waiting” line is current. Check the actual PID and the last log modification.
Use `--verbose` for more details. With the operator profile, visual alerts remain on and sound is off;
standalone commands can also use `NOTIFY_SOUND=false`. Set `NOTIFY: 0` in local configuration to
disable visual alerts too. Use main `--no-trace`, or standalone `TRACE=0` where no configuration
overrides it, to turn off tracing; a positive `--trace-retention-days N` adjusts retention.
Diagnostics stay out of GitHub.
