# RPG Tracker for SillyTavern

**Notice & Disclaimer:**
This extension was created with heavy assistance from AI. It is in an experimental stage, so feedback, bug reports, and suggestions are welcome!
You can check the changelog [here](https://github.com/Soyo5800/rpg-tracker-for-sillytavern/blob/e6b01fde6643a568cb533230759584c9d25b1e58/Changelog.md)

---

A React-based sidebar extension for SillyTavern designed to track RPG parameters (character statistics, profiles, inventories, quests, relationship metrics, and world states) without manually editing JSON files or complex system prompts.

---

## 🔍 Core Features

* **Character Management:** Track Status gauges, Integers, Text conditions, Profiles, Relations, Equipment/Inventory (Drag & Drop), and Quests.
* **World State:** Track Date, Time, Weather, Location, and dynamic World Events.
* **Timeline & Snapshot Tracking:** Automatic state rollback on message swipes or deletes. Attach customizable status snapshots (`Message Tracker`) or view turn-by-turn change logs (`Delta Log`).

---

## 🛠️ How to Use

### 1. Installation & Setup
1. Open SillyTavern Extensions menu -> **Install Extension** -> enter `https://github.com/Soyo5800/rpg-tracker-for-sillytavern`.
2. Enable **RPG Tracker** in Extension Settings.
3. Click the floating tracker button (top-left by default) to open the sidebar. *(Right-click button -> **Enable Drag** to reposition).*
4. Select your **Update Mode** in Settings (Gear Icon):
   * **Merged:** Automatically updates status during normal conversation turns.
   * **Separated (Recommended):** Injects read-only status for context. Updates are triggered manually.
   * **Isolated:** No prompt injection during normal turns. Manual updates only.
<img src="https://github.com/Soyo5800/rpg-traker-for-sillytavern/raw/af0c34e7a0817e7086740ed2a7e55f6787a305ff/trackerguide1.png" width="100%" alt="trackerguide1">

---

### 2. Sidebar Header Controls

* **`Update` Button (Play Icon):** Manually requests the LLM to analyze recent chat context and update parameters (available in Separated/Isolated modes).
* **`Turn Back` Button (Reset Arrow Icon):** Reverts manual edits and restores the original AI-generated status for the current turn.
* **`Prompt` Button (Pen Icon):** Opens system prompt, schema templates, and field guidelines editor.
* **`Settings` Button (Gear Icon):** Configure update modes, panel positions, visual themes, and snapshot backup limits.

---

### 3. Sidebar Navigation Tabs

#### 📊 Status Tab
* **`+ Add Character` / `Character List`:** Add new character sheets or reorder/manage preset templates.
* **`Sync Card` (Inside Character Editor):** Bind character sheets to active SillyTavern character cards or player personas. Save/load presets directly to/from card PNG metadata.
* **Dashboard Sub-Tabs:**
  * **Status:** Track Consumable/Stacking gauges, Integer stats, and short condition Text.
  * **Profile (Person Icon):** Store static text features (Race, Appearance, Personality).
  * **Relations (Heart Icon):** Track descriptions and numerical relationship metrics. Automatically cross-syncs values if both characters exist in the tracker.
  * **Inventory (Bag Icon - Player Only):** Manage equipped items and storage containers via Drag & Drop.
  * **Quests (Book Icon - Player Only):** Manage Main/Side quests with completion checkboxes.
* **Avatar Cropping:** Click a character avatar (except read-only personas) to crop profile pictures.
<img src="https://github.com/Soyo5800/rpg-traker-for-sillytavern/raw/af0c34e7a0817e7086740ed2a7e55f6787a305ff/trackerguide2.png" width="100%" alt="trackerguide2">
<img src="https://github.com/Soyo5800/rpg-traker-for-sillytavern/raw/af0c34e7a0817e7086740ed2a7e55f6787a305ff/trackerguide3.png" width="100%" alt="trackerguide3">

#### 🌐 World Tab
* Track **Date**, **Time**, **Weather**, and **Location** with lock toggles.
* Add and manage ongoing **World Events**.

#### ⚡ Function Tab
* **Tracker API Model:** Toggle **Use Separate Model** to run background status updates using a faster or lighter LLM model (e.g., `gemini-3.5-flash-lite`, `gpt-4o-mini`).
* **Context Limit Setting:** Set the maximum number of recent chat messages sent to the AI during manual updates or generation queries to optimize token usage.
* **Character Generator:** Enter a character name (or leave blank to auto-detect) and click **Generate NPC** or **Generate Player** to automatically create a structured sheet from chat history.
* **Active Add-ons:** Toggle specialized prompt instructions for **World Events**, **Dynamic Weather**, or **CYOA Mode** (interactive choices at response ends).

---

### 4. Message-Level Features

#### 📁 Message Tracker (Snapshots)
Click the **Message Tracker** button (ID card icon) located in the button group at the top-right of any chat message:
* Select specific World States or Character Parameters from that exact turn.
* Add optional custom notes to record milestone events.
* Directly edit or preview the raw JSON payload before attaching.
* Appends a clean, collapsible snapshot block at the bottom of the selected message text.
<img src="https://github.com/Soyo5800/rpg-traker-for-sillytavern/raw/af0c34e7a0817e7086740ed2a7e55f6787a305ff/trackerguide4.png" width="100%" alt="trackerguide4">

#### 📝 Tracker Changes (Delta Logs)
* Automatically displays a collapsible summary (`Tracker Changes`) at the bottom of AI messages.
* Shows exactly which parameters, equipment, items, or world states were updated during that specific turn.

---

## ⚠️ Warning & Compatibility

* Tested primarily on Gemini models (ranging from 2.5 to 3.5). JSON parsing stability and instruction following may vary across different LLMs.
* If you encounter bugs or have suggestions, feel free to submit feedback or open an issue!


## Scan a reply into RPG Tracker

Use **Scan / Update Tracker** in an AI message's action bar, beside **Add/Edit Message Tracker**. The existing Add/Edit action still edits message snapshots manually.

The scan reads only that reply's displayed swipe and applies supported facts to the **current chat tracker**. Existing named characters are updated; new named characters can be added with the information stated in the reply. Locked fields stay protected. Missing values are not invented. Manual message snapshots and prior recap blocks are excluded from extraction.

An explicit RPG_TRACKER JSON block can be applied without another model request. Narrative text uses one additional request through your configured SillyTavern connection (and the tracker model override, if enabled), so it consumes tokens and takes time. The button shows **Updating…** while running. No OOC phrase or automatic scan is required.

**Tracker Changes** on the selected reply shows accepted changes. The updated state is saved at the current timeline position, including when scanning an older reply. Scanning the same unchanged reply/swipe again is skipped, including after reload. A changed reply or different swipe can be scanned separately. Failed requests remain retryable; changing chat/swipe or the source text while extraction is running discards the stale result.

Release history is in [CHANGELOG.md](CHANGELOG.md).

## Suggest a field guideline

In **Prompt Editor → Field Definitions**, click **Suggest** beside a Status, Profile,
or Relationship guide. The AI writes a short instruction for that field and places it
in the editable textbox. Adjust the wording, then click **Save Changes**; **Cancel**
discards the draft.

Each suggestion uses one additional request through your configured SillyTavern
connection and tracker model override, if enabled. It sends the field's name, type,
limits and existing guide, without chat history or character values. Existing draft
language is preserved; empty guides default to English. If you edit the field while
waiting, your edit wins over the late AI result. Errors keep the existing text intact.

## Editing, ordering, and presets

- Drag the handle beside a character or a Profile/Status field to reorder it. On a keyboard, focus the handle, press Space, move with the arrow keys, and press Space again; Escape cancels the move. Status fields stay within their own group.
- **Apply to Chat** applies the editor draft. **Cancel** discards the draft. **Save Preset** stores a reusable template without applying it to the current chat.
- Preset contents are stored in your SillyTavern account settings on the server. Another device using the same server and account can load them; use **Refresh** to fetch changes made elsewhere. This is not real-time collaborative editing.
- Opening Character List migrates available older browser presets to account storage, retaining the browser copies as backups. Open the extension in the original browser **and origin/address** to recover browser-only presets. Missing copies are kept visible; JSON import/export remains available for recovery and moving between servers.
- Locks remain scoped to the current chat. Swipe/regenerate and AI updates preserve both a locked field and its value. Unlocked fields continue to follow the selected response. Unlocking a field explicitly allows subsequent updates again. Lock choices are stored in chat metadata, independently of individual response snapshots.

## Development

Use a Vite-compatible Node version (20.19+, 22.12+, or Node 24; Node 24 was tested).

```sh
npm ci
npm test
npm run build
```

`npm test` runs focused regression tests for locks, timeline restoration, sorting, preset migration/persistence, and accepted-change recaps. The test loader uses Node's experimental VM modules because the extension's native browser modules are ESM while the package metadata remains CommonJS.

`npm run build` compiles `src/main.jsx` into the extension's tracked `dist/bundle.js`, including its styles. Run it after React/CSS changes before installing or updating the extension in SillyTavern. `npm run build:watch` rebuilds while editing; reload SillyTavern to load the updated bundle. Native integration modules under `src/core` are also served directly by SillyTavern, so distribute the full extension, not only the bundle.
