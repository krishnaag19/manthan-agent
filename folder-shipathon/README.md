# ✦ Gmail AI Draft Agent — Chrome Extension

A Chrome extension that reads your Gmail emails and drafts replies using your AI pipeline.

---

## 📁 Files

```
gmail-agent-extension/
├── manifest.json     ← Extension config (edit OAuth client ID here)
├── background.js     ← OAuth, Gmail API, pipeline API calls
├── content.js        ← Gmail DOM observer, sidebar injection, draft insertion
├── sidebar.css       ← Sidebar UI styles
├── popup.html        ← Settings popup
├── popup.js          ← Settings logic
└── icons/            ← Extension icons
```

---

## ⚙️ Setup (One-Time)

### Step 1 — Google OAuth Client ID

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Navigate to **APIs & Services → Library**
4. Enable: **Gmail API**
5. Go to **APIs & Services → Credentials**
6. Click **Create Credentials → OAuth 2.0 Client ID**
7. Choose **Chrome Extension** as application type
8. Copy your **Client ID**
9. Open `manifest.json` and replace:
   ```
   "client_id": "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com"
   ```
   with your actual client ID.

### Step 2 — Load the Extension

1. Open Chrome and go to `chrome://extensions`
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Select the `gmail-agent-extension/` folder
5. The extension icon (✦) will appear in your toolbar

### Step 3 — Configure Your Pipeline

1. Click the extension icon (✦) in Chrome toolbar
2. Enter your **Pipeline API URL** — the endpoint your backend exposes
3. Optionally add an **API Key** (sent as `Authorization: Bearer …`)
4. Click **Save Settings**
5. Click **Test Connection** to verify

---

## 🚀 Usage

1. Open [Gmail](https://mail.google.com)
2. Click any email
3. The **Draft Agent sidebar** slides in from the right
4. Click **✦ Generate Draft**
5. Watch your 5-module pipeline run step-by-step
6. Edit the draft in the text box if needed
7. Click **↳ Insert into Reply** to push it into Gmail's compose box

---

## 🔌 Pipeline API Contract

Your backend should accept:

```json
POST /your-endpoint
Authorization: Bearer <your-key>
Content-Type: application/json

{
  "query": "Full email body text",
  "context": {
    "subject": "Email subject",
    "sender":  "from@example.com",
    "recipient": "to@example.com",
    "date": "Mon, 24 Mar 2025 ...",
    "thread": [ ...previous messages... ]
  }
}
```

And return any of these keys:

```json
{
  "draft":    "Hi, thanks for reaching out...",
  "reply":    "...",   // also accepted
  "message":  "...",   // also accepted
  "response": "..."    // also accepted
}
```

---

## 🛠 Troubleshooting

| Problem | Fix |
|---------|-----|
| Sidebar doesn't appear | Reload Gmail (Ctrl+R) after installing |
| OAuth popup blocked | Allow popups for mail.google.com |
| Pipeline URL not configured | Click the toolbar icon and enter your URL |
| Draft box is empty | Check your pipeline returns `draft`, `reply`, `message`, or `response` |
| Compose box not found | Manually click Reply in Gmail first, then Insert |

---

## 🔒 Permissions Used

| Permission | Why |
|------------|-----|
| `identity` | OAuth login to access Gmail API |
| `storage` | Save your pipeline URL and API key locally |
| `activeTab` | Interact with the open Gmail tab |
| Gmail API (read-only) | Fetch full email body and thread |
| Gmail API (compose) | Reserved for future send support |

---

## 📝 Notes

- Your pipeline URL and API key are stored locally via `chrome.storage.sync` — never sent anywhere except your own endpoint.
- The extension never automatically sends emails. Draft insertion requires manual click.
- Gmail's DOM selectors may occasionally change. If the sidebar stops detecting emails, open a GitHub issue.
