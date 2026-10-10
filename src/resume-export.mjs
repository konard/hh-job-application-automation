#!/usr/bin/env bun

/**
 * Download a resume (CV) from hh.ru in every export format, convert it to Markdown
 * and collect the technology stack.
 *
 * Runs in its own headless Chrome. The hh.ru login is copied, in memory only, from the
 * automation browser that is already running, which is left untouched: its pages,
 * unsent answers and process are never closed or reloaded.
 */

import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';
import TurndownService from 'turndown';
import { makeConfig } from 'lino-arguments';
import { describeChoice, pickResume, readResumes } from './resumes.mjs';
import { collectStack, formatStackMarkdown } from './resume-stack.mjs';
import { SELECTORS } from './hh-selectors.mjs';

const FORMATS = ['pdf', 'doc', 'rtf', 'txt'];
/** hh.ru's "doc" export is the same RTF file as "rtf", so it is only downloaded on request */
const DEFAULT_FORMATS = ['pdf', 'rtf', 'txt'];
/** hh.ru's "txt" export is an HTML page */
const FILE_EXTENSIONS = { pdf: 'pdf', doc: 'doc', rtf: 'rtf', txt: 'html' };
const RESUMES_URL = 'https://hh.ru/applicant/resumes';

const argv = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('resume', {
        type: 'string',
        description: 'Resume hash (from https://hh.ru/resume/<hash>); default: the most recently updated resume',
        default: getenv('RESUME', ''),
      })
      .option('browser-port', {
        type: 'number',
        description: 'Remote debugging port of the running automation browser to copy the hh.ru login from',
        default: getenv('BROWSER_PORT', 9322),
      })
      .option('out', {
        type: 'string',
        description: 'Output directory',
        default: getenv('RESUME_OUT', path.join(process.cwd(), 'data', 'resume')),
      })
      .option('formats', {
        type: 'string',
        description: `Export formats to download: ${FORMATS.join(', ')}`,
        default: getenv('RESUME_FORMATS', DEFAULT_FORMATS.join(',')),
      }),
});

/**
 * hh.ru cookies of the running browser, read over CDP without attaching to any page
 * @param {number} port
 * @returns {Promise<Object[]>} Playwright cookies
 */
async function readRunningBrowserCookies(port) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json()).catch(() => null);
  if (!version?.webSocketDebuggerUrl) {
    throw new Error(`No automation browser on port ${port}. Start one with "bun run apply --keep-browser-open" and log in.`);
  }
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  const { cookies } = await new Promise((resolve, reject) => {
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Storage.getCookies' }));
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id === 1) {
        return message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      }
    };
    socket.onerror = () => reject(new Error(`Could not read cookies from the browser on port ${port}`));
  }).finally(() => socket.close());
  return cookies
    .filter(({ domain }) => domain === 'hh.ru' || domain.endsWith('.hh.ru'))
    .map(({ name, value, domain, path: cookiePath, expires, httpOnly, secure, sameSite }) => ({
      name, value, domain, path: cookiePath, httpOnly, secure,
      expires: expires > 0 ? expires : -1,
      ...(sameSite ? { sameSite } : {}),
    }));
}

/**
 * Structured resume data read from the DOM of hh.ru's HTML export
 * @param {import('playwright').Page} page - Page showing the export
 */
function readResumeExport(page) {
  return page.evaluate(() => {
    const text = (element) => element?.innerText.trim() ?? '';
    const skillGroup = (name) => [...document.querySelectorAll('.resume-skils')]
      .find((group) => text(group.querySelector('.bloko-form-hint')) === name);
    return {
      name: text(document.querySelector('.resume__title')),
      title: text(document.querySelector('.resume__position')),
      updated: document.body.innerText.match(/Резюме обновлено[^\n]*/)?.[0].trim() ?? '',
      keySkills: [...(skillGroup('Навыки')?.querySelectorAll('.resume-skils__item span') ?? [])]
        .map((span) => text(span).replace(/;$/, '').trim())
        .filter(Boolean),
      jobs: [...document.querySelectorAll('.resume-experience')].map((job) => {
        const position = job.querySelector('.resume-experience__position');
        return {
          company: text(job.querySelector('.resume-experience__company')),
          position: text(position),
          period: text(job.querySelector('.bloko-form-hint')).replace(/\s+/g, ' '),
          description: [...job.querySelectorAll('.resume-experience__position ~ p')].map(text).join('\n'),
        };
      }),
      about: text(skillGroup('Обо мне')),
    };
  });
}

