/** Public CV content from HH's HTML export; no contacts, salary or account state. */
export function readResumeExportDom() {
  const text = element => element?.innerText.trim() ?? '';
  const skillGroup = (...names) => [...document.querySelectorAll('.resume-skils')]
    .find(group => names.includes(text(group.querySelector('.bloko-form-hint'))));
  return {
    name: text(document.querySelector('.resume__title')),
    title: text(document.querySelector('.resume__position')),
    updated: document.body.innerText.match(/(?:Резюме обновлено|Resume updated|Updated)[^\n]*/)?.[0].trim() ?? '',
    keySkills: [...skillGroup('Навыки', 'Skills', 'Key skills')?.querySelectorAll('.resume-skils__item span') ?? []]
      .map(span => text(span).replace(/;$/, '').trim()).filter(Boolean),
    jobs: [...document.querySelectorAll('.resume-experience')].map(job => {
      const position = job.querySelector('.resume-experience__position');
      const info = text(job.querySelector('.info'));
      const website = info.match(/(?:^|,\s*)((?:https?:\/\/)?(?:[\p{L}\d-]+\.)+[\p{L}]{2,}(?:[/?#][^\s]*)?)\s*$/iu);
      const area = (website ? info.slice(0, website.index) : info).replace(/,\s*$/, '').trim();
      const industries = [];
      let parent = '';
      for (const child of job.children) {
        if (child === position) break;
        if (child.tagName === 'P' && !child.className) parent = text(child);
        if (child.tagName === 'UL') {
          for (const leaf of child.querySelectorAll('li')) industries.push({ name: text(leaf), parent });
        }
      }
      return {
        company: text(job.querySelector('.resume-experience__company')), position: text(position),
        period: text(job.querySelector('.bloko-form-hint')).replace(/\s+/g, ' '),
        description: [...job.querySelectorAll('.resume-experience__position ~ p')].map(text).join('\n'),
        area, website: website?.[1] ?? '', industries,
      };
    }),
    about: text(skillGroup('Обо мне', 'About me', 'About')),
  };
}

/** Resolve localized export labels to IDs shared by both languages and by the editor. */
export function attachIndustryIds(resume, tree) {
  const entries = tree.flatMap(group => group.industries.map(item => ({ id: item.id, name: item.name, parent: group.name })));
  const normalize = text => String(text).replace(/\s+/g, ' ').trim();
  return { ...resume, jobs: resume.jobs.map(job => ({ ...job, industries: job.industries.map(industry => {
    let matches = entries.filter(item => normalize(item.name) === normalize(industry.name));
    if (matches.length > 1) matches = matches.filter(item => !industry.parent || normalize(item.parent) === normalize(industry.parent));
    if (matches.length !== 1) throw new Error(`No unique industry ID for exported label: ${industry.name}`);
    return matches[0];
  }) })) };
}
