# Requirements

Every requirement the user gave in the working session of 2026-10-08 … 2026-10-10, in one list, so
that its delivery can be tracked. Each row quotes the user's own words (in the original language,
trimmed to the relevant sentence), restates the requirement precisely, says how to check it, and
gives the status and the evidence (commit, file, test).

Status is taken from the repository and `git log`, as of 2026-10-10 (audited against the code at `35342c4`, see PROC14):

- ✅ done and verified live, on hh.ru or the real browser
- 🧪 done, verified offline only (unit tests, a replay or a sample page)
- 🚧 partial
- ⬜ to do
- ↪ superseded by a later requirement (the later one is what counts)

A `?` after a status means the evidence is incomplete; the note says what is missing.

Detailed lists that this index includes:

- [forms-and-chats.md](forms-and-chats.md): hh.ru application forms (A1–A8), external forms (B1–B26)
  and hh.ru chats (C1–C15). Every row there is listed below under [FORM](#form-external-forms) and
  [CHAT](#chat-hhru-chats), with the same status.
- [experience-sync.md](experience-sync.md): LinkedIn and hh.ru work experience export, diff, sync and
  translation. Being written separately; its requirements are summarised below under
  [EXP](#exp-work-experience-export-sync-and-translation).

Sections:
[DEP](#dep-dependencies-code-quality-upstream-issues) ·
[LOGIN](#login-accounts-and-sign-in) ·
[RUN](#run-the-application-run) ·
[PACE](#pace-pacing-and-load-on-hhru) ·
[BRW](#brw-browser-tabs-and-session) ·
[TRACE](#trace-recording-and-debugging) ·
[CONF](#conf-test-mode-confirmations-and-auto-send) ·
[QA](#qa-answers) ·
[CAP](#cap-captcha) ·
[FLT](#flt-filtering-and-deferring-vacancies) ·
[RES](#res-resume-export-and-stack) ·
[FORM](#form-external-forms) ·
[CHAT](#chat-hhru-chats) ·
[EXP](#exp-work-experience-export-sync-and-translation) ·
[SEC](#sec-safety-constraints) ·
[PROC](#proc-how-the-work-is-done) ·
[Upstream issues](#upstream-issues) ·
[Questions asked](#questions-and-one-off-requests) ·
[Summary](#summary)

## DEP: dependencies, code quality, upstream issues

| ID | User's words | Requirement | Check | Status | Evidence |
|---|---|---|---|---|---|
| DEP1 | «Update all dependencies of this project to latest versions» · «Update all dependencies including browser commander (when it available) if still something is wrong or missing - report» | Every dependency is on its latest version | `package.json` versions vs. `npm view <pkg> versions` (npm's `latest` tag lags for some) | ✅ browser-commander 0.28.0 (2026-10-10); links-notation 0.25.1, lino-arguments 0.3.0, log-lazy 1.0.4, playwright 1.64.0, puppeteer 25.13.0, turndown 7.2.4, eslint 10.12.0, test-anywhere 0.9.1 already latest stable; transitive packages refreshed in both lockfiles | 54b771f (browser-commander 0.5.4 → 0.26.3 …); this commit (0.27.0 → 0.28.0). `npm audit`: 5 high, all `braces` under browser-commander → command-stream → shelljs → fast-glob, no fixed version published |
| DEP2 | «we need to make sure our code is simple, short and elegant, and our dependencies are feature-reach enough, so generic code is not duplicated across usages, with biggest focus on browser-commander» | Generic browser code lives in the dependencies (browser-commander first), not in this repository | No local copies of what browser-commander provides (`waitForUrlCondition`, `installClickListener`, `findToggleButton`, `isEnabled`…) | ✅ | 54b771f (src ~5400 → ~3000 lines) |
| DEP3 | «if some missing features are in these dependencies report them» · «report issues on missing issues to browser commander» · «all missing features of browser commander must be reported» · «If needed report issues to browser commander.» | Every feature missing from a dependency is filed as an issue in that dependency's repository | [Upstream issues](#upstream-issues) | ✅ | browser-commander #136, #137, #140–#145 (closed by 0.27.0/0.28.0), #148–#158 (open, filed 2026-10-10): #149 EPERM in `connectOrLaunch`, #150 stale `targetId`, #151 kept-open session adoption, #152 trace network redaction, #153 DOM trace redaction, #154 trace rotation drops, #155 `net::ERR_ABORTED`, #156 `concurrency: 'skip'` default, #157 overlay dismissal, #158 `renderTrace`/`summarizeTrace` not exported; lino-arguments #40; links-notation #333 |
| DEP4 | «make sure to draft all code with workarounds if possible» · «Do workaround here, and in browser commander report issues if any.» | Until upstream fixes land, the repository works around each gap in its own code | Replaced by browser-commander 0.28.0: the merged `--disable-features` and Translate preference (now `resolveRestrictions(['no-crash-restore', 'no-translate'])`), the tab the engine attaches to (`targetId`/`singleTab`), the Trusted Types workaround (`openShadowRoots: false`), the re-entry guard of the form trigger (`concurrency: 'skip'`). Kept: detached browser + watchdog (#149 EPERM, #150 stale tab, #151 adoption all open), choosing/closing tabs (no ranking, no closing of later tabs, #151), `network.lino` and `dom.lino` (0.28.0 redacts far less: #152, #153 open), overlay dismissal (#157 open), the `net::ERR_ABORTED` case (#155 open) | ✅ | `src/browser-session.mjs`, `src/browser-watchdog.mjs`, `src/tracing.mjs`; 101b754, 6114822, 61901a1; this commit |
| DEP5 | «Once everything done push changes to default branch.» · «Make sure you committed and pushed dependencies update to the entire system.» | The dependency update is committed and pushed to `main`, CI green | `git log origin/main` | ✅ | 54b771f |

## LOGIN: accounts and sign-in

| ID | User's words | Requirement | Check | Status | Evidence |
|---|---|---|---|---|---|
| LOGIN1 | «make sure we are able to import all accounts that can be used to login to hh.ru from other browsers» | Logins usable for hh.ru (an hh.ru session, or VK / Mail.ru / OK / Google / Gosuslugi) are found in every installed browser profile | Startup prints the detected logins per browser/profile | ✅ | `detectLogins()` in `src/login.mjs`; 101b754 |
| LOGIN2 | «try to login to hh.ru with the most simple way possible, so as few clicks are needed from me» · «we need to have logic to auto-detect available logins, and be able to login to hh.ru» | Sign-in is automatic: the hh.ru login is imported through a snapshot of a browser profile, with no clicks from the user | Run 1: «🔓 Logged in to hh.ru using chrome (Default)» | ✅ | `ensureLoggedIn()` in `src/login.mjs`; 101b754 |
| LOGIN3 | «The request for password was 2 times it is unacceptable in real world usage.» | No macOS Keychain (or any password) prompt during login | Login from a Chrome profile snapshot shows no system prompt | ✅ | snapshot launch (Chrome decrypts its own cookies); 101b754 |
| LOGIN4 | «Try login via vk, we have session there in on of the browsers.» | When no profile has an hh.ru session, sign in through a social provider session (VK first) | VK sign-in worked in a Chrome snapshot (one-time «Continue as» approval) | 🧪? | `signInWithProvider` in `src/login.mjs`; proven live by a probe, but the integrated path has not been needed since (Chrome had an hh.ru session) |
| LOGIN5 | «we also should use the same playwright profile after login to hh.ru to speed up» | After the first login the automation keeps its own profile, so later runs start logged in | Restarted runs reuse `~/.hh-automation/chrome-profile` and stay logged in | ✅ | `getUserDataDir()` in `src/config.mjs`; 101b754 |
| LOGIN6 | «we need to click on accept cookies when shown» | The cookies banner (and the salary popup) is closed when shown | «🍪 Accepted the cookies policy banner» | ✅ | `dismissOverlays()` in `src/helpers/page-helpers.mjs`; 101b754 |
| LOGIN7 | «to login to linkedin, we should use already active sessions from other browsers, and if there a login + passpords we do prefill of them.» | `bun run linkedin-login` lists installed browsers holding linkedin.com cookies (counts only), copies the one with the most into the LinkedIn slot (port 9350), checks the feed, and falls back to a visible login page that waits for the user to log in manually; the session is kept in the slot profile for later runs; no password is ever read, typed or stored | `! bun run linkedin-login` (in Claude Code) | ✅ live 2026-10-11: `bun run linkedin-login` copied the Chrome (Default) LinkedIn session (14 cookies, values not shown) into the LinkedIn slot; Safari needs Full Disk Access for the terminal | 7c1289b |
| LOGIN8 | «browser-commander must fully support import of data from all possible real browsers.» | Every data class (cookies, passwords, storage, autofill, …) from every installed browser (Chromium family, Firefox forks, Safari) can be imported | browser-commander #114, #117–#120, #126 (all closed by 0.28.0); `readBrowserCookies` used in `src/linkedin-login.mjs` | 🧪 | browser-commander 0.28.0; import issues #114 (parent), #117 (Safari), #118 (Firefox/WebKit import), #119 (storage/autofill), #120 (diagnostics matrix), #126 (launch Safari still import-only) all closed; not run live against every browser |

## RUN: the application run

| ID | User's words | Requirement | Check | Status | Evidence |
|---|---|---|---|---|---|
| RUN1 | «start make applications to suggested vacancies … All logic must be automated» · «So you can do the default logic.» | With no URL given, the run applies to hh.ru's suggested vacancies of the chosen resume, unattended | `bun run apply` with no `--url` opens `/search/vacancy?resume=<hash>` | ✅ | `findSuggestedVacanciesUrl()` in `src/resumes.mjs`; `url` default `''`; 101b754 |
| RUN2 | «for the most recently updated CV» · «for the most recent resume/cv» | The resume chosen is the one updated last | Two resumes with different update dates: the newer is used | 🧪 | The resumes page shows no date, but it embeds hh.ru's state (`<template class="ResumeProfileFront-InitialState">`: `applicantResumes[]._attributes.updated` per hash, and `latestResumeHash`), found in a saved page of `logs/traces`. `pickResume()` takes the latest `updated` (else a visible «Обновлено …» text, then `latestResumeHash`, then hh.ru's order) and logs which resume and why; no extra request on the resumes page. A kept-open browser already on a search page fetches `/applicant/resumes` once from inside the page and switches the `resume` parameter, filters kept (`latestResumeSearchUrl`). Russian dates: сегодня/вчера, «7 октября 2026 в 14:28», 07.10.2026, «5 минут назад». On the saved real page it picks hh.ru's own `latestResumeHash`. Not run live yet. `src/resumes.mjs`, `tests/resumes.test.mjs` |
| RUN3 | «И проверяй на ошибки и возврат к списку вакансий в поиске после успешного отклика. … сейчас тут застряли.» | After a sent application the run returns to the search list right away (no 36 s wait for the vacancy page) | Log: sent → list within seconds | ✅ | 86e3b0a; browser-commander #143, #144 |
| RUN4 | «Chat is not closed after we send first message there.» | The employer chat panel that hh.ru opens after an application is closed | «💬 Closed the chat panel» (live, run 13) | ✅ | a389a53 |
| RUN5 | «we have multiple critical bugs here.» (two popups were sent unconfirmed while a captcha was shown) | An application hh.ru does not confirm as sent stops the run (unattended) or waits for the user; it never moves on to the next vacancy — on the popup and on the full form | «hh.ru did not mark vacancy … as responded» → wait (popup, live); full form: `tests/application-flows.test.mjs` («an application hh.ru does not confirm goes to the stop-or-wait of the popup») | 🧪 | a389a53 (popup, live); this commit: the full form only printed «Submission was not confirmed» and returned, now it calls the popup's `applicationNotConfirmed` (`src/orchestrator.mjs`), which stops the main loop unattended; full form not seen live yet |
| RUN6 | «новые интервалы делаем по умолчанию, чтобы пользователи наши не страдали, и все настройки, чтобы минимум настроек и оно всё само шло - делаем по умолчанию» | The settings proven in the session are the defaults; `bun run apply` needs no option except the cover letter choice (RUN7) | Option defaults in `src/config.mjs` and `.lenv.example` | ✅ | cfd842e, cfc8e55, e1d615b, 61901a1 |
| RUN7 | «кроме сопроводительного письма - его только по выбору, но сейчас тестируем с этим что уже проверили - моим.» | The cover letter is always an explicit choice: the run does not start without `--message` / `--message-file`; `data/cover-letter.txt` holds the user's letter | A run without `--message`/`--message-file` stops with «Choose a cover letter…» | ✅ | cfd842e; `data/cover-letter.txt` |
| RUN8 | «Continue 1 by 1.» · «we stop only if input from me is required, and we have no known answer» | The run handles one vacancy at a time and stops only when it needs the user | Continuous run log | ✅ | 37e4055, 6ec31d8 |
| RUN9 | «Is it working? Do we do applications?» · «We need to fix everything if we stuck.» | A stuck run is a bug: its cause is found and fixed in the code, not only restarted | Each stall has a fix commit | ✅ | 86e3b0a (vacancy page idle), 965531d (popup → full form), 61901a1 (background tab), 36f8af7 (hidden notice) |

## PACE: pacing and load on hh.ru

| ID | User's words | Requirement | Check | Status | Evidence |
|---|---|---|---|---|---|
| PACE1 | «please try to make at least 1-2 minutes intervals between pages changes» | At least 1–2 minutes between page changes | — | ↪ PACE3 | 101b754 (60–120 s), later 180 s (cfd842e), then 240 s |
| PACE2 | «We also need to reduce load on hh.ru, so it is better to have persistent instance of hh.ru browser.» · «As we can reuse the same page multiple times.» | One persistent browser and one page are reused, so hh.ru sees no new logins or page sets | `♻️ Reusing the running browser on port 9322` | ✅ | `connectOrLaunchBrowser()` in `src/browser-session.mjs`; 101b754 |
| PACE3 | «Давай увеличим паузу в 4 минуты или сколько там было, в общем больше 3-х минут … Но нужно рассчитать все паузы так, чтобы точно хватило на 200 откликов в день.» | The pause after every opened vacancy is over 3 minutes (240 s + up to a quarter) and the pace still fits 200 applications a day | `tests/pacing.test.mjs` («is longer than 3 minutes by default», «the default pace fits hh.ru's 200»); live log «next vacancy in … seconds» | ✅ | cfc8e55; `src/pacing.mjs` |
| PACE4 | «То есть равномерное увелечение интервала лучше чем увеличение интервала в момент капчи.» · «`Call listener each time a captcha has been solved…` это плохая идея.» | The pause is the same after every vacancy; no extra pause or listener on a solved captcha | No `onCaptchaSolved` in `src/` | ✅ | cfc8e55 |
| PACE5 | «I asked you to not do to much requests and use single browser instance» | Minimal requests to hh.ru; one browser instance does the applications; side tools never hit hh.ru in parallel loops | Pause after every opened vacancy, not only sent ones; filters checked before a click | ✅ | a389a53, 4167d35; `answer-chats --watch` checks the chat list every 5 minutes (was 1) |
| PACE6 | «We should never more than 1 tab per browser instance by default.» | The automation browser keeps exactly one tab (`--single-tab`, default on): others are closed on attach and as they appear | `tests/browser-tabs.test.mjs`; live: run 21 closed the extra tab | ✅ | 61901a1; this commit: the engine attaches to the kept tab by `targetId` (browser-commander 0.28.0, #145 closed), which also closes a tab opened in between (`singleTab`); choosing the tab and closing later tabs stay local |

## BRW: browser, tabs and session

| ID | User's words | Requirement | Check | Status | Evidence |
|---|---|---|---|---|---|
| BRW1 | «even better to have an ability for browser commander to have persistent browser instance, so it can be reused even between restarts of the scripts or our processes» | The browser runs detached on a fixed port (9322) and later runs attach to it | Restart a run: it reuses the browser and stays logged in; this commit: own headless Chrome on port 9397 reused after the process exited | ✅ | `src/browser-session.mjs`; 101b754. browser-commander 0.28.0 has `connectOrLaunch()` (#140 closed), not used yet: #149 (EPERM under Bun on macOS), #150 (stale remembered `targetId` throws and leaks the connection), #151 (refuses a browser started by earlier versions, idle counts navigations only) all open |
| BRW2 | «By default it is good to kill browser instance, but we must have an option to keep it open, may be with timeout of 30 minutes, so we don't reopen it if it was open less than 30 minutes ago and also it should close automatically if unused for 30 minutes.» | Default: the browser closes on exit. `--keep-browser-open`: it stays, is reused, and a watchdog closes it after `--browser-idle-timeout` (30) unused minutes | Default run closes Chrome; kept-open Chrome closes after 30 idle minutes (seen live on 10-10); this commit: own headless Chrome kept open after exit and closed by the watchdog after a 6-second idle timeout | ✅ | `src/browser-watchdog.mjs`; 101b754. The watchdog of browser-commander 0.28.0 `connectOrLaunch` closed an idle browser under Bun too, but it counts only navigations as use (#151 open; BRW1 for why it is not used) |
| BRW3 | «I see we have a bug, by default browser commander should not show [the] panels» · «So all these bugs must be fixed first.» | Chrome's «Continue where you left off» infobar does not appear | Window capture after start; `tests/browser-tabs.test.mjs` («one --disable-features switch hides the restore infobar and Translate») | ✅ | 6114822; this commit: browser-commander 0.28.0 `no-crash-restore` disables `SessionRestoreInfobar` and merges `--disable-features` itself (#141 closed), the local merge is gone |
| BRW4 | «another bug - page translation is active it distracts from the viewing the page, but default in browser commander it should not pop up» | The Translate bubble never appears | Window capture on a Russian page; `tests/browser-tabs.test.mjs` («the profile turns Translate off») | ✅ | 6114822; this commit: `translate.enabled: false` now comes from browser-commander 0.28.0's `no-translate` preferences (#141 closed) |
| BRW5 | «there must be no visible outlines on buttons or vacancies block. It is critical to be able to record animations and get nice screenshots.» | Nothing is drawn on the page (no outlines, highlights, overlays); targets are only scrolled into view; marks are data attributes | Screenshots during a confirmed step | ✅ | 80b45b1 |
| BRW6 | «So the visual appearence is perfect for viewer of the browser.» | The visible browser looks clean for a viewer: no infobars, bubbles, placeholders or markers | BRW3–BRW5; no `bringToFront` (it left the omnibox placeholder) | ✅ | 6114822, 80b45b1 |
| BRW7 | «please don't kill this browser instance and use another one, as I already selected alot of pending answers» | Side tools (resume export, form slots, chat slot) never close or navigate the automation browser on port 9322; they use their own browser | `bun run resume` while a form waits: the form is untouched | ✅ | df08e17 (`src/resume-export.mjs`), ec11d6e (`src/prefill-form.mjs`) |

## TRACE: recording and debugging

| ID | User's words | Requirement | Check | Status | Evidence |
|---|---|---|---|---|---|
| TRACE1 | «Latest version of browser commander should provide full links notation recording of dom + changes to it, we must use it, if something is missing report.» | Every run records a browser-commander trace with Links Notation export, including DOM and its changes | `logs/traces/<time>/trace.lino`, `dom.lino` | 🧪 | browser-commander 0.28.0 adds `links: { dom: 'full' \| 'text' }`, but it is not used: `redactPatterns` are not applied to checkpoint HTML or mutation batches (embedded `csrf-token`/`xsrfToken` values leaked in a local test; #153 open), snapshots are uncapped, and every 500 ms drain re-reads the whole bundle. `dom.lino` stays: a `(snapshot: …)` of the DOM after every load (`page.content()`, read-only) and every bundle mutation batch as `(mutations: …)`, hidden/password values and tokens redacted, capped (4 MB per snapshot, 16 MB per interval) with truncation markers. 0.28.0 appends the current interval to its mutation file every 500 ms, so `dom.lino` now converts a file only once the next one exists (all at stop): 95/95 ticker mutations of a local test page in `dom.lino`. Trusted Types fixed upstream (shadow roots copied with `appendChild`), so `openShadowRoots: false` is gone. The bundle cap stays at 1 GB: #148 is open (rotation in 0.28.0 deletes old segments and drops oversized writes; `target.html` is still repeated in every record; #154 open). `src/trace-dom.mjs`, `src/tracing.mjs`, `tests/trace-dom.test.mjs` upstream: #140 (closed), #148, #153, #154 (open) |
| TRACE2 | «Check DOM, we also may need requests and responses recording by browser commander, there might be some way to find the data.» | Requests and responses (document/xhr/fetch) are recorded with the trace | `logs/traces/<time>/network.lino` | 🧪 | browser-commander 0.28.0 records requests and responses (`network: { bodies, har }`), but it is not used: it redacts only cookie/authorization headers, a few header names and query parameters, no form/JSON/multipart fields by name, and stores response bodies base64 so patterns cannot redact them (password, `_xsrf`, `?xsrf=`, `X-Xsrftoken` and hidden-input tokens leaked in a local test; #152 open). `network.lino` stays: per exchange method, status, type, URL (token query parameters redacted), request and response headers (Cookie, Set-Cookie, Authorization, `X-*token*`, CSRF/XSRF values redacted, names kept), request body (password/xsrf/token fields redacted by name in form, JSON and multipart bodies) and response body (HTML hidden inputs and embedded tokens redacted), text capped at 256 KB with `(…Truncated: (bytes) (kept))`, binary bodies skipped with their size. `src/trace-network.mjs`, `src/trace-redaction.mjs`, `tests/trace-network.test.mjs` upstream: #140 (closed), #152 (open) |
| TRACE3 | «So browser commander provides all the best tools for debug out of the box.» | Debugging tools (trace, network, console) come from browser-commander, not from local code | `trace.lino` timeline | 🧪 | Console messages, page errors, failed requests, dialogs, navigations and interactions come from browser-commander's trace (all event sources kept), written to `trace.lino`. Network headers/bodies and DOM as links stay local (TRACE1, TRACE2): 0.28.0 has both, but with weaker redaction (#152, #153 open). `tests/trace-dom.test.mjs` (event sources; library network/DOM links/rotation/gzip left off) upstream: #140 (closed), #148, #152, #153, #154 (open) |
| TRACE4 | «Also double check browser-commander have all the tools for gif and video generation in multiple formats, and also easy and unified API for getting screenshots and so on for all supported engines and languages.» | Survey browser-commander's screenshot / video / GIF / trace-render APIs in all engines and languages, and report the gaps | 0.28.0: `commander.screenshot()`, `commander.startRecording()`, `encodeAnimation()` (GIF/APNG/WebP), `encodeVideo()`, `renderTraceViewer()` are exported; `renderTrace`/`summarizeTrace` only through the CLI (`trace render`, `trace summarize`), not exported from the package | ✅ | browser-commander #142 (closed by 0.28.0); export gap filed as #158 (open) |

## CONF: test mode, confirmations and auto-send

| ID | User's words | Requirement | Check | Status | Evidence |
|---|---|---|---|---|---|
| CONF1 | «Now can you in test mode do single application from recomendation for the most recent resume/cv? But do it slowly, so I can confirm each entered value is correct.» | `--test-mode`: one application, each entered value confirmed on stdin (`y` / `q`) | Two test applications sent live (137609108, 138053587) | ✅ | 6114822, 37e4055; `src/confirmations.mjs`; `tests/confirmations.test.mjs` |
| CONF2 | «I want the click to be done already it should not have any confirmation it is not an input field.» | Button clicks are never confirmed; only values typed or chosen in form fields | Test mode clicks «Откликнуться» right away | ✅ | 0938fe4 |
| CONF3 | «so I can confirm each entered value is correct» · «I see nothing prefilled in the browser.» | The form is shown filled in, and the run waits before the click that sends it | Test mode stops before «Откликнуться» on a filled form | ✅ | 242e919 |
| CONF4 | «here y, and no more confirmations for this place.» | The short popup form runs without confirmations | `--test-mode` = `--max-applications 1 --confirm answers,send`, no `popup` | ✅ | 37e4055 |
| CONF5 | «And never again skip anything, instead just wait for me to deside what to write.» | A question without a saved answer never makes the run skip the vacancy by default; the run lists it and waits for the user (`--on-missing-answers wait`), on the full form and on the popup | Missing answer → «❓ Answer the open question(s)…»; unattended popup waits in the browser: `tests/popup-application.test.mjs` | 🧪 | 37e4055 (full form, live); this commit: the popup deferred instead of waiting when unattended, now it honours `--on-missing-answers` and waits for the user in the browser |
| CONF6 | «Make sure for all our usecases we used at the moment our tools have all configuration options - where to pause, what to auto confirm and so on, what do not.» | Every pause and auto-confirm is an option: `--confirm answers,cover-letter,send,popup` or `none`, `--on-missing-answers`, `--max-applications`, `--auto-send-exact-answers`, `--captcha-auto-send`, `--captcha-prefill`, `--single-tab`, `--skip-question` | README «Test Mode and Confirmations» table; `bun src/apply.mjs --help` | ✅ | 37e4055, e1d615b, 61901a1, 1e02ee8 |
| CONF7 | «Forms with questions only with my confirmation» | Forms with questions are sent only after the user's `y` (`--confirm send` default) | — | ↪ CONF8 | cfd842e |
| CONF8 | «Set by default, that we auto fill the vacancy form with questions and auto submit it only if all questions match exactly, overwise autofill and wait» | A form is sent without asking only when every question is a saved question word for word and its field holds exactly the saved answer (saved before the form was opened); any other form is autofilled and waits, in every `--confirm` mode and on the popup as on the full form (= [A2, A3](forms-and-chats.md#a-hhru-application-forms)); only the explicit `--auto-submit-vacancy-response-form` sends such a form unattended | Live: forms sent «without asking»; a changed answer makes it ask; `tests/exact-answers.test.mjs`, `tests/confirmations.test.mjs` («decideSend»), `tests/popup-application.test.mjs`, `tests/application-flows.test.mjs` | 🧪 | e1d615b (full form, live); this commit: one rule `decideSend` for popup and full form — `--confirm none` sent popups with questions unchecked, `--confirm answers` sent non-exact full forms without asking, and the periodic auto-save could turn a similar question's autofilled answer into an «exact» one before the check; the popup now autofills and saves answers like the full form (A1, A5) |
| CONF9 | «We only auto-submit on exact symbol by symbol match, but prefill should use similarity search.» | Prefill uses similarity (fuzzy) matching, without mixing subjects (= [A1, A4](forms-and-chats.md#a-hhru-application-forms)) | Live: Project Manager form prefilled by similarity (0.69 / 0.55); `tests/fuzzy-matching.test.mjs` | ✅ | baade6b, efe3a38, f5b1de8 |
| CONF10 | Derived from «Forms with questions only with my confirmation» (a stale «y» nearly confirmed an unseen form) | A form the user sends in the browser counts as sent; the waiting prompt is withdrawn, and a `y` typed before a prompt was shown is ignored | `tests/confirmations.test.mjs` («answers typed for a withdrawn prompt … do not confirm the next prompt») | 🧪 | 6ec31d8, 5c77637, 70e0acd |
| CONF11 | «All errors and warnings must be fixed.» (run 19 ended with a TimeoutError) | When hh.ru switches from the popup to the full form, the popup steps stop and the full-form handler takes over | Live: vacancy 138276367; `tests/popup-full-form-switch.test.mjs` | ✅ | 965531d |
| CONF12 | «we need to add language detection, and post the same [cover letter] but in english when question are clearly in English» | The English cover letter (`data/cover-letter.en.txt` next to the chosen one, or `--message-file-en`) is typed when the vacancy's questions are clearly English (≥90% Latin letters), in the popup and the full form | `src/cover-letter.mjs`; `tests/cover-letter.test.mjs`; live: the Go Team Lead form 137908044 got the English letter | 🧪 | 74d45f6 |

## QA: answers

| ID | User's words | Requirement | Check | Status | Evidence |
|---|---|---|---|---|---|
| QA1 | «We didn't have presaved answers to such questions in .lino file?» · «make sure they will be saved to .lino file» | Answers the user types in hh.ru forms are saved to `data/qa.lino`, once per change (= [A5](forms-and-chats.md#a-hhru-application-forms)) | One «Saved Q&A» per edited question; `tests/qa-autosave.test.mjs` | ✅ | aecb40b, 43bbe50 |
| QA2 | «Update 400000 to 450000 rubles and 6000 dollars in all places in lino files.» · «In all cases 450000 на руки, and 6000 на руки.» | Every plain or net salary answer is «От 450000 рублей в месяц на руки» / $6000 net | `grep -c 400000 data/qa.lino` = 0 | ✅ | 1cdad7e |
| QA3 | «Be careful with questions, that explicitly ask not на руки, but something else there it should be higher ammount.» | Questions about gross / до вычета НДФЛ or office pay get higher amounts (550000 ₽ gross, $8500 / $11000 gross, 850000 ₽ office) | Gross questions in `data/qa.lino` | ✅ | 991624f |
| QA4 | «please prefill me best answers you can up with, so I can see how it will look, and make sure they will be saved to .lino file» (AI-impact questions) | Good answers to the AI questions (measuring AI's effect, where AI helps) are drafted from the user's view, prefilled, and saved | The two answers in `data/qa.lino`; sent live with 137609108 | ✅ | 1cdad7e |
| QA5 | «Also I use not only Anthropic Claude Code, but also OpenAI Codex CLI» | AI-tool answers name OpenAI Codex CLI next to Claude Code | `grep -c Codex data/qa.lino` | ✅ | 0e7d28c |
| QA6 | «Double check q and a for these.» | Every edit of `qa.lino` keeps it parseable and the answers intact (validate the pair count before committing) | All pairs load (949 then; 1000+ now) | ✅ | 79bca5d (fixed the unparseable 0e7d28c) |
| QA7 | «remove deep-assistant link from the links across the repository.» | No deep-assistant link anywhere in the repository | `git grep -i deep-assistant -- src data tests` is empty (this index quotes it) | ✅ | 00fb880 |
| QA8 | «Не сейчас, а на последнем месте работы там был PostgreSQL, PHP Symphony, Go и т.п. Дополняй ответ и дай посмотреть.» · «Redis, RabbitMQ, Docker или ClickHouse именно ни все.» | The stack answer names the last job's stack (PHP Symfony, Go, PostgreSQL, ClickHouse, Redis, RabbitMQ, Docker) and is shown to the user before use | «на каком стеке вы разрабатываете?» in `data/qa.lino` | ✅ | 3a630bd |
| QA9 | «replace all such answers to Нячанг, Вьетнам и там где нужно указать часовой пояс укажи его.» | Every location answer says Нячанг, Вьетнам, with the time zone (UTC+7, +4 to Moscow) where asked | `grep -c Гоа data/qa.lino` = 0 | ✅ | 39d71ea |
| QA10 | «На основе моего резюме и моих прошлых ответов помоги разработать качественный ответ на этот вопрос "Какой портфель автоматизаций и AI-продуктов вам удалось реализовать? Как считали эффекты для бизнеса?"» | A draft answer from the resume and saved answers, with an effect methodology and no invented numbers | Case study draft | ✅ | 1e02ee8; [case study](../case-studies/hard-question-ai-portfolio/case-study.md) |
| QA11 | «we have linked in at `https://www.linkedin.com/in/konard` save it is as contact so we can paste a templated insert if contacts changes.» | Contacts live in `data/contacts.lino`; answers use placeholders (= [B4a](forms-and-chats.md#b-external-forms-google-forms-yandex-forms-a-companys-own-job-form)) | `tests/contacts.test.mjs` | ✅ `bun run contacts-migrate` ran on 2026-10-10: 29 answers and the cover letter use {{telegram}}/{{phone}}; every reader fills them in | ec58db0 |
| QA12 | «Проверяй сохранились ли ответы и коммить и пуш всё что не закоммитили и не запушили.» · «qa.lino was not committed? Why?» | Answers the user saves during a run are checked and committed and pushed promptly | `git status data/qa.lino` clean after each run | ✅ | the «Save answers on …» commits (3a630bd … 28e6223) |

## CAP: captcha

| ID | User's words | Requirement | Check | Status | Evidence |
|---|---|---|---|---|---|
| CAP1 | «Captcha is not detected it can lead to account block. … If captcha is detected only I manually can solve it, and our system must touch nothing and wait for me to solve it.» | While hh.ru shows a captcha, no click, typing, navigation or page script touches the page; the run waits until the user has solved it (except CAP7, CAP9) | Live: waits of 15 s … 7.5 h; `tests/captcha.test.mjs` | ✅ | a389a53, 5c77637; the side slots on hh.ru wait too: chat slot (`answer-chats`), form slots (`waitForCaptcha`), experience slot (`prefillHhExperience`) |
| CAP2 | «Also use https://github.com/link-assistant/image-to-number as an example to prefill the captcha using local claude + haiku 5.5 and codex + luna 6.1» | Local Claude Code (`claude-haiku-5-5`) and Codex (Luna) read the captcha picture, the image-to-number way, and the guess is typed into the field | Live: «вышивки жребием», «ежили проклейте\|Не проклейте» | ✅ | bbe578d, 30a51b0, 1d2bbdb; `src/captcha-solver.mjs` |
| CAP3 | «Captcha should not be submitted, but prefilled, so it will be easy for me to check and verify or fix as needed.» | The captcha is prefilled, never sent | — | ↪ CAP9 | bbe578d |
| CAP4 | «If luna and haiku disagre we prefill both captchas with \| separator» | Same guess → one answer; different → `haiku\|luna` | `tests/captcha-solver.test.mjs` (combineAnswers); live | ✅ | bbe578d |
| CAP5 | «`There's no 6.1 Luna in Codex's catalog for this account;` that must be absolutely wrong.» · «Use gpt-6-lune» · «Latest luna use.» | The newest `gpt-*-luna` in the account's Codex model catalog is used (fallback `gpt-6-luna`) | `codex debug models` → newest luna slug | ✅ | `resolveLunaModel()` in `src/captcha-solver.mjs`; bbe578d |
| CAP6 | «why prefill of captcha didn't work?» · «Make sure next time captcha will be shown the prefill wil work» | The picture is read after it has loaded (found by `data-qa`), up to three times; two-word answers accepted | Live prefill on the next captchas; replay of the recorded captcha | ✅ | 30a51b0, 1d2bbdb |
| CAP7 | «I hope you don't give a full screenshot to get prefill from models? And you actually give small source image?» | Only the captcha picture, in its original size (250×90, copied through a canvas, no new request), goes to the models; never the page or the screen | Image in `logs/captcha/` is 250×90 | ✅ | f7f8ee8 |
| CAP8 | «We use low thining at both luna nad haiku?» · «Set both to low by default, and we will see how these will perform.» | Both readers run at low reasoning effort regardless of the user's CLI settings | `READER_EFFORT = 'low'`; `claude --effort low`, `codex -c model_reasoning_effort=low` | ✅ | 88f6a74 |
| CAP9 | «for captcha we try to submit haiku version once, if works - ok, if not - wait for me, so there is less cases which need me» | On a captcha's first picture only Haiku's reading is typed and sent once (`--captcha-auto-send`, default on); after a new picture the guess is only prefilled and the run waits (= [A6](forms-and-chats.md#a-hhru-application-forms)) | Live: 1 accepted, 2 not accepted then prefilled | ✅ | e1d615b |

## FLT: filtering and deferring vacancies

| ID | User's words | Requirement | Check | Status | Evidence |
|---|---|---|---|---|---|
| FLT1 | «We have a hard question of `Какой портфель автоматизаций…`, do case staty about it in the repository» | A case study of the hard question in the repository | File exists | ✅ | 1e02ee8; [docs/case-studies/hard-question-ai-portfolio/case-study.md](../case-studies/hard-question-ai-portfolio/case-study.md) |
| FLT2 | «make ability to temporary skip vacancies by question, so we can will answer for that later. Also for skipped vacancies questions we should have .lino file.» | `s` at an open-questions prompt skips the vacancy for now and keeps its ID under each open question in `data/deferred-questions.lino`; matching forms are skipped until the answer is in `qa.lino`; applied vacancies are removed | `tests/deferred-questions.test.mjs`; `data/deferred-questions.lino` holds 137956393 | 🧪? | 1e02ee8; not seen exercised by `s` in a live run log |
| FLT3 | «And also ability to provide single or multiple of them in CLI options» | `--skip-question "<text>"`, repeatable or several values, or `SKIP_QUESTIONS` with `\|` | `tests/deferred-questions.test.mjs` («a --skip-question skips a form whether answered or not») | 🧪 | 1e02ee8 |
| FLT4 | «that is clearly not programming, and looks like physical presence only vacancy, we need to use such questions and vacancy description to be filtered out automatically with database of automatic filtering.» | Rules in `data/vacancy-filters.lino` (`vacancy`, `question`, `page`) skip such vacancies without asking: the card before the click, then questions and form text; each is logged and kept in `data/filtered-vacancies.lino` (= [A7](forms-and-chats.md#a-hhru-application-forms)) | `tests/vacancy-filters.test.mjs`; log «🚫 … filtered out» | 🧪 | 4167d35, 3f3c612, 6741030 |
| FLT5 | (same message) «looks like physical presence only vacancy» | Vacancies that need physical presence (on-site manual or field work) and are clearly not programming are filtered too, using the vacancy description; office or hybrid software jobs are never filtered | `on-site` rules in `data/vacancy-filters.lino`, guarded by `programming` and `remote` fragments of the card or description; the description is read with one same-origin request for the vacancy page only when the card does not settle it, paced like an opened vacancy; `tests/vacancy-filters.test.mjs` (Moscow office Go developer passes; installer, field engineer, warehouse, production filtered), `tests/application-flows.test.mjs` (one request for a vague card, none for a Go developer card) | 🧪 | this commit; not run live: the vacancy page selectors (`vacancy-description`, `work-format`) are not checked against hh.ru yet, and a missing description falls back to the card |
| FLT6 | «[Image] check all these questions, logs and so on.» · «why it stuck now?» | hh.ru's «поменяйте видимость резюме» notice counts only when rendered; then the run asks or `s` skips (= [A8](forms-and-chats.md#a-hhru-application-forms)) | Live popup: no prompt; `tests/resume-visibility.test.mjs` | ✅ | badfa31, 36f8af7 |

## RES: resume export and stack

| ID | User's words | Requirement | Check | Status | Evidence |
|---|---|---|---|---|---|
| RES1 | «We need to have a tool to download my CV as PDF, convert it markdown and so on from the DOM of hh.ru» | `bun run resume` downloads the resume as PDF / RTF / HTML and converts it to Markdown, text and JSON in the gitignored `data/resume/` | Run it: files appear | ✅ | df08e17; `src/resume-export.mjs` |
| RES2 | «make a script to read my CV, resume, and collect all stack I worked with» · «Collect all tech stacks I worked on based on my CV.» | `stack.md`: every technology once, key skills, «Технические навыки» categories, and per job the listed and mentioned technologies | `tests/resume-stack.test.mjs`; live export | ✅ | df08e17; `src/resume-stack.mjs` |
| RES3 | «please don't kill this browser instance and use another one» | The export runs in its own headless Chrome and copies the hh.ru login in memory from the 9322 browser (= BRW7) | A waiting form stays untouched | ✅ | df08e17 |

## FORM: external forms

From the user: «We need to add automation to fill [the employer's Google Form] based on already answered
questions, and also ability to fill form at https://practicum.yandex.ru/job/vacancy-364 to make direct
application, do the best, so we can have everything prefilled, so in separate slots for browsers I will
able to review everything and submit or change.» · «add another form that needs to be supported. We
should make form filling as unversal as possible so all duplicate code is reused.» · «add form prefilling
support if not yet supported.» (the «Анкета для С++ Developer» form, https://forms.gle/NTRexHv7bxQQxnKZA,
the same form as slot 3).

The details and checks are in [forms-and-chats.md, section B](forms-and-chats.md#b-external-forms-google-forms-yandex-forms-a-companys-own-job-form).

| ID | Requirement | Status |
|---|---|---|
| B1 | One command prefills any number of forms: `bun run prefill-form -- <url> [<url> ...]` | ✅ |
| B2 | Each form in its own browser slot (own Chrome, profile, port), apart from the hh.ru browser; stays open for review | ✅ |
| B3 | Nothing is ever submitted | ✅ |
| B4 | Contacts from the exported resume (not committed) and `data/profile.lino` | ✅ |
| B4a | Contacts in `data/contacts.lino` as placeholders (LinkedIn) | ✅ `bun run contacts-migrate` ran on 2026-10-10: 29 answers and the cover letter use {{telegram}}/{{phone}}; every reader fills them in |
| B5 | Link questions get the links they ask for | ✅ |
| B6 | Saved answers from qa.lino by the same similarity and option matching as hh.ru forms | ✅ |
| B7 | Open questions drafted by local Claude Code with «[уточнить: …]» marks; a choice gets one of its options | ✅ |
| B8 | A resume file field gets `data/resume/resume.pdf` | 🧪 |
| B9 | A site captcha (Yandex SmartCaptcha) is left to the user; the slot waits up to 30 minutes | 🧪 |
| B10 | Forms inside an iframe (Yandex Forms on practicum.yandex.ru) | 🧪 |
| B11 | Multi-page forms: current page filled, report says to open the next page | 🧪 |
| B12 | Report of every question and its source in `logs/forms/` | ✅ |
| B13 | One implementation for every form, shared with hh.ru forms | ✅ |
| B14 | Answers the user finally sends in an external form are saved to qa.lino (detached watcher per slot, only on a real submission, contacts as placeholders; `--no-learn`) | 🧪 `tests/form-answers.test.mjs`; local forms in an own headless Chromium |
| B15 | Drafts in forms are plain text, without Markdown | 🧪 |
| B16 | A form's test assignment becomes a repository (given name) with an issue restated in English, without the employer, via gh | ✅ konard/marketplace-retail-ai-control #1 |
| B17 | The completed-assignment link question gets the repository link | 🧪 |
| B18 | A form with a test assignment is not answered until the assignment's repository exists | 🧪 |
| B19 | The assignment's repository starts from the hive-mind CI/CD template of the vacancy's language (or the most fitting one); the issue asks for the most fitting stack | ✅ konard/marketplace-retail-ai-control (Python template, issue #1) |
| B20 | A form sent in a chat remembers the chat's vacancy for its assignment | 🧪 |
| B21 | Templates are read from hive-mind's CI/CD guide; a new assignment repository always starts from the template, never empty | ✅ |
| B22 | A written (no-code) assignment asks for a document in the assignment's language, not code | ✅ konard/marketplace-retail-ai-control #1 |
| B23 | Answers changed in a prefilled form are saved to qa.lino a minute after the last change, before the form is sent | 🧪 |
| B24 | A sent form is recognized in any language: the /formResponse page, Vietnamese confirmation and send button | 🧪 |
| B25 | A city question asking for the time zone gets «Нячанг, Вьетнам, UTC+7, МСК+4» from the profile | 🧪 |
| B26 | Pay answers follow the form's vacancy: below the target, the top of its range as the minimum plus the comfortable hourly rate; not learned | 🧪 |
| B27 | A pay stated in the form's own description comes first as the minimum (converted to the asked unit), plus the comfortable rate; one or two short sentences | 🧪 |

Evidence: ec11d6e, ec58db0; `src/prefill-form.mjs`, `src/form-prefill.mjs`, `src/contacts.mjs`;
`tests/form-prefill.test.mjs`, `tests/contacts.test.mjs`.

## CHAT: hh.ru chats

From the user: «we also need to support question answering based on previous answers in chat as
separate slot on separate page like https://hh.ru/chat/5698827730, and also when immediately after the
application chat opens.» · «we also need to support templated answers to templated messages from
multiple companies in the chat like these.» · «we also need to support auto-reading all rejections …
but better only prefill» · «we also need to add support for auto filling answers or rating here» · «if the
answer is the same or similar we can learn updated regex/peg like templates from multiple of them.»

Details and checks: [forms-and-chats.md, section C](forms-and-chats.md#c-hhru-chats).

| ID | Requirement | Status |
|---|---|---|
| C1 | Chats are answered in their own slot (separate browser and page), not in the single-tab automation browser | ✅ |
| C2 | The chat slot copies the automation browser's hh.ru login; cookie values are never printed or stored | ✅ |
| C3 | Unanswered employer / bot messages are answered from qa.lino by similarity, drafts for the rest | ✅ |
| C4 | Template messages from different companies get the saved template reply (`data/chat-templates.lino`) | 🧪 |
| C5 | The answer is typed, not sent | ✅ |
| C6 | Previous chat answers are learned into qa.lino / chat-templates.lino | ✅ |
| C7 | Chats opened right after an application are picked up by a watch mode, one by one; a chat is visited again when its last message changes | 🧪 |
| C8 | hh.ru's suggested quick replies are never clicked | ✅ |
| C9 | Rejections are read; when a reply is possible, the saved question about the reason is typed, not sent | 🧪 |
| C10 | Questionnaire links from chats are prefilled in form slots | 🧪 |
| C11 | hh.ru's employer rating poll from a chat opens prefilled (company) in a form slot; ratings stay the user's | 🧪 |
| C12 | Template messages answered the same way are generalized into learned patterns (`…` gaps, `*` endings) | 🧪 |
| C13 | Messages that need no reply (a bot's summary of answers, `[без ответа]` templates) are only read; summaries are learned | ✅ |
| C14 | `apply.mjs --process-chats` starts `answer-chats.mjs --auto` as a child process alongside the application loop; stopped when apply exits; `--chats-interval-minutes` (default 120) sets the poll interval | ✅ live 2026-10-10: «💬 Chat processor started (checking unread chats every 120 min)», chat slot 9340 reused, applications ran alongside |
| C15 | `--auto` takes unread chats only; handles what needs nothing sent; stops at the first chat that needs a message, with it open and the reply typed, until the user has answered it; nothing is sent by the tool | 🧪 live: stopped at the first chat with the reply typed («💬 Check the typed reply and send it: …»); resuming after the user's answer not yet seen |

## EXP: work experience export, sync and translation

From the user: «We also need to develop ability to export both linked in and hh.ru working experince and
display differences, that needs to be synced. We also need support auto sync with automatic translation
support. Translation should be done using Haiku 5.5 or latest, Luna 6 or latest, and
https://github.com/link-foundation/formal-ai latest version, if Formal AI fails on any translation we must
report it to its repository.»

The detailed requirements are in [experience-sync.md](experience-sync.md) (written separately): `bun run experience -- export|diff|sync`. The Formal AI repository is
link-assistant/formal-ai (link-foundation/formal-ai does not exist).

| ID | Requirement | Check | Status |
|---|---|---|---|
| EXP1 | Export the work experience from hh.ru (the resume export, RES1, is the starting point) | Structured list of jobs from hh.ru | ✅ `bun run experience -- export` reads data/resume/resume.json |
| EXP2 | Export the work experience from LinkedIn (https://www.linkedin.com/in/konard) | Structured list of jobs from LinkedIn | ✅ live 2026-10-11: 10 LinkedIn positions read (from the page text: LinkedIn changed its markup), with their edit links |
| EXP3 | Show the differences between the two | A per-job diff report | 🧪 `experience -- diff`, tests/experience.test.mjs; live: check the report in logs/experience/ |
| EXP4 | Sync the differences (in either direction, after review) | One side updated from the other | 🧪 prefill verified on hh.ru; save path robust (waitFor visible + close), decision logic unit-tested (applySyncDecision, tests/experience.test.mjs); live: `bun run experience -- sync --to hh`, check prefill, type y to save |
| EXP5 | Auto sync with automatic translation (Russian ↔ English) | A Russian hh.ru entry appears translated on LinkedIn and vice versa | 🧪 `experience -- sync --auto` |
| EXP6 | Translation by Haiku 5.5 or later, Luna 6 or later, and the latest Formal AI (link-assistant/formal-ai) | The three translations are produced for each text | ✅ Haiku 5.5, gpt-6-luna and Formal AI 0.352.1 on 19 real texts |
| EXP7 | Any Formal AI translation failure is reported as an issue in link-assistant/formal-ai | An issue per failure | ✅ link-assistant/formal-ai #1192, #1193, comment on #1174; deduplicated on rerun; #1194 (short phrases, 2026-10-10: Formal AI translated 1 of 27 texts, Haiku 26, Luna 27) |
| EXP8 | LinkedIn prefill picks the position's skills from the profile's skills and adds the company website as a media link; nothing is saved without y | Kaiten: iOS, Android; https://kaiten.ru/ «Kaiten.ru» | 🧪 |
| EXP9 | A LinkedIn form saved or closed by the user in the browser is detected (the prompt is withdrawn, «people you may know» skipped); a form where nothing could be filled is closed without a question; skills and media lines are not read as the description | Kaiten saved by you: detected on re-read, only ClickUp left | 🧪 |

## SEC: safety constraints

| ID | Source | Requirement | Status | Evidence |
|---|---|---|---|---|
| SEC1 | «The request for password was 2 times it is unacceptable in real world usage.» | No Keychain or password prompts (= LOGIN3) | ✅ | 101b754 |
| SEC2 | Session constraint (a password option and a plaintext session-cookie file were refused during the session) | Cookie values and passwords are never printed, logged or stored; no password option, no session-cookie file; logins are copied in memory only | ✅ | `src/login.mjs`, `src/resume-export.mjs` (error output sanitized after a Playwright error printed a cookie header) |
| SEC3 | «Captcha is not detected it can lead to account block.» · «I asked you to not do to much requests and use single browser instance, and you failed me» | Nothing may risk the account: captcha guard (CAP1), single instance and tab (PACE5, PACE6), pause after every vacancy (PACE3), stop on unconfirmed applications (RUN5) | ✅ | a389a53, cfc8e55, 61901a1; side slots: `waitForCaptcha` in answer-chats, form-slots, experience-sites |
| SEC4 | «please don't kill this browser instance» | The automation browser on port 9322, with the user's pending answers, is never killed by tools or by the agent (= BRW7) | ✅ | df08e17, ec11d6e |
| SEC5 | «And never again skip anything» | No vacancy is skipped silently: every skip (filter, deferral, unattended skip) is logged and recorded in a `.lino` file with the vacancy ID, title, reason and time; a recorded skip is not retried on the next run unless its reason is transient (retried once) | Filters (`data/filtered-vacancies.lino`, now with title and time), deferrals (`data/deferred-questions.lino`) and every other skip (`data/skipped-vacancies.lino`: external site with the employer's link, hidden resume, popup timeout, button and click failures, response-page timeout, user skips, `--ignore-vacancies-with-questionnaire`, which moved there from `ignored-vacancy-ids.txt`); `bun run skipped` lists them with `bun run prefill-form -- <url>` and clears them; `tests/skipped-vacancies.test.mjs`, `tests/popup-application.test.mjs`, `tests/application-flows.test.mjs` | 🧪 | 37e4055, 1e02ee8, 4167d35, this commit; not seen in a live run yet |
| SEC6 | Session constraint (a full-screen capture exposed another app) | Screenshots for checking are of the Chrome window only, never the full screen | ✅ | process rule; no screen capture in `src/` |
| SEC7 | Session constraint (a stale «y» nearly confirmed an unseen form) | The agent never answers a prompt for the user unless they said so, and only while that prompt is pending | ✅ | 70e0acd guards it in code |
| SEC8 | Session constraint | Personal data (resume export, `data/profile.lino`, form reports, traces) stays out of git | ✅ | `.gitignore` (`data/resume/`, `logs`) |
| SEC9 | Session constraint (model refusals on captcha reading) | Prompts to models are honest about the task; they are not disguised to get around refusals | ✅ | prompt in `src/captcha-solver.mjs` (30a51b0, e1d615b) |

## PROC: how the work is done

| ID | User's words | Requirement | Status | Evidence |
|---|---|---|---|---|
| PROC1 | «Also make sure to commit and push after all changes.» · «Commit and push, so it will be preserved.» · «Коммить и пуш всё» | Every change is committed and pushed to `main` | ✅ ongoing | every commit above is on `main` |
| PROC2 | «All issues reported? Give me links to them.» · «I asked for links.» | Reports give the actual links (issues, commits), not just a claim | ✅ ongoing | [Upstream issues](#upstream-issues) |
| PROC3 | «Double check all we can fully implemented and everything missing is reported.» | Before reporting done, check that everything possible is implemented and the rest is reported upstream | ✅ ongoing | — |
| PROC4 | «Double check logs for all errors, warnings, false positives, false negative, fix them all - commit and push.» · «All errors and warnings must be fixed.» · «продожай мониторинг за ошибками и предупреждениями и оперативно всё исправляй» · «keep monitoring for all errors and fix them if you encounter them» | Runs are monitored; every error, warning, false positive and false negative in the logs is fixed, committed and pushed, and the run restarted | ✅ ongoing | aecb40b, 86e3b0a, 5c77637, 43bbe50 … |
| PROC5 | «Find the root cause in the source code and fix it.» · «I didn't touch anything.» | Fix the root cause in the code, explain it in the commit, not only the symptom | ✅ ongoing | 61901a1, 36f8af7, 43bbe50 |
| PROC6 | «Can we do workaround and continue?» | When blocked upstream, work around it locally and continue the run | ✅ ongoing | DEP4 |
| PROC7 | «Be super careful fix all the bugs first and do it slowly and carefully step by step reverify on each step.» · «давай шаг за шагом очень аккуратно двигаемся к следующему отклику» | Fix bugs before going on; verify each step on the live page before the next | ✅ ongoing | — |
| PROC8 | «Also I don't see why you need to restart it so often, if we can have snapshots and plan and draft all changes in bulk in advance.» | Restart the browser and runs rarely; plan and draft changes in bulk from snapshots and traces | ✅ ongoing | restarts only in pauses between vacancies |
| PROC9 | «`There's no 6.1 Luna in Codex's catalog for this account;` that must be absolutely wrong.» | Report outcomes honestly: state only what was observed, correct wrong claims and misleading commits openly | ✅ ongoing | 0f6c30a (fixes the misleading 8a11b69) |
| PROC10 | «do case staty about it in the repository» | Hard problems get a case study in `docs/case-studies/` | ✅ | FLT1 |
| PROC11 | «Draft exactly all requirements and we will test them as soon as I'm ready.» · «Please double check that all requirements from the conversation are listed in the repository so we fully track their delivery.» | All requirements are listed in the repository with checks and status, and kept up to date | ✅ | this file; [forms-and-chats.md](forms-and-chats.md) |
| PROC12 | «To speed up drafting/development you may use up to 3 subagents of Opus 5.5.» | Up to 3 Opus 5.5 subagents may work in parallel | ✅ ongoing | this list, `experience-sync.md` |
| PROC13 | «Ok, continue monitoring.» · «Ok, continue to monitor.» | Keep watching the run and report when the user is needed | ✅ ongoing | — |
| PROC14 | «Double check that all our requirements are fully done and our scripts machinery answers them all.» | Statuses are audited against the code; overstated ones are corrected | Audit of HEAD 35342c4: RUN6/RUN7 reworded, TRACE2, SEC5, DEP1, QA11, B4a and B15 corrected | ✅ ongoing | this commit |
| PROC15 | «be short and consise if you want anything from me, I cannot read so much text» | When asking the user for input, do only what cannot be done without them first, then ask in one short line; do not print long reports in chat | ✅ ongoing | process constraint; no code required |
| SEC10 | «Yes, it is public.» (the health answer in qa.lino) | The answers in data/qa.lino and contacts in data/contacts.lino are public by the user's decision; the resume export, profile and logs stay out of git | `git check-ignore data/resume logs data/profile.lino` | ✅ | 58a0268 |

## Upstream issues

| Issue | What is missing |
|---|---|
| [browser-commander#136](https://github.com/link-foundation/browser-commander/issues/136) | Missing APIs and packaging issues found while upgrading to 0.26.3 (`onUrlChange` unsubscribe, multi-text `findToggleButton`, first-matching-selector helper, …) |
| [browser-commander#137](https://github.com/link-foundation/browser-commander/issues/137) | Reuse an existing site login without Keychain prompts: snapshot cookie reads, setCookies, session persistence (`resolveDefaultBrowser` null on macOS, …) |
| [browser-commander#140](https://github.com/link-foundation/browser-commander/issues/140) | Trace LN without DOM and mutations, no request/response recording, Trusted Types checkpoint failure, no persistent browser with idle timeout, debug tools out of the box (closed by 0.28.0; Trusted Types fix adopted, DEP4 for the rest) |
| [browser-commander#141](https://github.com/link-foundation/browser-commander/issues/141) | Restore infobar and Translate still shown; protected prefs; `--disable-features` merging (closed by 0.28.0, adopted) |
| [browser-commander#142](https://github.com/link-foundation/browser-commander/issues/142) | No unified screenshot / video / GIF / trace-render API (closed by 0.28.0) |
| [browser-commander#143](https://github.com/link-foundation/browser-commander/issues/143) | Page handlers wait for full network idle; choose when a handler starts (closed by 0.28.0: `readyOn`, `concurrency`; `concurrency: 'skip'` adopted) |
| [browser-commander#144](https://github.com/link-foundation/browser-commander/issues/144) | `clickButton` times out instead of reporting a navigation (closed by 0.28.0: `NavigationInterruptedError`, handled in `isFormLeftDuringWait`) |
| [browser-commander#145](https://github.com/link-foundation/browser-commander/issues/145) | Foreground page pick under Playwright focus emulation (single tab) (closed by 0.28.0: `targetId`, `singleTab`; adopted) |
| [browser-commander#148](https://github.com/link-foundation/browser-commander/issues/148) | Long traces hit `maxBundleBytes` and drop every later checkpoint; mutation records repeat the target's HTML (open; not fixed by 0.28.0's rotation/gzip) |
| [browser-commander#149](https://github.com/link-foundation/browser-commander/issues/149) | `connectOrLaunch` with `userDataDir` throws EPERM under Bun on macOS (`physicalPath` on `~/Library/Safari`) |
| [browser-commander#150](https://github.com/link-foundation/browser-commander/issues/150) | A stale remembered `targetId` makes `connectOrLaunch` throw and leak the CDP connection |
| [browser-commander#151](https://github.com/link-foundation/browser-commander/issues/151) | Kept-open sessions: cannot adopt a running browser, idle counts only navigations, `singleTab` only at attach |
| [browser-commander#152](https://github.com/link-foundation/browser-commander/issues/152) | Trace network leaks secrets: no field-name redaction, response bodies stored base64, narrow header list |
| [browser-commander#153](https://github.com/link-foundation/browser-commander/issues/153) | DOM traces: redaction not applied to checkpoints and mutations; `links.dom` re-reads the whole bundle every drain |
| [browser-commander#154](https://github.com/link-foundation/browser-commander/issues/154) | Trace rotation drops oversized writes and deletes old segments by default |
| [browser-commander#155](https://github.com/link-foundation/browser-commander/issues/155) | `goto` replaced by another navigation throws raw `net::ERR_ABORTED` |
| [browser-commander#156](https://github.com/link-foundation/browser-commander/issues/156) | Trigger `concurrency: 'skip'` (new default) silently changes 0.27 behaviour; DOM-ready starts can be lost |
| [browser-commander#157](https://github.com/link-foundation/browser-commander/issues/157) | Overlay dismissal runs before every interaction and its errors fail that interaction |
| [browser-commander#158](https://github.com/link-foundation/browser-commander/issues/158) | `renderTrace`/`summarizeTrace` not exported; README links docs not shipped in the package |
| [lino-arguments#40](https://github.com/link-foundation/lino-arguments/issues/40) | Update pinned yargs / links-notation and auto-map options to env vars |
| [links-notation#333](https://github.com/link-foundation/links-notation/issues/333) | Public API for indented parent/children documents and minimal-quoting escape |

## Questions and one-off requests

Messages that asked a question or a one-time action rather than a lasting requirement, with what came
of them, so none is lost.

| User's words | Outcome |
|---|---|
| «Did it fully work? Where you been able to login to hh.ru automatically?» | Answered; led to LOGIN4 (VK) |
| «i don't see button click confirmation, fix that.» | Reversed by the user a minute later: «I want the click to be done already…» (CONF2) |
| «Make window focus so I see something.» | Done once; `bringToFront` later removed (BRW6) |
| «No more questions were between button and this page?» | Answered from the trace: none |
| «What happened? Why no сопроводительного письма?» | A default letter was added (b0c8742), later made opt-in by the user's request (RUN7) |
| «Now lest try next one.» · «And go for next application once you are done.» · «y» | Applications sent one by one |
| «[Image] it stuck here again» | Fixed in 86e3b0a (RUN3) |
| «Ввёл капчу, продолжай мониторинг» · «Я уже сделал отклик в открытым окне и ввёл капчу…» | Run continued; manual sends are counted (CONF10) |
| «Что такое "cycle time"?» | Answered; explained in the case study |
| «What happenned? Why no browser?» | Root cause in the agent's own run setup (a pipe holder that expired after 24 h), not in the code; the idle watchdog then closed Chrome as designed (BRW2) |
| «[Image] why it stuck now?» | Fixed in 36f8af7 (FLT6) |
| «Everything that is blocked by my actions - do at the end.» | Scheduling instruction: items waiting on the user (LinkedIn login, live checks) deferred to the end of the session; independent work done first (led to the ordering of the 2026-10-10 subagents) |
| «linkedin must be unblocked - search the ways, i have logged in by other browsers.» | LOGIN7: `bun run linkedin-login` (7c1289b) copies the LinkedIn session of an installed browser into the LinkedIn slot. Running it was blocked by Claude Code's auto-mode classifier (credential exploration) even after the user's permission; it runs once the user leaves auto mode and approves the prompt |
| «[Image] that may be used as default template for rejection.» | The shown rejection message pattern is the default template for asking about rejection reasons (C9); covered by chat-templates.lino |
| «what is going on here?» | Question about a stuck run state; answered inline; no lasting requirement |

## Summary

| Section | Requirements | ✅ | 🧪 | 🚧 | ⬜ | ↪ |
|---|---|---|---|---|---|---|
| DEP | 5 | 5 | | | | |
| LOGIN | 8 | 6 | 2 | | | |
| RUN | 9 | 7 | 2 | | | |
| PACE | 6 | 5 | | | | 1 |
| BRW | 7 | 7 | | | | |
| TRACE | 4 | 1 | 3 | | | |
| CONF | 12 | 7 | 4 | | | 1 |
| QA | 12 | 12 | | | | |
| CAP | 9 | 8 | | | | 1 |
| FLT | 6 | 2 | 4 | | | |
| RES | 3 | 3 | | | | |
| FORM (B) | 28 | 14 | 14 | | | |
| CHAT (C) | 15 | 8 | 7 | | | |
| EXP | 9 | 4 | 5 | | | |
| SEC | 10 | 9 | 1 | | | |
| PROC | 15 | 15 | | | | |
| **Total** | **158** | **113** | **42** | **0** | **0** | **3** |

The hh.ru application forms (A1–A8 in forms-and-chats.md) are counted once, under CONF, QA, CAP and FLT:
A1 and A4 → CONF9, A2 and A3 → CONF8, A5 → QA1, A6 → CAP9, A7 → FLT4, A8 → FLT6. QA11 and B4a are the same
requirement (contacts as placeholders), listed in both places. Section D of forms-and-chats.md (rules for
all of it) is covered by SEC, PACE6 and PROC1.

Open work, in order: live checks of the chat items (C4, C7, C9–C12), LinkedIn login (LOGIN7) and the LinkedIn side of the experience sync (EXP2, EXP4), live checks of
saving sent external-form answers on a real form (B14), the resume choice (RUN2), on-site filtering (FLT5), skip records (SEC5),
the popup's autofill and send rule (CONF5, CONF8, RUN5) and the trace workarounds (TRACE1–TRACE3), and the upstream trace gaps
they work around.
