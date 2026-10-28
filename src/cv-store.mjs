/** Saved CV snapshots. Export uses a separate headless browser; the editor is never navigated. */
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { formatCvLino, parseCvLino, privateDetails, resumeToCv } from './cv.mjs';

export const CV_EXPORT_DIR = path.join(process.cwd(), 'data', 'resume', 'cv');

/** Keep the app's selected résumé cache aligned with real exports, retaining existing PDFs. */
export async function refreshSelectedCvCache(directory = CV_EXPORT_DIR, selectedDirectory = path.dirname(directory)) {
  const selected = await fs.readFile(path.join(selectedDirectory, 'resume.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (!selected?.hash || !/^[a-z0-9]+$/i.test(selected.hash)) return false;
  const source = path.join(directory, selected.hash);
  if (!await fs.access(path.join(source, 'resume.json')).then(() => true, () => false)) return false;
  for (const name of ['resume.json', 'resume.md', 'resume.txt', 'stack.md']) {
    const from = path.join(source, name);
    if (!await fs.access(from).then(() => true, () => false)) continue;
    const to = path.join(selectedDirectory, name);
    const temporary = `${to}.${process.pid}.tmp`;
    await fs.copyFile(from, temporary);
    await fs.rename(temporary, to);
  }
  return true;
}

export const runCvCommand = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'inherit'], ...options });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
});

export async function exportSavedCvs({ port = 9322, directory = CV_EXPORT_DIR } = {}) {
  // Keep previous PDFs, other formats and backups. Export never deletes the cache directory.
  await fs.mkdir(directory, { recursive: true });
  const refresh = await fs.mkdtemp(path.join(directory, '.refresh-'));
  const resumes = [];
  try {
    await runCvCommand(process.execPath, [fileURLToPath(new URL('./resume-export.mjs', import.meta.url)),
      '--all', '--out', refresh, '--formats', 'txt', '--browser-port', String(port)]);
    for (const hash of await fs.readdir(refresh)) {
      const resume = JSON.parse(await fs.readFile(path.join(refresh, hash, 'resume.json'), 'utf8'));
      if (resume.hash !== hash) {
        throw new Error('Exported CV hash does not match its directory');
      }
      resumes.push({ hash, cv: resumeToCv(resume) });
      await fs.mkdir(path.join(directory, hash), { recursive: true });
      for (const file of await fs.readdir(path.join(refresh, hash))) {
        const target = path.join(directory, hash, file);
        const temporary = `${target}.${process.pid}.tmp`;
        await fs.copyFile(path.join(refresh, hash, file), temporary);
        await fs.rename(temporary, target);
      }
    }
  } finally {
    // Only this invocation's temporary directory, never the existing exported CVs.
    await fs.rm(refresh, { recursive: true, force: true });
  }
  await refreshSelectedCvCache(directory);
  return resumes;
}

export async function writeCvSnapshots(resumes, out) {
  const files = resumes.map(({ hash, cv }) => {
    const text = formatCvLino(cv);
    const found = privateDetails(text);
    if (found.length > 0) {
      throw new Error(`CV holds ${found.join(', ')}: snapshot not published`);
    }
    if (JSON.stringify(parseCvLino(text)) !== JSON.stringify(cv)) {
      throw new Error('CV snapshot failed its Links Notation round trip');
    }
    const count = resumes.filter((resume) => resume.cv.language === cv.language).length;
    return { file: path.join(out, `cv.${cv.language}${count > 1 ? `.${hash.slice(0, 6)}` : ''}.lino`), text };
  });
  await fs.mkdir(out, { recursive: true });
  for (const { file, text } of files) {
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, text);
    await fs.rename(temporary, file);
  }
  return files.map(({ file }) => file);
}

/** Opt-in publication commits only these example files, never unrelated staged changes. */
export async function publishCvSnapshots(files) {
  if (files.length === 0) {
    return;
  }
  await runCvCommand('git', ['add', '--', ...files]);
  const dirty = await new Promise((resolve, reject) => {
    const child = spawn('git', ['diff', '--cached', '--quiet', 'HEAD', '--', ...files], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(false) : code === 1 ? resolve(true) : reject(new Error('Cannot check CV git changes')));
  });
  if (!dirty) {
    return;
  }
  await runCvCommand('git', ['commit', '--only', '-m', 'Update saved CV examples', '--', ...files]);
  await runCvCommand('git', ['push']);
}
