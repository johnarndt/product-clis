# Intakra CLI

Review tracked companies, dated evidence, saved leads, and the person who likely owns a project. Update your account list and hand reviewed briefs to connected CRMs from your terminal. Commands return JSON for scripts and agents.

Requires Node.js 22 or later.

```sh
npm install -g intakra-cli
intakra --help
```

Generate an API key in **Intakra > Settings > API and MCP**. Store the `ik_live_` key as `INTAKRA_API_KEY` using your shell or runtime's secret store. The key can read and act in its workspace; revoke it in Settings. Keep it out of command arguments, chat, and source control.

```sh
intakra brief get
intakra accounts list --limit 50
intakra accounts prioritize --limit 20
intakra accounts get --account example.com
intakra leads list --filter closing_soon
```

## Find the right accounts

```sh
intakra accounts list --domains '["example.com","example.org"]'
intakra accounts list --offset 50 --limit 50
intakra accounts changes --since 2026-10-01 --limit 100
intakra accounts prioritize --domains '["example.com","example.org"]'
intakra leads contact --opportunity-id eop_LEAD_ID
intakra projects updates --opportunity-id eop_LEAD_ID
```

Follow `next_offset` from the account list. Ranking and changes responses can be truncated; narrow domains or dates before treating a result as complete. Account detail contains up to 12 recent findings. Project updates contain the latest 20 material changes.

Read tools use saved records and do not invoke new research. Public events are proof of those events; need, budget, and purchase intent remain interpretations. Keep pending checks, missing accounts, and accounts without eligible leads distinct. A quiet daily note is normal.

`leads contact` returns who likely owns one saved lead and why. When available, it includes a verified work email, except for EU, EEA, or UK companies. It may instead return a LinkedIn search for the relevant title. The CLI does not draft or send outreach.

## Update the workspace

```sh
intakra accounts add --domains '["example.com","example.org"]' --confirm-write
intakra offering set --offering "Payroll software for restaurant groups with 5 to 50 locations" --confirm-write
intakra accounts request --description "Logistics software companies in Texas" --confirm-research
intakra suggestions list --state pending
```

Adding accounts skips duplicates and respects your plan's tracked-account cap. New domains are checked on the next normal pass. `offering set` replaces the current description, which affects relevance in future checks. It accepts 10 to 600 characters.

Account discovery runs in the background and may use product research resources under existing feature, billing, and spending limits. It does not purchase extra credits. The request is not automatically retried. Suggestions do not count toward your plan until approved in Intakra. Use `suggestions list` to inspect them and the website to approve them.

## Handle leads and delivery

```sh
intakra leads mark --opportunity-id eop_LEAD_ID --status saved --confirm-write
intakra leads mark --opportunity-id eop_LEAD_ID --status remind_later --days 14 --confirm-write
intakra projects watch --opportunity-id eop_LEAD_ID --active=true --confirm-write
intakra projects watch --opportunity-id eop_LEAD_ID --active=false --confirm-write
intakra crm push --opportunity-id eop_LEAD_ID --providers '["hubspot"]' --confirm-crm
```

`remind_later` schedules one reminder email. A project watch opts into future material updates through existing workspace email and Slack preferences; stopping preserves saved history. Only opt in when those updates are wanted.

Lead statuses are `worth_a_call`, `not_relevant`, `already_customer`, `wrong_company`, `too_late`, `remind_later`, `saved`, and `done`. The default `future_scope` is `this_only`. Use `--future-scope account` with `already_customer` or `wrong_company` only to exclude future leads for that account. Use `--future-scope project_type` with `not_relevant` only to reduce that project type's relevance. These preferences can be undone in **What we watch**. Rule-match IDs beginning `rh_` support only the applicable subset; server validation remains authoritative.

CRM delivery accepts `hubspot`, `salesforce`, or `attio`. Omitting `--providers` sends to every connected CRM. At least one confirmed delivery marks the lead handled; inspect each destination's result for partial failures. Confirmed retries reuse the mapped company. After an unknown create outcome, verify and link the record in **Opportunities > Review brief / CRM** before retrying.

## Public evidence review

The two public commands need no API key. They evaluate supplied business observations without fetching sources, accessing a workspace, storing inputs, doing research, or sending anything.

```sh
intakra evidence score --data @examples/evidence.json
intakra evidence review --data @examples/evidence.json
```

Use a local JSON file in this format, replacing the synthetic example with evidence you can substantiate:

```json
{
  "account": { "name": "Example Logistics" },
  "vendor": {
    "offer": "Warehouse planning software",
    "idealCustomerProfile": "Logistics companies opening facilities"
  },
  "fitCriteria": [
    {
      "criterion": "Operates warehouses",
      "assessment": "match",
      "evidence": "The supplied company page describes three warehouses."
    }
  ],
  "signals": [
    {
      "kind": "expansion",
      "evidence": "The supplied announcement describes a planned new facility.",
      "observedAt": "2026-10-20",
      "relevanceToOffer": "A new facility may create a warehouse-planning project.",
      "confidence": "medium"
    }
  ],
  "asOfDate": "2026-10-21"
}
```

Fit assessments are `match`, `mismatch`, or `unknown`. Signal kinds are `leadership_change`, `hiring`, `funding`, `product_launch`, `expansion`, `technology_change`, `partnership`, `regulatory_event`, or `other`. Confidence is `high`, `medium`, or `low`. Include 1 to 8 fit criteria and 1 to 10 signals. Optional `sourceUrl` values must be credential-free HTTPS URLs; the service does not verify them. Set `asOfDate` for reproducible scoring.

## Integration

Connected commands use the supported native API-key endpoint `https://intakra.com/api/mcp`, which exposes 15 workspace tools. Public evidence commands use `https://intakra.com/mcp`. This CLI's connected workflow uses the native API key; it does not treat a browser session or OAuth token as an API key.

Intakra also has three read-only REST endpoints (`/api/v1/accounts`, `/api/v1/opportunities`, `/api/v1/brief`). The CLI uses MCP for the fuller saved-evidence contract and explicit actions. The retired `/api/v1/signals` endpoint is not used. Server permissions, feature availability, and current plan limits apply.

[Connection guide](https://intakra.com/api/mcp/setup) · [Source and issues](https://github.com/johnarndt/product-clis) · [Contract evidence](CONTRACT.md)
