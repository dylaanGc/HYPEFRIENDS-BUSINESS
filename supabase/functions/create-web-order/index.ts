import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const FREE_SHIPPING_THRESHOLD_CRC = 50000;
const ALLOWED_PROOF_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
]);
const PAYMENT_METHODS = new Set([
  "bank_transfer",
  "sinpe_movil",
  "cash_on_delivery",
]);

type CartLine = { id: number; size: string; qty: number };
type CatalogProduct = {
  store_product_id: string;
  product_name: string;
  unit_price: number;
  currency: string;
  available_stock: number;
  available_sizes: string[];
  active: boolean;
  drop_available_at: string | null;
};

const baseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};

function allowedOrigins(): Set<string> {
  return new Set([
    "https://dylaangc.github.io",
    ...(Deno.env.get("ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  ]);
}

function respond(
  request: Request,
  status: number,
  body: Record<string, unknown>,
): Response {
  const origin = request.headers.get("Origin") ?? "";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...baseHeaders,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    },
  });
}

function normalizeLines(value: unknown): CartLine[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw new Error("El carrito debe contener entre 1 y 50 productos.");
  }
  const lines = new Map<string, CartLine>();
  for (const valueLine of value) {
    if (!valueLine || typeof valueLine !== "object") {
      throw new Error("Hay un producto inválido en el carrito.");
    }
    const line = valueLine as Partial<CartLine>;
    if (!Number.isSafeInteger(line.id) || !Number.isSafeInteger(line.qty) ||
      (line.qty ?? 0) < 1 || (line.qty ?? 0) > 20 ||
      typeof line.size !== "string" || line.size.length > 50) {
      throw new Error("La talla o cantidad de un producto no es válida.");
    }
    const key = `${line.id}:${line.size}`;
    const previous = lines.get(key);
    const quantity = (previous?.qty ?? 0) + line.qty!;
    if (quantity > 20) {
      throw new Error("La cantidad solicitada supera el máximo permitido.");
    }
    lines.set(key, { id: line.id!, size: line.size, qty: quantity });
  }
  return [...lines.values()];
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

async function verifyTurnstile(token: unknown, remoteIp: string | null) {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) {
    return { ok: false, error: "Falta configurar la verificación anti-robots." };
  }
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) {
    return { ok: false, error: "Completa la verificación antes de enviar el pedido." };
  }
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp) form.set("remoteip", remoteIp);
  const verification = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form },
  );
  if (!verification.ok) {
    return { ok: false, error: "No se pudo verificar la protección anti-robots." };
  }
  const result = await verification.json();
  const validHostname = [...allowedOrigins()].some((allowedOrigin) => {
    try {
      return new URL(allowedOrigin).hostname === result.hostname;
    } catch {
      return false;
    }
  });
  return result.success && result.action === "checkout" && validHostname
    ? { ok: true as const }
    : { ok: false, error: "La verificación expiró. Inténtalo de nuevo." };
}

