# AD-3 Owner Runbook — Telegram Witness Environment Verification

## Purpose

This procedure documents the owner-operated verification required for BUILD 03.1 / AD-3.

It does not change any gate status, authorize capital activity, authorize production execution, or create a cutoff timestamp. AD-3 remains UNRESOLVED until evidence is returned and separately adjudicated.

## Witness pair

- Telegram channel: `@FCC_Command`
- Telegram bot: `@FCC_Com_Bot`

The bot must be able to post in the channel before the test begins.

## Where to run

Run the verification only on the owner-controlled Dev computer in PowerShell.

Do not run it in GitHub Codespaces. Codespaces cannot reach the required Telegram endpoints and must never receive the bot token.

Keep `fcc-build03-1-telegram-envtest.js` outside the `fcc-record` repository.

## Preflight

Confirm that:

- Node.js is installed on the Dev computer.
- The environment-test script is present in the folder where PowerShell will run.
- The channel and bot above are the intended witness pair.
- No token is stored in a repository file, chat message, commit, GitHub secret, or Codespace.
- The default redaction setting remains enabled.

## Default verification run

Open PowerShell in the folder containing `fcc-build03-1-telegram-envtest.js`.

Paste the following, replacing only `PASTE_BOT_TOKEN_HERE` with the actual token. Keep the quotation marks.

```powershell
$env:TELEGRAM_BOT_TOKEN = 'PASTE_BOT_TOKEN_HERE'
$env:FCC_CHANNEL = '@FCC_Command'
node .\fcc-build03-1-telegram-envtest.js