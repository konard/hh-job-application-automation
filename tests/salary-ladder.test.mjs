import { describe, test, expect } from 'bun:test';
import { createSalaryLadder, vacancySalary } from '../src/salary-ladder.mjs';

const contacts = { salary_net_rub: '450000', salary_net_usd: '$6000', salary_net_eur: '5500 €', salary_hours_per_month: '160' };
const search = 'https://hh.ru/search/vacancy?resume=ru&from=resumelist';
const make = options => createSalaryLadder({ contacts, rubPer: { USD: 80, EUR: 90, KZT: 0.16 }, log: () => {}, ...options });

describe('matching vacancies salary ladder', () => {
  test('starts at the exact target, resets pagination only for a changed filter, keeps unknown pay', () => {
    const ladder = make();
    const url = new URL(ladder.prepare(`${search}&page=5&only_with_salary=true&label=with_salary&label=not_from_agency`));
    expect(url.searchParams.get('salary')).toBe('450000');
    expect(url.searchParams.get('currency_code')).toBe('RUR');
    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.has('only_with_salary')).toBe(false);
    expect(url.searchParams.getAll('label')).toEqual(['not_from_agency']);
    expect(ladder.prepare(url.href)).toBe(url.href);
    expect(ladder.assess('')).toMatchObject({ action: 'apply' });
    const existing = `${search}&salary=400000&currency_code=RUR&page=3`;
    expect(ladder.prepare(existing)).toBe(existing);
    expect(ladder.floorRub).toBe(400000);
  });
  test('a blank filter gets the target; explicit zero, foreign currency and unrelated searches are preserved', () => {
    expect(new URL(make().prepare(`${search}&salary=`)).searchParams.get('salary')).toBe('450000');
    const zero = `${search}&salary=0`;
    const ladder = make();
    expect(ladder.prepare(zero)).toBe(zero);
    expect(ladder.advance()).toBeNull();
    const foreign = make();
    const usd = `${search}&salary=6000&currency_code=USD`;
    expect(foreign.prepare(usd)).toBe(usd);
    expect(foreign.floorRub).toBe(480000);
    expect(Number(new URL(foreign.advance()).searchParams.get('salary'))).toBe(5375);
    const general = 'https://hh.ru/search/vacancy?text=developer';
    expect(make().prepare(general)).toBe(general);
    expect(make({ enabled: false }).prepare(search)).toBe(search);
  });
  test('hard caps below half the configured currency target are excluded, precisely at half are retained', () => {
    const ladder = make();
    for (const text of ['до 224 999 ₽ в месяц', '100 000–200 000 ₽', '200000 RUB', 'up to $2999 per month', 'до 2749 EUR']) {
      expect(ladder.assess(text).action).toBe('exclude');
    }
    for (const text of ['до 225000 ₽', 'up to $3000', '2750 EUR']) expect(ladder.assess(text).action).toBe('defer');
    expect(ladder.assess('from 100000 ₽').action).toBe('defer');
    expect(ladder.assess('from $6000').action).toBe('apply');
    expect(ladder.assess('5000000 KZT').action).toBe('apply');
    expect(ladder.assess('до 1000000 ₸').action).toBe('exclude');
    expect(ladder.assess('from 204 000 up to 325 900 ₽ per month, before tax').action).toBe('defer');
    expect(ladder.assess('from 160 000 up to 220 000 ₽ per month, after taxes').action).toBe('exclude');
  });
  test('drops by 50k only on explicit exhaustion, releasing eligible deferred IDs without durable skips', () => {
    const released = [];
    const ladder = make({ release: id => released.push(id) });
    ladder.prepare(search);
    expect(ladder.check('1', 'from 400000 ₽').action).toBe('defer');
    expect(ladder.check('2', 'from 100000 ₽').action).toBe('defer');
    expect(ladder.check('3', 'до 200000 ₽').action).toBe('exclude');
    expect(ladder.check('4', '').action).toBe('apply');
    expect(released).toEqual([]);
    const floors = [];
    for (let i = 0; i < 9; i++) floors.push(Number(new URL(ladder.advance()).searchParams.get('salary')));
    expect(floors).toEqual([400000, 350000, 300000, 250000, 200000, 150000, 100000, 50000, 0]);
    expect(released).toEqual(['1', '2']);
    expect(ladder.advance()).toBeNull();
    expect(ladder.assess('до 200000 ₽').action).toBe('exclude');
    expect(ladder.assess('from 100000 ₽').action).toBe('apply');
    expect(ladder.assess('').action).toBe('apply');
  });
  test('normalizes known periods and does not guess shift/project pay or unknown currencies', () => {
    const ladder = make();
    expect(vacancySalary('от 3000 ₽ в час')).toMatchObject({ min: 480000, max: Infinity });
    expect(ladder.assess('up to $24000 per year').action).toBe('exclude');
    for (const text of ['10000 ₽ за смену', '20000 ₽ за проект', 'Pay negotiable', '2000 XYZ']) {
      expect(ladder.assess(text).action).toBe('apply');
    }
    expect(make({ contacts: {} }).enabled).toBe(false);
  });
});
