const reviewId = { type: 'string', in: 'path', required: true, description: 'Review job ID returned by submission (job_ followed by 32 hexadecimal characters).' };

export default {
  id: 'ocolta',
  displayName: 'Ocolta',
  baseUrl: 'https://app.ocolta.com',
  homepage: 'https://ocolta.com',
  description: 'Ocolta CLI for authorized document reviews, review status, and recoverable reports.',
  keywords: ['ocolta', 'cli', 'document-review', 'document-integrity', 'pdf', 'api', 'ai-agents'],
  auth: {
    env: 'OCOLTA_API_KEY',
    help: 'In the original purchasing browser, open https://app.ocolta.com/workspace and create an external integration grant. Use its oct_ token. Each grant is bound to one purchase, exact tier, credit ceiling, and expiry; it cannot buy credits or access unrelated purchases.',
  },
  commands: [
    {
      name: 'reviews submit', description: 'Review one authorized document using one existing purchased credit. Explicit document-sharing consent and credit confirmation are required.', method: 'POST', path: '/api/v1/reviews', auth: true, requiresConfirmation: 'confirm-credit-use',
      multipart: { fileOption: 'file', fileField: 'file', maxBytes: 5242880, contentTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'], fields: { consentVersion: '2026-08-30.openrouter-zdr.v2' } },
      options: {
        file: { type: 'string', in: 'file', required: true, description: 'Local PDF, PNG, JPEG or WebP document, at most 5 MiB.' },
        tier: { type: 'string', in: 'body', key: 'analysisMode', required: true, enum: ['deep-review', 'deep-review-plus'], description: 'Exact purchased tier bound to this grant.' },
        'idempotency-key': { type: 'string', in: 'header', key: 'Idempotency-Key', required: true, description: 'Stable operation key: 16–128 letters, numbers, underscores or hyphens.' },
        'confirm-credit-use': { type: 'boolean', in: 'header', key: 'X-Ocolta-Confirm-Credit', trueValue: '1', description: 'Authorize one purchased credit for this document and tier.' },
        'consent-to-processing': { type: 'boolean', in: 'body', key: 'consent', required: true, mustBeTrue: true, description: 'Confirm authorization to share this document for AI processing and return its report to this integration.' },
      },
    },
    { name: 'reviews status', description: 'Read status of a review submitted by the current grant without retrying it.', method: 'GET', path: '/api/v1/reviews/{id}', auth: true, options: { id: reviewId } },
    { name: 'reviews result', description: 'Retrieve this grant’s completed recoverable report within its 24-hour retention period.', method: 'GET', path: '/api/v1/reviews/{id}/result', auth: true, options: { id: reviewId } },
  ],
};