function instructionsFor(paymentMethod: string, orderNumber: string): string {
  if (paymentMethod === "bank_transfer") {
    return Deno.env.get("WEB_ORDER_BANK_DETAILS")?.trim() ||
      "Te contactaremos para coordinar la transferencia y verificar el pago.";
  }
  if (paymentMethod === "sinpe_movil") {
    const phone = Deno.env.get("WEB_ORDER_SINPE_PHONE")?.trim();
    return phone
      ? `Envía el pago por SINPE Móvil al ${phone} e indica ${orderNumber} en el detalle.`
      : "Te contactaremos para compartir el número SINPE y verificar el pago.";
  }
  return "Pagarás el pedido cuando lo recibas.";
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin") ?? "";
  if (!allowedOrigins().has(origin)) {
    return respond(request, 403, { error: "Origen no autorizado." });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...baseHeaders,
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      },
    });
  }
  if (request.method !== "POST") {
    return respond(request, 405, { error: "Método no permitido." });
  }
  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return respond(request, 413, { error: "El comprobante supera el tamaño permitido." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const gamShippingText = Deno.env.get("WEB_ORDER_SHIPPING_GAM_CRC");
  const outsideShippingText = Deno.env.get("WEB_ORDER_SHIPPING_OUTSIDE_GAM_CRC");
  const gamShippingAmount = Number(gamShippingText);
  const outsideShippingAmount = Number(outsideShippingText);
  if (!supabaseUrl || !serviceRoleKey || !gamShippingText?.trim() ||
    !outsideShippingText?.trim() ||
    !Number.isSafeInteger(gamShippingAmount) || gamShippingAmount < 0 ||
    !Number.isSafeInteger(outsideShippingAmount) || outsideShippingAmount < 0) {
    console.error("Missing server-side Supabase or shipping configuration.");
    return respond(request, 503, { error: "El checkout todavía no está configurado." });
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let proof: File | null = null;
  let payload: Record<string, unknown>;
  try {
    if (request.headers.get("Content-Type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const rawOrder = form.get("order");
      if (typeof rawOrder !== "string") {
        return respond(request, 400, { error: "Faltan los datos del pedido." });
      }
      payload = JSON.parse(rawOrder);
      const candidateProof = form.get("proof");
      if (candidateProof instanceof File && candidateProof.size > 0) proof = candidateProof;
    } else {
      payload = await request.json();
    }
  } catch {
    return respond(request, 400, { error: "No se pudieron leer los datos del pedido." });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return respond(request, 400, { error: "Los datos del pedido no son válidos." });
  }

  if (payload.action === "catalog") {
    const { data, error } = await db
      .from("web_store_catalog_inventory")
      .select("store_product_id,product_name,unit_price,currency,available_sizes,active,drop_available_at,available_stock,category,image_url,description")
      .order("store_product_id");
    if (error) {
      console.error("Website catalog load:", error.message);
      return respond(request, 503, { error: "No se pudo actualizar el inventario de la tienda." });
    }
    return respond(request, 200, {
      products: (data ?? []).map((product) => ({
        ...product,
        in_stock: product.active &&
          (!product.drop_available_at || Date.parse(product.drop_available_at) <= Date.now()) &&
          product.available_stock > 0,
      })),
    });
  }
  if (payload.action !== "quote" && payload.action !== "create") {
    return respond(request, 400, { error: "Acción de checkout inválida." });
  }

  let lines: CartLine[];
  try {
    lines = normalizeLines(payload.items);
  } catch (error) {
    return respond(request, 400, { error: error instanceof Error ? error.message : "Carrito inválido." });
  }
  const productIds = [...new Set(lines.map((line) => String(line.id)))];
  const { data: catalogRows, error: catalogError } = await db
    .from("web_store_catalog_inventory")
    .select("store_product_id,product_name,unit_price,currency,available_stock,available_sizes,active,drop_available_at,category,image_url,description")
    .in("store_product_id", productIds);
  if (catalogError) {
    console.error("Website catalog lookup:", catalogError.message);
    return respond(request, 503, { error: "No se pudo consultar el catálogo de la tienda." });
  }

  const catalog = new Map<string, CatalogProduct>(
    (catalogRows ?? []).map((product) => [product.store_product_id, product]),
  );
  let subtotal = 0;
  const requestedByProduct = new Map<string, number>();
  const orderItems = [];
  for (const line of lines) {
    const product = catalog.get(String(line.id));
    if (!product || !product.active ||
      (product.drop_available_at && Date.parse(product.drop_available_at) > Date.now()) ||
      !product.available_sizes.includes(line.size)) {
      return respond(request, 409, { error: "Un producto ya no está disponible en la talla seleccionada." });
    }
    const requested = (requestedByProduct.get(product.store_product_id) ?? 0) +
      line.qty;
    requestedByProduct.set(product.store_product_id, requested);
    if (requested > product.available_stock) {
      return respond(request, 409, { error: `No hay suficientes unidades de ${product.product_name}.` });
    }
    subtotal += Number(product.unit_price) * line.qty;
    orderItems.push({
      store_product_id: product.store_product_id,
      product_name: product.product_name,
      sku: null,
      variant: null,
      size: line.size,
      color: null,
      quantity: line.qty,
      unit_price: Number(product.unit_price),
    });
  }
  if (!Number.isSafeInteger(subtotal) || subtotal <= 0) {
    return respond(request, 400, { error: "El total del carrito no es válido." });
  }
  if (payload.deliveryZone !== "gam" && payload.deliveryZone !== "outside_gam") {
    return respond(request, 400, { error: "Selecciona la zona de entrega del pedido." });
  }
  const deliveryZone = payload.deliveryZone;
  const shippingAmount = subtotal > FREE_SHIPPING_THRESHOLD_CRC
    ? 0
    : deliveryZone === "gam" ? gamShippingAmount : outsideShippingAmount;
  const total = subtotal + shippingAmount;
  const quote = { subtotal, shippingAmount, total, currency: "CRC", deliveryZone };
  if (payload.action === "quote") {
    return respond(request, 200, {
      ...quote,
      items: orderItems.map((item) => ({
        id: Number(item.store_product_id),
        size: item.size,
        qty: item.quantity,
        productName: item.product_name,
        unitPrice: item.unit_price,
        availableStock: catalog.get(item.store_product_id)?.available_stock,
      })),
    });
  }

  const captcha = await verifyTurnstile(
    payload.turnstileToken,
    request.headers.get("CF-Connecting-IP"),
  );
  if (!captcha.ok) return respond(request, 403, { error: captcha.error });

  const orderId = payload.orderId;
  const checkoutReference = payload.checkoutReference;
  if (!validUuid(orderId) || !validUuid(checkoutReference)) {
    return respond(request, 400, { error: "No se pudo validar la referencia del checkout." });
  }
  const customerName = typeof payload.customerName === "string" ? payload.customerName.trim() : "";
  const customerEmail = typeof payload.customerEmail === "string" ? payload.customerEmail.trim().toLowerCase() : "";
  const customerPhone = typeof payload.customerPhone === "string" ? payload.customerPhone.trim() : "";
  const shippingAddress = typeof payload.shippingAddress === "string" ? payload.shippingAddress.trim() : "";
  const customerNotes = typeof payload.customerNotes === "string" ? payload.customerNotes.trim() : "";
  const paymentMethod = payload.paymentMethod;
  if (!customerName || customerName.length > 200 ||
    (!customerEmail && !customerPhone) ||
    (customerEmail && (customerEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))) ||
    (customerPhone && customerPhone.replace(/\D/g, "").length < 8) ||
    customerPhone.length > 50 ||
    !shippingAddress || shippingAddress.length > 1000 ||
    customerNotes.length > 2000 ||
    typeof paymentMethod !== "string" || !PAYMENT_METHODS.has(paymentMethod)) {
    return respond(request, 400, { error: "Revisa el nombre, contacto, dirección y método de pago." });
  }
  if (proof && (!ALLOWED_PROOF_TYPES.has(proof.type) || proof.size > MAX_PROOF_BYTES)) {
    return respond(request, 400, { error: "El comprobante debe ser JPG, PNG, WebP o PDF de hasta 10 MB." });
  }
  if (proof && paymentMethod === "cash_on_delivery") {
    return respond(request, 400, { error: "Los pedidos contra entrega no requieren comprobante anticipado." });
  }

  const { data: existing, error: existingError } = await db
    .from("web_orders")
    .select("id,order_number,total,subtotal,shipping_amount,currency,customer_email,customer_phone,payment_status,payment_method,delivery_zone,shipping_address")
    .eq("checkout_reference", checkoutReference)
    .maybeSingle();
  if (existingError) {
    console.error("Idempotency lookup:", existingError.message);
    return respond(request, 503, { error: "No se pudo verificar el pedido; vuelve a intentarlo." });
  }
  if (existing) {
    if (existing.id !== orderId || Number(existing.total) !== total ||
      existing.currency !== "CRC" ||
      Number(existing.subtotal) !== subtotal ||
      Number(existing.shipping_amount) !== shippingAmount ||
      existing.customer_email !== (customerEmail || null) ||
      existing.customer_phone !== (customerPhone || null) ||
      existing.payment_method !== paymentMethod ||
      existing.delivery_zone !== deliveryZone ||
      existing.shipping_address !== shippingAddress) {
      return respond(request, 409, { error: "La referencia ya se utilizó para otro pedido." });
    }
    return respond(request, 200, {
      orderId: existing.id,
      orderNumber: existing.order_number,
      paymentMethod,
      paymentStatus: existing.payment_status,
      paymentInstructions: instructionsFor(paymentMethod, existing.order_number),
      ...quote,
      alreadyCreated: true,
    });
  }

  let proofPath: string | null = null;
  if (proof) {
    const extension = ALLOWED_PROOF_TYPES.get(proof.type)!;
    proofPath = `${orderId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await db.storage
      .from("web-order-proofs")
      .upload(proofPath, proof, {
        cacheControl: "3600",
        contentType: proof.type,
        upsert: false,
      });
    if (uploadError) {
      console.error("Private payment proof upload:", uploadError.message);
      return respond(request, 400, { error: "No se pudo guardar el comprobante." });
    }
  }

  const date = new Date();
  const orderNumber = `HF-${date.toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { data: createdId, error: createError } = await db.rpc("create_web_order", {
    p_order_id: orderId,
    p_order_number: orderNumber,
    p_checkout_reference: checkoutReference,
    p_customer_name: customerName,
    p_customer_email: customerEmail || null,
    p_customer_phone: customerPhone || null,
    p_currency: "CRC",
    p_subtotal: subtotal,
    p_shipping_amount: shippingAmount,
    p_total: total,
    p_payment_method: paymentMethod,
    p_delivery_zone: deliveryZone,
    p_shipping_address: shippingAddress,
    p_customer_notes: customerNotes || null,
    p_items: orderItems,
    p_proof_path: proofPath,
  });
  if (createError || createdId !== orderId) {
    const { data: retryOrder, error: retryLookupError } = await db
      .from("web_orders")
      .select("id,order_number,total,subtotal,shipping_amount,currency,customer_email,customer_phone,payment_status,payment_method,delivery_zone,shipping_address")
      .eq("checkout_reference", checkoutReference)
      .maybeSingle();
    if (!retryLookupError && retryOrder && retryOrder.id === orderId &&
      Number(retryOrder.total) === total && Number(retryOrder.subtotal) === subtotal &&
      Number(retryOrder.shipping_amount) === shippingAmount &&
      retryOrder.customer_email === (customerEmail || null) &&
      retryOrder.customer_phone === (customerPhone || null) &&
      retryOrder.payment_method === paymentMethod &&
      retryOrder.delivery_zone === deliveryZone &&
      retryOrder.shipping_address === shippingAddress) {
      return respond(request, 200, {
        orderId: retryOrder.id,
        orderNumber: retryOrder.order_number,
        paymentMethod,
        paymentStatus: retryOrder.payment_status,
        paymentInstructions: instructionsFor(paymentMethod, retryOrder.order_number),
        ...quote,
        alreadyCreated: true,
      });
    }
    if (retryLookupError) {
      console.error("Order retry lookup:", retryLookupError.message);
    } else if (proofPath) {
      const { error: removeError } = await db.storage.from("web-order-proofs").remove([proofPath]);
      if (removeError) console.error("Orphan proof cleanup:", removeError.message);
    }
    console.error("Order creation:", createError?.message ?? "Unexpected database response.");
    return respond(request, 400, { error: "No se pudo registrar el pedido. Tu carrito sigue guardado." });
  }

  return respond(request, 200, {
    orderId,
    orderNumber,
    paymentMethod,
    paymentStatus: proof ? "proof_submitted" : "pending",
    paymentInstructions: instructionsFor(paymentMethod, orderNumber),
    ...quote,
    alreadyCreated: false,
  });
});
