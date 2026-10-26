#!/usr/bin/env bun
import { loadOxionSettings, oxionModelStatus } from './oxion.mjs';
if (process.argv.includes('--help')) console.log('Usage: bun run ai-status -- [--probe] (settings: OXION_BASE_URL, OXION_API_KEY, OXION_MODEL in .lenv)');
else {
  try { console.log(JSON.stringify(await oxionModelStatus(await loadOxionSettings(), { probe: process.argv.includes('--probe') }), null, 2)); }
  catch (error) { console.error(error.message.split('\n')[0]); process.exitCode = 1; }
}
