// Contract: Intakra native workspace MCP 3.0.0 and public app MCP 3.1.0.
// Source and live public metadata verified 2026-10-21; see CONTRACT.md.
const domains = { type: 'json', in: 'body', description: 'JSON array of 1 to 200 company domains. Omit to use all tracked accounts.' };
const opportunityId = { type: 'string', in: 'body', key: 'opportunity_id', required: true, description: 'Saved lead ID (eop_); leads/brief tools may also return rule matches (rh_).' };
const evidenceOptions = {
  account: { type: 'json', in: 'body', required: true, description: 'Object with business name: {"name":"Example Co"}.' },
  vendor: { type: 'json', in: 'body', required: true, description: 'Object with offer and idealCustomerProfile strings.' },
  'fit-criteria': { type: 'json', in: 'body', key: 'fitCriteria', required: true, description: '1 to 8 criterion/assessment/evidence objects.' },
  signals: { type: 'json', in: 'body', required: true, description: '1 to 10 supplied business-event observations. See examples/evidence.json.' },
  'as-of-date': { type: 'string', in: 'body', key: 'asOfDate', description: 'YYYY-MM-DD date for reproducible recency scoring.' },
};

export default {
  id: 'intakra',
  displayName: 'Intakra',
  baseUrl: 'https://intakra.com',
  homepage: 'https://intakra.com',
  description: 'Intakra CLI for tracked companies, dated buying evidence, saved leads, and workspace actions.',
  keywords: ['intakra', 'cli', 'sales', 'accounts', 'buying-signals', 'mcp', 'ai-agents'],
  mcpPath: '/api/mcp',
  auth: {
    env: 'INTAKRA_API_KEY',
    help: 'Generate an ik_live_ API key in Intakra Settings > API and MCP, then set INTAKRA_API_KEY. The key can read and act in its workspace; revoke it in Settings. Public evidence commands need no key.',
  },
  commands: [
    { name: 'evidence score', description: 'Score supplied account fit and dated observations for review. Does not research or access a workspace.', mcpTool: 'score_buying_signal_evidence', path: '/mcp', auth: false, body: true, options: evidenceOptions },
    { name: 'evidence review', description: 'Prepare a why-now review from supplied observations, with unverified claims clearly labeled.', mcpTool: 'prepare_why_now_review', path: '/mcp', auth: false, body: true, options: evidenceOptions },
    {
      name: 'accounts list', description: 'List tracked accounts, check dates, missing selected domains, and pagination.', mcpTool: 'list_accounts', auth: true, body: true,
      options: { domains, limit: { type: 'number', in: 'body', description: 'Integer 1 to 100; default 50.' }, offset: { type: 'number', in: 'body', description: 'Integer 0 to 10000; follow next_offset for another page.' } },
    },
    {
      name: 'accounts prioritize', description: 'Rank saved open leads relevant to your offering; include accounts awaiting checks or with no eligible lead.', mcpTool: 'prioritize_accounts', auth: true, body: true,
      options: { domains, limit: { type: 'number', in: 'body', description: 'Integer 1 to 100; default 20. Check truncation fields.' } },
    },
    {
      name: 'accounts changes', description: 'Read findings recorded since a date, distinguishing event dates from discovery dates.', mcpTool: 'get_account_changes', auth: true, body: true,
      options: { domains, since: { type: 'string', in: 'body', description: 'YYYY-MM-DD or ISO timestamp with timezone; default seven days ago.' }, limit: { type: 'number', in: 'body', description: 'Integer 1 to 200; default 50. Narrow dates/domains if truncated.' } },
    },
    {
      name: 'accounts get', description: 'Read one tracked company, up to 12 recent findings, and its open leads.', mcpTool: 'get_account', auth: true, body: true,
      options: { account: { type: 'string', in: 'body', required: true, description: 'Company domain, name, or account ID.' } },
    },
    {
      name: 'accounts add', description: 'Add domains to the tracked list for future normal checks. Existing plan account limits apply.', mcpTool: 'add_accounts', auth: true, body: true, requiresConfirmation: 'confirm-write',
      options: { domains: { ...domains, required: true, description: 'JSON array of 1 to 200 company domains to add. Existing domains are skipped.' } },
    },
    {
      name: 'accounts request', description: 'Queue account discovery under existing plan limits. May use product research resources; review suggestions later.', mcpTool: 'request_accounts', auth: true, body: true, requiresConfirmation: 'confirm-research',
      options: {
        description: { type: 'string', in: 'body', description: 'Description of the companies to find.' },
        industry: { type: 'string', in: 'body', description: 'Industry to find.' }, country: { type: 'string', in: 'body', description: 'Two-letter country code, such as US.' }, region: { type: 'string', in: 'body', description: 'State or region code.' },
        'employee-min': { type: 'number', in: 'body', key: 'employee_min', description: 'Minimum employees; positive integer.' },
        'employee-max': { type: 'number', in: 'body', key: 'employee_max', description: 'Maximum employees; positive integer.' },
        'lookalike-domains': { type: 'json', in: 'body', key: 'lookalike_domains', description: 'JSON array of up to 5 customer domains.' },
      },
    },
    {
      name: 'offering set', description: 'Replace the workspace description of what you sell, changing relevance for future checks.', mcpTool: 'set_offering', auth: true, body: true, requiresConfirmation: 'confirm-write',
      options: { offering: { type: 'string', in: 'body', required: true, description: 'What you sell, 10 to 600 characters.' } },
    },
    { name: 'brief get', description: 'Read today’s saved note, or what the next one would hold. Quiet days may return no accounts.', mcpTool: 'get_daily_brief', auth: true },
    {
      name: 'leads list', description: 'Read current saved leads with dated proof, relevance, and estimated timing.', mcpTool: 'list_opportunities', auth: true, body: true,
      options: { filter: { type: 'string', in: 'body', enum: ['open', 'closing_soon'], description: 'open (default) or usually winding down within 30 days.' }, limit: { type: 'number', in: 'body', description: 'Maximum 100; default 20.' } },
    },
    { name: 'leads contact', description: 'Read the likely project owner and why, with a verified work email when available and eligible.', mcpTool: 'get_best_contact', auth: true, body: true, options: { 'opportunity-id': opportunityId } },
    {
      name: 'leads mark', description: 'Record a lead decision. remind_later schedules one reminder email; future_scope can change future relevance.', mcpTool: 'mark_opportunity', auth: true, body: true, requiresConfirmation: 'confirm-write',
      options: {
        'opportunity-id': opportunityId,
        status: { type: 'string', in: 'body', required: true, enum: ['worth_a_call', 'not_relevant', 'already_customer', 'wrong_company', 'too_late', 'remind_later', 'saved', 'done'], description: 'Decision for this saved lead.' },
        'future-scope': { type: 'string', in: 'body', key: 'future_scope', enum: ['this_only', 'account', 'project_type'], description: 'Default this_only. account excludes future already_customer/wrong_company leads; project_type reduces relevance for not_relevant.' },
        reason: { type: 'string', in: 'body', description: 'Optional explanation, especially for not_relevant.' },
        days: { type: 'number', in: 'body', description: 'Reminder delay, 1 to 90 days; default 14.' },
      },
    },
    { name: 'projects updates', description: 'Read watch status and latest 20 material project changes with dated sources.', mcpTool: 'get_project_updates', auth: true, body: true, options: { 'opportunity-id': opportunityId } },
    {
      name: 'projects watch', description: 'Start or stop future project updates through existing workspace email/Slack preferences.', mcpTool: 'watch_project', auth: true, body: true, requiresConfirmation: 'confirm-write',
      options: { 'opportunity-id': opportunityId, active: { type: 'boolean', in: 'body', required: true, description: 'true to opt in to future updates; false to stop while keeping history.' } },
    },
    {
      name: 'crm push', description: 'Deliver a cited brief to connected CRMs. Any confirmed delivery marks the lead handled.', mcpTool: 'push_to_crm', auth: true, body: true, requiresConfirmation: 'confirm-crm',
      options: { 'opportunity-id': opportunityId, providers: { type: 'json', in: 'body', description: 'JSON array of hubspot, salesforce, or attio. Omit for all connected CRMs.' } },
    },
    {
      name: 'suggestions list', description: 'Read suggested accounts and why they fit; approval in Intakra is required before they count toward your plan.', mcpTool: 'list_suggestions', auth: true, body: true,
      options: { state: { type: 'string', in: 'body', enum: ['pending', 'approved', 'rejected'], description: 'Default pending.' }, limit: { type: 'number', in: 'body', description: 'Integer 1 to 100; default 25.' } },
    },
  ],
};
