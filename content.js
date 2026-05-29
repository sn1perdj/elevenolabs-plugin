chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "process-text") {
    return false;
  }

  void processText(message.payload)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

async function processText({ text }) {
  const textarea = await waitForElement(findTextInput, 30000, "Could not find the ElevenLabs text input.");
  await fillInput(textarea, text);

  const generateButton = await waitForElement(findGenerateButton, 15000, "Could not find the Generate button.");
  generateButton.click();

  await waitForGenerationToFinish(generateButton);
  const downloadButton = await waitForElement(findDownloadButton, 120000, "Audio was not ready for download.");

  downloadButton.click();
  await delay(3000);
}

function findTextInput() {
  const selectors = [
    'textarea',
    '[contenteditable="true"]',
    'div[role="textbox"]'
  ];

  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll(selector));
    const candidate = elements.find((element) => isVisible(element) && isWritable(element));
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function findGenerateButton() {
  const exactSelectors = [
    'button[data-testid="tts-generate"]',
    'button[aria-label*="Generate speech"]'
  ];

  for (const selector of exactSelectors) {
    const match = Array.from(document.querySelectorAll(selector)).find((element) => isVisible(element));
    if (match) {
      return match;
    }
  }

  return findButtonByText([
    "Generate speech",
    "Generate",
    "Convert"
  ]);
}

function findDownloadButton() {
  const exactSelectors = [
    'button[aria-label*="Download"]',
    'a[aria-label*="Download"]'
  ];

  for (const selector of exactSelectors) {
    const match = Array.from(document.querySelectorAll(selector)).find(
      (element) => isVisible(element) && isInteractive(element)
    );
    if (match) {
      return match;
    }
  }

  const direct = findButtonByText([
    "Download",
    "Download audio",
    "MP3"
  ]);

  if (direct) {
    return direct;
  }

  const links = Array.from(document.querySelectorAll('a, button'));
  return links.find((element) => {
    const text = normalizeText(element.textContent);
    const aria = normalizeText(element.getAttribute("aria-label"));
    return (
      isVisible(element) &&
      isInteractive(element) &&
      (text.includes("download") || aria.includes("download"))
    );
  }) || null;
}

function findButtonByText(labels) {
  const buttons = Array.from(document.querySelectorAll("button, a, [role='button']"));
  return buttons.find((button) => {
    if (!isVisible(button) || !isInteractive(button)) {
      return false;
    }
    const text = normalizeText(button.textContent);
    const aria = normalizeText(button.getAttribute("aria-label"));
    return labels.some((label) => {
      const normalized = normalizeText(label);
      return text.includes(normalized) || aria.includes(normalized);
    });
  }) || null;
}

async function fillInput(element, text) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    element.focus();
    element.value = "";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.value = text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  element.focus();
  document.execCommand("selectAll", false);
  document.execCommand("delete", false);
  document.execCommand("insertText", false, text);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function isWritable(element) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return !element.disabled && !element.readOnly;
  }
  return element.getAttribute("contenteditable") === "true" || element.getAttribute("role") === "textbox";
}

function isVisible(element) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
}

function isInteractive(element) {
  if (element.hasAttribute("disabled")) {
    return false;
  }
  if (element.getAttribute("aria-disabled") === "true") {
    return false;
  }
  if (element.dataset.loading === "true") {
    return false;
  }
  return true;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

async function waitForGenerationToFinish(generateButton) {
  const timeoutMs = 120000;
  const startedAt = Date.now();
  let sawBusyState = false;

  while (Date.now() - startedAt < timeoutMs) {
    const currentButton = findGenerateButton() || generateButton;
    const isBusy = currentButton?.dataset?.loading === "true" || currentButton?.hasAttribute("disabled");

    if (isBusy) {
      sawBusyState = true;
    }

    if (sawBusyState && !isBusy) {
      await delay(800);
      return;
    }

    if (!sawBusyState && Date.now() - startedAt > 3000) {
      return;
    }

    await delay(400);
  }

  throw new Error("Timed out waiting for speech generation to finish.");
}

async function waitForElement(getter, timeoutMs, errorMessage) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const element = getter();
    if (element) {
      return element;
    }
    await delay(500);
  }
  throw new Error(errorMessage);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
