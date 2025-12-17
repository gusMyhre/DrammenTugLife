import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
new Response(JSON.stringify(body), {
status,
headers: { "Content-Type": "application/json" },
});

serve(async (req) => {
try {
if (req.method !== "POST") return json({ error: "Use POST" }, 405);


const authHeader = req.headers.get("Authorization") || "";
const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
if (!jwt) return json({ error: "Missing Bearer token" }, 401);

const payload = await req.json().catch(() => ({}));
const email = payload?.email;
const mode = payload?.mode ?? "invite"; // "invite" | "resend"
if (!email || typeof email !== "string") return json({ error: "Missing email" }, 400);

const url = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");
if (!url || !anonKey || !serviceKey) {
  return json({ error: "Missing env (SUPABASE_URL / SUPABASE_ANON_KEY / SERVICE_ROLE_KEY)" }, 500);
}

// 1) Verify caller + read THEIR role through RLS
const userClient = createClient(url, anonKey, {
  global: { headers: { Authorization: `Bearer ${jwt}` } },
});

const { data: userRes, error: userErr } = await userClient.auth.getUser();
const caller = userRes?.user;
if (userErr || !caller) return json({ error: "Invalid session" }, 401);

const { data: profile, error: profErr } = await userClient
  .from("profiles")
  .select("role, is_active")
  .eq("user_id", caller.id)
  .single();

if (profErr || !profile) return json({ error: "No profile / cannot read profile" }, 403);

// 3) Lock down: must be admin AND active
if (profile.role !== "admin") return json({ error: "Not admin" }, 403);
if (!profile.is_active) return json({ error: "Admin not active" }, 403);

// 4) Invite using service role (admin-only)
const adminClient = createClient(url, serviceKey);

// Check if target user already exists
const { data: list, error: listErr } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
if (listErr) return json({ error: listErr.message }, 400);

const existing = list.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());

// If user exists and mode is invite, don't re-invite (return a nice message)
if (existing && mode === "invite") {
  return json({ ok: false, error: "User already exists", existing_user_id: existing.id }, 409);
}

// If user exists and mode is resend: send a new magic link (not an invite)
if (existing && mode === "resend") {
  const { data, error } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: "https://gusmyhre.github.io/DrammenTugLife/index.html",
    },
  });

  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, resent: true, email: data.properties?.email }, 200);
}

// If user does not exist: invite them
const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
  redirectTo: "https://gusmyhre.github.io/DrammenTugLife/index.html",
});

if (error) return json({ error: error.message }, 400);

return json({ ok: true, invited: data.user?.email }, 200);

} catch (e) {
return json({ error: String(e) }, 500);
}
});
