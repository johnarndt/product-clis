# Ocolta CLI

Use [Ocolta](https://ocolta.com) from a terminal or agent to submit an authorized document for paid review, check its status, and retrieve the recoverable report.

```sh
npm install --global ocolta-cli
ocolta --help
```

Requires Node.js 22 or later. Responses are JSON. Source: [johnarndt/product-clis](https://github.com/johnarndt/product-clis).

## Authentication

Open the [Ocolta workspace](https://app.ocolta.com/workspace) in the original purchasing browser and create a named external integration grant. Choose the purchase, its exact tier, a ceiling of 1–25 existing review credits bounded by the remaining balance, and a 7- or 30-day expiry. Confirm document and report sharing for that integration.

Supply the returned `oct_` token through `OCOLTA_API_KEY` using your secret manager. It is a purchase-bound connection token, not an unrestricted account key. Never paste it into source, logs, URLs, or issue reports. Manage and revoke grants in the purchasing browser; the token cannot manage grants, buy credits, or access unrelated purchases.

To save a token locally, use the hidden terminal prompt:

```sh
ocolta login
ocolta auth status
```

For automation, pipe the token from your secret manager into `ocolta login --token-stdin`, or redirect an existing private token file:

```sh
ocolta login --token-stdin < /secure/path/ocolta-token.txt
```

Saved credentials are private to your local user and bound to the service origin. Login saves the token; the next API command verifies server access. `OCOLTA_API_KEY` takes precedence over the saved token. `ocolta logout` removes the local saved copy; unset the environment variable separately and revoke the grant in Ocolta to invalidate it remotely.

This CLI calls `https://app.ocolta.com/api/v1`. It uses the external-review API, which is separate from Ocolta's categorical-report MCP connection. A browser cookie or an MCP OAuth token is not a replacement for an external-review grant.

## Submit one review

Submission shares the selected file with Ocolta and its configured AI processing chain, then returns its report through this integration. Read the current disclosure in the Ocolta workspace and confirm that you may share the document. Deep Review+ additionally sends guarded institution details to research providers. The review is a document-level aid for human follow-up; it does not establish fraud, authenticity, identity, account ownership, or a person's eligibility.

```sh
ocolta reviews submit \
  --file ./document.pdf \
  --tier deep-review \
  --idempotency-key review-document-20261021 \
  --consent-to-processing \
  --confirm-credit-use
```

Use `--tier deep-review-plus` only with a grant bound to that tier. Both explicit processing consent and credit confirmation are required. The command sends disclosure version `2026-08-30.openrouter-zdr.v2`; update the CLI if the server rejects a stale disclosure.

One completed review uses **one existing purchased credit**, including inconclusive and safety-refused results. The CLI does not purchase credits. A first technical failure permits one explicitly requested retry; a second failed started attempt exhausts that credit. The CLI does not automatically retry a paid attempt.

Supported input: PDF, PNG, JPEG, or WebP, **up to 5 MiB**. PDFs allow up to 25 pages. Images allow up to 10,000 pixels per side and 40 megapixels. The service validates the bytes and processing limits.

## Recover status and result

Keep the `id` returned by submission:

```sh
ocolta reviews status --id job_0123456789abcdef0123456789abcdef
ocolta reviews result --id job_0123456789abcdef0123456789abcdef
```

These example IDs are synthetic. Only the submitting grant can retrieve its submissions. Reports are recoverable for **24 hours**; check `expiresAt`. The recovery copy excludes the local deterministic scan and combined scan judgment. An expired or revoked grant cannot read a report. Revoking a grant does not erase report copies already received by your integration.

If a response is lost, replay the original submission with the **same idempotency key and identical file bytes, filename, media type, tier, and disclosure version** to recover its existing operation. Do not switch to a new key to automatically retry. Keys contain 16–128 letters, numbers, underscores, or hyphens. Changed input with the same key returns a conflict.

## Limits and errors

- One active external review per purchase.
- At most 50 submissions per purchase per 24 hours.
- 60 authenticated requests per grant per minute.
- The grant ceiling includes completed credits, credits exhausted by failures, and active reservations.
- `401` or `403`: check the grant, expiry, revocation, purchase and tier in the purchasing browser.
- `402`: insufficient authorized purchased balance. `409`: inspect the existing operation and any active review before taking another action.
- `410`: the grant or report has expired. `429`: respect the response's retry guidance.
- `503` or a timeout: the outcome may be unknown; recover the existing operation before considering another attempt.

There is no CLI command to list all purchases or all reviews: the external API exposes submission and recovery for this grant's known job IDs. It does not provide a local free scan, document request links, new purchases, or bank-account-number verification.

## License

MIT. Published by Soxoa LLC.
