const DEFAULT_STATE = {
  sheetUrl: "",
  startRow: 1,
  replayRow: 0,
  running: false,
  mode: "idle",
  currentRow: null,
  targetRow: null,
  lastProcessedRow: null,
  totalRows: null,
  lastError: "",
  logs: [],
  elevenLabsTabId: null,
  pendingDownloadName: null
};

const PROCESS_ALARM = "process-next-row";
let pendingDownloadNameCache = null;

chrome.runtime.onInstalled.addListener(() => {
  void initializeState();
});

chrome.runtime.onStartup.addListener(() => {
  void resumeIfNeeded();
  void restorePendingDownloadCache();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PROCESS_ALARM) {
    void processNextRow();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message).then(sendResponse);
  return true;
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const pendingName = pendingDownloadNameCache;
  if (!pendingName) {
    suggest();
    return;
  }

  const extension = getExtensionFromItem(item);
  suggest({
    filename: `${pendingName}${extension}`,
    conflictAction: "overwrite"
  });

  pendingDownloadNameCache = null;
  void setState({
    pendingDownloadName: null
  });

  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case "get-state":
      return { state: await getState() };
    case "save-draft":
      await saveDraft(message);
      return { ok: true };
    case "open-elevenlabs":
      return { tabId: await ensureElevenLabsTab() };
    case "start-batch":
      await startBatch(message.sheetUrl, message.startRow);
      return { ok: true };
    case "replay-row":
      await replayRow(message.sheetUrl, message.replayRow);
      return { ok: true };
    case "stop-run":
      await stopRun("Stopped by user.");
      return { ok: true };
    case "prepare-download":
      pendingDownloadNameCache = String(message.filenameBase);
      await setState({ pendingDownloadName: pendingDownloadNameCache });
      return { ok: true };
    default:
      return { ok: false, error: "Unknown message type." };
  }
}

async function initializeState() {
  const stored = await chrome.storage.local.get("runnerState");
  if (!stored.runnerState) {
    await chrome.storage.local.set({ runnerState: DEFAULT_STATE });
  }
  pendingDownloadNameCache = stored.runnerState?.pendingDownloadName || null;
}

async function resumeIfNeeded() {
  const state = await getState();
  pendingDownloadNameCache = state.pendingDownloadName || null;
  if (!state.running) {
    return;
  }
  await log(`Resuming ${state.mode} run from row ${state.currentRow || state.startRow}.`);
  await chrome.alarms.create(PROCESS_ALARM, { when: Date.now() + 500 });
}

async function saveDraft({ sheetUrl, startRow, replayRow }) {
  await setState({
    sheetUrl: sheetUrl || "",
    startRow: normalizeRow(startRow, 1),
    replayRow: normalizeRow(replayRow, 0)
  });
}

async function startBatch(sheetUrl, startRow) {
  const normalizedStart = normalizeRow(startRow, 1);
  validateSheetUrl(sheetUrl);

  await setState({
    sheetUrl,
    startRow: normalizedStart,
    running: true,
    mode: "batch",
    currentRow: normalizedStart,
    targetRow: null,
    lastError: "",
    pendingDownloadName: null
  });
  await log(`Batch started from row ${normalizedStart}.`);
  await chrome.alarms.create(PROCESS_ALARM, { when: Date.now() + 250 });
}

async function replayRow(sheetUrl, replayRowValue) {
  const normalizedRow = normalizeRow(replayRowValue, 0);
  validateSheetUrl(sheetUrl);
  if (!normalizedRow) {
    throw new Error("Replay row must be 1 or higher.");
  }

  await setState({
    sheetUrl,
    replayRow: normalizedRow,
    running: true,
    mode: "replay",
    currentRow: normalizedRow,
    targetRow: normalizedRow,
    lastError: "",
    pendingDownloadName: null
  });
  await log(`Replay requested for row ${normalizedRow}.`);
  await chrome.alarms.create(PROCESS_ALARM, { when: Date.now() + 250 });
}

async function stopRun(reason = "Run stopped.") {
  await chrome.alarms.clear(PROCESS_ALARM);
  pendingDownloadNameCache = null;
  await setState({
    running: false,
    mode: "idle",
    currentRow: null,
    targetRow: null,
    pendingDownloadName: null
  });
  await log(reason);
}

