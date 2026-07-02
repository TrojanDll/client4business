export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://approval:approval@localhost:15432/approval_test?schema=public';
