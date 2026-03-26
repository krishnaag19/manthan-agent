// ============================================================
// popup.js — Settings Popup Logic
// ============================================================

const pipelineInput = document.getElementById("pipeline-url");
const apiKeyInput   = document.getElementById("api-key");
const autoFetchChk  = document.getElementById("auto-fetch");
const saveBtn       = document.getElementById("save-btn");
const testBtn       = document.getElementById("test-btn");
const statusBadge   = document.getElementById("status-badge");

// ── Load saved settings on open ──────────────────────────
chrome.storage.sync.get(["pipelineUrl", "apiKey", "autoFetch"], (data) => {
  if (data.pipelineUrl) pipelineInput.value = data.pipelineUrl;
  if (data.apiKey)      apiKeyInput.value   = data.apiKey;
  autoFetchChk.checked = !!data.autoFetch;
});

// ── Save ──────────────────────────────────────────────────
saveBtn.addEventListener("click", () => {
  const pipelineUrl = pipelineInput.value.trim();
  const apiKey      = apiKeyInput.value.trim();
  const autoFetch   = autoFetchChk.checked;

  if (pipelineUrl && !isValidUrl(pipelineUrl)) {
    showStatus("Invalid URL format.", "error");
    return;
  }

  chrome.storage.sync.set({ pipelineUrl, apiKey, autoFetch }, () => {
    showStatus("Settings saved! ✓", "success");
  });
});

// ── Test Connection ───────────────────────────────────────
testBtn.addEventListener("click", async () => {
  const url    = pipelineInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  if (!url) { showStatus("Enter a pipeline URL first.", "error"); return; }

  testBtn.textContent = "Testing...";
  testBtn.disabled    = true;

  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(url, {
      method:  "POST",
      headers: headers,
      body:    JSON.stringify({ query: "ping", context: { subject: "test" } })
    });

    if (res.ok) {
      showStatus(`Connected! Status ${res.status} ✓`, "success");
    } else {
      showStatus(`Server returned ${res.status}`, "error");
    }
  } catch (err) {
    showStatus(`Connection failed: ${err.message}`, "error");
  } finally {
    testBtn.textContent = "Test Connection";
    testBtn.disabled    = false;
  }
});

// ── Helpers ───────────────────────────────────────────────
function showStatus(msg, type) {
  statusBadge.textContent = msg;
  statusBadge.className   = `show ${type}`;
  setTimeout(() => { statusBadge.className = ""; }, 3500);
}

function isValidUrl(str) {
  try { new URL(str); return true; } catch { return false; }
}
