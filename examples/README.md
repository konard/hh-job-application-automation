# CV examples and operator profile

[`operator.lenv`](operator.lenv) is the reusable silent startup profile. See the
[operating guide](../docs/OPERATING_GUIDE.md) for its command and full workflow.

`cv.ru.lino` and `cv.en.lino` are snapshots of the owner's saved HH.ru CVs in Links Notation. They are published with the owner's permission. Drafts awaiting review are kept separately and are not presented as saved CVs.

The Russian CV is the reference for the selected positions, their order and employment dates. The English CV must contain the same 12 positions with equivalent English titles and the same dates. Existing English descriptions are retained, including details absent from the Russian version.

HH.ru changes are prepared one position at a time. The owner reviews and saves each change. After a confirmed save, export the saved CVs again and update these examples on GitHub. Shared HH.ru experience entries need separate language-specific copies before translating them, so an English edit does not replace the Russian text.

## Synchronization status

Verified on 2026-11-03 against the actual saved exports:

- Both snapshots contain the same 12 positions, matching order and employment dates.
- Both About inventories contain 201 technologies, with no missing entries or duplicate canonical names.
- Position lists have no pending counterpart/formatting differences. Verified aliases appear inline;
  categories are alphabetical, `k8s` is lowercase, and `npm (JS/TS)` stays distinct from Nginx Proxy Manager.
- The dangling `Yandex Cloud/` entry has been removed. It is not a second technology; internal slashes
  in real names such as `CI/CD` and `C/C++` are preserved.
- Both Kaiten descriptions include the owner's billing-system work. English Evirma is `Evirma LLC`,
  and ELAR's English narrative names the Interaction Management System integration correctly.
- City, company website, industry IDs/labels and dates are retained by Links Notation import/export.
  Biography, job narratives and owner edits are preserved.
- These are saved snapshots, not proposed drafts. A closed editor alone never counts as a Save.

This is a dated verification, not a promise that later edits need no review. Run
`bun run cv -- technologies` while an authenticated automation browser is available for a fresh
private audit. Add `--review --snapshots-out examples` to review each proposed update in the CV
slot; the owner presses final Save. Publishing snapshots remains a separate explicit opt-in.
A technology audit verifies inventories and position lists, not sentence-for-sentence equivalence
of older translated narratives. The retained English details below remain available for a later
separately reviewed Russian expansion.

## English details to retain and consider adding to Russian later

These details already exist in the English CV. Keep them while editing English; adding them to Russian is a later, separately reviewed change.

- **Deep.Foundation:** RSS ingestion and frequency-based word-cloud visualization in the news analytics demo; developer-community bookkeeping in Deep.Chain; Discord as the platform for the JavaScript executor bot; GPT-4o question answering and potential applicability to other countries' laws in the legal-search bot; GPT-4o as the assistant in the smart-store web application; code behavior stored as links; HasuraStorage/minio named in the S3 integration description.
- **LinksPlatform:** task decomposition is explicit; Links Notation is described as a data exchange format/protocol.
- **Pegas:** form validation includes guided help.
- **ArtBridge:** Lua is listed among the technologies used.

ELAR's saved English description now uses “Interaction Management System, IMS” for the
Gazprombank integration platform; the obsolete “database management system” expansion was corrected.
