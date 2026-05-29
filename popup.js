const els = {
  sheetUrl: document.getElementById("sheetUrl"),
  startRow: document.getElementById("startRow"),
  replayRow: document.getElementById("replayRow"),
  openTabBtn: document.getElementById("openTabBtn"),
  startBtn: document.getElementById("startBtn"),
  replayBtn: document.getElementById("replayBtn"),
  stopBtn: document.getElementById("stopBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  statusBadge: document.getElementById("statusBadge"),
  modeLabel: document.getElementById("modeLabel"),
  currentRowValue: document.getElementById("currentRowValue"),
  lastProcessedValue: document.getElementById("lastProcessedValue"),
  totalRowsValue: document.getElementById("totalRowsValue"),
  lastErrorValue: document.getElementById("lastErrorValue"),
  logList: document.getElementById("logList")
};

async function sendMessage(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function renderLogs(logs = []) {
  els.logList.innerHTML = "";
  if (!logs.length) {
    const item = document.createElement("li");
    item.className = "placeholder";
    item.textContent = "No activity yet.";
    els.logList.appendChild(item);
    return;
  }

  logs.slice().reverse().forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = `${entry.time}  ${entry.message}`;
    els.logList.appendChild(item);
  });
}

function renderState(state) {
  els.sheetUrl.value = state.sheetUrl || "";
  els.startRow.value = state.startRow || "";
  els.replayRow.value = state.replayRow || "";

  const badgeText = state.running ? "Running" : state.lastError ? "Attention" : "Idle";
  els.statusBadge.textContent = badgeText;
  els.statusBadge.className = `badge ${state.running ? "running" : state.lastError ? "error" : "idle"}`;
  els.modeLabel.textContent = state.running
    ? state.mode === "replay"
      ? `Replay mode for row ${state.targetRow || "-"}`
      : "Batch mode in progress"
    : "No active run";

  els.currentRowValue.textContent = state.currentRow || "-";
  els.lastProcessedValue.textContent = state.lastProcessedRow || "-";
  els.totalRowsValue.textContent = state.totalRows || "-";
  els.lastErrorValue.textContent = state.lastError || "None";

  renderLogs(state.logs || []);
}

async function refreshState() {
  const response = await sendMessage("get-state");
  if (response?.state) {
    renderState(response.state);
  }
}

async function persistDraft() {
  await sendMessage("save-draft", {
    sheetUrl: els.sheetUrl.value.trim(),
    startRow: Number(els.startRow.value || 1),
    replayRow: Number(els.replayRow.value || 0)
  });
}

els.sheetUrl.addEventListener("input", persistDraft);
els.startRow.addEventListener("input", persistDraft);
els.replayRow.addEventListener("input", persistDraft);

els.openTabBtn.addEventListener("click", async () => {
  await persistDraft();
  await sendMessage("open-elevenlabs");
});

els.startBtn.addEventListener("click", async () => {
  await persistDraft();
  await sendMessage("start-batch", {
    sheetUrl: els.sheetUrl.value.trim(),
    startRow: Number(els.startRow.value || 1)
  });
  await refreshState();
});

els.replayBtn.addEventListener("click", async () => {
  await persistDraft();
  await sendMessage("replay-row", {
    sheetUrl: els.sheetUrl.value.trim(),
    replayRow: Number(els.replayRow.value || 0)
  });
  await refreshState();
});

els.stopBtn.addEventListener("click", async () => {
  await sendMessage("stop-run");
  await refreshState();
});

els.refreshBtn.addEventListener("click", refreshState);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.runnerState) {
    return;
  }
  renderState(changes.runnerState.newValue);
});

refreshState();
