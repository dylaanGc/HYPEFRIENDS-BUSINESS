import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const MAX_BODY_BYTES = 64 * 1024;
const PAGE_SIZE = 500;
const BATCH_SIZE = 20;
const VALID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRUSTED_PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);

type WebOrderRecord = {
  id: string;
  order_number: string;
  customer_name: string;
  total: number | string;
  currency: string;
  created_at: string;
};

type Subscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function validPushEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === "https:" &&
      (TRUSTED_PUSH_HOSTS.has(endpoint.hostname) ||
        endpoint.hostname.endsWith(".notify.windows.com"));
  } catch {
    return false;
  }
}

async function secretsMatch(expected: string, actual: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [expectedHash, actualHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
  ]);
  const left = new Uint8Array(expectedHash);
  const right = new Uint8Array(actualHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function statusCodeFrom(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("statusCode" in error)) {
    return null;
  }
  const statusCode = Number(error.statusCode);
  return Number.isInteger(statusCode) ? statusCode : null;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const expectedSecret = Deno.env.get("WEB_ORDER_PUSH_WEBHOOK_SECRET");
  const receivedSecret = request.headers.get("x-webhook-secret") ?? "";
  if (!expectedSecret || expectedSecret.length < 32 ||
    receivedSecret.length < 32 ||
    !await secretsMatch(expectedSecret, receivedSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey ||
    !vapidPrivateKey || !vapidSubject) {
    console.error("Missing server-side push configuration.");
    return new Response("Push sender is not configured", { status: 503 });
  }

  let payload: {
    type?: string;
    table?: string;
    schema?: string;
    record?: WebOrderRecord;
  };
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid JSON payload", { status: 400 });
  }
  const order = payload?.record;
  if (payload?.type !== "INSERT" || payload.table !== "web_orders" ||
    payload.schema !== "public" || !order ||
    !VALID_UUID.test(order.id) ||
    typeof order.order_number !== "string" ||
    typeof order.customer_name !== "string" ||
    !Number.isFinite(Number(order.total)) ||
    !["CRC", "USD"].includes(order.currency)) {
    return new Response("Invalid web order event", { status: 400 });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const amount = new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: order.currency,
    maximumFractionDigits: 0,
  }).format(Number(order.total));
  const notification = JSON.stringify({
    orderId: order.id,
    orderNumber: order.order_number,
    customerName: order.customer_name,
    title: "Nueva compra del sitio web",
    body: `Pedido ${order.order_number} · ${order.customer_name} · ${amount}`,
  });

  let offset = 0;
  let sent = 0;
  let failed = 0;
  while (true) {
    const { data: subscriptions, error: subscriptionsError } = await db
      .from("web_push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (subscriptionsError) {
      console.error("Push subscription lookup:", subscriptionsError.message);
      return new Response("Could not load push subscriptions", { status: 503 });
    }
    if (!subscriptions?.length) break;
    offset += subscriptions.length;

    for (let start = 0; start < subscriptions.length; start += BATCH_SIZE) {
      const batch = subscriptions.slice(start, start + BATCH_SIZE) as Subscription[];
      const outcomes = await Promise.all(batch.map(async (subscription) => {
        if (!validPushEndpoint(subscription.endpoint)) {
          console.error("Rejected an untrusted web push endpoint.");
          return "failed" as const;
        }

        const { data: claimed, error: claimError } = await db.rpc(
          "claim_web_push_delivery",
          {
            p_order_id: order.id,
            p_subscription_id: subscription.id,
          },
        );
        if (claimError) {
          console.error("Push delivery claim:", claimError.message);
          return "failed" as const;
        }
        if (!claimed) return "skipped" as const;

        try {
          const response = await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          }, notification, { TTL: 60, timeout: 10000 });
          const { error: finishError } = await db.rpc("finish_web_push_delivery", {
            p_order_id: order.id,
            p_subscription_id: subscription.id,
            p_delivery_status: "sent",
            p_response_status: response.statusCode,
          });
          if (finishError) {
            console.error("Push delivery completion:", finishError.message);
            return "failed" as const;
          }
          return "sent" as const;
        } catch (error) {
          const statusCode = statusCodeFrom(error);
          const { error: finishError } = await db.rpc("finish_web_push_delivery", {
            p_order_id: order.id,
            p_subscription_id: subscription.id,
            p_delivery_status: "failed",
            p_response_status: statusCode,
          });
          if (finishError) {
            console.error("Push failure recording:", finishError.message);
          }
          if (statusCode === 404 || statusCode === 410) {
            const { error: deleteError } = await db
              .from("web_push_subscriptions")
              .delete()
              .eq("id", subscription.id);
            if (deleteError) {
              console.error("Expired push subscription cleanup:", deleteError.message);
            }
          } else {
            console.error("Web push delivery failed:", statusCode ?? "unknown status");
          }
          return "failed" as const;
        }
      }));
      sent += outcomes.filter((result) => result === "sent").length;
      failed += outcomes.filter((result) => result === "failed").length;
    }
    if (subscriptions.length < PAGE_SIZE) break;
  }

  return new Response(JSON.stringify({ sent, failed }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
});
