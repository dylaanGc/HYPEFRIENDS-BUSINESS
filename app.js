/* =========================================================
   HYPEFRIENDS BUSINESS — SUPABASE / PWA
   ========================================================= */

const SUPABASE_URL = 'https://ynowgseafcpcfgvsmkub.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_2DSB2bN-_Q4JAm5WO4QruA_E4sXrEuH';
const USD_TO_CRC_RATE = 460;

if (!window.supabase || typeof window.supabase.createClient !== 'function') {
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.querySelector('#loginError');
    if (el) el.textContent = 'No se pudo cargar el módulo de Supabase. Abre la aplicación desde un servidor/hosting HTTPS y vuelve a intentar.';
  });
  throw new Error('Supabase JS no cargó');
}

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const $ = s => document.querySelector(s);
const state = {
  user: null,
  session: null,
  sales: [],
  products: [],
  expenses: [],
  customers: [],
  dataLoaded: false,
  view: 'dashboard',
  realtime: null
};

const money = (n, c='CRC') => c === 'USD'
  ? '$' + Number(n || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})
  : '₡' + Math.round(Number(n || 0)).toLocaleString('es-CR');

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
};
const dateKey = value => String(value || '').slice(0,10);
const escapeHtml = v => String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const toast = m => { const t=$('#toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); };

function setSync(ok, text) {
  $('#syncDot').style.background = ok ? '#4caf74' : '#c86643';
  $('#syncText').textContent = text;
}

function showLogin(show=true) {
  $('#loginScreen').classList.toggle('hidden', !show);
  $('#app').classList.toggle('app-visible', !show);
  $('#app').classList.toggle('hidden-app', show);
}

async function boot() {
  $('#loginForm').addEventListener('submit', login);
  $('#logoutBtn').addEventListener('click', logout);
  $('#closeModal').onclick = closeModal;
  $('#newSaleBtn').onclick = openSale;
  $('#installBtn').onclick = installApp;
  const toggleMenu = open => {
    $('.sidebar').classList.toggle('menu-open', open);
    $('#menuBackdrop').classList.toggle('visible', open);
    $('#menuToggle').setAttribute('aria-expanded', String(open));
  };
  $('#menuToggle').onclick = () => toggleMenu(!$('.sidebar').classList.contains('menu-open'));
  $('#menuBackdrop').onclick = () => toggleMenu(false);
  $('#todayLabel').textContent = new Date().toLocaleDateString('es-CR', {day:'numeric',month:'short',year:'numeric'});
  document.querySelectorAll('.nav').forEach(b => b.onclick = () => {
    render(b.dataset.view);
    toggleMenu(false);
  });

  const { data: { session } } = await db.auth.getSession();
  if (session) await startApp(session);

  db.auth.onAuthStateChange((_event, sessionNow) => {
    setTimeout(() => {
      if (sessionNow) {
        if (!state.session || state.session.access_token !== sessionNow.access_token) startApp(sessionNow);
      } else {
        stopApp();
      }
    }, 0);
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

async function login(e) {
  e.preventDefault();
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;
  $('#loginError').textContent = 'Conectando...';
  if (!email || !password) {
    $('#loginError').textContent = 'Escribe el correo y la contraseña.';
    return;
  }

  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('Supabase login error:', error);
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('email not confirmed')) {
        $('#loginError').textContent = 'Este correo todavía no está confirmado en Supabase. Ve a Authentication → Users y confirma el usuario.';
      } else if (msg.includes('invalid login credentials')) {
        $('#loginError').textContent = 'Correo o contraseña incorrectos. Revisa los datos del usuario en Supabase.';
      } else if (msg.includes('failed to fetch') || msg.includes('network')) {
        $('#loginError').textContent = 'No se puede conectar con Supabase. Comprueba tu conexión a internet y abre la app desde un servidor/hosting HTTPS.';
      } else {
        $('#loginError').textContent = `Error de Supabase: ${error.message}`;
      }
      return;
    }

    $('#loginError').textContent = '✓ Acceso correcto. Cargando HYPEFRIENDS BUSINESS...';
    if (data?.session) await startApp(data.session);
  } catch (err) {
    console.error('Login exception:', err);
    $('#loginError').textContent = `Error inesperado: ${err.message || err}`;
  }
}

async function logout() {
  await db.auth.signOut();
}

async function startApp(session) {
  state.session = session;
  state.user = session.user;
  let convertedRows = 0;
  try {
    convertedRows = await convertUsdToCrc();
  } catch (error) {
    console.error('Currency conversion failed:', error);
    $('#loginError').textContent = `No se pudo completar la conversión a colones. ${error.message || error} Recarga para reintentar.`;
    showLogin(true);
    return;
  }
  $('#userEmail').textContent = state.user.email || 'Usuario';
  showLogin(false);
  setSync(true, 'Sincronizando nube...');
  await ensureProfile();
  const loaded = await loadAll();
  subscribeRealtime();
  render(state.view);
  if (!loaded) return;
  setSync(true, 'Sincronizado con Supabase');
  if (convertedRows) toast(`${convertedRows} registros convertidos a colones (₡460 por US$1)`);
}

async function convertUsdToCrc() {
  const conversions = [
    { table:'products', fields:['cost','price'] },
    { table:'sales', fields:['total','paid'] },
    { table:'payments', fields:['amount'] },
    { table:'expenses', fields:['amount'] }
  ];
  let converted = 0;

  for (const {table, fields} of conversions) {
    while (true) {
      const columns=['id',...fields].join(',');
      const {data: rows, error: readError} = await db.from(table).select(columns).eq('currency','USD').range(0,199);
      if (readError) throw new Error(`No se pudieron leer los importes en USD de ${table}: ${readError.message}`);
      if (!rows?.length) break;

      for (const row of rows) {
        const values = {currency:'CRC'};
        fields.forEach(field => { values[field] = Number(row[field] || 0) * USD_TO_CRC_RATE; });
        if (table === 'products') values.updated_at = new Date().toISOString();
        const {data, error} = await db.from(table).update(values).eq('id',row.id).eq('currency','USD').select('id');
        if (error) throw new Error(`No se pudo convertir un registro de ${table}: ${error.message}`);
        converted += data?.length || 0;
      }
    }
  }

  return converted;
}

function stopApp() {
  if (state.realtime) db.removeChannel(state.realtime);
  state.realtime = null;
  state.user = null;
  state.session = null;
  state.sales=[]; state.products=[]; state.expenses=[]; state.customers=[];
  state.dataLoaded = false;
  showLogin(true);
}

async function ensureProfile() {
  if (!state.user) return;
  const { error } = await db.from('profiles').upsert({
    id: state.user.id,
    name: state.user.user_metadata?.name || state.user.email?.split('@')[0] || 'Socio'
  }, { onConflict: 'id' });
  if (error) console.warn('Profile:', error.message);
}

async function loadAll() {
  setSync(true, 'Cargando datos...');
  const [p,c,e,s] = await Promise.all([
    db.from('products').select('*').order('created_at', {ascending:true}),
    db.from('customers').select('*').order('created_at', {ascending:true}),
    db.from('expenses').select('*').order('created_at', {ascending:true}),
    db.from('sales').select('*, customers(name,phone,email), sale_items(*, products(name)), payments(*)').order('created_at', {ascending:true})
  ]);
  const err = p.error || c.error || e.error || s.error;
  if (err) {
    setSync(false, 'Error de conexión');
    console.error(err);
    toast(`No se pudieron cargar los datos: ${err.message || err}`);
    return false;
  }
  state.products = p.data || [];
  state.customers = c.data || [];
  state.expenses = e.data || [];
  state.dataLoaded = true;
  state.sales = (s.data || []).map(x => ({
    ...x,
    customer: x.customers?.name || 'Cliente',
    payments: (x.payments || []).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))
  }));

  setSync(true, 'Sincronizado con Supabase');
  return true;
}

