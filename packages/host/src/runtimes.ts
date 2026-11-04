// Agent CLIs the host downloads for the owner, like OpenBot's provider runtimes: a pinned version per
// platform with the SHA-256 GitHub publishes, unpacked under <home>/runtimes/<id>/<version>/ and
// checked with `--version` before it is used. Only Pi ships standalone binaries; DSH comes with its
// desktop app.

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface RuntimeArtifact {
  url: string;
  sha256: string;
  bytes: number;
}

export interface RuntimeLock {
  id: string;
  version: string;
  /** Executable path inside the unpacked archive. */
  executable: string;
  artifacts: Partial<Record<string, RuntimeArtifact>>;
}

/** Pi 1.5.0 (2026-11-02). Hashes are the `digest` of each GitHub release asset. */
export const PI_RUNTIME: RuntimeLock = {
  id: "pi",
  version: "1.5.0",
  executable: "pi/pi",
  artifacts: {
    "darwin-arm64": {
      url: "https://github.com/earendil-works/pi/releases/download/v1.5.0/pi-darwin-arm64.tar.gz",
      sha256: "a9bf0d82d58d2a7d337f4ae4171b5fc9ebffe42509527a831364c4b65adf2cdf",
      bytes: 48027930,
    },
    "darwin-x64": {
      url: "https://github.com/earendil-works/pi/releases/download/v1.5.0/pi-darwin-x64.tar.gz",
      sha256: "f41b26cd9a1754abe259e05a421fb33b00936779cb0783c893a6389d1bd2ee0d",
      bytes: 50541720,
    },
    "linux-arm64": {
      url: "https://github.com/earendil-works/pi/releases/download/v1.5.0/pi-linux-arm64.tar.gz",
      sha256: "5d5711b48600756473682e86360b026b11abf7591e5d112eb411d4da2c100d9a",
      bytes: 58742522,
    },
    "linux-x64": {
      url: "https://github.com/earendil-works/pi/releases/download/v1.5.0/pi-linux-x64.tar.gz",
      sha256: "df870ba0e344cb7b3358d8d8f19397b8b8d225a8669784736ad68a5c2169d53b",
      bytes: 58876253,
    },
  },
};

export function currentTarget(): string {
  return `${process.platform}-${process.arch}`;
}

export interface InstallProgress {
  received: number;
  total: number;
}

/** File written last, after the executable answered `--version` with the pinned version. */
const READY_MARK = ".agentherd-ready";

/** Download, check and unpack pinned agent CLIs under `<root>/<id>/<version>/`. */
export class RuntimeStore {
  private readonly root: string;
  private readonly target: string;

  constructor(root: string, target: string = currentTarget()) {
    this.root = root;
    this.target = target;
  }

  dir(lock: RuntimeLock): string {
    return join(this.root, lock.id, lock.version);
  }

  supported(lock: RuntimeLock): boolean {
    return lock.artifacts[this.target] !== undefined;
  }

  /** @returns The executable when the pinned version is installed and checked, else undefined. */
  installed(lock: RuntimeLock): string | undefined {
    const dir = this.dir(lock);
    if (!existsSync(join(dir, READY_MARK))) return undefined;
    const bin = join(dir, lock.executable);
    return existsSync(bin) ? bin : undefined;
  }

  /**
   * Downloads the archive, checks its SHA-256, unpacks it beside the final folder, checks that the
   * executable reports the pinned version, then moves it into place.
   * @returns The executable.
   * @throws When the platform has no build, the download fails, or a check does not match.
   */
  async install(
    lock: RuntimeLock,
    onProgress: (p: InstallProgress) => void = () => {},
    signal?: AbortSignal,
  ): Promise<string> {
    const done = this.installed(lock);
    if (done !== undefined) return done;
    const artifact = lock.artifacts[this.target];
    if (artifact === undefined) throw new Error(`${lock.id} has no build for ${this.target}`);
    const parent = join(this.root, lock.id);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const staging = join(parent, `.installing-${randomUUID()}`);
    const archive = `${staging}.tar.gz`;
    try {
      await download(artifact, archive, onProgress, signal);
      mkdirSync(staging);
      await run("tar", ["-xzf", archive, "-C", staging]);
      const bin = join(staging, lock.executable);
      if (!existsSync(bin)) throw new Error(`${lock.id} archive has no ${lock.executable}`);
      const { stdout } = await run(bin, ["--version"], { timeout: 30_000 });
      if (stdout.trim() !== lock.version) {
        throw new Error(`${lock.id} reports version "${stdout.trim()}", expected ${lock.version}`);
      }
      writeFileSync(join(staging, READY_MARK), `${artifact.sha256}\n`);
      const dir = this.dir(lock);
      rmSync(dir, { recursive: true, force: true });
      renameSync(staging, dir);
      return join(dir, lock.executable);
    } finally {
      rmSync(archive, { force: true });
      rmSync(staging, { recursive: true, force: true });
    }
  }

  /** Removes every installed version of a runtime. */
  remove(lock: RuntimeLock): void {
    rmSync(join(this.root, lock.id), { recursive: true, force: true });
  }

  /** The SHA-256 recorded when the runtime was installed. */
  recordedHash(lock: RuntimeLock): string | undefined {
    const mark = join(this.dir(lock), READY_MARK);
    return existsSync(mark) ? readFileSync(mark, "utf8").trim() : undefined;
  }
}

async function download(
  artifact: RuntimeArtifact,
  path: string,
  onProgress: (p: InstallProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(artifact.url, signal === undefined ? {} : { signal });
  if (!response.ok || response.body === null) {
    throw new Error(`download failed: HTTP ${response.status} for ${artifact.url}`);
  }
  const total = Number(response.headers.get("content-length")) || artifact.bytes;
  const hash = createHash("sha256");
  let received = 0;
  let last = 0;
  const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    received += chunk.length;
    const now = Date.now();
    if (now - last > 200 || received === total) {
      last = now;
      onProgress({ received, total });
    }
  });
  await pipeline(body, createWriteStream(path, { mode: 0o600 }));
  onProgress({ received, total });
  const actual = hash.digest("hex");
  if (actual !== artifact.sha256) {
    throw new Error(`download of ${artifact.url} does not match its SHA-256 (got ${actual})`);
  }
}
