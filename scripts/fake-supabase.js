// A Supabase client just real enough to assert query shapes against.
//
// Exists because the store's whole job is talking to Supabase, and the failure
// that matters most (a write silently rejected by RLS, returning no rows) is
// invisible unless something deliberately simulates it.
//
// Queries are thenable, because supabase-js is awaited directly rather than
// having an .execute().
//
// Inserts land in the table they name, so a test can fire writes at the same
// moment and count what arrived. `unique` names the columns that must not
// repeat per table, the way Postgres's unique constraints refuse a second row.

export function fakeSupabase({ tables = {}, writeReturnsNothing = false, failOn = null, unique = {} } = {}) {
  const calls = [];
  const store = tables;

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
        // A tick before answering, as a network call would, so writes started
        // together really do overlap.
        return Promise.resolve().then(() => {
          calls.push({ table, op, filters, payload });
          if (failOn === table) return resolve({ data: null, error: { message: "boom" } });
          if (op === "upsert") {
            if (writeReturnsNothing) return resolve({ data: [], error: null });
            // Kept only when the caller names what makes a row the same row.
            if (q.onConflict) {
              const rows = (store[table] ||= []);
              const cols = q.onConflict.split(",");
              const hit = rows.find(r => cols.every(c => r[c] === payload[c]));
              if (hit) Object.assign(hit, payload); else rows.push({ ...payload });
            }
            return resolve({ data: [payload], error: null });
          }
          if (op === "delete") {
            const hit = apply(store[table] || [], filters);
            store[table] = (store[table] || []).filter(r => !hit.includes(r));
            return resolve({ data: hit, error: null });
          }
          if (op === "insert") {
            if (writeReturnsNothing) return resolve({ data: [], error: null });
            const rows = (store[table] ||= []);
            const cols = unique[table];
            if (cols && rows.some(r => cols.every(c => r[c] === payload[c]))) {
              return resolve({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } });
            }
            const row = { id: `${table}-${rows.length + 1}`, started_at: new Date().toISOString(), ...payload };
            rows.push(row);
            return resolve({ data: [row], error: null });
          }
          if (op === "update") {
            if (writeReturnsNothing) return resolve({ data: [], error: null });
            const hit = apply(store[table] || [], filters);
            hit.forEach(r => Object.assign(r, payload));
            return resolve({ data: hit, error: null });
          }
          return resolve({ data: apply(store[table] || [], filters), error: null });
        });
      },
    };
    return q;
  }

  return {
    calls,
    tables: store,
    from: (table) => ({
      select: () => query(table, "select"),
      upsert: (payload, opts) => Object.assign(query(table, "upsert", payload), { onConflict: opts?.onConflict }),
      delete: () => query(table, "delete"),
      insert: (payload) => query(table, "insert", payload),
      update: (payload) => query(table, "update", payload),
    }),
  };
}