function subscribeRealtime() {
  if (state.realtime) db.removeChannel(state.realtime);
  const tables = ['products','customers','sales','sale_items','payments','expenses'];
  let channel = db.channel('hypefriends-business-sync');
  tables.forEach(table => {
    channel = channel.on('postgres_changes', {event:'*', schema:'public', table}, async () => {
      if (await loadAll()) render(state.view);
    });
  });
  state.realtime = channel.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      setSync(state.dataLoaded, state.dataLoaded ? 'Sincronizado en tiempo real' : 'Conexión activa; datos pendientes');
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSync(false, 'Reintentando sincronización...');
  });
}

function totals(currency) {
  const sales = state.sales.filter(s=>s.currency===currency);
  const total = sales.reduce((a,s)=>a+Number(s.total||0),0);
  const paid = sales.reduce((a,s)=>a+Number(s.paid||0),0);
  const expenses = state.expenses.filter(e=>e.currency===currency).reduce((a,e)=>a+Number(e.amount||0),0);
  return {total, paid, due:Math.max(total-paid,0), expenses};
}

function render(view='dashboard') {
  state.view=view;
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active', b.dataset.view===view));
  $('#viewTitle').textContent={dashboard:'INICIO',sales:'VENTAS',inventory:'INVENTARIO',finance:'GASTOS',customers:'CLIENTES',installments:'APARTADOS',history:'REPORTES'}[view] || 'INICIO';
  const c=$('#content');
  if(view==='dashboard') dashboard(c);
  if(view==='sales') sales(c);
  if(view==='inventory') inventory(c);
  if(view==='finance') finance(c);
  if(view==='customers') customers(c);
  if(view==='installments') installments(c);
  if(view==='history') history(c);
}

