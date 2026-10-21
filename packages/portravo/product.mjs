const projectId = { type: 'string', in: 'path', required: true, description: 'Owned Portravo project ID.' };
const uploadId = { type: 'string', in: 'path', key: 'uploadId', required: true, description: 'Upload grant ID.' };
const idempotency = { type: 'string', in: 'header', key: 'Idempotency-Key', required: true, description: 'Stable operation key: 8–128 letters, numbers, _, ., :, or -. Reuse on an identical retry.' };

export default {
  id: 'portravo',
  displayName: 'Portravo',
  baseUrl: 'https://portravo.com',
  homepage: 'https://portravo.com',
  description: 'Portravo CLI for construction plan uploads, project takeoffs, extraction status, and reviewed estimate exports.',
  keywords: ['portravo', 'cli', 'construction', 'takeoff', 'estimating', 'plans', 'api', 'ai-agents'],
  auth: {
    env: 'PORTRAVO_API_KEY',
    help: 'Create a scoped ptrv_ API key in Portravo Settings > Integrations. Keys expire after 90 days. Read commands require projects:read; creation projects:write; plan uploads plans:write; extraction extractions:write; export estimates:read. Upload PUT uses its separate short-lived upload token.',
  },
  commands: [
    { name: 'metros list', description: 'List supported pricing markets and their direct-price availability.', method: 'GET', path: '/api/v1/metros', auth: true },
    { name: 'projects list', description: 'List up to 50 owned projects; use nextOffset for the following page.', method: 'GET', path: '/api/v1/projects', auth: true, options: { offset: { type: 'number', in: 'query', description: 'Integer offset from 0 to 999999.' } } },
    { name: 'projects get', description: 'Read an owned project, takeoff lines, file metadata, and review URL.', method: 'GET', path: '/api/v1/projects/{id}', auth: true, options: { id: projectId } },
    {
      name: 'projects create', description: 'Create a draft project without consuming a takeoff credit.', method: 'POST', path: '/api/v1/projects', auth: true, body: true,
      options: {
        'idempotency-key': idempotency,
        name: { type: 'string', in: 'body', description: 'Project name, 1–120 characters. Required by the API.' },
        address: { type: 'string', in: 'body', description: 'Optional address, up to 200 characters.' },
        'metro-code': { type: 'string', in: 'body', key: 'metroCode', description: 'Pricing market code from metros list.' },
      },
    },
    {
      name: 'uploads create', description: 'Create a private 15-minute upload grant for a project’s first plan PDF.', method: 'POST', path: '/api/v1/projects/{id}/uploads', auth: true, body: true,
      options: { id: projectId, filename: { type: 'string', in: 'body', description: 'PDF filename without path separators, up to 200 characters. Required by the API.' } },
    },
    {
      name: 'uploads file', description: 'PUT a PDF using PORTRAVO_UPLOAD_TOKEN from an upload grant; limit 10 MiB.', method: 'PUT', path: '/api/v1/projects/{id}/uploads/{uploadId}/file', auth: false,
      rawFile: { fileOption: 'file', contentType: 'application/pdf', maxBytes: 10485760, tokenEnv: 'PORTRAVO_UPLOAD_TOKEN' },
      options: { id: projectId, 'upload-id': uploadId, file: { type: 'string', in: 'file', required: true, description: 'Local PDF file path.' } },
    },
    {
      name: 'uploads complete', description: 'Validate and attach a successfully uploaded first plan; no extraction or credit use.', method: 'POST', path: '/api/v1/projects/{id}/uploads/{uploadId}/complete', auth: true, body: true,
      options: { id: projectId, 'upload-id': uploadId, url: { type: 'string', in: 'body', description: 'Exact private URL returned by uploads file. Required by the API.' } },
    },
    {
      name: 'extract start', description: 'Start an initial takeoff using existing balance. Review the project’s trades and credit cost first.', method: 'POST', path: '/api/v1/projects/{id}/extract', auth: true, body: true, requiresConfirmation: 'confirm-credit-use',
      options: { id: projectId, 'idempotency-key': idempotency, 'confirm-credit-use': { type: 'boolean', in: 'body', key: 'confirmCreditUse', description: 'Authorize the selected project’s takeoff credit use.' } },
    },
    {
      name: 'extract status', description: 'Read extraction status without advancing, retrying, or consuming credits.', method: 'GET', path: '/api/v1/projects/{id}/extract/status', auth: true,
      options: { id: projectId, 'run-id': { type: 'string', in: 'query', key: 'runId', description: 'Optional specific extraction run.' } },
    },
    {
      name: 'extract advance', description: 'Advance an existing run without charging again. Use a new key for each distinct advance.', method: 'POST', path: '/api/v1/projects/{id}/extract/advance', auth: true, body: true,
      options: { id: projectId, 'idempotency-key': idempotency, 'run-id': { type: 'string', in: 'body', key: 'runId', description: 'Run ID returned by extraction. Required by the API.' } },
    },
    {
      name: 'projects export', description: 'Download the reviewed, priced estimate as XLSX. Requires --output.', method: 'GET', path: '/api/v1/projects/{id}/export', auth: true, response: 'binary',
      options: { id: projectId },
    },
  ],
};
