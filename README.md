# Product CLIs

Small command-line clients for Postedly, MentionedOn, Intakra, Portravo, and Ocolta. Each package connects to the product's existing public API and prints JSON that works in terminal scripts and agent workflows. Node.js 22 or newer is required. There are no runtime dependencies or install scripts.

| Product | npm package | Commands | Sign-in |
| --- | --- | --- | --- |
| [Postedly](https://postedly.com) | [`postedly-cli`](packages/postedly) | Quotes, private checkout review, mail/fax delivery, contacts and drafts | Browser OAuth with PKCE |
| [MentionedOn](https://mentioned-on.com) | [`mentionedon-cli`](packages/mentionedon) | AI visibility reports, supplied evidence, website inspection and saved fixes | Browser OAuth with PKCE |
| [Intakra](https://intakra.com) | [`intakra-cli`](packages/intakra) | Accounts, buying evidence, leads and workspace actions | Workspace API key |
| [Portravo](https://portravo.com) | [`portravo-cli`](packages/portravo) | Plan uploads, takeoff status and reviewed estimate exports | Scoped API key |
| [Ocolta](https://ocolta.com) | [`ocolta-cli`](packages/ocolta) | Document review submission, status and reports | Purchase-bound integration grant |

Install a package individually with `npm install --global postedly-cli` (substitute the other package name), then run `postedly --help`. Each package README provides complete examples and current product limits. Public evidence and catalog commands work without credentials where supported.

## Authentication and outputs

Run `<product> login` for browser OAuth or a hidden API-key prompt. A secret manager can pipe a token to `<product> login --token-stdin`. Product environment variables override saved credentials. `auth status` shows configuration without revealing secrets; `logout` removes the local saved copy. Revoke remote access in the product or its documented revocation endpoint when needed.

Saved credentials use a private file under `$XDG_CONFIG_HOME/product-clis/<product>/credentials.json`, or `~/.config/product-clis/<product>/credentials.json`. Credentials are bound to their service origin. Browser OAuth uses PKCE, exact loopback callbacks, state checks, and serialized refresh token rotation. An interrupted refresh requires signing in again so an old refresh token is never replayed.

Commands print JSON to stdout and errors to stderr with a nonzero exit code. `--output <new-file>` saves output without overwriting an existing file. Downloads require an output path. `--data @file.json` supplies complex request objects where documented. Named flags override JSON fields. Boolean values use `--active=true` or `--active=false`; confirmation switches such as `--confirm-credit-use` must be supplied explicitly.

No request retries automatically. Reuse the same idempotency key and identical input after an uncertain response to a credit-consuming action, following the product's documented recovery process. A Portravo takeoff may consume more than one credit based on selected trades. Ocolta requires both processing consent and one-credit confirmation. Postedly checkout returns a private browser review link; approval and payment remain in that flow.

## Development

```sh
npm run build
npm test
npm run pack:check
```

Edit `shared/runtime.mjs` or a package's `product.mjs`, then rebuild. `scripts/build.mjs` copies the common runtime into each independent package. Package allowlists include only the executable, runtime, product command definitions, documentation, examples, and license. Product backend source and credentials are not included.

Tests exercise request contracts, OAuth and credential handling using local fixtures. Public catalog, metadata and evidence calls can be smoke-tested without accounts. Authenticated customer workflows and credit-consuming fulfillment must be tested separately with an authorized account; passing local tests does not establish delivery or model accuracy.

## Publishing

After review and successful checks, sign in with `npm login` and run the release script:

```sh
node scripts/publish.mjs
```

It publishes only a missing package version and verifies the resulting version and integrity against its tarball. Existing versions are never overwritten. npm requires suitable account authentication; the five packages remain independent. External package directories may discover npm metadata on their own schedule; publication does not guarantee indexing or search ranking.
