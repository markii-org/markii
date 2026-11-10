# @markii/host

The shared host layer for [Markii](https://github.com/markii-org/markii)
apps. An app implements one `HostAdapter` (read and write files, list a
folder, ask one yes-or-no question, keep device-local state, write a
diagnostics line) and `createMarkiiHost` gives it the rest: running a
note's scripts behind the grant model and the watchdog, pack install,
load, trust and removal, export, completion, hover and component insertion.

Entries:

- `@markii/host`: environment-neutral; safe to bundle for a browser.
- `@markii/host/browser`: a Web Worker isolate and a `fetch` network
  provider bound to an origin allowlist.
- `@markii/host/node`: a worker-thread isolate (`createNodeHostIsolate`),
  the address-pinning network provider, and the Node file system seams.
- `@markii/host/node-worker`: the self-contained worker file, for a host
  that bundles the worker itself.
- `@markii/host/conformance`: the host scenario corpus and its runner, to
  prove an adapter behaves like the reference apps.

See `docs/integration.md` in the repository for how to write a host.
