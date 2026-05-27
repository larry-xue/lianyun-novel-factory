import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Did you forget to copy .env.example to .env?');
}

const queryClient = postgres(databaseUrl, {
  max: 10,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
});

export const db = drizzle(queryClient, { schema, casing: 'snake_case' });
export { schema };
export type Db = typeof db;
