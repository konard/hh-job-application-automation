# Requirements: work experience of hh.ru and LinkedIn

Export of the work experience of the hh.ru resume and the LinkedIn profile, their differences, and
a sync with translation that prefills the other side for review. Status as of 2026-10-10; each
requirement has the check that shows it works.

Status: ✅ done and verified live · 🧪 done, verified offline only (fixtures, tests) · 🚧 in progress · ⬜ to do

## The user's words

1. «We also need to develop ability to export both linked in and hh.ru working experince and display
   differences, that needs to be synced.»
2. «We also need support auto sync with automatic translation support.»
3. «Translation should be done using Haiku 5.5 or latest, Luna 6 or latest, and
   https://github.com/link-foundation/formal-ai latest version, if Formal AI fails on any
   translation we must report it to its repository.»

Formal AI lives at https://github.com/link-assistant/formal-ai (link-foundation/formal-ai does not
exist); its latest version is 0.352.1 (`cargo +1.98.1 install formal-ai --version 0.352.1`, it
needs rustc 1.98).

## A. Export

| # | Requirement | Check | Status |
|---|---|---|---|
| A1 | `bun run experience -- export` exports both sides into one shape: company, title, location, start/end ("YYYY-MM"), current, description, skills; saved to `data/resume/experience.json` (gitignored) | The file lists both sides' jobs | 🧪 (hh.ru side live; LinkedIn side with a fixture) |
| A2 | hh.ru jobs come from `bun run resume` (`data/resume/resume.json`); it is run only when the file is missing or on `--refresh-hh`; per-job skills are the job's stack and mentioned technologies | 12 hh.ru jobs read from the existing export, periods «Май 2026 — настоящее время» parsed | ✅ |
| A3 | LinkedIn's experience page (https://www.linkedin.com/in/konard/details/experience/) is read in its own browser slot: profile `~/.hh-automation/linkedin-slot`, port 9350; the hh.ru browser (9322) and the review slots (9331–9333, 9340) are not touched | Slot 9350 opens; LinkedIn shows its login wall to the fresh profile | 🧪 (reader written for LinkedIn's entity markup with a text fallback, tested on line fixtures; to verify after the login) |
| A4 | Without a LinkedIn session (no `li_at` cookie, or a login/sign-up wall) the run prints «log in to LinkedIn in the slot window (port 9350)» and waits up to 30 minutes; passwords are never read, typed or stored; only the cookie's presence is checked | Message shown on the authwall; the run waits | 🧪 (wall detected live; the wait ends when the user logs in) |
| A5 | Requests stay minimal: the experience page is opened once, scrolled, and "Show more results" clicked when shown | One page load per export | 🧪 |
| A6 | A company with several roles gives one job per role; dateless nested parts (skills) stay with their position | `tests/experience.test.mjs` | 🧪 |
| A7 | The LinkedIn page text is kept in `data/resume/linkedin-experience.txt`, so the parsing can be checked | File written on export | 🧪 |

## B. Differences

| # | Requirement | Check | Status |
|---|---|---|---|
| B1 | `bun run experience -- diff` matches jobs by company (Cyrillic or Latin, legal forms and quotes ignored: «ООО "ЕВИРМА"» = «Evirma») and overlapping time | Fixture run: ЕВИРМА/Evirma, Kaiten, Deep.Foundation matched | ✅ (live hh.ru data, fixture LinkedIn side) |
| B2 | Per matched job: title, dates, description, skills (only on one side), location differences; titles and descriptions in different languages are compared through each translator's version | «Руководитель команды разработки» = «Team Lead» (via «Development Team Lead»); Kaiten: dates, description 0.11, skills | ✅ (same) |
| B3 | Jobs only on hh.ru and only on LinkedIn are listed | «Only on hh.ru: Capico LLC, …», «Only on LinkedIn: Example Fixture Corp» | ✅ (same) |
| B4 | The report is printed (differences) and saved in full, with the translations side by side, to `logs/experience/<time>-diff.md` | Report file after a run | ✅ |

## C. Translation

