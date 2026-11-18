# Mail

Galahad can read and write your mail in Gmail and in Outlook (Outlook.com and Microsoft 365), signed in as you. He signs in through an app you register yourself, once, with Google or Microsoft. No one else's app stands between you and your mail, and your sign-in never leaves your nodes.

| Who | Can | Can't |
|---|---|---|
| **You** (a paired device or a terminal on a node) | Seal the app you registered, sign in, sign out; do anything the tools do | |
| **Galahad** | Search, read, draft and archive freely (every call is in the ledger); send and trash only once you approve each one | See your sign-in, or the app's secret: each call carries a short-lived token the node gets for it |
| **An agent you allowed** (`galahad connector allow gmail <agent>`) | The same as Galahad | The same |
| **Any other agent** | Ask you for it (`connector_request`); you allow it or not | Use it: it's refused until you allow it |

**Mail is private, as the bank's data is.** Once an answer has read mail, nothing that could carry it out of Galahad or write it into the shared mind runs for the rest of that answer, except mail's own tools. Mail is someone else's words: it reaches the model as data, never as instructions.

## The tools

| Tool | What it does | Asks you first |
|---|---|---|
| `search` | Messages matching your words (Gmail's own: `from:anna is:unread newer_than:7d`); without any, the inbox's latest, up to 25: who, when, the subject, a snippet, unread or not | no |
| `read` | One message: its headers, its words (its plain text, or its HTML's words), what it has attached | no |
| `draft` | A draft in your Drafts, unsent: a new message, or a reply (`replyTo`) in its thread | no |
| `send` | Sends a message, or a reply in its thread | **yes** |
| `archive` | Out of the inbox (Gmail: into All Mail; Outlook: into Archive); back any time | no |
| `trash` | Into Trash (Gmail keeps it 30 days) or Deleted Items (Outlook) | **yes** |

## Gmail: register your app with Google

1. In [Google Cloud](https://console.cloud.google.com), make a project (say, "Galahad mail").
2. **APIs & Services → Library**: enable the **Gmail API** (and the **Google Drive API**, for bilag copied to Drive: [BOOKS.md](BOOKS.md)).
3. **Google Auth Platform** (the OAuth consent screen): get started with an app name ("Galahad") and your address; the audience is **External**, or **Internal** on Google Workspace (only your organization's accounts sign in, and nothing expires or needs Google's review: steps 5's warning and its seven days don't apply).
4. **Data access**: add the scopes `https://www.googleapis.com/auth/gmail.modify`, `openid` and `.../auth/userinfo.email` (and for Google Drive, `.../auth/drive.readonly` to read all of it and `.../auth/drive.file` to write his copies of bilag: [BOOKS.md](BOOKS.md)).
5. **Audience**: **publish the app** (In production). A sign-in to an app left in Testing ends after seven days. Google shows an app it hasn't verified with a warning on its consent page; as its only user, go on through **Advanced**.
6. **Clients → Create client**: **Web application**, with this **authorized redirect URI**: the address you open Galahad at, then `/oauth/callback` (the Gmail card in Connectors shows it exactly, e.g. `https://keep.example.ts.net/oauth/callback`).
7. Copy its **client ID** and **client secret**.

In Galahad: **Connectors → Gmail → Install**, then **Seal the app** with the two, then **Sign in with Google**: Google's page opens, you choose your account and allow it (tick each box it shows), and it comes back to your node, which says when you're in, and what wasn't allowed if a box was left unticked. At a terminal:

```sh
galahad connector add gmail
galahad connector app gmail --client-id <client id>        # the secret is asked for, hidden
galahad connector signin gmail --redirect https://<your node's address>/oauth/callback
```

## Outlook: register your app with Microsoft

1. In [Microsoft Entra](https://entra.microsoft.com), **App registrations → New registration**: a name ("Galahad"), and **Accounts in any organizational directory and personal Microsoft accounts**. No redirect URI.
2. **Authentication → Advanced settings**: **Allow public client flows: Yes**.
3. **API permissions → Add a permission → Microsoft Graph → Delegated**: `Mail.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access`, `openid`, `email`, `profile`. (A work account's administrator may have to consent to them.)
4. Copy its **Application (client) ID**.

Registering needs a Microsoft Entra tenant: a work account has one, and a free Azure account gives a personal Outlook.com address one.

In Galahad: **Connectors → Outlook → Install**, **Seal the app** with the client ID, then **Sign in**: type the code it shows at [microsoft.com/devicelogin](https://microsoft.com/devicelogin), sign in, and the card says when you're in. At a terminal: `galahad connector add outlook`, `galahad connector app outlook --client-id <id>`, `galahad connector signin outlook`.

## Signing out, and when a sign-in ends

**Sign out** on the card (or `galahad connector signout <id>`) forgets the sign-in and keeps the app; sign in again any time. A sign-in you revoke at Google or Microsoft, or one left unused for months, ends: the next call says to sign in again. Replacing the app with another client ID ends the sign-in it had.

How it works, in full: [ARCHITECTURE.md §10](ARCHITECTURE.md#10-connectors-and-the-approval-outbox-).
