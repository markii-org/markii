// The playground seeds its editor with the repository's README.mk.md, so the
// document shown at https://sadigaxund.github.io/markii/ is the same file
// people read in the repo: edit README.mk.md and the deployed app follows.
//
// The import is resolved at build time, so what ships is a frozen string baked
// into the bundle. Every visitor starts from a fresh copy held in memory only;
// nothing they type is persisted or written back to the file.
import readmeDoc from '../../../README.mk.md?raw';

export const DEMO_DOC = readmeDoc;
