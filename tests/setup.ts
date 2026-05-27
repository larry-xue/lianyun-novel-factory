import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://lianyun:lianyun_dev@localhost:5433/lianyun';
}
if (!process.env.LLM_API_ENDPOINT) {
  process.env.LLM_API_ENDPOINT = 'http://localhost:0/v1';
}
if (!process.env.LLM_API_KEY) {
  process.env.LLM_API_KEY = 'test-key';
}
if (!process.env.LLM_MODEL) {
  process.env.LLM_MODEL = 'gpt-4o-mini';
}
