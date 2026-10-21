# MentionedOn CLI

Read saved AI visibility reports, review discovery evidence, and prepare website fixes from your terminal. Commands return JSON for scripts and agents.

Requires Node.js 22 or later.

```sh
npm install -g mentionedon-cli
mentionedon --help
mentionedon login
mentionedon businesses list
mentionedon visibility report --business-id BUSINESS_UUID --limit 30
```

`login` connects your verified MentionedOn account through browser OAuth with PKCE. It requests `brands:read` and `website:write`. You can also supply an existing OAuth access token through `MENTIONEDON_ACCESS_TOKEN`; the issuing integration must refresh environment-provided tokens. Access tokens expire after one hour, and grants last up to 30 days. Keep credentials out of command arguments, chat, and source control.

The connection covers businesses you own. Businesses shared by another owner are excluded. An empty account returns a setup link; the CLI does not start a trial or subscription.

## Read visibility

```sh
mentionedon businesses list
mentionedon visibility report --business-id BUSINESS_UUID
mentionedon website get --business-id BUSINESS_UUID
```

Visibility reports contain saved capture dates, competitors, evidence links, provider gaps, and up to 30 historical snapshots. Evidence excerpts are capped at 20 runs, with `evidenceTruncated` indicating additional runs. Score changes use matching, complete capture recipes. Read the returned limitations: a failed provider is a gap, and saved captures do not establish current inclusion in consumer AI products. Read commands do not run new model scans.

## Prepare website fixes

First read the current revision. Use `0` only when no saved record exists.

```sh
mentionedon website get --business-id BUSINESS_UUID
mentionedon website inspect --business-id BUSINESS_UUID --revision 0 --confirm-write
```

Inspection fetches the saved business website using bounded public HTML requests and saves candidate facts with source receipts. It needs an active paid or trial monitoring slot. Review those facts with the business owner before creating drafts. Inspection will not overwrite an existing draft.

Create a private `confirmed-facts.json` containing only reviewed facts:

```json
{
  "businessId": "BUSINESS_UUID_FROM_LIST",
  "revision": 1,
  "businessType": "LocalBusiness",
  "facts": {
    "name": "Confirmed business name",
    "description": "Confirmed factual description",
    "addressCountry": "US"
  }
}
```

Replace the placeholder ID and revision with the exact values returned by MentionedOn, then:

```sh
mentionedon website draft --data @confirmed-facts.json --confirm-facts
mentionedon website get --business-id BUSINESS_UUID
```

Supported facts are `name` (required), `description`, `streetAddress`, `addressLocality`, `addressRegion`, `postalCode`, `addressCountry`, `telephone`, `email`, `openingHours`, and `services`. Values are strings. Country uses two uppercase letters. Hours use entries such as `Mo-Fr 09:00-17:00`; multiple schedules and services use newline-separated strings. Do not invent missing facts. Run `mentionedon website draft --help` for supported schema business types.

Review and install the generated schema and copy in your site editor. Then use the current saved revision to check the installed page:

```sh
mentionedon website verify --business-id BUSINESS_UUID --revision CURRENT_REVISION --url https://your-business.example/page --confirm-write
```

The CLI saves drafts and dated installation checks in MentionedOn. It does not publish your website, send messages, or purchase anything. Installation checks can be `found`, `not_found`, or `unknown`; a found installation does not prove improved AI visibility. If the service reports a revision conflict, read `website get` again before deciding whether to retry. Inspection and verification share a 20-per-day website-fetch limit; connected tools also have an hourly limit.

## Public evidence tools

These commands need no account. They evaluate observations you supply without fetching websites, calling models, or saving inputs. The example fixtures are synthetic and demonstrate the input format.

```sh
mentionedon evidence readiness --data @examples/readiness.json
mentionedon evidence plan --data @examples/action-plan.json
mentionedon evidence summarize --data @examples/captures.json
```

Use your own local JSON file, or copy the [examples](https://github.com/johnarndt/product-clis/tree/main/packages/mentionedon/examples) from the source repository. Individual fields can also be passed as flags:

```sh
mentionedon evidence readiness --business-name "Example Business" --signals '[{"signal":"business_identity","status":"unknown"}]'
```

Readiness and action-plan observations use `signal`, `status`, and optional `evidence`. Valid signals are `business_identity`, `service_location`, `page_description`, `contact_details`, `structured_data`, `corroborating_profiles`, `crawlability`, `buyer_faq`, `first_party_evidence`, and `machine_summary`. Each can appear once. Status is `present`, `partial`, `missing`, or `unknown`; every status except `unknown` requires supporting evidence. Omitted signals remain unknown.

Capture summaries accept 1 to 50 dated observations. A completed capture includes `businessMentioned`; `businessCitationUrls` must refer specifically to the business. Errors and skipped captures include a reason and are kept separate from completed captures.

## Integration

The CLI uses the supported [MentionedOn MCP endpoint](https://mentioned-on.com/developers/mcp), `https://mentioned-on.com/mcp`. MentionedOn does not expose a public `/api/v1` API or permanent API keys. Server validation and current plan limits apply to every command.

Review or revoke access at [MentionedOn connections](https://mentioned-on.com/oauth/connections). Refresh tokens rotate; do not share one refreshing credential file between independent runtimes. Removing local credentials does not itself revoke service access.

[Source and issues](https://github.com/johnarndt/product-clis) · [Contract evidence](CONTRACT.md)