function dashboard(c) {
  const now=today();
  const salesToday=state.sales.filter(s=>s.currency==='CRC'&&dateKey(s.created_at)===now);
  const todayTotal=salesToday.reduce((sum,s)=>sum+Number(s.total||0),0);
  const crc=totals('CRC');
  const inventoryCost=state.products.reduce((sum,p)=>sum+Number(p.stock||0)*Number(p.cost||0),0);
  const todayExpenses=state.expenses.filter(e=>e.currency==='CRC'&&dateKey(e.created_at)===now).reduce((sum,e)=>sum+Number(e.amount||0),0);
  const soldToday=salesToday.reduce((sum,s)=>sum+(s.sale_items||[]).reduce((n,item)=>n+Number(item.quantity||0),0),0);
  const pending=state.sales.filter(s=>s.currency==='CRC'&&Number(s.paid)<Number(s.total));
  const pendingTotal=pending.reduce((sum,s)=>sum+Number(s.total||0)-Number(s.paid||0),0);
  const salesByDay=[];
  for(let offset=6;offset>=0;offset--){
    const date=new Date(); date.setDate(date.getDate()-offset);
    const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const total=state.sales.filter(s=>s.currency==='CRC'&&dateKey(s.created_at)===key).reduce((sum,s)=>sum+Number(s.total||0),0);
    salesByDay.push({key,label:date.toLocaleDateString('es-CR',{day:'numeric',month:'short'}),total});
  }
  const maxDay=Math.max(...salesByDay.map(day=>day.total),1);
  const bars=salesByDay.map(day=>{
    const height=day.total?Math.max(8,day.total/maxDay*78):3;
    return `<div class="chart-item ${day.key===now?'today':''}" title="${escapeHtml(day.label)} · ${money(day.total)}"><div class="chart-bar" style="height:${height}px"></div><span class="chart-label">${escapeHtml(day.label)}</span></div>`;
  }).join('');
  const pendingHtml=pending.slice().sort((a,b)=>Number(b.total)-Number(a.total)).slice(0,5).map(s=>`<div class="payment-row"><span>${escapeHtml(s.customer)}<br><small class="muted">${escapeHtml(s.id.slice(0,8))} · Abonado ${money(s.paid)}</small></span><span class="orange">${money(Number(s.total)-Number(s.paid))}</span></div>`).join('')||'<p class="muted">No hay apartados pendientes.</p>';
  const featuredProducts=state.products.slice(0,5).map(p=>`<div class="featured-product"><span class="featured-icon" aria-hidden="true">◇</span><span class="featured-info"><b>${escapeHtml(p.name)}</b><small>Talla: ${escapeHtml(p.size||'—')} · Stock: ${Number(p.stock)}</small></span><strong>${money(p.price,p.currency)}</strong></div>`).join('')||'<p class="muted">Agrega productos para verlos aquí.</p>';
  c.innerHTML=`
    <div class="content-intro"><div><h2>Resumen del negocio</h2><p>Controla tus ventas, inventario y apartados</p></div></div>
    <section class="card sales-overview">
      <div class="sales-overview-heading"><div><div class="label">Monto total vendido</div><div class="sales-overview-total">${money(crc.total)} <small>CRC</small></div></div><span class="sales-period">Últimos 7 días</span></div>
      <div class="chart sales-overview-chart" role="img" aria-label="Gráfica de ventas de los últimos siete días">${bars}</div>
      <div class="sales-chart-axis"><span>${escapeHtml(salesByDay[0].label)}</span><span>${escapeHtml(salesByDay[6].label)}</span></div>
    </section>
    <div class="grid overview-metrics">
      ${metricCard('Ventas registradas',money(crc.total),'▣','')}
      ${metricCard('Costo de mercadería',money(inventoryCost),'◇','green')}
      ${metricCard('Gastos totales',money(crc.expenses),'▦','blue')}
      ${metricCard('Dinero en apartados',money(pendingTotal),'⬡','yellow',`${pending.length} activos`)}
    </div>
    <section class="card featured-inventory">
      <div class="section-title"><h2>Inventario destacado</h2><button class="text-action" onclick="render('inventory')">Ver inventario</button></div>
      <div class="featured-list">${featuredProducts}</div>
    </section>
    <div class="grid dashboard-lower">
      <div class="card"><div class="section-title"><h2>Últimos apartados</h2><button class="text-action" onclick="render('installments')">Ver todos</button></div>${pendingHtml}</div>
    </div>
    <div class="stats dashboard-quick-stats">
      ${statCard('Ventas de hoy',money(todayTotal),'▣','green')}
      ${statCard('Transacciones',salesToday.length,'◷','blue')}
      ${statCard('Productos vendidos',soldToday,'▤','purple')}
      ${statCard('Clientes',state.customers.length,'♙','yellow')}
    </div>`;
}

function metricCard(label,value,icon,tone,note=''){
  return `<div class="card metric-card"><div class="metric-left"><span class="metric-icon ${tone}">${icon}</span><div><div class="label">${label}</div><div class="metric">${value}</div></div></div>${note?`<span class="metric-note">${note}</span>`:''}</div>`;
}

function statCard(label,value,icon,tone){
  return `<div class="card stat-card"><span class="metric-icon ${tone}">${icon}</span><div><div class="label">${label}</div><div class="metric">${value}</div></div></div>`;
}

function saleTable(n=99) {
  const rows=state.sales.slice(-n).reverse();
  return `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Total</th><th>Pagado</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows.map(s=>`<tr><td><b>${escapeHtml(s.customer)}</b><br><span class="muted">${escapeHtml(s.id)}</span></td><td>${money(s.total,s.currency)}</td><td>${money(s.paid,s.currency)}</td><td><span class="badge ${s.paid>=s.total?'green':'orange'}">${s.paid>=s.total?'Pagada':'Pendiente'}</span></td><td class="sale-actions"><div class="actions">${s.paid<s.total?`<button class="primary small" onclick="openPayment('${s.id}')">ABONO</button>`:''}<button class="delete-button" onclick="deleteSale('${s.id}')">ELIMINAR</button></div></td></tr>`).join('')||'<tr><td colspan="5" class="muted">No hay ventas todavía.</td></tr>'}</tbody></table></div>`;
}

function sales(c){c.innerHTML=`<div class="content-intro"><div><h2>Todas las ventas</h2><p>Ventas y pagos registrados en colones costarricenses.</p></div><button class="primary" onclick="openSale()">＋ NUEVA VENTA</button></div>${saleTable()}`;}

function inventory(c){
  c.innerHTML=`<div class="content-intro"><div><h2>Control de inventario</h2><p>Sneakers, hoodies y artículos en bodega</p></div><button class="primary inventory-add" onclick="openProduct()">＋ <span>AGREGAR PRODUCTO</span></button></div><div class="table-wrap inventory-table"><table><thead><tr><th>Producto</th><th>Talla</th><th>Stock</th><th>Costo unit.</th><th>Precio venta</th><th>Acciones</th></tr></thead><tbody>${state.products.map(p=>`<tr><td class="inventory-name">${escapeHtml(p.name)}</td><td>${escapeHtml(p.size||'—')}</td><td><span class="stock-badge">${Number(p.stock)} disp.</span></td><td>${money(p.cost,p.currency)}</td><td class="inventory-price">${money(p.price,p.currency)}</td><td><div class="actions"><button class="secondary small" onclick="openStockAdjustment('${p.id}')">AJUSTAR</button><button class="delete-button" onclick="deleteProduct('${p.id}')">QUITAR</button></div></td></tr>`).join('')||'<tr><td colspan="6" class="muted">No hay productos. Agrega el primero con el botón superior.</td></tr>'}</tbody></table></div>`;
}

