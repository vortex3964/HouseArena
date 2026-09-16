// Password reset without email. Step 1 sends a 6-digit code by push to
// the account owner's devices, step 2 spends the code for a new password.
// Every answer is generic, so the endpoint cannot probe which addresses
// exist or whether a code is close.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ok = () =>
  new Response(JSON.stringify({ ok: true }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });

const fail = () =>
  new Response(JSON.stringify({ ok: false, error: "Invalid or expired code." }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function resetCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => String(Math.floor((b / 256) * 10))).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { action, email, code, newPassword } = await req.json();
    const clean = String(email ?? "").trim().toLowerCase();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "request") {
      if (!validEmail) return ok();
      const now = new Date().toISOString();
      // Self-cleanup: expired codes and out-of-window throttle rows
      // are useless, so every call sweeps its own email's leftovers.
      await admin.from("password_reset_codes").delete().eq("email", clean).lt("expires_at", now);
      const hourAgo = new Date(Date.now() - 3600_000).toISOString();
      await admin.from("password_reset_requests").delete().eq("email", clean).lt("created_at", hourAgo);
      // Max 3 codes per address per hour, abuse and harassment brake.
      // Counted only for real accounts, so strangers cannot burn
      // someone else's quota with unknown addresses.
      const { data: profile } = await admin
        .from("profiles")
        .select("id")
        .eq("email", clean)
        .maybeSingle();
      if (!profile) return ok();
      const { count } = await admin
        .from("password_reset_requests")
        .select("id", { count: "exact", head: true })
        .eq("email", clean)
        .gte("created_at", hourAgo);
      if ((count ?? 0) >= 3) return ok();
      await admin.from("password_reset_requests").insert({ email: clean });

      const plain = resetCode();
      await admin.from("password_reset_codes").insert({
        email: clean,
        code_hash: await sha256Hex(`${clean}:${plain}`),
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });

      const { data: devices } = await admin
        .from("push_devices")
        .select("expo_push_token")
        .eq("user_id", profile.id);
      const tokens = (devices ?? [])
        .map((d) => d.expo_push_token)
        .filter((t) => t.startsWith("ExponentPushToken"));
      if (tokens.length === 0) return ok();

      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          tokens.map((to) => ({
            to,
            sound: "default",
            title: "HouseArena password reset",
            body: `Your reset code is ${plain}. It expires in 10 minutes.`,
          })),
        ),
      });
      return ok();
    }

    if (action === "confirm") {
      if (!validEmail) return fail();
      // Sweep this email's expired codes first, then consider every
      // remaining one: a newer request must not kill an older live code.
      await admin
        .from("password_reset_codes")
        .delete()
        .eq("email", clean)
        .lt("expires_at", new Date().toISOString());
      const { data: rows } = await admin
        .from("password_reset_codes")
        .select("id, code_hash, expires_at, attempts")
        .eq("email", clean)
        .order("created_at", { ascending: false });
      const guess = await sha256Hex(`${clean}:${String(code ?? "").trim()}`);
      const row = (rows ?? []).find(
        (r) =>
          r.attempts < 5 &&
          new Date(r.expires_at) >= new Date() &&
          r.code_hash === guess,
      );
      if (!row) {
        // Wrong guess bumps only the newest row, so one bad attempt
        // cannot burn every live code at once.
        const latest = (rows ?? [])[0];
        if (latest && latest.attempts < 5) {
          await admin
            .from("password_reset_codes")
            .update({ attempts: latest.attempts + 1 })
            .eq("id", latest.id);
        }
        return fail();
      }
      const pw = String(newPassword ?? "");
      // Length checked only after a correct code, so the two cases
      // stay indistinguishable to anyone probing codes.
      if (pw.length < 6) {
        return new Response(
          JSON.stringify({ ok: false, error: "Password needs at least 6 characters." }),
          { headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      const { data: profile } = await admin
        .from("profiles")
        .select("id")
        .eq("email", clean)
        .maybeSingle();
      if (!profile) return fail();
      const { error } = await admin.auth.admin.updateUserById(profile.id, {
        password: pw,
      });
      // Codes die only after the password actually changed, so a
      // transient failure just means trying the same code again.
      if (error) return fail();
      await admin.from("password_reset_codes").delete().eq("email", clean);
      return ok();
    }

    return fail();
  } catch {
    return fail();
  }
});
