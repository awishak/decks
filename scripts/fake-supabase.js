// A Supabase client just real enough to assert query shapes against.
//
// Exists because the store's whole job is talking to Supabase, and the failure
// that matters most (a write silently rejected by RLS, returning no rows) is
// invisible unless something deliberately simulates it.
//
// Queries are thenable, because supabase-js is awaited directly rather than
// having an .execute().

export function fakeSupabase({ tables = {}, writeReturnsNothing = false, failOn = null } = {}) {
  const calls = [];

  const apply = (rows, filters) => filters.reduce((acc, f) => {
    const [op, k, v, w] = f;
    if (op === "eq")  return acc.filter(r => r[k] === v);
    if (op === "in")  return acc.filter(r => v.includes(r[k]));
    if (op === "is")  return acc.filter(r => (v === null ? r[k] == null : r[k] === v));
    if (op === "not") return acc.filter(r => (w === null ? r[k] != null : r[k] !== w));
    return acc;   // `or` is left unfiltered: the date-window logic is Postgres's
  }, rows);

  function query(table, op, payload) {
    const filters = [];
    const q = {
      select() { return q; },
      eq(k, v) { filters.push(["eq", k, v]); return q; },
      in(k, v) { filters.push(["in", k, v]); return q; },
      is(k, v) { filters.push(["is", k, v]); return q; },
      not(k, _o, v) { filters.push(["not", k, null, v]); return q; },
      or() { return q; },
      order() { return q; },
      then(resolve) {
        calls.push({ table, op, filters, payload });
        if (failOn === table) return resolve({ data: null, error: { message: "boom" } });
        if (op === "upsert") {
          return resolve({ data: writeReturnsNothing ? [] : [payload], error: null });
        }
        return resolve({ data: apply(tables[table] || [], filters), error: null });
      },
    };
    return q;
  }

  return {
    calls,
    from: (table) => ({
      select: () => query(table, "select"),
      upsert: (payload) => query(table, "upsert", payload),
    }),
  };
}
