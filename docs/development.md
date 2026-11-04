# Development and compatibility

## Source ownership

This repository owns the extension and the shared browser-pet runtime. The
website imports a specific release, verifies its checksums and keeps a local
snapshot for builds. Shared changes must be made here and then imported by the
website. No Git submodule or checkout of another repository is required to build
this project.

## Website origins

`npm run build` targets the official website. `npm run build:dev` targets the
loopback development service. A custom HTTPS preview build uses
`npm run build -- --origin https://preview.example.com`. Explicit HTTP loopback
origins with another local port are also supported; public HTTP origins are not.

The build generates one site configuration for the popup, background worker,
page bridge and content scripts. A build changes only `dist`. Do not use a
development build as the official release archive.

## Manual acceptance

Use a pet you already own. No new generation or payment is required.

1. Install into an isolated Chrome profile and verify the empty library state.
2. Claim a pet from the matching website origin and verify its name and avatar.
3. Check watch, follow, sleep, text-field interaction, hover controls and hide on
   two ordinary web pages. Check that each page contains one companion.
4. Switch pets, resize, change a shortcut and set a timer. Reload the extension
   and pages; verify the saved library, preferences and timer remain available.
5. Upgrade the package in place, refresh pages and verify local data is retained.
6. Verify creation and first-install links carry the fixed public campaign
   parameters, without pet IDs or private authorization data.

Chrome internal pages, the Chrome Web Store, browser PDF viewers and other
restricted surfaces may not permit content scripts. File URLs require a separate
browser setting and are not included in the extension's HTTP/HTTPS matching.

## Release artifacts

The package version is the single version source. The build writes an unpacked
extension, extension ZIP, shared runtime ZIP, portable source ZIP, `release.json`
and `SHA256SUMS`. Archive entries have a stable order and timestamps. Builds of
the same source and origin should produce the same archive bytes across supported
operating systems.

A release tag must match the package version. Keep a copy of the last working
release when updating a website snapshot. GitHub publication and Chrome Web Store
submission are separate operations.
