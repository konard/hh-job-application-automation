import { describe, test, assert } from 'test-anywhere';
import { assertHhExperienceTarget, industryPrefix, verifyHhSavedForm } from '../src/hh-cv-editor.mjs';

describe('opened workplace identity', () => {
  test('a neighbouring language entry is rejected before any field changes', () => {
    const target = { company: 'Example', title: 'AI Tech Lead', description: 'Исходное описание.' };
    assert.throws(() => assertHhExperienceTarget({ ...target, description: 'English copy.' }, target), /does not match/);
    assert.throws(() => assertHhExperienceTarget({ ...target, title: 'Other position' }, target), /does not match/);
    assert.throws(() => assertHhExperienceTarget({ ...target, url: 'https://hh.ru/profile/edit/experience/12' }, { ...target, entryId: '1' }), /does not match/);
    assertHhExperienceTarget({ ...target, url: 'https://hh.ru/profile/edit/experience/1' }, { ...target, entryId: '1' });
    assertHhExperienceTarget(target, target);
  });
});

describe('HH.ru CV save verification', () => {
  const form = {
    company: 'Example', title: 'AI Tech Lead', description: 'Owner added this detail.',
    startMonth: 'Май', startYear: '2026', current: true,
    resumes: [{ hash: 'en', checked: true }, { hash: 'ru', checked: false }],
  };
  const job = { company: 'Example', position: 'AI Tech Lead', start: '2026-05', end: null, description: form.description };
  const resumes = [
    { hash: 'en', cv: { jobs: [job] } },
    { hash: 'ru', cv: { jobs: [{ ...job, description: 'Исходное описание.' }] } },
  ];
  test('preserves owner edits and verifies English-only selection', () => {
    assert.equal(verifyHhSavedForm(form, resumes), true);
    assert.equal(verifyHhSavedForm({ ...form, description: 'Original prefill, not the owner edit.' }, resumes), false);
    assert.equal(verifyHhSavedForm({ ...form, startYear: '2025' }, resumes), false);
    assert.equal(verifyHhSavedForm(form, [resumes[0]]), false);
    assert.equal(verifyHhSavedForm(form, [resumes[0], { hash: 'ru', cv: { jobs: [job] } }]), false);
  });
  test('a deselection is checked against the export, not treated as deletion', () => {
    const detached = { ...form, resumes: [{ hash: 'en', checked: false }, { hash: 'ru', checked: true }] };
    assert.equal(verifyHhSavedForm(detached, [{ hash: 'en', cv: { jobs: [] } }, { hash: 'ru', cv: { jobs: [job] } }]), true);
    assert.equal(verifyHhSavedForm(detached, resumes), false);
  });
  test('an incomplete form is never confirmed as saved', () => {
    assert.equal(verifyHhSavedForm({ ...form, startMonth: '' }, resumes), false);
    assert.equal(verifyHhSavedForm({ ...form, current: false, endMonth: '', endYear: '' }, resumes), false);
    assert.equal(verifyHhSavedForm({ ...form, resumes: [] }, resumes), false);
  });
});

describe('HH.ru industry labels', () => {
  test('commas inside a label are retained, with the longest exact prefix chosen', () => {
    const long = 'Marketing, Advertising, Designer, Event and PR Agencies';
    assert.equal(industryPrefix(`${long}, Consulting Services`, ['Marketing', long]), long);
    assert.equal(industryPrefix('Consulting Services, Marketing', ['Consulting', 'Consulting Services']), 'Consulting Services');
    assert.equal(industryPrefix('Unknown label', ['Consulting Services']), null);
  });
});
