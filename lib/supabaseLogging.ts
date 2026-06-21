type SupabaseErrorLike = {
  name?: string;
  code?: string;
  message?: string;
  hint?: string;
  status?: number;
  statusCode?: number | string;
};

type SafeLogContext = Record<string, string | number | boolean | null | undefined>;

function pickSupabaseError(err: unknown) {
  const e = err as SupabaseErrorLike;

  return {
    name: e?.name,
    code: e?.code,
    message: e?.message ?? (typeof err === "string" ? err : "Unknown Supabase error"),
    hint: e?.hint,
    status: e?.status ?? e?.statusCode,
  };
}

export function logSupabaseInsertError(
  table: string,
  err: unknown,
  context: SafeLogContext = {}
) {
  console.error("[supabase insert failed]", {
    table,
    context,
    error: pickSupabaseError(err),
  });
}