function finance(c){
  const crc=totals('CRC');
  c.innerHTML=`<div class="content-intro"><div><h2>Gastos</h2><p>Control de salidas de dinero en colones costarricenses.</p></div><button class="primary" onclick="openExpense()">+ REGISTRAR GASTO</button></div><div class="grid stats"><div class="card"><div class="label">Ventas registradas</div><div class="metric">${money(crc.total)}</div></div><div class="card"><div class="label">Gastos acumulados</div><div class="metric orange">${money(crc.expenses)}</div></div></div><div class="section-title"><h2>Movimientos de gastos</h2></div><div class="table-wrap"><table><thead><tr><th>Concepto</th><th>Monto</th><th>Fecha</th><th>Acción</th></tr></thead><tbody>${state.expenses.slice().reverse().map(x=>`<tr><td>${escapeHtml(x.note)}</td><td>${money(x.amount)}</td><td>${dateKey(x.created_at)}</td><td><button class="delete-button" onclick="deleteExpense('${x.id}')">QUITAR</button></td></tr>`).join('')||'<tr><td colspan="4" class="muted">No hay gastos. Registra el primero con el botón superior.</td></tr>'}</tbody></table></div>`;
}

function customers(c){c.innerHTML=`<div class="content-intro"><div><h2>Clientes</h2><p>Administra la lista de clientes de tu tienda.</p></div><button class="primary" onclick="openCustomer()">+ CLIENTE</button></div><div class="product-list">${state.customers.map(x=>`<div class="card"><div class="product-head"><span class="metric-icon yellow">♙</span><button class="delete-button" onclick="deleteCustomer('${x.id}')">QUITAR</button></div><h3>${escapeHtml(x.name)}</h3><div class="muted">${escapeHtml(x.phone||'Sin teléfono')}</div>${x.email?`<div class="muted">${escapeHtml(x.email)}</div>`:''}</div>`).join('')||'<div class="card muted">Agrega tu primer cliente.</div>'}</div>`;}

function installments(c){
  const rows=state.sales.filter(s=>Number(s.paid)<Number(s.total)||s.payments.length).slice().reverse();
  c.innerHTML=`<div class="content-intro"><div><h2>Apartados</h2><p>Control de pagos parciales y saldos pendientes</p></div><button class="primary" onclick="openSale()">♧ <span>NUEVO APARTADO</span></button></div><div class="installment-list">${rows.map(s=>{const balance=Math.max(Number(s.total)-Number(s.paid),0), progress=Number(s.total)>0?Math.min(Number(s.paid)/Number(s.total)*100,100):0;return `<article class="card installment-card"><div class="installment-heading"><div><h3>${escapeHtml(s.customer)}</h3><p>${escapeHtml((s.sale_items||[]).map(item=>item.products?.name||'Producto').join(', ')||s.id)}</p></div><span class="badge ${balance?'orange':'green'}">${balance?'Pendiente':'Pagado'}</span></div><div class="installment-totals"><span>Abonado: <b>${money(s.paid)}</b></span><span>Resta: <b class="${balance?'orange':''}">${money(balance)}</b></span></div><div class="progress-track"><span style="width:${progress}%"></span></div><div class="installment-actions">${balance?`<button class="installment-pay" onclick="openPayment('${s.id}')">+ Abonar plata</button>`:''}</div><div class="payment-list">${s.payments.map(p=>`<div class="payment-row"><span><span class="payment-amount">${money(p.amount)}</span><br><small class="muted">${dateKey(p.created_at)}</small></span><button class="delete-button" onclick="deletePayment('${s.id}','${p.id}')">QUITAR ABONO</button></div>`).join('')}</div></article>`;}).join('')||'<div class="card muted">No hay apartados ni abonos. Registra una venta con un pago parcial para empezar.</div>'}</div>`;
}

function history(c){
  const rows=[];
  state.sales.forEach(s=>s.payments.forEach(p=>rows.push({type:'Pago',desc:`${s.customer} · ${s.id}`,amount:p.amount,currency:p.currency||s.currency,date:String(p.created_at||'').slice(0,10)})));
  state.expenses.forEach(e=>rows.push({type:'Gasto',desc:e.note,amount:e.amount,currency:e.currency,date:String(e.created_at||'').slice(0,10)}));
  rows.sort((a,b)=>b.date.localeCompare(a.date));
  c.innerHTML=`<div class="section-title"><h2>MOVIMIENTOS</h2></div><div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Detalle</th><th>Monto</th><th>Fecha</th></tr></thead><tbody>${rows.map(r=>`<tr><td><span class="badge">${r.type}</span></td><td>${escapeHtml(r.desc)}</td><td>${money(r.amount,r.currency)}</td><td>${r.date}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No hay movimientos.</td></tr>'}</tbody></table></div>`;
}

function modal(html){$('#modalContent').innerHTML=html;$('#modal').classList.remove('hidden');}
function closeModal(){$('#modal').classList.add('hidden');}

