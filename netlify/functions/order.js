// netlify/functions/order.js
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const clean = (v, max) => String(v ?? "").trim().slice(0, max);
const DELIVERY_FEES = [70, 100, 120];

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return json(500, { error: "Server not configured" });

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid data" });
  }

  const name = clean(data.name, 100);
  const phone = clean(data.phone, 20);
  const district = clean(data.district, 60);
  const area = clean(data.area, 80);
  const address = clean(data.address, 500);
  if (!name || !phone || !district || !area || !address) {
    return json(400, { error: "Missing delivery details" });
  }

  if (!Array.isArray(data.items) || data.items.length === 0) {
    return json(400, { error: "Cart is empty" });
  }
  const items = data.items.map((i) => ({
    product_id: clean(i.id, 50),
    product_name: clean(i.name, 100),
    size: clean(i.size, 30),
    unit_price: Math.round(Number(i.price)),
    quantity: Math.round(Number(i.quantity))
  }));
  if (items.some((i) => !i.product_id || !(i.unit_price >= 0) || !(i.quantity >= 1 && i.quantity <= 99))) {
    return json(400, { error: "Invalid cart item" });
  }

  const deliveryFee = Number(data.deliveryFee);
  if (!DELIVERY_FEES.includes(deliveryFee)) {
    return json(400, { error: "Invalid delivery fee" });
  }
  const subtotal = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json"
  };

  // 1. Save the order. The database creates the Order Number and Serial Number.
  const orderRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify([{
      customer_name: name,
      customer_phone: phone,
      email: clean(data.email, 120) || null,
      division: clean(data.division, 60) || null,
      district,
      area,
      address,
      notes: clean(data.notes, 500) || null,
      delivery_zone: clean(data.deliveryZone, 30) || null,
      delivery_fee: deliveryFee,
      subtotal,
      grand_total: subtotal + deliveryFee
    }])
  });
  if (!orderRes.ok) {
    console.error("Order insert failed:", await orderRes.text());
    return json(500, { error: "Could not save order" });
  }
  const [order] = await orderRes.json();

  // 2. Save the items for this order.
  const itemsRes = await fetch(`${SUPABASE_URL}/rest/v1/order_items`, {
    method: "POST",
    headers,
    body: JSON.stringify(items.map((i) => ({ ...i, order_id: order.id })))
  });
  if (!itemsRes.ok) {
    console.error("Items insert failed:", await itemsRes.text());
    // Remove the half-saved order so it doesn't appear without items.
    await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${order.id}`, { method: "DELETE", headers });
    return json(500, { error: "Could not save order items" });
  }

  // The website shows orderId in the thank-you message.
  return json(200, {
    orderId: order.order_number,
    serial: order.serial_no,
    status: order.status
  });
};
