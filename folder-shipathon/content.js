// ============================================================
// content.js — Gmail Content Script
// Handles: Email detection, Sidebar injection, Draft insertion
// ============================================================

(function () {
  "use strict";

  // ── State ─────────────────────────────────────────────────
  let sidebarEl       = null;
  let currentEmail    = null;
  let lastMessageId   = null;
  let isProcessing    = false;

  // ── Boot ──────────────────────────────────────────────────
  init();

  function init() {
    injectSidebar();
    watchForEmailOpen();
  }

  // ── MutationObserver: detect when an email is opened ──────
  function watchForEmailOpen() {
    const observer = new MutationObserver(debounce(() => {
      detectOpenEmail();
    }, 400));

    observer.observe(document.body, { childList: true, subtree: true });
    // Also run once on load
    setTimeout(detectOpenEmail, 1500);
  }

  function detectOpenEmail() {
    // Gmail stable selectors (verified 2025)
    const msgContainer = document.querySelector('[data-message-id]');
    if (!msgContainer) return;

    const messageId = msgContainer.getAttribute('data-message-id');
    if (!messageId || messageId === lastMessageId) return;

    lastMessageId = messageId;

    // Extract from DOM as a fast preview (Gmail API fetch happens on demand)
    const subject  = document.querySelector('h2.hP')?.innerText?.trim()          || "(No Subject)";
    const fromEl   = document.querySelector('.gD');
    const from     = fromEl?.getAttribute('email') || fromEl?.innerText?.trim()  || "(Unknown Sender)";
    const bodyEl   = document.querySelector('.a3s.aiL');
    const body     = bodyEl?.innerText?.trim()                                   || "";

    // Try to get thread ID from URL
    const threadIdMatch = window.location.hash.match(/#(?:inbox|sent|all|search\/[^/]+)\/([a-f0-9]+)/);
    const threadId = threadIdMatch?.[1] || null;

    currentEmail = { messageId, threadId, subject, from, body };

    updateSidebarEmailInfo(currentEmail);
    showSidebar();
  }

  // ── Sidebar: Create & Inject ───────────────────────────────
  function injectSidebar() {
    if (document.getElementById("gaia-sidebar")) return;

    sidebarEl = document.createElement("div");
    sidebarEl.id = "gaia-sidebar";
    sidebarEl.innerHTML = getSidebarHTML();
    document.body.appendChild(sidebarEl);

    // Wire up buttons
    sidebarEl.querySelector("#gaia-close-btn").addEventListener("click", hideSidebar);
    sidebarEl.querySelector("#gaia-generate-btn").addEventListener("click", onGenerateClick);
    sidebarEl.querySelector("#gaia-insert-btn").addEventListener("click", onInsertClick);
    sidebarEl.querySelector("#gaia-copy-btn").addEventListener("click", onCopyClick);
    sidebarEl.querySelector("#gaia-regen-btn").addEventListener("click", onGenerateClick);
    sidebarEl.querySelector("#gaia-toggle-btn").addEventListener("click", toggleSidebar);
  }

  function getSidebarHTML() {
    return `
      <div id="gaia-header">
        <div id="gaia-header-left">
          <span id="gaia-logo">✦</span>
          <span id="gaia-title">Draft Agent</span>
        </div>
        <div id="gaia-header-right">
          <button id="gaia-toggle-btn" title="Minimize">−</button>
          <button id="gaia-close-btn" title="Close">✕</button>
        </div>
      </div>

      <div id="gaia-body">
        <div id="gaia-email-info">
          <div class="gaia-info-row">
            <span class="gaia-label">FROM</span>
            <span id="gaia-from" class="gaia-value">—</span>
          </div>
          <div class="gaia-info-row">
            <span class="gaia-label">SUBJECT</span>
            <span id="gaia-subject" class="gaia-value">—</span>
          </div>
        </div>

        <div id="gaia-idle-state">
          <div id="gaia-idle-icon">✦</div>
          <p>Open an email, then click<br><strong>Generate Draft</strong></p>
        </div>

        <div id="gaia-loading-state" class="gaia-hidden">
          <div id="gaia-spinner"></div>
          <p id="gaia-loading-text">Running pipeline...</p>
          <div id="gaia-pipeline-steps">
            <div class="gaia-step" id="step-fetch">
              <span class="gaia-step-dot"></span> Data Fetcher
            </div>
            <div class="gaia-step" id="step-transform">
              <span class="gaia-step-dot"></span> Data Transformer
            </div>
            <div class="gaia-step" id="step-plot">
              <span class="gaia-step-dot"></span> Data Plotter
            </div>
            <div class="gaia-step" id="step-report">
              <span class="gaia-step-dot"></span> Report Maker
            </div>
            <div class="gaia-step" id="step-fact">
              <span class="gaia-step-dot"></span> Fact Checker
            </div>
          </div>
        </div>

        <div id="gaia-result-state" class="gaia-hidden">
          <div id="gaia-draft-label">GENERATED DRAFT</div>
          <div id="gaia-draft-box" contenteditable="true" spellcheck="true"></div>
          <div id="gaia-result-actions">
            <button id="gaia-regen-btn" class="gaia-btn gaia-btn-secondary">↺ Regenerate</button>
            <button id="gaia-copy-btn" class="gaia-btn gaia-btn-secondary">⎘ Copy</button>
            <button id="gaia-insert-btn" class="gaia-btn gaia-btn-primary">↳ Insert into Reply</button>
          </div>
        </div>

        <div id="gaia-error-state" class="gaia-hidden">
          <div id="gaia-error-icon">⚠</div>
          <p id="gaia-error-text">Something went wrong.</p>
          <button class="gaia-btn gaia-btn-secondary" onclick="document.getElementById('gaia-generate-btn').click()">Try Again</button>
        </div>
      </div>

      <div id="gaia-footer">
        <button id="gaia-generate-btn" class="gaia-btn gaia-btn-primary gaia-btn-full">
          ✦ Generate Draft
        </button>
      </div>

      <div id="gaia-minimized" class="gaia-hidden">
        <span>✦</span>
      </div>
    `;
  }

  // ── Sidebar State Management ───────────────────────────────
  function showSidebar() {
    if (sidebarEl) sidebarEl.classList.add("gaia-visible");
  }

  function hideSidebar() {
    if (sidebarEl) sidebarEl.classList.remove("gaia-visible");
    lastMessageId = null; // allow re-detection
  }

  function toggleSidebar() {
    const body = sidebarEl.querySelector("#gaia-body");
    const footer = sidebarEl.querySelector("#gaia-footer");
    const mini = sidebarEl.querySelector("#gaia-minimized");
    const btn = sidebarEl.querySelector("#gaia-toggle-btn");

    const isMin = body.classList.contains("gaia-hidden");
    body.classList.toggle("gaia-hidden", !isMin);
    footer.classList.toggle("gaia-hidden", !isMin);
    mini.classList.toggle("gaia-hidden", isMin);
    btn.textContent = isMin ? "−" : "□";
  }

  function setState(state) {
    // states: idle | loading | result | error
    const states = ["idle", "loading", "result", "error"];
    states.forEach(s => {
      const el = sidebarEl.querySelector(`#gaia-${s}-state`);
      if (el) el.classList.toggle("gaia-hidden", s !== state);
    });
  }

  function updateSidebarEmailInfo(email) {
    if (!sidebarEl) return;
    const fromEl    = sidebarEl.querySelector("#gaia-from");
    const subjectEl = sidebarEl.querySelector("#gaia-subject");
    if (fromEl)    fromEl.textContent    = email.from    || "—";
    if (subjectEl) subjectEl.textContent = email.subject || "—";
    setState("idle");
  }

  // ── Pipeline Steps Animation ───────────────────────────────
  const STEPS = ["step-fetch", "step-transform", "step-plot", "step-report", "step-fact"];
  const STEP_LABELS = [
    "Running Data Fetcher...",
    "Transforming data...",
    "Plotting insights...",
    "Compiling report...",
    "Fact checking...",
    "Finalising draft..."
  ];
  let stepInterval = null;

  function startStepAnimation() {
    let i = 0;
    STEPS.forEach(id => {
      const el = sidebarEl.querySelector(`#${id}`);
      if (el) el.className = "gaia-step";
    });
    const loadingText = sidebarEl.querySelector("#gaia-loading-text");
    stepInterval = setInterval(() => {
      if (i > 0) {
        const prev = sidebarEl.querySelector(`#${STEPS[i - 1]}`);
        if (prev) prev.classList.add("gaia-step-done");
      }
      if (i < STEPS.length) {
        const curr = sidebarEl.querySelector(`#${STEPS[i]}`);
        if (curr) curr.classList.add("gaia-step-active");
        if (loadingText) loadingText.textContent = STEP_LABELS[i];
      }
      if (i >= STEPS.length) {
        if (loadingText) loadingText.textContent = STEP_LABELS[STEPS.length];
        clearInterval(stepInterval);
      }
      i++;
    }, 900);
  }

  function stopStepAnimation() {
    if (stepInterval) clearInterval(stepInterval);
    STEPS.forEach(id => {
      const el = sidebarEl.querySelector(`#${id}`);
      if (el) el.classList.add("gaia-step-done");
    });
  }

  // ── Action Handlers ────────────────────────────────────────
  async function onGenerateClick() {
    if (isProcessing) return;
    if (!currentEmail) {
      showError("No email detected. Please open an email first.");
      return;
    }

    isProcessing = true;
    setState("loading");
    startStepAnimation();

    try {
      // Prefer Gmail API for full body; fall back to DOM-extracted body
      let emailPayload = { ...currentEmail };

      if (currentEmail.messageId) {
        const result = await sendMessage({
          type: "FETCH_EMAIL",
          messageId: currentEmail.messageId
        });
        if (result.success) {
          emailPayload = { ...emailPayload, ...result.email };
        }
      }

      // Fetch thread context if available
      if (currentEmail.threadId) {
        const threadResult = await sendMessage({
          type: "GET_THREAD",
          threadId: currentEmail.threadId
        });
        if (threadResult.success) {
          emailPayload.thread = threadResult.thread;
        }
      }

      // Send to pipeline
      const pipelineResult = await sendMessage({
        type: "RUN_PIPELINE",
        payload: emailPayload
      });

      stopStepAnimation();

      if (!pipelineResult.success) {
        showError(pipelineResult.error || "Pipeline returned an error.");
        return;
      }

      showDraft(pipelineResult.draft);

    } catch (err) {
      stopStepAnimation();
      showError(err.message || "Unexpected error.");
    } finally {
      isProcessing = false;
    }
  }

  function showDraft(text) {
    const draftBox = sidebarEl.querySelector("#gaia-draft-box");
    if (draftBox) draftBox.innerText = text;
    setState("result");
  }

  function showError(msg) {
    const errEl = sidebarEl.querySelector("#gaia-error-text");
    if (errEl) errEl.textContent = msg;
    setState("error");
  }

  function onInsertClick() {
    const draftBox = sidebarEl.querySelector("#gaia-draft-box");
    const draft = draftBox?.innerText?.trim();
    if (!draft) return;

    // Click Reply button if compose box isn't open
    const replyBtn = document.querySelector('[data-tooltip="Reply"]') ||
                     document.querySelector('[aria-label="Reply"]');

    if (replyBtn) replyBtn.click();

    setTimeout(() => {
      insertDraftIntoCompose(draft);
    }, 700);
  }

  function insertDraftIntoCompose(text) {
    // Try all known Gmail compose selectors
    const selectors = [
      '[aria-label="Message Body"][contenteditable="true"]',
      '[g_editable="true"][contenteditable="true"]',
      '.Am.Al.editable'
    ];

    let composeBox = null;
    for (const sel of selectors) {
      composeBox = document.querySelector(sel);
      if (composeBox) break;
    }

    if (!composeBox) {
      alert("Could not find Gmail compose box. Please open a reply window first.");
      return;
    }

    composeBox.focus();
    composeBox.innerText = text;
    // Trigger input events so Gmail registers the change
    composeBox.dispatchEvent(new Event("input", { bubbles: true }));
    composeBox.dispatchEvent(new Event("change", { bubbles: true }));

    showToast("Draft inserted! ✓");
  }

  async function onCopyClick() {
    const draftBox = sidebarEl.querySelector("#gaia-draft-box");
    const text = draftBox?.innerText?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard! ✓");
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("Copied! ✓");
    }
  }

  // ── Toast Notification ─────────────────────────────────────
  function showToast(message) {
    const existing = document.getElementById("gaia-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "gaia-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("gaia-toast-show"), 10);
    setTimeout(() => {
      toast.classList.remove("gaia-toast-show");
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }

  // ── Utility: sendMessage wrapper ───────────────────────────
  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  }

  // ── Utility: debounce ──────────────────────────────────────
  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

})();