function openSale(){
  if(!state.products.length) return toast('Primero agrega un producto');
  modal(`<h2>NUEVA VENTA</h2><div class="form"><label>Cliente<select id="fCustomer"><option value="">Cliente nuevo / sin registrar</option>${state.customers.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select></label><label>Producto<select id="fProduct">${state.products.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} — ${money(p.price,p.currency)} — stock ${p.stock}</option>`).join('')}</select></label><div class="form-grid"><label>Cantidad<input id="fQty" type="number" min="1" value="1"></label><label>Pago recibido<input id="fPaid" type="number" min="0" value="0"></label></div><div class="total-box">TOTAL<strong id="saleTotal">₡0</strong><small id="saleCurrencyHint"></small></div><button class="primary" onclick="createSale()">REGISTRAR VENTA</button></div>`);
  ['fProduct','fQty'].forEach(id=>$('#'+id).addEventListener('input',updateSaleTotal));
  updateSaleTotal();
}

function updateSaleTotal(){
  const p=state.products.find(x=>x.id===$('#fProduct')?.value); if(!p)return;
  $('#saleTotal').textContent=money(Number(p.price)*Number($('#fQty').value||1),p.currency);
  $('#saleCurrencyHint').textContent=`Moneda de la venta: ${p.currency==='USD'?'Dólares':'Colones'}`;
}

async function createSale(){
  const p=state.products.find(x=>x.id===$('#fProduct').value);
  const qty=Number($('#fQty').value), paid=Number($('#fPaid').value||0), customerId=$('#fCustomer').value||null;
  if(!p||qty<=0)return toast('Datos de venta inválidos');
  if(qty>Number(p.stock))return toast('No hay suficiente stock');
  const total=Number(p.price)*qty;
  const realPaid=Math.min(Math.max(paid,0),total);
  const status=realPaid>=total?'paid':'pending';
  setSync(true,'Guardando venta...');

  const {data:sale,error:saleErr}=await db.from('sales').insert({customer_id:customerId,total,paid:realPaid,currency:p.currency,status,created_by:state.user.id}).select().single();
  if(saleErr){console.error(saleErr);setSync(false,'Error guardando');return toast('No se pudo registrar la venta');}

  const {error:itemErr}=await db.from('sale_items').insert({sale_id:sale.id,product_id:p.id,quantity:qty,unit_price:p.price,unit_cost:p.cost});
  if(itemErr){console.error(itemErr);toast('Venta creada, pero falló el detalle');}

  if(realPaid>0){
    const {error:payErr}=await db.from('payments').insert({sale_id:sale.id,amount:realPaid,currency:p.currency,created_by:state.user.id});
    if(payErr)console.error(payErr);
  }

  const {error:stockErr}=await db.from('products').update({stock:Number(p.stock)-qty,updated_at:new Date().toISOString()}).eq('id',p.id);
  if(stockErr){console.error(stockErr);toast('Venta creada, pero no se pudo actualizar stock');}

  await loadAll(); closeModal(); render('sales'); toast('VENTA REGISTRADA EN LA NUBE');
  if(realPaid>0){
    const createdSale=state.sales.find(row=>row.id===sale.id);
    if(createdSale)showReceipt(createdSale,realPaid);
  }
}

async function deleteSale(id){
  const sale=state.sales.find(row=>row.id===id);
  if(!sale)return toast('No se encontró la venta. Recarga la vista e inténtalo de nuevo.');
  if(!window.confirm(`¿Eliminar la venta de ${sale.customer} por ${money(sale.total,sale.currency)}? También se eliminarán sus abonos y se intentará devolver el inventario.`))return;

  const {data:items,error:itemsError}=await db.from('sale_items').select('product_id,quantity').eq('sale_id',id);
  if(itemsError){console.error('Sale items lookup:',itemsError);return toast('No se pudo revisar el inventario asociado a la venta.');}

  const {data:deleted,error:deleteError}=await db.from('sales').delete().eq('id',id).select('id').maybeSingle();
  if(deleteError||!deleted){console.error('Sale delete:',deleteError);return toast('No se pudo eliminar la venta.');}

  const quantities=new Map();
  (items||[]).forEach(item=>{
    if(item.product_id)quantities.set(item.product_id,(quantities.get(item.product_id)||0)+Number(item.quantity||0));
  });
  const stockErrors=[];
  for(const [productId,quantity] of quantities){
    const {data:product,error:readError}=await db.from('products').select('id,name,stock').eq('id',productId).maybeSingle();
    if(readError||!product){console.error('Sale stock lookup:',readError||`Product ${productId} was not found.`);stockErrors.push(productId);continue;}
    const {data:updated,error:updateError}=await db.from('products').update({
      stock:Number(product.stock||0)+quantity,
      updated_at:new Date().toISOString()
    }).eq('id',productId).eq('stock',product.stock).select('id').maybeSingle();
    if(updateError||!updated){console.error('Sale stock restore:',updateError||`Stock for ${product.name} changed concurrently.`);stockErrors.push(product.name);}
  }

  await loadAll();
  render('sales');
  if(stockErrors.length)return toast(`Venta eliminada; no se pudo restaurar el stock de: ${stockErrors.join(', ')}. Revisa el inventario.`);
  toast('VENTA ELIMINADA Y STOCK RESTAURADO');
}

function openPayment(id){
  const s=state.sales.find(x=>x.id===id); if(!s)return;
  modal(`<h2>REGISTRAR ABONO</h2><p><b>${escapeHtml(s.customer)}</b> · ${escapeHtml(s.id)}</p><div class="card"><div class="label">Saldo pendiente</div><div class="metric orange">${money(Number(s.total)-Number(s.paid),s.currency)}</div></div><div class="form"><label>Monto del abono<input id="payAmount" type="number" min="0.01" max="${Number(s.total)-Number(s.paid)}" step="0.01"></label><button class="primary" onclick="addPayment('${s.id}')">REGISTRAR ABONO Y COMPROBANTE</button></div>`);
}

async function addPayment(id){
  const s=state.sales.find(x=>x.id===id), amount=Number($('#payAmount').value);
  const due=Number(s.total)-Number(s.paid);
  if(!amount||amount<=0||amount>due)return toast('Monto de abono inválido');
  const {error:payErr}=await db.from('payments').insert({sale_id:id,amount,currency:s.currency,created_by:state.user.id});
  if(payErr){console.error(payErr);return toast('No se pudo registrar el abono');}
  const newPaid=Number(s.paid)+amount;
  const {error:saleErr}=await db.from('sales').update({paid:newPaid,status:newPaid>=Number(s.total)?'paid':'pending'}).eq('id',id);
  if(saleErr){console.error(saleErr);return toast('Abono creado, pero no se actualizó la venta');}
  await loadAll();
  const updated=state.sales.find(x=>x.id===id);
  showReceipt(updated,amount);
  render('sales');
}

function receiptText(s,amount){
  const items=(s.sale_items||[]).map(item=>`- ${item.products?.name||'Producto'} × ${Number(item.quantity)||1}`).join('\n')||'- Artículos de la venta';
  return `HYPEFRIENDS BUSINESS\nFACTURA / COMPROBANTE DE ABONO\n\nCliente: ${s.customer}\nVenta: ${s.id}\nFecha: ${new Date().toLocaleDateString('es-CR')}\n\nArtículos:\n${items}\n\nAbono recibido: ${money(amount,s.currency)}\nTotal de compra: ${money(s.total,s.currency)}\nTotal abonado: ${money(s.paid,s.currency)}\nSaldo pendiente: ${money(Math.max(Number(s.total)-Number(s.paid),0),s.currency)}\n\nSIN INTERESES\nGracias por comprar en HYPEFRIENDS.`;}

function showReceipt(s,amount){
  const items=(s.sale_items||[]).map(item=>`<div class="receipt-row"><span>${escapeHtml(item.products?.name||'Producto')} × ${Number(item.quantity)||1}</span><b>${money(Number(item.unit_price||0)*Number(item.quantity||1),s.currency)}</b></div>`).join('')||'<div class="receipt-row"><span>Artículos de la venta</span></div>';
  modal(`<div class="receipt" id="receiptPreview"><div class="receipt-head">HYPEFRIENDS</div><div class="muted">STREETWEAR & DROPS · FACTURA DE ABONO</div><hr><div class="receipt-row"><span>Cliente</span><b>${escapeHtml(s.customer)}</b></div><div class="receipt-row"><span>Venta</span><b>${escapeHtml(s.id)}</b></div><div class="receipt-row"><span>Fecha</span><b>${new Date().toLocaleDateString('es-CR')}</b></div><hr><b>ARTÍCULOS</b>${items}<hr><div class="receipt-row"><span>Abono recibido</span><b>${money(amount,s.currency)}</b></div><div class="receipt-row"><span>Total compra</span><b>${money(s.total,s.currency)}</b></div><div class="receipt-row"><span>Total abonado</span><b>${money(s.paid,s.currency)}</b></div><hr><div class="receipt-row"><span>Saldo pendiente</span><b class="receipt-total">${money(Math.max(Number(s.total)-Number(s.paid),0),s.currency)}</b></div><hr><b>SIN INTERESES</b><p class="muted">Gracias por comprar en HYPEFRIENDS.</p></div><div class="actions" style="margin-top:14px"><button class="primary" onclick="shareReceiptImage('${s.id}',${Number(amount)})">📲 COMPARTIR FACTURA</button><button class="outline light-button" onclick="shareReceiptText('${s.id}',${Number(amount)})">WHATSAPP / TEXTO</button><button class="outline light-button" onclick="closeModal()">CERRAR</button></div>`);
}

function buildReceiptCanvas(s,amount){
  const items=s.sale_items||[];
  const canvas=document.createElement('canvas'); canvas.width=900; canvas.height=1100+Math.max(items.length,1)*54;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#090909'; ctx.textAlign='left';
  ctx.font='900 48px Arial'; ctx.fillText('HYPEFRIENDS',60,90);
  ctx.font='700 22px Arial'; ctx.fillText('BUSINESS · FACTURA DE ABONO',60,135);
  ctx.strokeStyle='#cccccc'; ctx.setLineDash([8,8]); ctx.beginPath(); ctx.moveTo(60,175); ctx.lineTo(840,175); ctx.stroke(); ctx.setLineDash([]);
  const rows=[['Cliente',s.customer],['Venta',s.id],['Fecha',new Date().toLocaleDateString('es-CR')]];
  let y=240;
  rows.forEach(([label,value])=>{ctx.font='500 25px Arial';ctx.fillStyle='#777';ctx.fillText(label,60,y);ctx.font='700 26px Arial';ctx.fillStyle='#090909';ctx.fillText(String(value).slice(0,38),840,y,{align:'right'});ctx.textAlign='left';y+=64;});
  ctx.strokeStyle='#ddd';ctx.beginPath();ctx.moveTo(60,y-25);ctx.lineTo(840,y-25);ctx.stroke();
  ctx.font='900 24px Arial';ctx.fillStyle='#090909';ctx.fillText('ARTÍCULOS',60,y+15);y+=65;
  (items.length?items:[{products:{name:'Artículos de la venta'},quantity:1,unit_price:0}]).forEach(item=>{
    const label=`${item.products?.name||'Producto'} × ${Number(item.quantity)||1}`;
    ctx.font='500 22px Arial';ctx.fillStyle='#333';ctx.fillText(label.slice(0,40),60,y);
    ctx.font='700 22px Arial';ctx.fillStyle='#090909';ctx.fillText(money(Number(item.unit_price||0)*Number(item.quantity||1),s.currency),840,y,{align:'right'});
    ctx.textAlign='left';y+=54;
  });
  y+=10;ctx.strokeStyle='#ccc';ctx.beginPath();ctx.moveTo(60,y-25);ctx.lineTo(840,y-25);ctx.stroke();y+=30;
  const totals=[['Abono recibido',money(amount,s.currency)],['Total de compra',money(s.total,s.currency)],['Total abonado',money(s.paid,s.currency)],['Saldo pendiente',money(Math.max(Number(s.total)-Number(s.paid),0),s.currency)]];
  totals.forEach(([label,value],index)=>{ctx.font=index===3?'900 30px Arial':'500 24px Arial';ctx.fillStyle=index===3?'#090909':'#777';ctx.fillText(label,60,y);ctx.textAlign='right';ctx.fillStyle=index===3?'#f06418':'#090909';ctx.fillText(value,840,y);ctx.textAlign='left';y+=62;});
  ctx.font='900 28px Arial';ctx.fillStyle='#090909';ctx.fillText('SIN INTERESES',60,y+10);
  ctx.font='500 21px Arial';ctx.fillStyle='#777';ctx.fillText('Gracias por comprar en HYPEFRIENDS.',60,y+55);
  return canvas;
}

async function shareReceiptImage(id,amount){
  const s=state.sales.find(x=>x.id===id); if(!s)return;
  const canvas=buildReceiptCanvas(s,amount);
  canvas.toBlob(async blob=>{
    const file=new File([blob],`HYPEFRIENDS-${id}.png`,{type:'image/png'});
    if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
      try{await navigator.share({title:'Comprobante HYPEFRIENDS',text:receiptText(s,amount),files:[file]});toast('Comprobante listo para compartir');}catch(e){}
    }else{
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`HYPEFRIENDS-${id}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Imagen generada; puedes enviarla por WhatsApp');
    }
  },'image/png');
}

