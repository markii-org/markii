A note's Lua script blocks never run just because the note was opened. Run **Markii: Run Scripts** to run them once, feeding the note's data-bound components (`stat`, `progress`, `chart`, `:value[...]`).

The first time a script requests a network host, you get a one-host-at-a-time prompt. Until scripts have run, script blocks show a collapsed marker and data-bound components show their quiet empty state.

Two settings can automate this later: `markii.runOnOpen` runs a note once when its preview opens, and `markii.refreshIntervalSeconds` re-runs it on a timer. Both stay at the read-only tier and reuse only hosts you already granted by hand. The next step shows where to find them.