| # | Requirement | Check | Status |
|---|---|---|---|
| C1 | Every text is translated by three translators and shown side by side: Claude Haiku (`claude -p --model claude-haiku-5-5`, the latest Haiku), Codex with the latest Luna (`codex debug models` → gpt-6-luna, the captcha prefill's `resolveLunaModel`), Formal AI (latest, `FORMAL_AI_LIVE_API=1` so it can look words up) | 19 hh.ru texts: Haiku and Luna translated all, Formal AI 1 | ✅ |
| C2 | Haiku and Luna get batches as a JSON array and answer with one; Formal AI gets each text as `Translate "<text>" to English` (the form its handler recognizes) | `tests/translation.test.mjs` | ✅ |
| C3 | Every answer is judged: empty, «I could not translate», a placeholder, a web search request, the source returned as is, or text not in the target language is no translation; the chosen one is Haiku's, else Luna's, else Formal AI's | Haiku returned «Associative technologies.» as is → Luna's «Ассоциативные технологии.» chosen | ✅ |
| C4 | Results are cached in `data/resume/translations.json` per model and Formal AI version; failed calls are asked again | Second run makes no translator calls | ✅ |
| C5 | Auto sync translates the source side into the target's language (hh.ru → English for LinkedIn, LinkedIn → Russian for hh.ru) | `sync --to hh`: «Leading a team of 5 senior developers.» → «Руководство командой из 5 старших разработчиков.» | ✅ |

## D. Formal AI failures are reported

| # | Requirement | Check | Status |
|---|---|---|---|
| D1 | Each Formal AI failure is reported to its repository with the version, the exact input (work experience text only), the command, the output, the expected behavior and the other translators' answers | https://github.com/link-assistant/formal-ai/issues/1192, /1193, /1194 | ✅ |
| D2 | No duplicates: existing issues are searched first (this tool's marker, then known phrases); an open issue on the same failure gets one comment per Formal AI version (several kinds share one comment), a closed one is named as a regression of a new issue | Phrase and sentence gaps and the web-search misroute → one comment on #1174 (https://github.com/link-assistant/formal-ai/issues/1174#issuecomment-6097723241); a rerun says «already reported for 0.352.1» | ✅ |
| D3 | Failures that are not Formal AI's (a wrong command line, a timeout, a missing binary, or keeping a text every translator keeps) are not reported | A `--silent` + `FORMAL_AI_SILENT` usage error of this tool was caught and not reported | ✅ |
| D4 | `--dry-run-issues` prints what would be filed; `--no-report-formal-ai` turns reporting off; the report lists the issue URLs | Report section «Formal AI» | ✅ |

Failures found with Formal AI 0.352.1 on the resume texts: phrases and sentences are not translated
(«I could not translate … translation gap»; single words such as «Программист» are), a long
multi-line description is answered with a web search request, «Веб-программист» gives
«-- Английский-->» (#1192), and «Translate to English: Программист» gives an empty answer, routed
to the en→en handler with the placeholder `response:translate` (#1193). Job titles of two or more
known words fail in both directions («Ведущий разработчик», «Team Lead»; «Ведущий» alone is «Host»),
reported as #1194 (failure kind `short-phrase`); sentences are part of #1174.

Comparison on the 27 resume texts (2026-10-10): Formal AI translated 1 («Программист» → «Programmer»),
Haiku 26, Luna 27. Haiku's translation is used; Formal AI is run and reported on every sync.

## E. Sync

| # | Requirement | Check | Status |
|---|---|---|---|
| E1 | `bun run experience -- sync --to linkedin` or `--to hh` plans the changes that bring that side in line with the other: updates of matched jobs that differ, jobs only on the source added; jobs only on the target are kept (never deleted) | Fixture: 4 changes to hh.ru (location note, Kaiten dates and description, Deep.Foundation description, new job) | ✅ (hh.ru) |
| E2 | Each change is prefilled in the target's form in a browser slot for review: hh.ru in `hh-experience-slot` (port 9351, logged in by copying the automation browser's hh.ru cookies, which stays untouched), LinkedIn in the LinkedIn slot | hh.ru Kaiten form prefilled live: «Август 2024», translated description | ✅ hh.ru · 🧪 LinkedIn (form labels to verify after the login) |
| E3 | Nothing is saved without `y` typed on stdin; `s` discards the change («Отменить» → «Не надо» on hh.ru), `q` stops and leaves the form prefilled for the user; closed stdin stops | Closed stdin: stopped at the first prompt, nothing saved; reopening Kaiten shows «Июль 2024» | ✅ |
| E4 | A change with nothing for the form (hh.ru keeps skills per resume; its city is picked from a list) opens no form and is listed as a note | Evirma «location: Remote» → note only | ✅ |
| E5 | `--auto` runs export, diff and sync in one go and still asks before every save | `sync --auto` | 🧪 |
| E6 | Saving after `y` clicks the form's save button (hh.ru «Сохранить», LinkedIn «Save») and waits for the form to close | `applySyncDecision` unit-tested in tests/experience.test.mjs (save/skip/withdrawn/error cases); live: type `y` during sync to save, check the form closes | 🧪 |

## F. Rules

- Nothing is saved on hh.ru or LinkedIn without the user's `y`; nothing is deleted.
- The hh.ru automation browser (9322) is only read for cookies; the review slots (9331–9333, 9340)
  are not touched.
- Cookie values and passwords are never printed or stored; LinkedIn login is manual.
- Resume exports, translations and the LinkedIn export stay in `data/resume/` (gitignored); reports
  go to `logs/` (gitignored).

## Test plan (when the user is ready)

1. `bun run experience -- export`: log in to LinkedIn in the slot window on port 9350 when asked;
   check `data/resume/experience.json` and `data/resume/linkedin-experience.txt` (A3, A4).
2. `bun run experience -- diff`: check the report in `logs/experience/` (B1–B4).
3. `bun run experience -- sync --to linkedin`: check that each LinkedIn position form is prefilled
   (title, company, dates, description); type `s` to discard or `y` to save (E2, E3, E6).
4. `bun run experience -- sync --to hh`: same on hh.ru (E2, E3, E6).

### LinkedIn skills and media (2026-10-11)

«what are media? And can we preselect some skills?» A position's skills are chosen in its form from the skill picker: each skill is typed and the suggestion that is exactly it is chosen (`addLinkedInSkills` in `src/experience-sites.mjs`). The profile is at LinkedIn's 100-skill limit, so only skills already in its Skills section are taken (Kaiten: iOS and Android added, ClickUp is not among them and is left for the user). Media (images, documents, links, presentations attached to a position): «we can use link as kaiten.ru, and for skills we should automate prefillment» — the company website from the position's «Website:» line is added as a media link titled with the company (`companyWebsite` in `src/experience.mjs`, `addLinkedInMedia`), typed like a person (a pasted link broke LinkedIn's form), skipped when the form already has it; a change with only skills opens the LinkedIn form too. Live: Kaiten → https://kaiten.ru/ «Kaiten.ru» attached in the form, not saved.