async function shareReceiptText(id,amount){
  const s=state.sales.find(x=>x.id===id); if(!s)return;
  const text=receiptText(s,amount);
  if(navigator.share){try{await navigator.share({title:'Comprobante HYPEFRIENDS',text});return;}catch(e){}}
  await navigator.clipboard?.writeText(text); toast('Comprobante copiado; pégalo en WhatsApp');
}

function openProduct(){modal(`<h2>NUEVO PRODUCTO</h2><div class="form"><label>Nombre<input id="pName" required></label><div class="form-grid"><label>Talla<input id="pSize" placeholder="Ej. S, M, L, 38 o UNSIZE"></label><label>Stock inicial<input id="pStock" type="number" value="1" min="0" step="1"></label><label>Costo (CRC)<input id="pCost" type="number" value="0" min="0" step="0.01"></label><label>Precio (CRC)<input id="pPrice" type="number" value="0" min="0" step="0.01"></label></div><p class="muted">Todos los precios se guardan en colones costarricenses.</p><button class="primary" onclick="createProduct()">GUARDAR PRODUCTO</button></div>`);}

async function createProduct(){
  const name=$('#pName').value.trim(), stock=Number($('#pStock').value), cost=Number($('#pCost').value), price=Number($('#pPrice').value);
  if(!name||![stock,cost,price].every(Number.isFinite)||stock<0||cost<0||price<0)return toast('Revisa el nombre, stock, costo y precio.');
  const row={name,size:$('#pSize').value.trim()||null,stock,cost,price,currency:'CRC'};
  const {error}=await db.from('products').insert(row); if(error){console.error(error);return toast(`No se pudo guardar el producto: ${error.message}`);}
  await loadAll();closeModal();render('inventory');toast('PRODUCTO GUARDADO EN LA NUBE');
}

