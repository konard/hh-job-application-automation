# Requirements: answering forms and chats

Everything the automation fills in for the user, outside the hh.ru application form itself:
the hh.ru application rules it follows, external questionnaires (Google Forms, Yandex Forms, a
company's own job form), and hh.ru chats (recruiter bots, template messages). Status as of
2026-10-10; each requirement has the check that shows it works.

Part of [the full list of requirements](README.md).

Status: ✅ done and verified live · 🧪 done, verified offline only · 🚧 in progress · ⬜ to do

## The user's words

1. «Set by default, that we auto fill the vacancy form with questions and auto submit it only if
   all questions match exactly, overwise autofill and wait, and for captcha we try to submit haiku
   version once, if works - ok, if not - wait for me, so there is less cases which need me.»
2. «We only auto-submit on exact symbol by symbol match, but prefill should use similarity search.»
3. «that is clearly not programming, and looks like physical presence only vacancy, we need to use
   such questions and vacancy description to be filtered out automatically with database of
   automatic filtering.»
4. «We need to add automation to fill [the Google Form of an employer's message] based on already
   answered questions, and also ability to fill form at https://practicum.yandex.ru/job/vacancy-364
   to make direct application, do the best, so we can have everything prefilled, so in separate
   slots for browsers I will able to review everything and submit or change.»
5. «add another form that needs to be supported. We should make form filling as unversal as
   possible so all duplicate code is reused.»
6. «we also need to support question answering based on previous answers in chat as separate slot
   on separate page like https://hh.ru/chat/5698827730, and also when immediately after the
   application chat opens.»
7. «we also need to support templated answers to templated messages from multiple companies in the
   chat like these.» (Ирина: «Рассмотрим ваше резюме. Если навыки и опыт подойдут для позиции, мы
   свяжемся с вами.» → «Здравствуйте, благодарю, ожидаю.»)
8. «Draft exactly all requirements and we will test them as soon as I'm ready.»
9. «we have linked in at `https://www.linkedin.com/in/konard` save it is as contact so we can paste
   a templated insert if contacts changes.»

10. «add form prefilling support if not yet supported» (Maria's chat message with https://forms.gle/NTRexHv7bxQQxnKZA)
11. «we also need to support auto-reading all rejections where it is impossible to make answer, if answer is possible we ask
    for the reason of rejection, but better only prefill - I will confirm or reject sending.» and «that may be used as
    default template for rejection» (the user's reply «Здравствуйте, а можете раскрыть конкретнее причины отказа? …»)
12. «we also need to add support for auto filling answers or rating here» (Контур's template message with
    https://rating.hh.ru/poll)
13. «We also need to develop ability to export both linked in and hh.ru working experince and display differences, that
    needs to be synced …» — see [experience-sync.md](experience-sync.md)
14. «we can also can have a feature of `learning` messages and answers, and if the answer is the same or similar we can
    learn updated regex/peg like templates from multiple of them.» (Технократия's «Ваше резюме принято в работу…»)
15. «here in forms markdown does not work. And also this form contains test assignment, before answering any questions
    we should first create repository with an issue containing test assignment without any mentions of this specific
    employer.» · «We must create a tool to use gh tool to create test assignment as repository + issue with provided name
    and task description converted into English, it should be not the same text as in the actual form.»
16. «Which language and stack is required by `Натур Пласт — анкета AI Solution Architect` vacancy? Can we use our chat
    history to find the exact vacancy? … we must actually make sure we are able to automate it, so we take into the
    account language and stack that is expected, and also we should use our CI/CD templates from
    github.com/link-assistant/hive-mind to match exact language at least, and in the issue clearly request doing it with
    the most fitting stack.»

## A. hh.ru application forms

| # | Requirement | Check | Status |
|---|---|---|---|
| A1 | A form with questions is autofilled from `data/qa.lino` by similarity (fuzzy match), answers are shown for review; the popup the same way as the full form | A form with reworded saved questions gets them filled; the run asks `y`; popup: `tests/popup-application.test.mjs` (🧪) | ✅ |
| A2 | It is sent without asking only when every question is a saved question word for word and its field holds exactly the saved answer (`--auto-send-exact-answers`, default on) | A form with only exact saved questions is sent with "sending without asking" in the log; one changed answer makes it ask | ✅ |
| A3 | Any other form is autofilled as far as possible and waits for the user (`y` / `s` / `q`), in every `--confirm` mode, on the popup and the full form; unattended, it waits for the user in the browser | Open questions are listed; nothing is sent until `y` or the user sends it; `decideSend` tests (🧪) | ✅ |
| A4 | Similarity prefill must not mix up different subjects: C# vs Go, $ vs ₽, ИП vs ТК РФ, LinkedIn vs GitHub links; qualifiers (fulltime, remote, @username) do not count as subjects | `tests/fuzzy-matching.test.mjs`; leave-one-out over qa.lino gains 45 matches and loses only 2 wrong ones | ✅ |
| A5 | Answers the user types are saved to qa.lino once per change (no rewrite loop), in the popup too; an autofilled answer of a similar question never counts as exact on the same form | One "Saved Q&A" per edited question, not thousands; popup: `tests/popup-application.test.mjs` (🧪) | ✅ |
| A6 | Captcha: Haiku's reading is typed and sent once per captcha; if hh.ru shows a new picture, the answer is only prefilled (`haiku|luna`) and the run waits for the user | Live: one accepted, two not accepted then prefilled | ✅ |
| A7 | Vacancies are filtered out automatically by `data/vacancy-filters.lino` (vacancy card before opening it, questions, form text; on-site work that is not programming also by the vacancy description, FLT5); each is logged and kept in `data/filtered-vacancies.lino` with its title and time | «Инженер-схемотехник» card is skipped without a click; log line «🚫 … filtered out» | 🧪 |
| A8 | hh.ru's «поменяйте видимость резюме» notice counts only when it is rendered (not the collapsed `hidden-resume-warning` block); then the run asks to make the resume visible or `s` skips | Live popup: no prompt; visible notice sample: prompt | ✅ |

## B. External forms (Google Forms, Yandex Forms, a company's own job form)

| # | Requirement | Check | Status |
|---|---|---|---|
| B1 | One command prefills any number of forms: `bun run prefill-form -- <url> [<url> ...]` | Three URLs → three slots | ✅ |
| B2 | Each form opens in its own browser slot: separate Chrome, own profile `~/.hh-automation/form-slot-<n>`, port 9330+n, apart from the hh.ru automation browser; it stays open for review (closes after 24 unused hours) | Three windows, the hh.ru run goes on undisturbed | ✅ |
| B3 | Nothing is ever submitted: no click on «Отправить» / submit; the user reviews, changes and sends | Form responses stay empty until the user sends | ✅ |
| B4 | Contacts come from the exported resume (`data/resume/resume.md`, `bun run resume`), never committed: name (ФИО / имя / фамилия), phone, Telegram, email, birth date, location, resume link, GitHub links; `data/profile.lino` (not committed) overrides or adds values | «Укажите имя, номер телефона и Telegram» → «Константин Дьяченко, +7 958 200-05-67, Telegram: @drakonard» | ✅ |
| B4a | Contacts are kept in one place, `data/contacts.lino` (LinkedIn https://www.linkedin.com/in/konard, Telegram, phone, GitHub); answers and the cover letter use placeholders (`{{telegram}}`, `{{linkedin}}`…) filled in when used, so a changed contact is changed once; contact values in newly saved answers become placeholders | «Ссылка на твой Linkedin» → https://www.linkedin.com/in/konard; `tests/contacts.test.mjs` | 🧪 |
| B5 | A link question gets the links it asks for: «ссылка на резюме» → the hh.ru resume, LinkedIn → only LinkedIn (left open when there is none), GitHub → GitHub links, «резюме, портфолио или профиль» → all; a link question never takes a yes/no saved answer | Slot 3: resume link only, LinkedIn open | ✅ |
| B6 | Other questions take saved answers from qa.lino by the same similarity rules as hh.ru forms (A1, A4); choice questions use the same option matching as hh.ru forms | «Укажи свои зарплатные ожидания» → «От 450000 рублей в месяц на руки.» | ✅ |
| B7 | Questions still open are drafted by local Claude Code from the resume and the closest saved answers only; anything only the user knows is marked «[уточнить: …]»; a choice question gets exactly one of its options | Slot 1 drafts with [уточнить] marks; slot 3 «живу постоянно вне РФ/РБ» | ✅ (drafted choices are now matched to the options like saved answers; slot 1's choice question stayed open in the first run) |
| B8 | A file field asking for the resume gets `data/resume/resume.pdf` | Form with a resume upload | 🧪 |
| B9 | A captcha on the site (Yandex SmartCaptcha, as on practicum.yandex.ru) is left to the user; the slot waits up to 30 minutes and fills after it | Slot 2: «solve it in this slot's browser» | 🧪 |
| B10 | Forms inside an iframe (Yandex Forms on practicum.yandex.ru) are read and filled | Slot 2 finds the questions of forms.yandex.ru | 🧪 (every frame is read now; to verify on the next run of slot 2) |
| B11 | A multi-page form: the current page is filled, the report says to open the next page and run again; the answers of every page are learned when it is sent (B14) | Report line «The form has a next page» | 🧪 |
| B12 | A report lists every question with its source (profile / qa.lino score and saved question / draft / open) and is saved to `logs/forms/<time>.md` | Report file after a run | ✅ |
| B13 | One implementation for every form: the same matching (`findBestMatch`), option matching (`findMatchingOption`), answer text (`answerText`) as hh.ru forms; the question reader is generic (aria-labelledby, label, legend, placeholder, nearest heading) | No form-specific code for Google Forms or Yandex Forms | ✅ |
| B14 | Answers the user finally sends in an external form are saved to qa.lino: a detached watcher per slot (`src/form-watch.mjs`, default on, `--no-learn` turns it off) attaches over CDP, keeps the values of the prefill's `data-prefill-id` controls on every page (multi-page «Далее» forms accumulate), and only on a real submission (confirmation such as «Ваш ответ записан» / «Спасибо», or the form gone after a click on its send button) saves text, choices, checkbox lists and dates through `withContacts` (contacts as `{{placeholders}}`); empty answers, «[уточнить: …]» marks, unchanged profile contacts, test assignment links and answers qa.lino already gives are skipped | After sending, the pairs appear in qa.lino; `tests/form-answers.test.mjs`; own headless Chromium on local forms: a two-page form sent → 5 pairs saved (phone as `{{phone}}`), a form that disappears after «Отправить» (after a failed try) → saved, a form left unsent → nothing; the detached watcher saved and appended the questions to the report | 🧪 (not yet seen on a real Google / Yandex form) |
| B15 | Drafts are plain text: forms show Markdown as typed, so drafts are asked for without it and its marks (`**`, `#`, backticks, links, list markers) are taken out | Натур Пласт form: «**Проект:**» → «Проект:»; `tests/form-prefill.test.mjs` | 🧪 |
| B16 | A test assignment in a form comes first: `bun run test-assignment -- <name>` restates it as a GitHub issue in English in other words (not a translation of the form's text), without any mention of the employer, checks that (employer names in any case ending, English, no six words in a row from the original) and creates the repository with the given name and the issue with gh | Натур Пласт's «Тестовое задание — система управления бизнесом с ИИ», dry run; `tests/assignments.test.mjs` | 🧪 |
| B17 | The form question asking for the completed assignment («Ссылка на выполненное тестовое задание») is prefilled with the assignment's repository link; until the repository exists, the prefill says to create it first | `[slot N] 🧪 Test assignment …: create its repository first` | 🧪 |
| B18 | A form with a test assignment is not answered until the assignment's repository exists: the prefill stops with the `test-assignment` command to run, and the next prefill links the repository | Натур Пласт form → https://github.com/konard/marketplace-retail-ai-control (issue #1), link prefilled in slot 1 | 🧪 |
| B19 | The assignment's repository follows the vacancy's language and stack: the vacancy (`--vacancy`, or the one of the chat the form was sent in) is read; the language it names, or the most fitting one when it names none, selects the hive-mind CI/CD template (`link-foundation/<language>-ai-driven-development-pipeline-template`); the issue ends with a «Stack» section that clearly asks for the most fitting stack; a rerun updates the issue and brings the template into a repository without a pipeline | Натур Пласт (vacancy 138213782 names no language) → Python template merged into konard/marketplace-retail-ai-control, issue #1 updated with the Stack section; `tests/assignments.test.mjs` | ✅ |
| B20 | A form sent in an hh.ru chat remembers the chat's vacancy (`logs/form-vacancies.json`), so its test assignment finds the vacancy without `--vacancy` | `answer-chats` → `rememberFormVacancy`; `tests/assignments.test.mjs` | 🧪 |
| B21 | «double check our scripts select a template from Hive Mind, and do creation of repository based on it in the future, instead of making empty repository». The templates are read from the «Recommended CI/CD Templates» table of hive-mind's `docs/CI-CD-BEST-PRACTICES.md` (the built-in list is only the fallback); a new repository is always started from the template: `gh repo create --template` for a GitHub template, otherwise the template's history is pushed into the new empty repository (no bare README repository) | `hiveMindTemplates`, `loadTemplates`, `seedFromTemplate` in `src/assignments.mjs`; `tests/assignments.test.mjs`; live read: 9 templates | ✅ |
| B22 | «ensure … issues/1 was crafted perfectly to match». An assignment that asks for a written answer and no code (a concept, analysis, presentation) gets a «Deliverable and stack» section: a document in `docs/` within the length limit, in the language the assignment was given in, with the stack as what the proposal should prefer; the template's README is replaced by one that links to the result | `stackSection` (`deliverable: 'document'`), `answerLanguage`; konard/marketplace-retail-ai-control #1 updated (Russian document, no code; no employer name, checked) | ✅ |

## C. hh.ru chats

| # | Requirement | Check | Status |
|---|---|---|---|
| C1 | Chats are answered in their own slot (separate browser and page, e.g. https://hh.ru/chat/5698827730), not in the single-tab automation browser: `bun run answer-chats -- <chat url or id>` (port 9340, profile `chat-slot`) | The hh.ru run goes on while the chat slot works | ✅ |
| C2 | The chat slot is logged in to hh.ru by copying the automation browser's hh.ru cookies; cookie values are never printed or stored in the repository | «Logged in with the hh.ru session … (50 cookies, values not shown)» | ✅ |
| C3 | The last message(s) from the employer or recruiter bot without a reply are found; questions are answered from qa.lino (close match ≥ 0.7, as chat questions often ask two things), drafts (B7, from the chat history, resume and saved answers) for the rest | Chat 5698827730: «уровень английского и зарплаты на старте» → drafted reply with both | ✅ |
| C4 | Template messages from different companies get the saved template reply: matched by similarity after leaving out the greeting with the user's name, the sender's name and signature, or when the template is contained in a longer message (`data/chat-templates.lino`: message → reply) | «Рассмотрим ваше резюме … свяжемся с вами» (Ирина), Контур's «В течение двух рабочих дней…» → «Здравствуйте, благодарю, ожидаю.»; `tests/chat-answers.test.mjs` | 🧪 |
| C5 | The answer is typed into the message field and not sent; the user checks, changes and sends (same rule as B3) | Message field filled, nothing sent | ✅ |
| C6 | Previous answers in chats are learned: an employer question followed by the user's reply is saved to qa.lino (questions) or chat-templates.lino (template messages); replies that are questions back («Можно без опыта?») and the application itself are not answers | Learned «компьютерного зрения…» and «BIM-моделями…» from chat 5698827730 | ✅ |
| C7 | Chats that open right after an application are picked up: `--watch` goes through the chat list (chats whose last message is not the user's) one by one and waits until the user sends (or `s` skips) before the next | Apply → the chat slot prefills the bot's first question | 🧪 |
| C8 | hh.ru's suggested quick replies («Можно без опыта?», «Какая схема оплаты?») are never clicked | No message is sent by the slot | ✅ |
| C9 | Rejections are read automatically: a closed chat («Переписка будет доступна после приглашения работодателя») is only opened (read); when a reply is possible, the saved rejection reply asking for the reason is typed, not sent (`Отказ` in chat-templates.lino: «Здравствуйте, а можете раскрыть конкретнее причины отказа? Если это вилка зарплатных ожиданий, может быть мы можем рассмотреть другие варианты вместе?») | VK «Отказ» chat: read; an open one: the reply typed | 🧪 |
| C10 | Questionnaire links sent in chats (Google Forms, Yandex Forms, Microsoft Forms, Typeform) are prefilled in a free form slot (B1–B13) | Maria's «анкета: https://forms.gle/NTRexHv7bxQQxnKZA» → form slot | 🧪 |
| C11 | hh.ru's employer rating poll (https://rating.hh.ru/poll) from a chat opens in a form slot logged in to hh.ru with the company typed into the search; the ratings are the user's to choose (never invented, never submitted) | Контур's message → rating poll slot | 🧪 |
| C12 | Template messages answered the same (or a similar) way are generalized into learned patterns in chat-templates.lino: the words they share in order, `…` for what differs, `*` for word endings; patterns are learned again whenever a new template reply is learned, a different template with the same reply stays apart, a question never matches a pattern | Ирина's and Технократия's messages → `pattern: ваше резюме … опыт* … позиции … свяже* с вами`; `tests/chat-answers.test.mjs` | 🧪 |
| C13 | Messages that need no reply are only read: a recruiter bot's summary («Вопрос?: Ответ» lines, whose answers are learned into qa.lino, answers that are questions back aside) and templates saved with the reply `[без ответа]` (the bot's «Спасибо! Ваши ответы отправлены работодателю…») | Mad Devs chat 5698827730: «📭 No reply needed», the English/salary answer learned | ✅ |
| C14 | `apply.mjs --process-chats` starts `answer-chats.mjs --auto` as a child process (chat browser slot, port 9340) alongside the application loop; the child is stopped when apply exits; `--chats-interval-minutes` (default 120) sets the poll interval | `spawn` in `src/apply.mjs`; child killed in `shutdown`; `tests/process-chats.test.mjs` | 🧪 |
| C15 | «automatically process unread messages, but if it sees last message that it cannot process in any predefined way - it should stop and give ability for me to react … once 2 hours». `answer-chats --auto` takes unread chats only; chats that need nothing sent (no-reply messages, closed chats, questionnaires prefilled in form slots) are handled; the first chat that needs a message sent (a reply typed or drafted for the user to check, or none found) stops processing: that chat stays open in the chat slot with the text typed, one line `💬 … <title> <url>` goes to the apply log, and later cycles only re-read that chat (no chat list) until the user's own message is its last one or it is closed; nothing is sent by the tool; applications keep running | `stuckChat` and `isChatAnswered` in `src/answer-chats.mjs` / `src/chat-answers.mjs`; `tests/process-chats.test.mjs` | 🧪 |

## D. Rules for all of it

- Nothing is sent or submitted without the user, except A2 (exact answers) and A6 (one captcha try).
- No visible markers on pages; marks are data attributes only.
- Requests to hh.ru are kept low: the automation browser keeps one tab; the chat slot opens one chat at a time.
- Cookies and passwords are never printed or stored in the repository; personal data (the resume
  export, profile.lino) stays out of git.
- Every change is committed and pushed.

## Test plan (when the user is ready)

1. `bun run prefill-form -- https://forms.gle/wghLoFv9nxzyKCea6 https://practicum.yandex.ru/job/vacancy-364 https://forms.gle/NTRexHv7bxQQxnKZA`
   - Slots 1–3 open; slot 2 waits for the Yandex captcha, then fills the Yandex Forms iframe (B9, B10).
   - Check B4–B8 in each slot and in `logs/forms/*.md`; nothing is submitted (B3).
2. Chat slot on https://hh.ru/chat/5698827730: the bot's last question is answered in the message field, not sent (C1–C5, C8).
3. A chat with Ирина's template message: «Здравствуйте, благодарю, ожидаю.» is typed (C4).
4. Watch mode during an hh.ru run: a chat opened by a fresh application is prefilled (C7).
5. After sending: the new pairs are in qa.lino / chat-templates.lino (B14, C6).