async function main() {
  const formats = argv.formats.split(',').map((format) => format.trim()).filter(Boolean);
  const unknown = formats.filter((format) => !FORMATS.includes(format));
  if (unknown.length > 0) {
    throw new Error(`Unknown format(s): ${unknown.join(', ')}. Use: ${FORMATS.join(', ')}`);
  }
  if (!formats.includes('txt')) {
    formats.push('txt');
  }

  const cookies = await readRunningBrowserCookies(argv.browserPort);
  console.log(`🔑 Copied ${cookies.length} hh.ru cookie(s) from the browser on port ${argv.browserPort} (it stays open)`);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ locale: 'ru-RU' });
    await context.addCookies(cookies);
    const page = await context.newPage();

    let hash = argv.resume;
    if (!hash) {
      await page.goto(RESUMES_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(SELECTORS.resume, { timeout: 20000 }).catch(() => {});
      const resumes = await readResumes({ evaluate: (fn, arg) => page.evaluate(fn, arg) });
      const choice = pickResume(resumes);
      if (!choice.resume?.hash) {
        throw new Error(`No resumes found on ${RESUMES_URL}; is the browser on port ${argv.browserPort} logged in to hh.ru?`);
      }
      hash = choice.resume.hash;
      console.log(describeChoice(choice, resumes.length));
    }

    // Download from inside the page, so the browser's own TLS stack and cookies are used
    // and no error message can carry the cookie header
    await page.goto(`https://hh.ru/resume/${hash}`, { waitUntil: 'domcontentloaded' });
    await fs.mkdir(argv.out, { recursive: true });
    const saved = {};
    for (const format of formats) {
      const download = await page.evaluate(async (url) => {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
          return { status: response.status };
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (let index = 0; index < bytes.length; index += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        }
        return { status: response.status, base64: window.btoa(binary) };
      }, `/resume_converter/resume.${format}?hash=${hash}&type=${format}`);
      if (!download.base64) {
        throw new Error(`Downloading the ${format} export failed: HTTP ${download.status}`);
      }
      const file = path.join(argv.out, `resume.${FILE_EXTENSIONS[format]}`);
      await fs.writeFile(file, Buffer.from(download.base64, 'base64'));
      saved[format] = file;
      console.log(`⬇️  ${file}`);
    }

    const html = await fs.readFile(saved.txt, 'utf8');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const resume = { hash, url: `https://hh.ru/resume/${hash}`, ...(await readResumeExport(page)) };
    const plainText = await page.evaluate(() => document.body.innerText);

    const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
    turndown.remove(['head', 'style', 'script', 'title']);
    const stack = collectStack(resume);
    const outputs = {
      'resume.md': `${turndown.turndown(html).replace(/\n{3,}/g, '\n\n').trim()}\n`,
      'resume.txt': `${plainText.replace(/\n{3,}/g, '\n\n').trim()}\n`,
      'resume.json': `${JSON.stringify({ ...resume, stack }, null, 2)}\n`,
      'stack.md': formatStackMarkdown(stack, resume),
    };
    for (const [name, content] of Object.entries(outputs)) {
      const file = path.join(argv.out, name);
      await fs.writeFile(file, content);
      console.log(`📝 ${file}`);
    }

    console.log(`\n🧰 ${stack.all.length} technologies: ${stack.all.join(', ')}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  // Playwright call logs list request headers; keep only the first line so cookies are never printed
  console.error('Error:', error.message.split('\n')[0].replace(/cookie:.*/i, 'cookie: <hidden>'));
  process.exit(1);
});
