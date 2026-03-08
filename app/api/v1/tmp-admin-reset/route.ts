import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";

/**
 * TEMPORARY admin password reset endpoint. DELETE THIS FILE after use.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "email and password required" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const supabase = createSupabaseServiceRoleClient();

    const { data: userList, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 });
    }

    const user = userList.users.find((u: { email?: string }) => u.email === email);

    if (!user) {
      return NextResponse.json({ error: `User ${email} not found` }, { status: 404 });
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password
    });

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Unknown error"
    }, { status: 500 });
  }
}
