import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "../../../lib/supabase/service-role";

/**
 * TEMPORARY admin password reset endpoint.
 * DELETE THIS FILE after use.
 *
 * Usage: GET /api/admin-reset?email=zino@useaccrue.com&password=YOUR_NEW_PASSWORD
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");
  const newPassword = searchParams.get("password");

  if (!email || !newPassword) {
    return NextResponse.json({
      error: "Provide ?email=...&password=... query params"
    }, { status: 400 });
  }

  if (newPassword.length < 8) {
    return NextResponse.json({
      error: "Password must be at least 8 characters"
    }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();

    // Find the user by email
    const { data: userList, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 });
    }

    const user = userList.users.find(u => u.email === email);

    if (!user) {
      return NextResponse.json({ error: `User ${email} not found` }, { status: 404 });
    }

    // Reset the password
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password: newPassword
    });

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Password reset for ${email}. You can now sign in. DELETE /app/api/admin-reset/route.ts after use.`
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Unknown error"
    }, { status: 500 });
  }
}
