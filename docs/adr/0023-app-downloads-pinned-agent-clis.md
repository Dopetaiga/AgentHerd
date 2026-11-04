# ADR 0023: The app downloads pinned agent CLIs; the owner does not install them

- Status: Superseded by [ADR 0024](0024-follow-latest-releases-six-agents.md) (no more pins)
- Date: 2026-11-04
- Related: [ADR 0022](0022-pi-through-a-bundled-acp-bridge.md), [03-agents.md](../spec/03-agents.md#managed-downloads)

## Context

After plan 012 the owner had to run `npm i -g @earendil-works/pi-coding-agent` before Pi showed
up. The maintainer does not want a terminal step: "我不要自己装，你看openbot他都是怎么搞的，他都是在gui配置的".

OpenBot keeps a lock file (`native-runtime.lock.json`) that pins each agent CLI per platform
(GitHub release URL, SHA-256, size), downloads it into its app data on request from the
Settings page, checks the hash and `--version`, and prefers that copy over a CLI found on
`PATH` (an explicit path in the environment wins over both).

Pi publishes standalone binaries per platform on GitHub releases (`pi-darwin-arm64.tar.gz` etc.,
a `pi/` folder with a single `pi` executable, no Node needed). DSH publishes no assets; it comes
with the DeepSeek Harness desktop app.

## Decision

- The host pins each downloadable CLI in code (`packages/host/src/runtimes.ts`, `PI_RUNTIME`):
  version, executable path inside the archive, and per target (`darwin-arm64`, `darwin-x64`,
  `linux-arm64`, `linux-x64`) the URL, SHA-256 and size from the GitHub release.
- The desktop **Agent** page lists the agents with their state and a 下载 / 取消 / 移除 button.
  A download goes to `<home>/runtimes/<id>/<version>/`: fetch, check SHA-256, unpack into a
  staging folder, run `--version` and require the pinned version, write a ready mark, then
  rename into place. A failed check leaves nothing behind and shows the error on the page.
- Lookup order for Pi: `AGENTHERD_PI`, then the downloaded copy, then `pi` on the search `PATH`.
  When the list changes, the host rebuilds the agent profiles; the next `/run` uses them.
- DSH is not downloaded. The page shows it when found and says to install the DeepSeek Harness
  app otherwise.
- Updating a pinned version is a code change (new URL and hashes), reviewed like any other.

## Alternatives considered

- **Keep `npm i -g`.** Rejected: the owner must open a terminal and needs a matching Node.
- **Download "latest" without a pin.** Rejected: an unreviewed binary would run with the owner's
  files; a hash and version check need a pinned release.
- **Bundle Pi inside the app.** Rejected for now: adds about 50 MB per platform to every install,
  also for owners who only use DSH.

## Consequences

- The host makes HTTPS requests to `github.com` only when the owner presses 下载.
- A new Pi release is not used until the pin is updated.
- Windows builds exist upstream but are not pinned (the app targets macOS first).
