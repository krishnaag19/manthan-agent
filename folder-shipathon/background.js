// ============================================================
// background.js — Service Worker
// Handles: OAuth tokens, Gmail API fetching, Pipeline API calls
// ============================================================

// ── Message Router ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "FETCH_EMAIL")       { handleFetchEmail(request.messageId, sendResponse); return true; }
  if (request.type === "RUN_PIPELINE")      { handleRunPipeline(request.payload, sendResponse);  return true; }
  if (request.type === "GET_THREAD")        { handleFetchThread(request.threadId, sendResponse); return true; }
  if (request.type === "GET_SETTINGS")      { handleGetSettings(sendResponse);                   return true; }
});

// ── OAuth Token Helper ───────────────────────────────────────
async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

// ── Fetch a Single Email via Gmail API ───────────────────────
async function handleFetchEmail(messageId, sendResponse) {
  try {
    const token = await getAuthToken();
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
    const data = await res.json();
    const parsed = parseEmailPayload(data);
    sendResponse({ success: true, email: parsed });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ── Fetch Full Thread ────────────────────────────────────────
async function handleFetchThread(threadId, sendResponse) {
  try {
    const token = await getAuthToken();
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
    const data = await res.json();
    const messages = (data.messages || []).map(parseEmailPayload);
    sendResponse({ success: true, thread: messages });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ── Parse Gmail API Payload into clean object ────────────────
function parseEmailPayload(data) {
  const headers   = data.payload?.headers || [];
  const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";

  const subject   = getHeader("Subject");
  const from      = getHeader("From");
  const to        = getHeader("To");
  const date      = getHeader("Date");
  const messageId = getHeader("Message-ID");
  const body      = extractBody(data.payload);

  return { id: data.id, threadId: data.threadId, subject, from, to, date, messageId, body, snippet: data.snippet };
}

// ── Recursively extract plain-text body from MIME parts ──────
function extractBody(payload) {
  if (!payload) return "";

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
      }
    }
    // fallback: recurse into nested parts
    for (const part of payload.parts) {
      const result = extractBody(part);
      if (result) return result;
    }
  }

  if (payload.body?.data) {
    return atob(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"));
  }

  return "";
}

// ── Send Email Data to Your Pipeline API ─────────────────────
async function handleRunPipeline(payload, sendResponse) {
  try {
    const settings = await getStoredSettings();

    if (!settings.pipelineUrl) {
      sendResponse({ success: false, error: "Pipeline URL not configured. Open the extension popup to set it." });
      return;
    }

    const headers = { "Content-Type": "application/json" };
    if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;

    const body = {
      query:   payload.body,
      context: {
        subject:   payload.subject,
        sender:    payload.from,
        recipient: payload.to,
        date:      payload.date,
        thread:    payload.thread || []
      }
    };

    const res = await fetch(settings.pipelineUrl, {
      method:  "POST",
      headers: headers,
      body:    JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Pipeline error (${res.status}): ${errText}`);
    }

    const data = await res.json();

    // Normalize: support { draft, reply, message, response } keys
    const draft = data.draft || data.reply || data.message || data.response || "No draft returned.";
    sendResponse({ success: true, draft, raw: data });

  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ── Settings Helpers ─────────────────────────────────────────
async function getStoredSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["pipelineUrl", "apiKey", "autoFetch"], (result) => {
      resolve({
        pipelineUrl: result.pipelineUrl || "",
        apiKey:      result.apiKey      || "",
        autoFetch:   result.autoFetch   ?? false
      });
    });
  });
}

async function handleGetSettings(sendResponse) {
  const settings = await getStoredSettings();
  sendResponse({ success: true, settings });
}
