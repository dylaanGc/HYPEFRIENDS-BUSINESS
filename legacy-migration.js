const LEGACY_MIGRATION_KEY = 'hf_supabase_legacy_migration_v1';

async function stableLegacyId(userId, entity, legacyId) {
  const input = new TextEncoder().encode(`${userId}:${entity}:${legacyId}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input)).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readLegacyArray(key) {
  const value = localStorage.getItem(key);
  if (!value) return [];
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error(`El dato local "${key}" no tiene el formato esperado.`);
  return parsed;
}

function legacyTimestamp(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

async function migrateLegacyLocalData(session) {
  if (localStorage.getItem(LEGACY_MIGRATION_KEY) === 'done') return;

  const inventory = readLegacyArray('hf_inv');
  const sales = readLegacyArray('hf_ventas');
  const installments = readLegacyArray('hf_apartados');
  const expenses = readLegacyArray('hf_gastos');

  if (![inventory, sales, installments, expenses].some(rows => rows.length)) return;

  const migrationDb = window.supabase.createClient(
    'https://ynowgseafcpcfgvsmkub.supabase.co',
    'sb_publishable_2DSB2bN-_Q4JAm5WO4QruA_E4sXrEuH',
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );

  const { error: sessionError } = await migrationDb.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token
  });
  if (sessionError) throw sessionError;

  const userId = session.user.id;
  const customersByName = new Map();
  const customerRows = [];

  const getCustomerId = async name => {
    const normalized = String(name || '').trim();
    if (!normalized) return null;
    const key = normalized.toLocaleLowerCase();
    if (customersByName.has(key)) return customersByName.get(key);
    const id = await stableLegacyId(userId, 'customer', key);
    customersByName.set(key, id);
    customerRows.push({ id, name: normalized });
    return id;
  };

  const productRows = await Promise.all(inventory.map(async (product, index) => ({
    id: await stableLegacyId(userId, 'product', product.id ?? `${product.name}-${product.size}-${index}`),
    name: String(product.name || 'Producto'),
    category: String(product.category || 'General'),
    size: product.size ? String(product.size) : null,
    stock: Number(product.stock || 0),
    cost: Number(product.cost || 0),
    price: Number(product.price || 0),
    currency: 'USD'
  })));

  const saleRows = [];
  const saleItemRows = [];
  const paymentRows = [];

  for (const [kind, records] of [['sale', sales], ['installment', installments]]) {
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const legacyId = record.id ?? `${record.item}-${record.fecha}-${index}`;
      const id = await stableLegacyId(userId, kind, legacyId);
      const total = Number(kind === 'sale' ? record.price : record.total);
      const paid = kind === 'sale' ? total : Number(record.abonado || 0);
      const customerId = await getCustomerId(record.cliente);
      const createdAt = legacyTimestamp(record.fecha);

      saleRows.push({
        id,
        customer_id: customerId,
        total,
        paid,
        currency: 'USD',
        status: paid >= total ? 'paid' : 'pending',
        created_by: userId,
        created_at: createdAt
      });
      saleItemRows.push({
        id: await stableLegacyId(userId, `${kind}-item`, legacyId),
        sale_id: id,
        quantity: 1,
        unit_price: total,
        unit_cost: Number(record.cost || 0)
      });
      if (paid > 0) {
        paymentRows.push({
          id: await stableLegacyId(userId, `${kind}-payment`, legacyId),
          sale_id: id,
          amount: paid,
          currency: 'USD',
          created_by: userId,
          created_at: createdAt
        });
      }
    }
  }

  const expenseRows = await Promise.all(expenses.map(async (expense, index) => ({
    id: await stableLegacyId(userId, 'expense', expense.id ?? `${expense.concepto}-${expense.fecha}-${index}`),
    note: String(expense.concepto || 'Gasto'),
    amount: Number(expense.monto || 0),
    currency: 'USD',
    created_by: userId,
    created_at: legacyTimestamp(expense.fecha)
  })));

  for (const [table, rows] of [
    ['customers', customerRows],
    ['products', productRows],
    ['sales', saleRows],
    ['sale_items', saleItemRows],
    ['payments', paymentRows],
    ['expenses', expenseRows]
  ]) {
    if (!rows.length) continue;
    const { error } = await migrationDb
      .from(table)
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(`No se pudieron importar los datos antiguos a ${table}: ${error.message}`);
  }

  localStorage.setItem(LEGACY_MIGRATION_KEY, 'done');
  console.info('HYPEFRIENDS: migración local a Supabase completada.');
}

if (typeof window.startApp === 'function') {
  const startCloudApp = window.startApp;
  window.startApp = async session => {
    try {
      await migrateLegacyLocalData(session);
    } catch (error) {
      console.error('Error importando los datos locales a Supabase:', error);
      const loginError = document.querySelector('#loginError');
      if (loginError) {
        loginError.textContent = `No se pudieron importar los datos de este dispositivo. ${error.message || error}`;
      }
      return;
    }
    return startCloudApp(session);
  };
}
