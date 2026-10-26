/**
 * hh.ru's own words, in each language its interface is shown in (Russian, English). The page's
 * markup (data-qa, the color of a status) is read first; these are for what only the text tells.
 * Functions that run in the page get them as strings (a RegExp does not pass into the page)
 *
 * @module hh-words
 */

/** The status of a chat, and the title of its message: the employer rejected the application */
export const REJECTION_WORD = /^(?:отказ|rejection|refusal|declined)$/iu;

/** The title of the user's own first message in a chat: the application with its cover letter */
export const APPLICATION_WORD = /^(?:отклик на вакансию|vacancy application|application for (?:the|a) vacancy|response to (?:the|a) vacancy|bewerbung)$/iu;

/**
 * hh.ru's notice that a recruiter bot has passed the answers on, so it asks nothing more:
 * «Спасибо за ответы! Мы передали их работодателю», «Ваши ответы отправлены работодателю»
 */
export const ANSWERS_PASSED = /(?:ответы|answers)[^.!?]{0,40}(?:отправлен|передан|sent|passed|forwarded)|передали\s+(?:их|ответы)\s+работодател|(?:sent|passed|forwarded)\s+them\s+(?:on\s+)?to\s+the\s+employer/iu;

/** Shown in place of the reply field: «Работодатель отключил переписку по данной вакансии» */
export const TURNED_OFF_WORDS = String.raw`отключил\p{L}*\s+переписку|(?:disabled|turned off|switched off|closed)\s+(?:the\s+)?(?:chat|messag\p{L}*|correspondence|conversation)`;

/** hh.ru's own message under an invitation */
export const INVITE_NOTICE = /^(?:ответьте на приглашение, даже если оно вам не интересно|(?:please\s+)?(?:respond|reply) to (?:the|this) invitation,? even if)/iu;

/** Texts hh.ru shows once an application has been sent */
export const RESPONSE_SENT_TEXTS = ['Вы откликнулись', 'Вы уже откликались', 'Отклик отправлен', 'Ваш отклик отправлен',
  'You have applied', 'You applied', 'You have already applied', 'Application sent', 'Your application has been sent'];

/** The vacancy page of a vacancy closed to this account */
export const UNAVAILABLE_TEXT = String.raw`Вам недоступна эта вакансия|(?:this\s+)?vacancy is (?:not available|unavailable) (?:to|for) you`;

/** Texts of the hh.ru captcha dialog and captcha page */
export const CAPTCHA_TEXTS = ['Пройдите капчу', 'введите текст с картинки', 'что вы не робот',
  'enter the text from the image', 'text from the picture', 'not a robot', 'complete the captcha'];

/** hh.ru's notice in a response form for a resume hidden from employers; lowercase, ё as е */
export const RESUME_HIDDEN_NOTICES = ['поменяйте видимость резюме', 'change the visibility of your resume',
  'change your resume visibility', 'change resume visibility'];

/** The direct application modal: the vacancy is applied to on the employer's site */
export const DIRECT_APPLICATION_MARKERS = ['прямым откликом', 'сайте работодателя', "employer's website", 'employer website', 'direct application'];

/** Buttons that close a popup without sending */
export const CLOSE_WORDS = String.raw`^(?:закрыть|отмена|отменить|close|cancel)$`;

/** A toggle that opens the cover letter field */
export const COVER_LETTER_TEXTS = ['Сопроводительное письмо', 'сопроводительное', 'Cover letter', 'cover letter'];

/**
 * The language hh.ru's page is shown in
 * @param {string} lang - document.documentElement.lang
 * @returns {'ru'|'en'}
 */
export const pageLanguage = (lang) => (/^en/i.test(String(lang ?? '')) ? 'en' : 'ru');
