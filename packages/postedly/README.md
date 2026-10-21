# Postedly CLI

Prepare physical mail, fax and handwritten cards, get a private review link, and track delivery from your terminal. Commands return JSON for scripts and agents.

Requires Node.js 22 or later.

```sh
npm install -g postedly-cli
postedly --help
postedly services list
postedly login
postedly account show
```

`postedly login` uses browser OAuth consent with PKCE. Postedly does not issue permanent API keys. For an existing integration, provide its OAuth access token through `POSTEDLY_TOKEN`. Keep tokens in your runtime's secret store, outside source control, command arguments and chat. Access tokens expire after one hour. An environment-provided token must be refreshed by the integration that issued it.

## Prepare a delivery

Read the live catalog before choosing a service. An `available: true` value means automated ordering is available; a manual quote entry must use its returned `quoteUrl`.

```sh
postedly services list
postedly products list --service handwritten
postedly documents upload --service letter --file ./finished-letter.pdf
```

Upload the finished, recipient-facing PDF. Letter, certified mail, fax and postcard uploads have a 10 MiB limit. Postcards require a two-page landscape PDF with the current catalog dimensions. `--expected-sha256` optionally checks byte integrity. Handwritten cards use a card, handwriting style and exact message instead of an upload.

Create a private `quote.json` containing the confirmed details below. Replace `DOCUMENT_ID_FROM_UPLOAD` and all example contact information before use. The connected account's verified email is used when `sender.email` is omitted.

```json
{
  "service": "letter",
  "documentId": "DOCUMENT_ID_FROM_UPLOAD",
  "recipient": {
    "name": "Confirmed recipient name",
    "address1": "Confirmed recipient street",
    "city": "Confirmed city",
    "state": "CA",
    "postalCode": "Confirmed ZIP",
    "country": "US"
  },
  "sender": {
    "name": "Confirmed sender name",
    "address1": "Confirmed return street",
    "city": "Confirmed city",
    "state": "CA",
    "postalCode": "Confirmed ZIP",
    "country": "US"
  },
  "options": {}
}
```

```sh
postedly quotes create --data @quote.json
postedly documents download --id FINAL_PROOF_DOCUMENT_ID --output ./final-proof.pdf
postedly checkout review --quote-id QUOTE_ID_FROM_RESPONSE
```

For PDF services, use the returned quote's `document.id` for `FINAL_PROOF_DOCUMENT_ID` and inspect every page of that final proof. `--output` creates a new file and refuses to overwrite an existing file. Open the returned private review URL. The payer reviews the exact proof or item, recipient, total and terms, verifies their receipt email if needed, and explicitly approves before Stripe Checkout. Uploading, quoting and generating this URL do not approve, pay or send. OAuth consent does not approve an order.

Fax quotes require the recipient's US fax number in `recipient.fax` with `+1`, plus the sender's US billing state and ZIP. For a handwritten card, omit `documentId` and provide `options.productId`, the selected style's exact `options.fontLabel`, and `options.message`; optional `options.wishes` is the closing. The current product catalog's character limits apply.

When the PDF is unavailable locally, `postedly documents prepare --service letter` returns a private upload handoff. Use `postedly documents status --id DOCUMENT_REQUEST_ID` to check it. Handoffs expire after 15 minutes.

## Track and manage orders

```sh
postedly orders list
postedly orders search --query "Recipient name" --limit 25
postedly orders search --status delivered --after 2026-01-01T00:00:00Z
postedly orders search --offset 25 --limit 25
postedly orders show --id ORDER_ID
postedly orders report --id ORDER_ID
postedly orders cancel --id ORDER_ID --confirm
```

`orders list` includes up to 100 recent orders created by the account or approved by it as payer. Search and report operations cover orders created by the connected account; search returns `nextOffset` for another page. A report's JSON `content` field contains its plain-text record. Provider milestones are recorded evidence, not independent proof of receipt.

Check `canCancel` before requesting cancellation; fulfillment may advance before the request arrives. After an uncertain payment or send result, inspect the existing order before taking another action. Do not create a duplicate order after a timeout.

## Save contacts and drafts

```sh
postedly contacts list --query "Office"
postedly contacts save --data @contact.json --confirm
postedly contacts delete --key office --expected-version 1 --confirm
postedly drafts list --key renewal
postedly drafts save --data @draft.json --confirm
postedly drafts delete --key renewal --expected-version 1 --confirm
```

Save only when the user asks to remember these details. Contact input has this shape:

```json
{
  "key": "office",
  "label": "Office recipient",
  "expectedVersion": 0,
  "contact": {
    "role": "recipient",
    "details": {
      "name": "Confirmed recipient name",
      "address1": "Confirmed street",
      "city": "Confirmed city",
      "state": "CA",
      "postalCode": "Confirmed ZIP",
      "country": "US"
    }
  }
}
```

For drafts, replace `contact` with `draft`, containing `service` and optional `documentId`, `recipient`, `sender` and `options`. Use `expectedVersion: 0` for a new key; read the saved item and supply its current version before updating or deleting. Contacts expire one year after their last save. Drafts expire after 30 days; their uploaded documents can expire separately. Resume a draft with current availability, a new quote and the normal browser review.

## API and authentication

The CLI uses the canonical `https://postedly.com` HTTP API and `/mcp/send` for private saved correspondence, order search, reports, document handoffs and browser review links. Browser login requests `orders:read`, `quotes:write`, `checkout:write`, `contacts:read`, `contacts:write`, `drafts:read` and `drafts:write`. An existing token with fewer scopes can use only its authorized commands.

The OAuth resource is `https://postedly.com/mcp/send`. Native callbacks use a loopback address. Refresh rotates both tokens; concurrent refresh or replay of a retired refresh token can revoke the grant. Do not share one refreshing credential file across independent runtimes. Removing local credentials does not revoke consent at the service. The owning OAuth client can revoke its grant through the documented `/oauth/revoke` endpoint using its client ID and token.

Private proofs, review links, contact details and order reports must stay private. The CLI does not complete a payment or bypass the browser's order approval.

See the [developer guide](https://postedly.com/developers), [API reference](https://postedly.com/openapi.json), [agent connection guide](https://postedly.com/agent-guide.md), and [source repository](https://github.com/johnarndt/product-clis).