function openStockAdjustment(id){
  const product=state.products.find(p=>p.id===id); if(!product)return;
  modal(`<h2>AJUSTAR EXISTENCIAS</h2><p>${escapeHtml(product.name)} · Stock actual: <b>${Number(product.stock)}</b></p><div class="form"><label>Movimiento<select id="stockAction"><option value="add">Agregar unidades</option><option value="remove">Retirar unidades</option></select></label><label>Cantidad<input id="stockQuantity" type="number" min="1" step="1" value="1"></label><button class="primary" onclick="adjustStock('${product.id}')">GUARDAR CAMBIO</button></div>`);
}

async function adjustStock(id){
  const product=state.products.find(p=>p.id===id), quantity=Number($('#stockQuantity').value), action=$('#stockAction').value;
  if(!product||!Number.isInteger(quantity)||quantity<1)return toast('Ingresa una cantidad válida de unidades.');
  if(action==='remove'&&quantity>Number(product.stock))return toast('No hay suficientes unidades para retirar.');
  const stock=Number(product.stock)+(action==='add'?quantity:-quantity);
  const {data,error}=await db.from('products').update({stock,updated_at:new Date().toISOString()}).eq('id',id).select('id').maybeSingle();
  if(error||!data){console.error('Stock update:',error);return toast('No se pudo actualizar el inventario.');}
  await loadAll();closeModal();render('inventory');toast(action==='add'?'UNIDADES AGREGADAS':'UNIDADES RETIRADAS');
}

async function deleteProduct(id){
  const product=state.products.find(p=>p.id===id); if(!product)return;
  if(!window.confirm(`¿Quitar "${product.name}" del inventario? Las ventas anteriores conservarán sus montos y cantidades.`))return;
  const {data:items,error:itemsError}=await db.from('sale_items').select('id').eq('product_id',id);
  if(itemsError){console.error('Product history lookup:',itemsError);return toast('No se pudo revisar el historial del producto.');}
  const itemIds=(items||[]).map(item=>item.id);
  if(itemIds.length){
    const {error:unlinkError}=await db.from('sale_items').update({product_id:null}).in('id',itemIds);
    if(unlinkError){console.error('Product history unlink:',unlinkError);return toast('No se pudo quitar el producto de las ventas anteriores.');}
  }
  const {data,error}=await db.from('products').delete().eq('id',id).select('id').maybeSingle();
  if(error||!data){
    console.error('Product delete:',error);
    const {data:restored,error:restoreError}=itemIds.length?await db.from('sale_items').update({product_id:id}).in('id',itemIds).select('id'):{data:[],error:null};
    if(restoreError||restored?.length!==itemIds.length)console.error('Product history restore failed:',restoreError||'Some sale items were not restored.');
    return toast(restoreError||restored?.length!==itemIds.length?'No se quitó el producto; revisa el historial de ventas.':'No se pudo quitar el producto.');
  }
  await loadAll();render('inventory');toast('PRODUCTO QUITADO DEL INVENTARIO');
}

