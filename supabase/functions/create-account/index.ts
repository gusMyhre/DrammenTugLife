import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
"https://gusmyhre.github.io",
"http://localhost:5173",
"http://localhost:3000",
]);

function corsHeaders(req: Request) {
const origin = req.headers.get("origin") ?? "";
const allowOrigin = allowedOrigins.has(origin) ? origin : "https://gusmyhre.github.io";

return {
"Access-Control-Allow-Origin": allowOrigin,
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
"Access-Control-Allow-Credentials": "true",
"Vary": "Origin",
"Content-Type": "application/json",
};
}

function json(req: Request, body: unknown, status = 200) {
return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

serve(async (req) => {
// ✅ Handle CORS preflight
if (req.method === "OPTIONS") {
return new Response(null, { status: 204, headers: corsHeaders(req) });
}

try {
if (req.method !== "POST") return json(req, { error: "Use POST" }, 405);

  const { email, password, nickname } = await req.json().catch(() => ({}));

  if (!email || typeof email !== "string") return json(req, { error: "Missing email" }, 400);
  if (!password || typeof password !== "string") return json(req, { error: "Missing password" }, 400);
  if (!nickname || typeof nickname !== "string") return json(req, { error: "Missing nickname" }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(req, { error: "Missing env" }, 500);

  const admin = createClient(url, serviceKey, {
  auth: { persistSession: false },
  });


  const normEmail = email.trim().toLowerCase();

  // 1) Check allowlist
  const { data: invites, error: invErr } = await admin
  .from("invites")
  .select("email, used")
  .eq("email", normEmail)
  .limit(1);

if (invErr) return json(req, { error: `Invite lookup failed: ${invErr.message}` }, 500);

const invite = invites?.[0];
if (!invite) return json(req, { error: `Not invited: ${normEmail}` }, 403);
if (invite.used) return json(req, { error: "Invite already used" }, 409);


  // 2) Create auth user
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: normEmail,
    password,
    email_confirm: true,
  });

  if (createErr) return json(req, { error: createErr.message }, 400);
  const user = created.user;
  if (!user) return json(req, { error: "User not created" }, 500);

  // 3) Create profile
  const { error: profErr } = await admin.from("profiles").insert({
    user_id: user.id,
    nickname,
    role: "user",
    coins: 0,
  });

  if (profErr) return json(req, { error: profErr.message }, 400);

  // 4) Mark invite used
  await admin
    .from("invites")
    .update({ used: true, used_at: new Date().toISOString() })
    .eq("email", normEmail);

  return json(req, { ok: true }, 200);


} catch (e) {
return json(req, { error: String(e) }, 500);
}
});
