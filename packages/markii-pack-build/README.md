# @markii/pack-build

Builds [Markii](https://github.com/markii-org/markii) component packs:
compiles a pack's component sources (and the CSS they import) with
esbuild's WebAssembly build, writes the prebuilt form, or produces a
`.mkp` archive. It is the one Markii package that carries a build
toolchain, for authoring hosts and pack build scripts; an app that only
installs prebuilt packs does not need it. Node only.

See `docs/packs.md` in the repository for the pack contract.
