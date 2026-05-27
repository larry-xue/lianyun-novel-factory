/**
 * TanStack Start 的 ServerFn 校验返回值是否 JSON 可序列化，
 * 而 drizzle 把 jsonb 列推断为 `Record<string, unknown>`，unknown 被拒绝。
 * 这里给那些 jsonb 字段一个"宽松但合法"的别名（避开循环引用）。
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue }
  | JsonValue[];

export type JsonObject = { [k: string]: JsonValue };
