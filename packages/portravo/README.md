# Portravo CLI

Use [Portravo](https://portravo.com) from a terminal or an agent: list projects, upload a construction plan, run a takeoff with existing balance, check progress, and download a reviewed estimate.

```sh
npm install --global portravo-cli
portravo --help
```

Requires Node.js 22 or later. JSON responses support scripts and agent workflows. Source: [johnarndt/product-clis](https://github.com/johnarndt/product-clis).

## Authentication

Complete your Portravo account setup, then create a scoped API key in [Settings > Integrations](https://portravo.com/settings). Keys begin with `ptrv_`, expire after 90 days, and can be revoked in Settings. Supply the key through `PORTRAVO_API_KEY` using your secret manager. Do not put a real key in source, command examples, issue reports, or logs.

Alternatively, save a key locally with a hidden terminal prompt:

```sh
portravo login
portravo auth status
```

For automation, pipe the token from your secret manager into `portravo login --token-stdin`, or redirect an existing private token file:

```sh
portravo login --token-stdin < /secure/path/portravo-token.txt
```

Saved credentials are private to your local user and bound to the service origin. Login saves the token; the next API command verifies server access. `PORTRAVO_API_KEY` takes precedence over the saved key. `portravo logout` removes the saved copy; unset the environment variable separately and revoke the key in Portravo to invalidate it remotely.

| Operation | Key scope |
| --- | --- |
| Markets, projects, takeoff lines and status | `projects:read` |
| Create a draft project | `projects:write` |
| Issue and complete a plan upload | `plans:write` |
| Start or advance extraction | `extractions:write` |
| Export a reviewed estimate | `estimates:read` |

The file PUT uses the upload grant's short-lived `clientToken` through `PORTRAVO_UPLOAD_TOKEN`. It does not use the main API key.

## Read projects

```sh
portravo metros list
portravo projects list
portravo projects list --offset 50
portravo projects get --id PROJECT_ID
portravo extract status --id PROJECT_ID
portravo extract status --id PROJECT_ID --run-id RUN_ID
```

Project lists contain at most 50 entries. Use the returned `nextOffset`, until it is `null`. Project details contain takeoff lines, selected trades, plan metadata, source information when available, and a review URL. A status read never advances or retries extraction.

## Create and upload

```sh
portravo projects create \
  --idempotency-key my-plan-project-20261021 \
  --data '{"name":"Warehouse bid","trades":["electrical"]}'

portravo uploads create --id PROJECT_ID --filename plan.pdf
```

Choose only currently supported automatic trades. The API rejects unavailable selections; team-assisted orders are available through [Portravo upload](https://portravo.com/upload). Read `metros list` before providing an optional `metroCode`. Project creation consumes no takeoff credit. `--data @project.json` also accepts a JSON file.

The upload response contains a private `clientToken`. Load it into `PORTRAVO_UPLOAD_TOKEN` with your secure runtime, then transfer the actual file:

```sh
portravo uploads file --id PROJECT_ID --upload-id UPLOAD_ID --file ./plan.pdf
```

Send the exact `url` returned by that transfer to complete the upload. Keep this private value in a local JSON file containing `{"url":"the exact returned URL"}`:

```sh
portravo uploads complete --id PROJECT_ID --upload-id UPLOAD_ID --data @upload-completion.json
```

API uploads support PDFs up to **10 MiB**. A grant lasts 15 minutes and is bound to one path and filename. A second file PUT to a used grant returns a conflict. Requesting the same filename can renew an unfinished grant. The browser's separate direct-upload flow supports larger files; this CLI does not silently switch flows. Uploading and attaching a plan do not start a takeoff.

## Run an authorized takeoff

Review the project, selected trades, and required credit cost in Portravo before starting. This command uses existing subscription allowance or purchased credits; it does not buy credits. Trade scope determines the cost, so a multi-trade takeoff can consume more than one credit.

```sh
portravo extract start --id PROJECT_ID \
  --idempotency-key my-plan-extract-20261021 \
  --confirm-credit-use
```

`--confirm-credit-use` is required for this command. A completed initial request can return `202` while work continues. Use status first. If the response calls for an explicit advance, respect its `retryAfterMs` and advance the returned run:

```sh
portravo extract advance --id PROJECT_ID --run-id RUN_ID \
  --idempotency-key my-plan-advance-0001
```

Every distinct advance needs a new idempotency key. Retrying the **same** operation after a lost response needs its **original** key and identical input. Do not replace a key merely because a request timed out. Keys contain 8–128 letters, numbers, underscores, periods, colons, or hyphens. An advance does not charge again. The CLI never automatically retries a paid start.

## Export

Review each line and complete pricing in Portravo before exporting:

```sh
portravo projects export --id PROJECT_ID --output ./estimate.xlsx
```

The response is an Excel workbook. `--output` is required; export rejects a project that has not met the existing review and pricing checks. Extraction does not approve line items, finalize a bid, or establish takeoff accuracy.

## Limits and troubleshooting

- General requests: 120 per minute per account, shared by keys.
- Initial extraction: 3 per 10 minutes per account. Advances: 60 per 10 minutes.
- `401`: missing, expired, or revoked key. `403`: missing scope or incomplete onboarding.
- `402`: existing balance is insufficient. `409`: review protection, upload conflict, or idempotency conflict; inspect the existing project before another action.
- `429`: respect `Retry-After`. `503`: API or extraction availability is limited; preserve the original key before deciding whether to retry.

The [public OpenAPI contract](https://portravo.com/api/v1/openapi.json) describes the service. Features, selected trades, and prices can change independently of the CLI. An API success or a populated takeoff does not replace review of source plans, quantities, scope, and pricing.

## License

MIT. Published by Soxoa LLC.
