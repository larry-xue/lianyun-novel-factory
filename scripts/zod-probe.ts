import { z } from 'zod';

const tests: Array<{ name: string; schema: z.ZodType<unknown>; inputs: unknown[] }> = [
  { name: 'string.default', schema: z.object({ foo: z.string().default('') }), inputs: [{}, { foo: null }, { foo: 'hi' }] },
  { name: 'string.catch', schema: z.object({ foo: z.string().catch('') }), inputs: [{}, { foo: null }, { foo: 'hi' }] },
  { name: 'string.optional', schema: z.object({ foo: z.string().optional() }), inputs: [{}, { foo: null }, { foo: 'hi' }] },
  { name: 'string.optional.catch', schema: z.object({ foo: z.string().optional().catch('') }), inputs: [{}, { foo: null }, { foo: 'hi' }] },
  { name: 'string.nullish', schema: z.object({ foo: z.string().nullish() }), inputs: [{}, { foo: null }, { foo: 'hi' }] },
  { name: 'enum.catch', schema: z.object({ foo: z.enum(['a','b']).catch('a') }), inputs: [{}, { foo: null }, { foo: 'xyz' }, { foo: 'a' }] },
  { name: 'string.optional.catch.transform', schema: z.object({ foo: z.string().optional().catch('').transform((v) => v ?? '') }), inputs: [{}, { foo: null }, { foo: 'hi' }, {foo: 123}] },
  { name: 'enum.optional.catch.transform', schema: z.object({ foo: z.enum(['a','b']).optional().catch('a').transform((v) => v ?? 'a') }), inputs: [{}, { foo: null }, { foo: 'xyz' }, { foo: 'a' }] },
];

for (const t of tests) {
  console.log(`\n${t.name}:`);
  for (const input of t.inputs) {
    const r = t.schema.safeParse(input);
    console.log(`  input=${JSON.stringify(input)} → ${r.success ? 'OK ' + JSON.stringify(r.data) : 'FAIL ' + JSON.stringify(r.error.issues[0])}`);
  }
}

process.exit(0);
