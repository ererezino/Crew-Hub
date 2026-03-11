export function extractSupabaseProjectRef(
  supabaseUrl: string | undefined | null
): string | null {
  if (!supabaseUrl) {
    return null;
  }

  try {
    const host = new URL(supabaseUrl).hostname.toLowerCase();

    if (!host.endsWith(".supabase.co")) {
      return null;
    }

    const [projectRef] = host.split(".");
    return projectRef && projectRef.length > 0 ? projectRef : null;
  } catch {
    return null;
  }
}
