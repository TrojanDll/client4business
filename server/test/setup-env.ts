import { TEST_DATABASE_URL } from './test-env';

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.LOG_LEVEL = 'silent';
