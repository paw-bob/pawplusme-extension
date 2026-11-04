# Contributing

Use Node.js 22 or later. Run `npm ci`, `npm run check`, `npm test` and
`npm run build` before opening a pull request. Tests read the built extension and
use synthetic fixtures; they do not call generation or payment services.

Keep changes focused. Shared interaction behavior belongs in `src/shared`;
extension integration belongs in `src/extension`. Never edit `dist` by hand.
When changing mouse, keyboard, timer or visibility behavior, cover the affected
path in its existing test family. Preserve the claimed-pet format, local storage
keys and website bridge protocol unless a coordinated compatibility change is
necessary.

To inspect the packaged UI, load `dist/extension` from `chrome://extensions` using
Developer mode. Website claiming requires a compatible backend and a pet you are
authorized to use. Refresh ordinary pages after reloading the extension.

Do not include credentials, recovery or claim links, customer photographs,
provider prompts, orders or internal deployment files. Report security issues
through the private channel in [SECURITY.md](SECURITY.md).

Describe the concrete behavior changed, why it changed and the checks you ran.
Screenshots or short recordings help with visible changes; use your own data.
