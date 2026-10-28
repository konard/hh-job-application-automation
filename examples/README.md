# CV examples

`cv.ru.lino` and `cv.en.lino` are snapshots of the owner's saved HH.ru CVs in Links Notation. They are published with the owner's permission. Drafts awaiting review are kept separately and are not presented as saved CVs.

The Russian CV is the reference for the selected positions, their order and employment dates. The English CV must contain the same 12 positions with equivalent English titles and the same dates. Existing English descriptions are retained, including details absent from the Russian version.

HH.ru changes are prepared one position at a time. The owner reviews and saves each change. After a confirmed save, export the saved CVs again and update these examples on GitHub. Shared HH.ru experience entries need separate language-specific copies before translating them, so an English edit does not replace the Russian text.

## Synchronization status

Snapshot on 2026-10-28, after the owner saved both Capico steps:

- The Russian CV contains the saved AI-first Evirma, Capico and Kaiten descriptions, including the owner's edits to the proposed text.
- Both saved CVs contain the same 12 jobs, with matching order and dates. The latest three roles' technology lists match across languages, including Claude Code and Codex in all three and Hive Mind in Evirma.
- English Kaiten has the Development Team Lead title and July 2024–November 2025 dates, restoring the Evirma → Capico → Kaiten order. Its saved description includes the owner's addition about automatic conflict resolution for frequent merges from team members and AI agents. The owner also saved the equivalent Russian sentence; both snapshots include it.
- Evirma is complete in both languages: English contains “self-developed Hive Mind,” Russian contains “Hive Mind собственной разработки,” and each language-specific entry is selected only in its own CV.
- Capico is complete in both languages as AI Senior Engineer, November 2025–May 2026. The English copy is saved, the original Russian entry is deselected from English, and the Russian CV retains its original description.
- Older English job descriptions are unchanged from the initial export; the additional details listed below are retained for later Russian review.

A subsequent raw technology audit found incomplete About inventories and duplicate items that the
previous deduplicating parser had hidden. The reviewed plan consolidates 201 technical entries in
both About sections, preserves their biography/personal text, removes duplicates in both languages'
Deep.Foundation and LinksPlatform lists, and adds Lua to Russian ArtBridge from its English counterpart.
These changes require the owner's browser Save; they are not claimed as saved in this status note.
Run `bun run cv -- technologies --hh-browser-port 9351` for a fresh audit. Its verification covers
technology inventories, not the older prose differences below. The example files continue to show
only actual saved content, and are refreshed after each confirmed Save.

## English details to retain and consider adding to Russian later

These details already exist in the English CV. Keep them while editing English; adding them to Russian is a later, separately reviewed change.

- **Deep.Foundation:** RSS ingestion and frequency-based word-cloud visualization in the news analytics demo; developer-community bookkeeping in Deep.Chain; Discord as the platform for the JavaScript executor bot; GPT-4o question answering and potential applicability to other countries' laws in the legal-search bot; GPT-4o as the assistant in the smart-store web application; code behavior stored as links; HasuraStorage/minio named in the S3 integration description.
- **LinksPlatform:** task decomposition is explicit; Links Notation is described as a data exchange format/protocol.
- **Pegas:** form validation includes guided help.
- **ArtBridge:** Lua is listed among the technologies used.

The ELAR English description expands the Russian abbreviation “СУВ” as “database management system.” Verify that interpretation with the owner before propagating it; retain the original wording until reviewed.
