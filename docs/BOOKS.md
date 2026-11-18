# The books

A knight that keeps your company's books: your bilag (receipts and invoices) copied from your mail to Google Drive, your bookkeeping in Dinero, and your bank accounts read but never moved. What may happen without asking is your word of 18 November 2026:

| What | Without asking | Asks you first |
|---|---|---|
| **Bilag** from Gmail and Outlook | Copied as they come, into Google Drive | Nothing: nothing is deleted, sent or moved in your mail |
| **Dinero** | Reading everything; preparing drafts: vouchers, invoices, offers, credit notes, and the contacts, products and files they need | Booking, registering a payment, sending, changing what is there, deleting |
| **Banks** | Reading balances and transactions (Enable Banking, [BANK.md](BANK.md)) | Nothing can move money: Galahad has no payment code at all |

e-conomic comes later, if you move to it: it has no official agent access, and Dinero does.

## Bilag to Google Drive ✅

Each attachment of new mail that is a bilag by its kind is copied as it is into your Drive: a PDF, a picture of one, or an XML e-invoice, but not a picture set in the mail's words and not a logo's few kilobytes. It goes in `Bilag/<year>/<month>/` and is named for the day the mail came, who sent it, and its own name: `2026-11-19 Telia – Faktura.pdf`. A file copied once is never copied again, whichever mail carries it again.

It is the node's own work, and no model is in it. The bytes go from Gmail's or Microsoft's API straight to Drive's, each under its own sign-in and pinned to its own address, and every request is a line in the ledger. Galahad reaches Drive with `drive.file` alone, so it sees only the files it made there, never the rest of your Drive.

**Which mail.** Mail with the words of a receipt or an invoice in it, in Danish or English, and an attachment: `faktura`, `kvittering`, `bilag`, `kreditnota`, `ordrebekræftelse`, `betalingsbekræftelse`, `invoice`, `receipt`, `credit note`, `order confirmation`. Change the words on the loop's mail wakes (Loops in the app, or `galahad loop set bilag --wake "gmail <words>"`).

### Setting it up

1. **Google** (Gmail and Drive, one app). Set it up as [MAIL.md](MAIL.md) says, with two additions: enable the **Google Drive API** as well as the Gmail API, and add the scope `https://www.googleapis.com/auth/drive.file`. On Google Workspace, choose **Internal** as the audience: only your organization's accounts can sign in, and nothing expires or needs Google's review.
2. **Microsoft 365** (Outlook and Exchange Online), as [MAIL.md](MAIL.md) says. Register it for *Accounts in any organizational directory* (Galahad signs in through Microsoft's common endpoint), and grant admin consent for your company.
3. **In Galahad**, under Connectors:
   - **Gmail**: Install, Seal the app, Sign in with Google.
   - **Outlook**: Install, Seal the app, Sign in with the device code.
   - **Google Drive**: Install, Seal the app with the *same* Google client ID and secret, Sign in with Google again. This sign-in asks for Drive's `drive.file` alone.
4. **Turn it on:** `galahad bilag on`. This makes a loop that new mail in either mailbox wakes; its bilag go to Drive on their own.
5. **Mail that came before:** `galahad bilag copy --from gmail`, and again `--from outlook`. It goes a batch at a time until none is left, and can be stopped and run again at any time: nothing is copied twice.

`galahad bilag` says how many have been copied, the latest, and what is not connected yet.

## Dinero ✅

Dinero's own MCP server (`https://mcp.dinero.dk/`, Dinero Pro or Total) is in Galahad's library. **Connectors → Dinero → Add**, then **Sign in**: Dinero's sign-in page (Visma Connect) opens, you log in with your Dinero user and allow it. Galahad then reaches every company that user has.

Its tools come classed as your ruling says, and you can change any of them (`galahad connector refresh dinero --class <tool>=<class>`):

- **Without asking:** reading anything, and creating drafts of vouchers, invoices, offers and credit notes, with the contacts, products and files they need.
- **Asks you first:** booking, registering a payment, sending, changing what is there, and deleting.

Dinero's own advice stands: check the work. Its server can't catch a model's mistakes, and booking is permanent. Take Galahad's access away in Dinero under **Konto → Brugerprofil → Gå til Visma Connect → Autoriserede applikationer**.

## Banks

Read-only, through Enable Banking, as [BANK.md](BANK.md) says. One bank is connected at a time for now; the company's Lunar and Danske Bank accounts side by side is next.

## The knight

Next: a knight of yours that is allowed these connectors (`galahad connector allow gmail|outlook|gdrive|dinero <knight>`), with work given on a schedule: each day, match the bank's transactions to their bilag and prepare the drafts in Dinero, and tell you what waits for your approval.
