Markii has four settings: `markii.packs`, `markii.runOnOpen`, `markii.refreshIntervalSeconds`, and `markii.allowPrivateNetworkAddresses`.

All four are **user-scope only**. They cannot be set from a workspace's `.vscode/settings.json`, on purpose: it is what stops a repository you open from silently enabling script execution, loading a pack, or widening network access on your behalf.

Use the button below to open Settings filtered to Markii. If you use profiles and want the underlying JSON, run **Preferences: Open Application Settings (JSON)** instead of the usual "Open User Settings (JSON)" command, since application-scope settings live there.

Two commands write these settings for you: **Markii: Enable Scheduled Refresh…** and **Markii: Toggle Run On Open**, both from the Command Palette.
