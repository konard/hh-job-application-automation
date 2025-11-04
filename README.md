# hh-job-application-automation
Automation of job application in hh.ru

https://github.com/user-attachments/assets/6884b2fe-e322-4358-aab8-7f3c20ccdc46

Application message example:

```
В какой форме предлагается юридическое оформление удалённой работы?

Посмотреть мой код на GitHub можно тут:

github.com/konard
github.com/deep-assistant
github.com/linksplatform
github.com/link-foundation
```

## Puppeteer

```bash
npm run puppeteer -- --url "https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist" --manual-login --job-application-interval 7
```

## Playwright

```bash
npm run playwright -- --url "https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist" --manual-login --job-application-interval 7
```
