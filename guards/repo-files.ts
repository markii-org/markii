import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const PRUNED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'tmp',
  '.git',
  'coverage',
  '.vite',
]);

/** Every file in the repository as a forward-slash path relative to the root, minus dependency, build and scratch folders. */
export function listRepoFiles(): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!PRUNED_DIRECTORIES.has(entry.name)) {
          visit(join(directory, entry.name));
        }
      } else if (entry.isFile()) {
        found.push(
          relative(repoRoot, join(directory, entry.name)).split(sep).join('/'),
        );
      }
    }
  };
  visit(repoRoot);
  return found.sort();
}

export function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

export interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

export function formatViolations(violations: Violation[]): string {
  return violations
    .map(
      (v) =>
        `${v.file}:${String(v.line)}: ${v.rule}\n    ${v.text.trim().slice(0, 160)}`,
    )
    .join('\n');
}
