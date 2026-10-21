// Contract: MentionedOn live MCP 2.0.0, verified 2026-10-21.
// See CONTRACT.md for source paths and public schema snapshots.
const businessId = { type: 'string', in: 'body', key: 'businessId', required: true, description: 'Owned business UUID returned by businesses list.' };
const revision = { type: 'number', in: 'body', required: true, description: 'Exact saved revision from website get; 0 before the first inspection.' };
const businessName = { type: 'string', in: 'body', key: 'businessName', required: true, description: 'Business name, 2 to 120 characters.' };

export default {
  id: 'mentionedon',
  displayName: 'MentionedOn',
  baseUrl: 'https://mentioned-on.com',
  homepage: 'https://mentioned-on.com',
  description: 'MentionedOn CLI for saved AI visibility reports, discovery evidence, and reviewed website fixes.',
  keywords: ['mentionedon', 'cli', 'ai-visibility', 'discovery', 'business', 'mcp', 'ai-agents'],
  mcpPath: '/mcp',
  auth: {
    env: 'MENTIONEDON_ACCESS_TOKEN',
    help: 'Run mentionedon login to connect your account with OAuth. Public evidence commands need no connection. Access covers businesses you own, not businesses shared by another owner.',
    oauth: {
      register: '/oauth/register', authorize: '/oauth/authorize', token: '/oauth/token', revoke: '/oauth/revoke',
      resource: 'https://mentioned-on.com/mcp', scopes: ['brands:read', 'website:write'],
    },
  },
  commands: [
    {
      name: 'evidence readiness', description: 'Score supplied discovery observations. Does not fetch a website or run AI scans.', mcpTool: 'analyze_discovery_readiness', auth: false, body: true,
      options: {
        'business-name': businessName,
        'website-url': { type: 'string', in: 'body', key: 'websiteUrl', description: 'Optional HTTP(S) URL label; the tool does not fetch it.' },
        signals: { type: 'json', in: 'body', required: true, description: 'JSON array of signal/status/evidence observations. See examples/readiness.json.' },
      },
    },
    {
      name: 'evidence plan', description: 'Prioritize website actions from supplied findings without saving or publishing changes.', mcpTool: 'build_visibility_action_plan', auth: false, body: true,
      options: {
        'business-name': businessName,
        goal: { type: 'string', in: 'body', required: true, enum: ['improve_discovery_clarity', 'strengthen_citation_evidence', 'prepare_for_monitoring'], description: 'Outcome used to prioritize the supplied findings.' },
        'effort-budget': { type: 'string', in: 'body', key: 'effortBudget', required: true, enum: ['lean', 'balanced', 'comprehensive'], description: 'How many actions to include and how to phase them.' },
        findings: { type: 'json', in: 'body', required: true, description: 'JSON array of signal/status/evidence observations.' },
      },
    },
    {
      name: 'evidence summarize', description: 'Calculate mention and citation rates from your dated captures. Does not obtain new captures.', mcpTool: 'summarize_scan_evidence', auth: false, body: true,
      options: {
        'business-name': businessName,
        observations: { type: 'json', in: 'body', required: true, description: 'JSON array of 1 to 50 dated captures. See examples/captures.json.' },
      },
    },
    { name: 'businesses list', description: 'List owned businesses and monitoring/setup status. Does not start scans or subscriptions.', mcpTool: 'list_monitored_businesses', auth: true },
    {
      name: 'visibility report', description: 'Read saved captures, competitors, evidence links, gaps, and comparable history.', mcpTool: 'get_visibility_report', auth: true, body: true,
      options: { 'business-id': businessId, limit: { type: 'number', in: 'body', description: 'History size, integer 1 to 30; default 30.' } },
    },
    { name: 'website get', description: 'Read saved website facts, drafts, verification, and current revision.', mcpTool: 'get_website_fixes', auth: true, body: true, options: { 'business-id': businessId } },
    {
      name: 'website inspect', description: 'Fetch the owned business website and save candidate facts. Requires an entitled monitoring slot.', mcpTool: 'inspect_business_website', auth: true, body: true, requiresConfirmation: 'confirm-write', bodyDefaults: { authorizationAcknowledged: true },
      options: { 'business-id': businessId, revision },
    },
    {
      name: 'website draft', description: 'Save schema and copy from facts you have reviewed and confirmed. Does not publish the website.', mcpTool: 'draft_website_fixes', auth: true, body: true, requiresConfirmation: 'confirm-facts', bodyDefaults: { confirmed: true },
      options: {
        'business-id': businessId, revision,
        facts: { type: 'json', in: 'body', required: true, description: 'Object of confirmed business facts. Requires name. See README for fields.' },
        'business-type': { type: 'string', in: 'body', key: 'businessType', required: true, enum: ['LocalBusiness', 'ProfessionalService', 'HomeAndConstructionBusiness', 'Plumber', 'Electrician', 'HVACBusiness', 'RoofingContractor', 'Dentist', 'MedicalBusiness', 'LegalService', 'RealEstateAgent', 'Restaurant', 'LodgingBusiness', 'Store', 'AutoRepair', 'BeautySalon'], description: 'Schema type matching the confirmed business.' },
      },
    },
    {
      name: 'website verify', description: 'Fetch a page on the same business website and save installation checks for the exact draft revision.', mcpTool: 'verify_website_fixes', auth: true, body: true, requiresConfirmation: 'confirm-write', bodyDefaults: { authorizationAcknowledged: true },
      options: { 'business-id': businessId, revision: { ...revision, description: 'Exact current revision from website get; must be positive.' }, url: { type: 'string', in: 'body', required: true, description: 'Page URL on the same owned business website.' } },
    },
  ],
};
