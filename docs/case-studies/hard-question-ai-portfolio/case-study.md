# Case Study: A Hard Question - the Portfolio of Automations and AI Products

## Summary

The form of vacancy [137956393](https://hh.ru/vacancy/137956393) ("Руководитель развития AI и
аналитических решений") asked:

> Какой портфель автоматизаций и AI-продуктов вам удалось реализовать? Как считали эффекты для бизнеса?

`data/qa.lino` had no answer, so the run stopped and waited, as it does for every open question.
Unlike the usual questions (location, salary, years with a language), this one cannot be answered
from a saved fact in a minute: it asks for a portfolio **and** for the way business effects were
measured. A good answer takes time to write, and the run should not stand still meanwhile.

Two outcomes:

1. A draft answer, kept below, to finish when there is time.
2. A way to put such questions off: the vacancy is skipped for now and kept in
   `data/deferred-questions.lino`, so it can be applied to once the answer is ready.

## Why the Question Is Hard

- **Two questions in one.** "What did you build" is a list; "how did you count the effects" asks for
  a method and, ideally, numbers.
- **The resume has no numbers.** It describes the projects (ЕВИРМА, Deep.Foundation, LinksPlatform)
  but not before/after metrics. Numbers must not be made up, so the draft names the metrics and
  leaves the values to the candidate.
- **The answer is judged by results.** For a head of AI development role a list of tools is not
  enough; the employer wants to see that effects were measured and drove decisions.
- **Some real work should not be mentioned.** This application tool is a real AI automation, but it
  is not something to tell an employer one applies to. Projects the candidate keeps out of this
  repository are left out too.

## Draft Answer

Built from the resume and from earlier answers in `qa.lino` about measuring the effect of AI.

> **Портфель:**
>
> 1. **AI-first разработка (ЕВИРМА, Tech Lead).** Сервисы на PHP (Symfony) и Go разрабатываются и
>    сопровождаются ИИ-агентами Claude Code и OpenAI Codex CLI. Задачи оформляются как issue,
>    агенты параллельно готовят pull request'ы, я провожу ревью и даю обратную связь.
> 2. **Автоматическое исправление ошибок из Sentry через ИИ.** Ошибка становится задачей, агент
>    готовит исправление и pull request, человек только проверяет.
> 3. **ИИ-роутер** — единая точка доступа к ИИ-провайдерам для автономных агентов и сотрудников
>    компании: один API вместо отдельных подписок, выбор модели под задачу, учёт расходов.
> 4. **Автоматизация CI/CD и тестовый стенд**, чтобы работа агентов проверялась автоматически ещё
>    до ревью.
> 5. **Сервис парсинга данных Wildberries** и блок управления расписанием рекламных кампаний.
> 6. **Ранее:** в Deep.Foundation — GPT-4o Discord-бот и система новостной аналитики. В LinksPlatform
>    — трансляторы исходного кода между языками на основе правил (C# → C++, C# → Python,
>    C++ → Java) и боты автоматизации сообщества (VK, Discord, GitHub).
>
> **Как считали эффекты:**
>
> - Пропускная способность до и после перехода на AI-first: число закрытых задач и смёрженных
>   pull request'ов в неделю, время от создания задачи до мержа (cycle time), число итераций ревью
>   на один pull request.
> - Для исправления ошибок: число открытых ошибок в Sentry и время от появления ошибки до
>   исправления в продакшене.
> - Для ИИ-роутера: расходы на ИИ на одного сотрудника или агента и доля задач, которые агенты
>   выполняют без участия человека.
>
> **Итог:** один техлид с ИИ-агентами по объёму работы заменяет команду разработчиков. Узкое
> место — ревью и обратная связь от человека, поэтому оптимизируем именно этот цикл.

### What Is Still Missing

- **Before/after values** for at least two metrics (e.g. pull requests a week, median cycle time,
  Sentry time-to-fix). With them the answer becomes much stronger; without them it stays a
  description of the method.
- **Money**, where it can be shown: the AI cost per employee through the router against the
  separate subscriptions it replaced.

### The Metrics in Short

| Metric | What it shows | How it is counted |
|---|---|---|
| Throughput | How much work gets done | Closed issues and merged pull requests a week |
| Cycle time | How fast a task is finished | From the issue (or first commit) to the merge; the weekly or monthly median |
| Review iterations | How good the first version is | Review rounds per pull request |
| Sentry errors, time to fix | Reliability | Open errors; from the first event to the fix in production |
| AI cost per person or agent | Price of the effect | Router spend divided by users and agents |
| Autonomous share | How much runs without a human | Tasks done by agents without manual changes |

Cycle time example: an issue created on Monday at 10:00 and its pull request merged on Tuesday at
16:00 is a cycle time of 30 hours. If it falls after AI agents are introduced, tasks are really
finished faster, not just more of them started.

## Decision: Answer Later, Keep Applying

The answer is deferred. The run must not stop on such a question, but the vacancy must not be lost
either, so the tool got a way to put questions off:

- **At the prompt.** When the run waits for open questions it offers `s`: the vacancy is skipped for
  now and its ID is kept under each open question in `data/deferred-questions.lino`.
- **Automatically.** A later form whose open question matches a deferred one (the same question in
  other words) is skipped right away and its vacancy ID is added to the file.
- **From the command line.** `--skip-question "<text>"` skips forms with a matching question,
  answered or not; repeat it for several questions, or set `SKIP_QUESTIONS` with `|` between them:

  ```bash
  bun run apply -- --message-file data/cover-letter.txt \
    --skip-question "портфель автоматизаций" --skip-question "эффекты для бизнеса"
  ```

- **Unattended runs.** `--on-missing-answers skip` records the open questions in the same file.

`data/deferred-questions.lino` uses the format of `qa.lino`, with vacancy IDs as the "answers":

```
Какой портфель автоматизаций и AI-продуктов вам удалось реализовать? Как считали эффекты для бизнеса?
  137956393
```

Deferred vacancies are not opened again, in this run or later ones, while their question has no
answer. Once the answer is in `qa.lino`, they are opened like any other vacancy hh.ru lists, and the
answer is filled in from `qa.lino`; a vacancy that has been applied to is removed from the file.

## Finishing It

1. Add the numbers to the draft and save it under the question in `data/qa.lino` (or answer it in
   any form; answers typed in the browser are saved there).
2. Open the vacancies listed under the question in `data/deferred-questions.lino`
   (`https://hh.ru/vacancy/<id>`) or let the run reach them again.
