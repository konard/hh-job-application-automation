/**
 * Tests for the page triggers' wiring to browser-commander's trigger manager: the form
 * handler runs once per page although the trigger fires again while it runs
 */
import { describe, test, assert } from 'test-anywhere';
import { EventEmitter } from 'events';
import { createPageTriggerManager } from 'browser-commander';
import { registerPageTriggers } from '../src/page-triggers.mjs';

const FORM_URL = 'https://hh.ru/applicant/vacancy_response?vacancyId=138276367';
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('registerPageTriggers', () => {
  test('the form handler is not started again while it runs', async () => {
    const navigation = new EventEmitter();
    const manager = createPageTriggerManager({ navigationManager: navigation, log: { debug() {} } });
    const page = new EventEmitter();
    page.url = () => FORM_URL;
    const commander = {
      page,
      pageTrigger: manager.pageTrigger,
      isActionStoppedError: manager.isActionStoppedError,
      onUrlChange() {},
      getUrl: () => FORM_URL,
      evaluate: async () => [],
    };
    manager.initialize(commander);
    let calls = 0;
    let release;
    const unregister = registerPageTriggers({
      commander,
      addOrUpdateQA: async () => {},
      handleVacancyResponsePage: () => {
        calls++;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      getReturnUrl: () => 'https://hh.ru/search/vacancy',
    });

    navigation.emit('onPageReady', { url: FORM_URL });
    await tick();
    navigation.emit('onPageReady', { url: FORM_URL });
    await tick();
    assert.equal(calls, 1);

    release();
    await tick();
    navigation.emit('onPageReady', { url: FORM_URL });
    await tick();
    assert.equal(calls, 2);

    release();
    unregister();
    await manager.destroy();
  });
});
