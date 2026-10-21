const bodyString = (key, description, required = false) => ({ type: 'string', in: 'body', key, description, required });
const bodyNumber = (key, description, required = false) => ({ type: 'number', in: 'body', key, description, required });
const id = { type: 'string', in: 'path', required: true, description: 'Existing Postedly resource ID.' };
const savedFilters = {
  key: bodyString('key', 'Exact saved key.'),
  query: bodyString('query', 'Text to match in the saved label.'),
  offset: bodyNumber('offset', 'Pagination offset, starting at 0.'),
  limit: bodyNumber('limit', 'Items per page, from 1 to 25.'),
};
const savedWrite = {
  key: bodyString('key', 'Stable lowercase key, using letters, numbers, hyphens or underscores.'),
  label: bodyString('label', 'Private display label, up to 100 characters.'),
  'expected-version': bodyNumber('expectedVersion', '0 to create; current saved version to update.'),
};
const savedDelete = {
  key: bodyString('key', 'Exact key to delete.', true),
  'expected-version': bodyNumber('expectedVersion', 'Current saved version, obtained from the list command.', true),
};

export default {
  id: 'postedly',
  displayName: 'Postedly',
  baseUrl: 'https://postedly.com',
  homepage: 'https://postedly.com/developers',
  description: 'Prepare physical mail, fax and handwritten cards; obtain a private review link and track delivery from the terminal.',
  keywords: ['postedly', 'cli', 'mail', 'fax', 'postcards', 'certified-mail', 'handwritten-cards', 'ai-agents'],
  mcpPath: '/mcp/send',
  auth: {
    env: 'POSTEDLY_TOKEN',
    help: 'Run postedly login for browser OAuth consent, or provide an existing OAuth access token in POSTEDLY_TOKEN. Postedly does not issue permanent API keys. OAuth consent is separate from approving an order.',
    oauth: {
      register: '/oauth/register',
      authorize: '/oauth/authorize',
      token: '/oauth/token',
      resource: 'https://postedly.com/mcp/send',
      scopes: ['orders:read', 'quotes:write', 'checkout:write', 'contacts:read', 'contacts:write', 'drafts:read', 'drafts:write'],
    },
  },
  commands: [
    {
      name: 'services list', description: 'Read current services, availability, starting prices and document requirements.',
      method: 'GET', path: '/api/catalog', auth: false,
    },
    {
      name: 'products list', description: 'Read handwritten card IDs, handwriting styles and current availability.',
      method: 'GET', path: '/api/products', auth: false,
      options: { service: { type: 'string', in: 'query', required: true, description: 'Use handwritten.' } },
    },
    {
      name: 'account show', description: 'Read the connected sender email, verification and session expiry.',
      method: 'GET', path: '/api/session', auth: true,
    },
    {
      name: 'documents upload', description: 'Upload an existing PDF, up to 10 MiB. Does not quote, approve, pay or send.',
      method: 'POST', path: '/api/documents', auth: true,
      multipart: { fileOption: 'file', fileField: 'file', maxBytes: 10485760 },
      options: {
        file: { type: 'string', in: 'file', required: true, description: 'Local path to the exact recipient-facing PDF.' },
        service: bodyString('service', 'fax, letter, certified or postcard.', true),
        'expected-sha256': bodyString('expectedSha256', 'Optional SHA-256 of the original bytes; mismatches are rejected.'),
      },
    },
    {
      name: 'documents download', description: 'Download an owned PDF or the final proof document by ID to a new private --output file.',
      method: 'GET', path: '/api/documents/{id}', auth: true, response: 'binary', options: { id },
    },
    {
      name: 'documents prepare', description: 'Create a private upload handoff when the PDF is not available locally; expires in 15 minutes.',
      method: 'POST', path: '/mcp/send', auth: true, mcpTool: 'postedly_prepare_document',
      options: { service: bodyString('service', 'fax, letter, certified or postcard.', true), filename: bodyString('filename', 'Optional expected filename.') },
    },
    {
      name: 'documents status', description: 'Read an existing upload handoff and its completed document details.',
      method: 'POST', path: '/mcp/send', auth: true, mcpTool: 'postedly_document_status',
      options: { id: bodyString('documentRequestId', 'Upload handoff documentRequestId.', true) },
    },
    {
      name: 'quotes create', description: 'Price one exact document or handwritten card and one recipient. Supply service, recipient, sender and options with --data. Does not send.',
      method: 'POST', path: '/api/quotes', auth: true, body: true,
      options: { service: bodyString('service', 'fax, letter, certified, postcard or handwritten.'), 'document-id': bodyString('documentId', 'ID from documents upload, for PDF services.') },
    },
    {
      name: 'checkout review', description: 'Get a private browser review link for an existing quote. The payer approves the proof, recipient, total and terms in the browser before payment.',
      method: 'POST', path: '/mcp/send', auth: true, mcpTool: 'postedly_checkout',
      options: { 'quote-id': bodyString('quoteId', 'Existing unexpired quote ID.', true) },
    },
    {
      name: 'orders list', description: 'Read up to 100 newest orders created by this account or approved by it as payer.',
      method: 'GET', path: '/api/orders', auth: true,
    },
    {
      name: 'orders search', description: 'Search orders created by this connected account, with pagination and status/date filters.',
      method: 'POST', path: '/mcp/send', auth: true, mcpTool: 'postedly_orders',
      options: {
        query: bodyString('query', 'Match order ID or recipient name.'),
        service: bodyString('service', 'fax, letter, certified, postcard or handwritten.'),
        status: bodyString('fulfillmentStatus', 'Fulfillment state, such as awaiting_payment, sent, delivered, failed or cancelled.'),
        after: bodyString('createdAfter', 'Inclusive ISO 8601 timestamp with timezone.'),
        before: bodyString('createdBefore', 'Inclusive ISO 8601 timestamp with timezone.'),
        offset: bodyNumber('offset', 'Pagination offset, starting at 0.'),
        limit: bodyNumber('limit', 'Items per page, from 1 to 50.'),
      },
    },
    {
      name: 'orders show', description: 'Read one owned order, payment state, fulfillment state and provider timeline.',
      method: 'GET', path: '/api/orders/{id}', auth: true, options: { id },
    },
    {
      name: 'orders report', description: 'Read a delivery record for an order created by this connected account. The JSON result contains a plain-text report in content.',
      method: 'POST', path: '/mcp/send', auth: true, mcpTool: 'postedly_delivery_report',
      options: { id: bodyString('orderId', 'Existing order ID.', true) },
    },
    {
      name: 'orders cancel', description: 'Request cancellation of one owned order when still allowed. Cancellation can fail if fulfillment has advanced.',
      method: 'POST', path: '/api/orders/{id}/cancel', auth: true, options: { id }, requiresConfirmation: 'confirm',
    },
    {
      name: 'contacts list', description: 'Read private saved recipients and sender addresses, including versions for safe updates.',
      method: 'POST', path: '/mcp/send', auth: true, mcpTool: 'postedly_contacts', options: savedFilters,
    },
    {
      name: 'contacts save', description: 'Save one private contact on explicit request. --data supplies key, label, expectedVersion and contact {role,details}. Retained one year after saving.',
      method: 'POST', path: '/mcp/send', auth: true, mcpTool: 'postedly_save_contact', body: true,
      options: savedWrite, bodyDefaults: { confirmedSave: true }, requiresConfirmation: 'confirm',
    },
    {
      name: 'contacts delete', description: 'Delete a saved contact using its current version. Existing quotes and orders retain their details.',
      method: 'POST', path: '/mcp/send', auth: true, mcpTool: 'postedly_delete_contact',
      options: savedDelete, bodyDefaults: { confirmedDelete: true }, requiresConfirmation: 'confirm',
    },
    {
      name: 'drafts list', description: 'Read saved correspondence drafts and versions. A draft is not a quote, approval, payment or order.',
      method: 'POST', path: '/mcp/send', auth: true, mcpTool: 'postedly_drafts', options: savedFilters,
    },
    {
      name: 'drafts save', description: 'Save private preparation details on explicit request. --data supplies key, label, expectedVersion and draft. Retained 30 days; PDF expiry is separate.',
      method: 'POST', path: '/mcp/send', auth: true, mcpTool: 'postedly_save_draft', body: true,
      options: savedWrite, bodyDefaults: { confirmedSave: true }, requiresConfirmation: 'confirm',
    },
    {
      name: 'drafts delete', description: 'Delete one saved draft using its current version. Does not delete its PDF or change a quote or order.',
      method: 'POST', path: '/mcp/send', auth: true, mcpTool: 'postedly_delete_draft',
      options: savedDelete, bodyDefaults: { confirmedDelete: true }, requiresConfirmation: 'confirm',
    },
  ],
};
