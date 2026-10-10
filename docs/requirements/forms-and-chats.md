# Requirements: answering forms and chats

Everything the automation fills in for the user, outside the hh.ru application form itself:
the hh.ru application rules it follows, external questionnaires (Google Forms, Yandex Forms, a
company's own job form), and hh.ru chats (recruiter bots, template messages). Status as of
2026-10-10; each requirement has the check that shows it works.

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

## A. hh.ru application forms

| # | Requirement | Check | Status |
|---|---|---|---|
| A1 | A form with questions is autofilled from `data/qa.lino` by similarity (fuzzy match), answers are shown for review | A form with reworded saved questions gets them filled; the run asks `y` | ✅ |
| A2 | It is sent without asking only when every question is a saved question word for word and its field holds exactly the saved answer (`--auto-send-exact-answers`, default on) | A form with only exact saved questions is sent with "sending without asking" in the log; one changed answer makes it ask | ✅ |
| A3 | Any other form is autofilled as far as possible and waits for the user (`y` / `s` / `q`) | Open questions are listed; nothing is sent until `y` or the user sends it | ✅ |
| A4 | Similarity prefill must not mix up different subjects: C# vs Go, $ vs ₽, ИП vs ТК РФ, LinkedIn vs GitHub links; qualifiers (fulltime, remote, @username) do not count as subjects | `tests/fuzzy-matching.test.mjs`; leave-one-out over qa.lino gains 45 matches and loses only 2 wrong ones | ✅ |
| A5 | Answers the user types are saved to qa.lino once per change (no rewrite loop) | One "Saved Q&A" per edited question, not thousands | ✅ |
| A6 | Captcha: Haiku's reading is typed and sent once per captcha; if hh.ru shows a new picture, the answer is only prefilled (`haiku|luna`) and the run waits for the user | Live: one accepted, two not accepted then prefilled | ✅ |
| A7 | Vacancies are filtered out automatically by `data/vacancy-filters.lino` (vacancy card before opening it, questions, form text); each is logged and kept in `data/filtered-vacancies.lino` | «Инженер-схемотехник» card is skipped without a click; log line «🚫 … filtered out» | 🧪 |
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
| B11 | A multi-page form: the current page is filled, the report says to open the next page and run again | Report line «The form has a next page» | 🧪 |
| B12 | A report lists every question with its source (profile / qa.lino score and saved question / draft / open) and is saved to `logs/forms/<time>.md` | Report file after a run | ✅ |
| B13 | One implementation for every form: the same matching (`findBestMatch`), option matching (`findMatchingOption`), answer text (`answerText`) as hh.ru forms; the question reader is generic (aria-labelledby, label, legend, placeholder, nearest heading) | No form-specific code for Google Forms or Yandex Forms | ✅ |
| B14 | Answers the user finally sends in an external form are saved to qa.lino | After sending, the pairs appear in qa.lino | ⬜ |

## C. hh.ru chats

| # | Requirement | Check | Status |
|---|---|---|---|
| C1 | Chats are answered in their own slot (separate browser and page, e.g. https://hh.ru/chat/5698827730), not in the single-tab automation browser | The hh.ru run goes on while the chat slot works | ⬜ |
| C2 | The chat slot is logged in to hh.ru by copying the automation browser's hh.ru cookies; cookie values are never printed or stored in the repository | Chat slot opens the chat logged in | ⬜ |
| C3 | The last message(s) from the employer or recruiter bot without a reply are found; questions are answered from qa.lino by the same similarity rules (A1, A4), drafts (B7) for the rest | Bot question «Работали ли с архитектурными … чертежами?» gets an answer | ⬜ |
| C4 | Template messages from different companies get the saved template reply: matched by similarity after leaving out the greeting with the user's name, the sender's name and signature (`data/chat-templates.lino`: message → reply) | «Рассмотрим ваше резюме … свяжемся с вами» from any company → «Здравствуйте, благодарю, ожидаю.» | ⬜ |
| C5 | The answer is typed into the message field and not sent; the user checks, changes and sends (same rule as B3) | Message field filled, nothing sent | ⬜ |
| C6 | Previous answers in chats are learned: an employer question followed by the user's reply is saved to qa.lino (questions) or chat-templates.lino (template messages) | After a chat, the pairs appear in the files | ⬜ |
| C7 | Chats that open right after an application are picked up: a watch mode goes through the chat list (new and unread chats with an unanswered message) one by one and waits for the user to send before the next | Apply → the chat slot prefills the bot's first question | ⬜ |
| C8 | hh.ru's suggested quick replies («Можно без опыта?», «Какая схема оплаты?») are never clicked | No message is sent by the slot | ⬜ |

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
