Five settings decide what may run: `markii.packs`, `markii.runOnOpen`, `markii.refreshIntervalSeconds`, `markii.scriptsDisabled`, and `markii.allowPrivateNetworkAddresses`. Two more are cosmetic: `markii.previewWidth` and `markii.hideScriptBlocks`.

The first five are **user-scope only**. They cannot be set from a workspace's `.vscode/settings.json`, on purpose: it is what stops a repository you open from silently enabling script execution, loading a pack, or widening network access on your behalf, and it is what stops one turning script execution back on after you have turned it off.

Use the button below to open Settings filtered to Markii. If you use profiles and want the underlying JSON, run **Preferences: Open Application Settings (JSON)** instead of the usual "Open User Settings (JSON)" command, since application-scope settings live there.

Three commands write these settings for you: **Markii: Enable Scheduled Refresh…**, **Markii: Toggle Run On Open**, and **Markii: Toggle Script Execution**, all from the Command Palette.
