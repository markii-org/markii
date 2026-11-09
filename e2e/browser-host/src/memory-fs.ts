import type { ArchiveExtractFs, HostDirEntry } from '@markii/host';

function normalize(p: string): string {
  const parts = p.split('/').filter((part) => part !== '' && part !== '.');
  return '/' + parts.join('/');
}

/** An in-memory file tree: the browser fixture's whole "disk". */
export class MemoryFs {
  private readonly files = new Map<string, Uint8Array>();
  private readonly dirs = new Set<string>(['/']);

  async readFile(p: string): Promise<Uint8Array> {
    const bytes = this.files.get(normalize(p));
    if (!bytes) throw new Error(`no such file: ${p}`);
    return bytes;
  }

  async exists(p: string): Promise<boolean> {
    const key = normalize(p);
    return this.files.has(key) || this.dirs.has(key);
  }

  async writeFile(p: string, bytes: Uint8Array): Promise<void> {
    const key = normalize(p);
    await this.makeDirectory(key.slice(0, key.lastIndexOf('/')) || '/');
    this.files.set(key, bytes);
  }

  async makeDirectory(p: string): Promise<void> {
    let current = '';
    for (const part of normalize(p).split('/').filter(Boolean)) {
      current += '/' + part;
      this.dirs.add(current);
    }
  }

  async removeDirectory(p: string): Promise<void> {
    const key = normalize(p);
    const prefix = key + '/';
    for (const file of [...this.files.keys()]) {
      if (file === key || file.startsWith(prefix)) this.files.delete(file);
    }
    for (const dir of [...this.dirs]) {
      if (dir === key || dir.startsWith(prefix)) this.dirs.delete(dir);
    }
  }

  async listFolder(p: string): Promise<readonly HostDirEntry[]> {
    const key = normalize(p);
    const prefix = key === '/' ? '/' : key + '/';
    const names = new Map<string, boolean>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) names.set(rest, false);
      else names.set(rest.slice(0, slash), true);
    }
    for (const dir of this.dirs) {
      if (!dir.startsWith(prefix) || dir === key) continue;
      const rest = dir.slice(prefix.length);
      const slash = rest.indexOf('/');
      names.set(slash === -1 ? rest : rest.slice(0, slash), true);
    }
    return [...names].map(([name, isDirectory]) => ({ name, isDirectory }));
  }

  asArchiveExtractFs(): ArchiveExtractFs {
    return {
      removeDirectory: (p) => this.removeDirectory(p),
      makeDirectory: (p) => this.makeDirectory(p),
      writeFile: (p, bytes) => this.writeFile(p, bytes),
    };
  }
}
