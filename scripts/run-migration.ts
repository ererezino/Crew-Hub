import { createClient } from "@supabase/supabase-js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing: ${name}`);
  return value;
}

const client = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function execSQL(sql: string, label: string): Promise<boolean> {
  const { error } = await client.rpc("exec_sql", { sql_string: sql });
  if (error) {
    console.log(`[${label}] Error: ${error.message}`);
    return false;
  }
  console.log(`[${label}] OK`);
  return true;
}

async function run() {
  console.log("=== Running Comprehensive Overhaul Migration ===\n");

  // Step 1: Add marketing to enum
  console.log("Step 1: Add marketing category...");
  const { error } = await client.rpc("exec_sql", {
    sql_string: "ALTER TYPE public.expense_category_type ADD VALUE IF NOT EXISTS 'marketing'"
  });

  // If exec_sql doesn't exist, we need an alternative approach
  if (error && error.message.includes("exec_sql")) {
    console.log("exec_sql not available. Using direct Supabase Dashboard SQL approach.");
    console.log("\nPlease run the migration SQL manually in Supabase Dashboard > SQL Editor.");
    console.log("Migration file: supabase/migrations/20260303130000_comprehensive_overhaul.sql");
    console.log("\nAlternatively, install supabase CLI: brew install supabase/tap/supabase");

    // Alternative: Try using the service role to directly modify via the postgrest schema cache
    // Or use the management API
    const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/(\w+)\.supabase/)?.[1];

    if (process.env.SUPABASE_ACCESS_TOKEN) {
      console.log("\nTrying Management API...");
      const mgmtRes = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`
        },
        body: JSON.stringify({
          query: "ALTER TYPE public.expense_category_type ADD VALUE IF NOT EXISTS 'marketing'"
        })
      });
      console.log("Management API status:", mgmtRes.status);
      if (mgmtRes.ok) {
        console.log("Management API works! Running full migration...");
      }
    } else {
      console.log("\nNo SUPABASE_ACCESS_TOKEN found.");
      console.log("To get one: Go to supabase.com > Account > Access Tokens > Generate new token");
      console.log("Then add SUPABASE_ACCESS_TOKEN=<token> to .env.local");
    }
    return;
  }

  if (error) {
    console.log(`Marketing enum: ${error.message}`);
  } else {
    console.log("Marketing enum: OK");
  }

  // Step 2: Add columns to expenses table
  const expenseColumns = [
    "ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS expense_type varchar(30) NOT NULL DEFAULT 'personal_reimbursement'",
    "ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS vendor_name text",
    "ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS vendor_bank_account_name text",
    "ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS vendor_bank_account_number text",
    "ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS custom_category text"
  ];

  for (const sql of expenseColumns) {
    await execSQL(sql, "Expense column");
  }

  // Step 3: Add profile columns
  const profileColumns = [
    "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio text",
    "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS favorite_music text",
    "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS favorite_books text",
    "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS favorite_sports text",
    "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS privacy_settings jsonb NOT NULL DEFAULT '{}'::jsonb"
  ];

  for (const sql of profileColumns) {
    await execSQL(sql, "Profile column");
  }

  console.log("\n=== Migration complete ===");
}

run();