async function processNextRow() {
  const state = await getState();
  if (!state.running) {
    return;
  }

  try {
    const rows = await fetchSheetColumnH(state.sheetUrl);
    await setState({ totalRows: rows.length });

    const rowNumber = state.mode === "replay" ? state.targetRow : state.currentRow || state.startRow;
    const rowData = rows[rowNumber - 1];

    if (!rowData || !rowData.text) {
      if (state.mode === "replay") {
        throw new Error(`Row H${rowNumber} is empty or unavailable.`);
      }

      const nextRow = await findNextPopulatedRow(rows, rowNumber + 1);
      if (!nextRow) {
        await stopRun("Batch completed.");
        return;
      }

      await log(`Skipping empty row H${rowNumber}.`);
      await setState({ currentRow: nextRow });
      await chrome.alarms.create(PROCESS_ALARM, { when: Date.now() + 250 });
      return;
    }

    await log(`Processing row H${rowNumber}.`);
    const tabId = await ensureElevenLabsTab();
    await waitForTabReady(tabId);
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "process-text",
      payload: {
        text: rowData.text,
        rowNumber,
        filenameBase: String(rowNumber)
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Unknown content script failure.");
    }

    await setState({
      lastProcessedRow: rowNumber,
      currentRow: state.mode === "batch" ? rowNumber + 1 : null
    });
    await log(`Downloaded audio for row H${rowNumber} as ${rowNumber}.`);

    if (state.mode === "replay") {
      await stopRun(`Replay completed for row ${rowNumber}.`);
      return;
    }

    const nextRow = await findNextPopulatedRow(rows, rowNumber + 1);
    if (!nextRow) {
      await stopRun("Batch completed.");
      return;
    }

    await setState({ currentRow: nextRow });
    await chrome.alarms.create(PROCESS_ALARM, { when: Date.now() + 1000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setState({
      running: false,
      mode: "idle",
      lastError: message,
      pendingDownloadName: null
    });
    pendingDownloadNameCache = null;
    await chrome.alarms.clear(PROCESS_ALARM);
    await log(`Error: ${message}`);
  }
}

async function ensureElevenLabsTab() {
  const state = await getState();
  if (state.elevenLabsTabId) {
    try {
      const existing = await chrome.tabs.get(state.elevenLabsTabId);
      if (existing.id && existing.url?.startsWith("https://elevenlabs.io/")) {
        await chrome.tabs.update(existing.id, { active: true });
        return existing.id;
      }
    } catch {
      // The stored tab is gone; fall through to discover or create one.
    }
  }

  const tabs = await chrome.tabs.query({ url: ["https://elevenlabs.io/*"] });
  const matched = tabs[0];
  if (matched?.id) {
    await setState({ elevenLabsTabId: matched.id });
    await chrome.tabs.update(matched.id, { active: true });
    return matched.id;
  }

  const created = await chrome.tabs.create({
    url: "https://elevenlabs.io/app/text-to-speech",
    active: true
  });
  await setState({ elevenLabsTabId: created.id || null });
  return created.id;
}

async function waitForTabReady(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") {
    return;
  }

  await new Promise((resolve) => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function fetchSheetColumnH(sheetUrl) {
  const { spreadsheetId, gid } = parseSheetUrl(sheetUrl);
  const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
  const response = await fetch(exportUrl, { credentials: "include" });
  if (!response.ok) {
    throw new Error("Could not fetch Google Sheet. Make sure the sheet is accessible in Chrome.");
  }

  const csv = await response.text();
  const rows = parseCsv(csv);
  return rows.map((columns, index) => ({
    rowNumber: index + 1,
    text: (columns[7] || "").trim()
  }));
}

function parseSheetUrl(sheetUrl) {
  let url;
  try {
    url = new URL(sheetUrl);
  } catch {
    throw new Error("Enter a valid Google Sheets URL.");
  }

  const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    throw new Error("Could not read the spreadsheet ID from the URL.");
  }

  const gid = url.searchParams.get("gid") || extractGidFromHash(url.hash) || "0";
  return { spreadsheetId: match[1], gid };
}

function extractGidFromHash(hash) {
  const match = hash.match(/gid=([0-9]+)/);
  return match ? match[1] : null;
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

async function findNextPopulatedRow(rows, startAt) {
  for (let row = startAt; row <= rows.length; row += 1) {
    if (rows[row - 1]?.text) {
      return row;
    }
  }
  return null;
}

function validateSheetUrl(sheetUrl) {
  if (!sheetUrl || !sheetUrl.includes("docs.google.com/spreadsheets")) {
    throw new Error("Please enter a Google Sheets URL.");
  }
}

function normalizeRow(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

function getExtensionFromItem(item) {
  const parsed = item.filename?.match(/(\.[a-z0-9]+)$/i);
  return parsed ? parsed[1] : ".mp3";
}

async function getState() {
  const stored = await chrome.storage.local.get("runnerState");
  return {
    ...DEFAULT_STATE,
    ...(stored.runnerState || {})
  };
}

async function restorePendingDownloadCache() {
  const state = await getState();
  pendingDownloadNameCache = state.pendingDownloadName || null;
}

async function setState(patch) {
  const next = {
    ...(await getState()),
    ...patch
  };
  await chrome.storage.local.set({ runnerState: next });
  return next;
}

async function log(message) {
  const state = await getState();
  const logs = [...(state.logs || []), { time: new Date().toLocaleTimeString(), message }];
  while (logs.length > 18) {
    logs.shift();
  }
  await setState({ logs });
}
