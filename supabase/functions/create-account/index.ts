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


const { email, password, nickname } = await req.json().catch(() => ({}));

if (!email || typeof email !== "string") return json({ error: "Missing email" }, 400);
if (!password || typeof password !== "string") return json({ error: "Missing password" }, 400);
if (!nickname || typeof nickname !== "string") return json({ error: "Missing nickname" }, 400);

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");
if (!url || !serviceKey) return json({ error: "Missing env" }, 500);

const admin = createClient(url, serviceKey);

// 1) Check allowlist
const { data: invite, error: invErr } = await admin
  .from("invites")
  .select("email, used")
  .eq("email", email.toLowerCase())
  .single();

if (invErr || !invite) return json({ error: "Not invited" }, 403);
if (invite.used) return json({ error: "Invite already used" }, 409);

// 2) Create auth user (email+password)
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: email.toLowerCase(),
  password,
  email_confirm: true, // skip email confirmation since you invited them
});

if (createErr) return json({ error: createErr.message }, 400);
const user = created.user;
if (!user) return json({ error: "User not created" }, 500);

// 3) Create profile row (adjust fields to your schema)
const { error: profErr } = await admin.from("profiles").insert({
  user_id: user.id,
  nickname,
  role: "user",
  coins: 0,
});

if (profErr) return json({ error: profErr.message }, 400);

// 4) Mark invite used
await admin
  .from("invites")
  .update({ used: true, used_at: new Date().toISOString() })
  .eq("email", email.toLowerCase());

return json({ ok: true }, 200);


} catch (e) {
return json({ error: String(e) }, 500);
}
});