function openExpense(){modal(`<h2>REGISTRAR GASTO</h2><div class="form"><label>Concepto<input id="eNote" required placeholder="Compra de mercadería, envío..."></label><label>Monto en colones (CRC)<input id="eAmount" type="number" min="0.01" step="0.01"></label><button class="primary" onclick="createExpense()">GUARDAR GASTO</button></div>`);}

async function createExpense(){
  const note=$('#eNote').value.trim(), amount=Number($('#eAmount').value);
  if(!note||!Number.isFinite(amount)||amount<=0)return toast('Ingresa el concepto y un monto válido.');
  const row={note,amount,currency:'CRC',created_by:state.user.id};
  const {error}=await db.from('expenses').insert(row); if(error){console.error(error);return toast('No se pudo guardar el gasto');}
  await loadAll();closeModal();render('finance');toast('GASTO REGISTRADO EN LA NUBE');
}

async function deleteExpense(id){
  const expense=state.expenses.find(row=>row.id===id); if(!expense)return;
  if(!window.confirm(`¿Quitar el gasto "${expense.note}" por ${money(expense.amount)}?`))return;
  const {data,error}=await db.from('expenses').delete().eq('id',id).select('id').maybeSingle();
  if(error||!data){console.error('Expense delete:',error);return toast('No se pudo quitar el gasto.');}
  await loadAll();render('finance');toast('GASTO QUITADO');
}

function openCustomer(){modal(`<h2>NUEVO CLIENTE</h2><div class="form"><label>Nombre<input id="cName" required></label><label>Teléfono<input id="cPhone" type="tel"></label><label>Correo<input id="cEmail" type="email"></label><button class="primary" onclick="createCustomer()">GUARDAR CLIENTE</button></div>`);}

async function createCustomer(){
  const name=$('#cName').value.trim();
  if(!name)return toast('Escribe el nombre del cliente.');
  const row={name,phone:$('#cPhone').value.trim()||null,email:$('#cEmail').value.trim()||null};
  const {error}=await db.from('customers').insert(row); if(error){console.error(error);return toast('No se pudo guardar el cliente');}
  await loadAll();closeModal();render('customers');toast('CLIENTE GUARDADO EN LA NUBE');
}

async function deleteCustomer(id){
  const customer=state.customers.find(row=>row.id===id); if(!customer)return;
  if(!window.confirm(`¿Quitar a "${customer.name}"? Sus ventas y abonos seguirán guardados, pero quedarán sin cliente asignado.`))return;
  const {data:linkedSales,error:salesError}=await db.from('sales').select('id').eq('customer_id',id);
  if(salesError){console.error('Customer sales lookup:',salesError);return toast('No se pudo revisar el historial del cliente.');}
  const saleIds=(linkedSales||[]).map(sale=>sale.id);
  if(saleIds.length){
    const {error:unlinkError}=await db.from('sales').update({customer_id:null}).in('id',saleIds);
    if(unlinkError){console.error('Customer history unlink:',unlinkError);return toast('No se pudo quitar la relación con sus ventas.');}
  }
  const {data,error}=await db.from('customers').delete().eq('id',id).select('id').maybeSingle();
  if(error||!data){
    console.error('Customer delete:',error);
    const {data:restored,error:restoreError}=saleIds.length?await db.from('sales').update({customer_id:id}).in('id',saleIds).is('customer_id',null).select('id'):{data:[],error:null};
    if(restoreError||restored?.length!==saleIds.length)console.error('Customer history restore failed:',restoreError||'Some sales were not restored.');
    return toast(restoreError||restored?.length!==saleIds.length?'No se quitó el cliente; revisa las ventas asociadas.':'No se pudo quitar el cliente.');
  }
  await loadAll();render('customers');toast('CLIENTE QUITADO');
}

async function deletePayment(saleId,paymentId){
  const sale=state.sales.find(row=>row.id===saleId), payment=sale?.payments.find(row=>row.id===paymentId);
  if(!sale||!payment)return toast('No se encontró el abono. Recarga la vista e inténtalo de nuevo.');
  if(!window.confirm(`¿Quitar el abono de ${money(payment.amount)}? El saldo pendiente de la venta aumentará.`))return;
  const previousPaid=Number(sale.paid), newPaid=Math.max(0,previousPaid-Number(payment.amount));
  const previousStatus=sale.status, newStatus=newPaid>=Number(sale.total)?'paid':'pending';
  const {data:updated,error:updateError}=await db.from('sales').update({paid:newPaid,status:newStatus}).eq('id',saleId).eq('paid',previousPaid).select('id').maybeSingle();
  if(updateError||!updated){console.error('Sale balance update:',updateError);return toast('No se actualizó el saldo; recarga y vuelve a intentarlo.');}
  const {data:deleted,error:deleteError}=await db.from('payments').delete().eq('id',paymentId).eq('sale_id',saleId).select('id').maybeSingle();
  if(deleteError||!deleted){
    console.error('Payment delete:',deleteError);
    const {data:restored,error:restoreError}=await db.from('sales').update({paid:previousPaid,status:previousStatus}).eq('id',saleId).eq('paid',newPaid).select('id').maybeSingle();
    if(restoreError||!restored)console.error('Sale balance restore failed:',restoreError||'Balance changed concurrently.');
    return toast(restoreError||!restored?'No se quitó el abono; recarga para verificar el saldo.':'No se pudo quitar el abono; el saldo fue restaurado.');
  }
  await loadAll();render('installments');toast('ABONO QUITADO Y SALDO ACTUALIZADO');
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;});
async function installApp(){if(deferredPrompt){deferredPrompt.prompt();deferredPrompt=null;}else toast('En iPhone usa Compartir → Agregar a pantalla de inicio');}

boot();
