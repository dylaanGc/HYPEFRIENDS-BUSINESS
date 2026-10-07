/* =========================================================
   HYPEFRIENDS BUSINESS — SUPABASE / PWA
   ========================================================= */

const SUPABASE_URL = 'https://ynowgseafpcfgvsmkub.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_2DSB2bN-_Q4JAm5WO4QruA_E4sXrEuH';

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
  view: 'dashboard',
  realtime: null
};

const DEFAULT_PRODUCTS = [
  { name:'CORE HOODIE', category:'Hoodie', stock:5, cost:30000, price:48000, currency:'CRC' },
  { name:'SHORT CORTEIZ', category:'Shorts', stock:8, cost:15000, price:25000, currency:'CRC' },
  { name:'CAP CHROME HEARTS', category:'Gorra', stock:9, cost:9000, price:15000, currency:'CRC' },
  { name:'CAMISETA CHROME HEARTS', category:'Camiseta', stock:15, cost:15000, price:28000, currency:'CRC' }
];

const money = (n, c='CRC') => c === 'USD'
  ? '$' + Number(n || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})
  : '₡' + Math.round(Number(n || 0)).toLocaleString('es-CR');

const today = () => new Date().toISOString().slice(0,10);
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
  document.querySelectorAll('.nav').forEach(b => b.onclick = () => render(b.dataset.view));

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
  $('#userEmail').textContent = state.user.email || 'Usuario';
  showLogin(false);
  setSync(true, 'Sincronizando nube...');
  await ensureProfile();
  await loadAll();
  subscribeRealtime();
  render(state.view);
  setSync(true, 'Sincronizado con Supabase');
}

function stopApp() {
  if (state.realtime) db.removeChannel(state.realtime);
  state.realtime = null;
  state.user = null;
  state.session = null;
  state.sales=[]; state.products=[]; state.expenses=[]; state.customers=[];
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
    toast('No se pudieron cargar los datos');
    return;
  }
  state.products = p.data || [];
  state.customers = c.data || [];
  state.expenses = e.data || [];
  state.sales = (s.data || []).map(x => ({
    ...x,
    customer: x.customers?.name || 'Cliente',
    payments: (x.payments || []).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))
  }));

  if (!state.products.length) await seedProducts();
  setSync(true, 'Sincronizado con Supabase');
}

async function seedProducts() {
  const { data, error } = await db.from('products').insert(DEFAULT_PRODUCTS).select();
  if (!error) state.products = data || [];
  else console.warn('Seed products:', error.message);
}

function subscribeRealtime() {
  if (state.realtime) db.removeChannel(state.realtime);
  const tables = ['products','customers','sales','sale_items','payments','expenses'];
  let channel = db.channel('hypefriends-business-sync');
  tables.forEach(table => {
    channel = channel.on('postgres_changes', {event:'*', schema:'public', table}, async () => {
      await loadAll();
      render(state.view);
    });
  });
  state.realtime = channel.subscribe(status => {
    if (status === 'SUBSCRIBED') setSync(true, 'Sincronizado en tiempo real');
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
  $('#viewTitle').textContent={dashboard:'DASHBOARD',sales:'VENTAS',inventory:'INVENTARIO',finance:'FINANZAS',customers:'CLIENTES',history:'HISTORIAL'}[view] || 'DASHBOARD';
  const c=$('#content');
  if(view==='dashboard') dashboard(c);
  if(view==='sales') sales(c);
  if(view==='inventory') inventory(c);
  if(view==='finance') finance(c);
  if(view==='customers') customers(c);
  if(view==='history') history(c);
}

function dashboard(c) {
  const crc=totals('CRC'), usd=totals('USD');
  const stock=state.products.reduce((a,p)=>a+Number(p.stock||0),0);
  c.innerHTML=`
    <div class="grid stats">
      <div class="card"><div class="label">Ventas CRC</div><div class="metric">${money(crc.total,'CRC')}</div></div>
      <div class="card"><div class="label">Cobrado CRC</div><div class="metric orange">${money(crc.paid,'CRC')}</div></div>
      <div class="card"><div class="label">Ventas USD</div><div class="metric">${money(usd.total,'USD')}</div></div>
      <div class="card"><div class="label">Stock total</div><div class="metric">${stock}</div></div>
    </div>
    <div class="grid two">
      <div><div class="section-title"><h2>ÚLTIMAS VENTAS</h2><button class="primary small" onclick="openSale()">+ VENTA</button></div>${saleTable(5)}</div>
      <div>
        <div class="section-title"><h2>RESUMEN</h2></div>
        <div class="grid">
          <div class="card"><div class="label">Por cobrar CRC</div><div class="metric orange">${money(crc.due,'CRC')}</div></div>
          <div class="card"><div class="label">Por cobrar USD</div><div class="metric orange">${money(usd.due,'USD')}</div></div>
          <div class="card"><div class="label">Gastos CRC / USD</div><div class="metric">${money(crc.expenses,'CRC')} · ${money(usd.expenses,'USD')}</div></div>
          <div class="card"><div class="label">Productos con stock bajo</div><div class="metric">${state.products.filter(p=>Number(p.stock)<=3).length}</div></div>
        </div>
      </div>
    </div>`;
}

function saleTable(n=99) {
  const rows=state.sales.slice(-n).reverse();
  return `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Total</th><th>Pagado</th><th>Estado</th><th></th></tr></thead><tbody>${rows.map(s=>`<tr><td><b>${escapeHtml(s.customer)}</b><br><span class="muted">${escapeHtml(s.id)}</span></td><td>${money(s.total,s.currency)}</td><td>${money(s.paid,s.currency)}</td><td><span class="badge ${s.paid>=s.total?'green':'orange'}">${s.paid>=s.total?'Pagada':'Pendiente'}</span></td><td>${s.paid<s.total?`<button class="primary small" onclick="openPayment('${s.id}')">ABONO</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">No hay ventas todavía.</td></tr>'}</tbody></table></div>`;
}

function sales(c){c.innerHTML=`<div class="section-title"><h2>TODAS LAS VENTAS</h2><button class="primary" onclick="openSale()">+ NUEVA VENTA</button></div>${saleTable()}`;}

function inventory(c){
  c.innerHTML=`<div class="section-title"><h2>PRODUCTOS</h2><button class="primary" onclick="openProduct()">+ PRODUCTO</button></div><div class="product-list">${state.products.map(p=>`<div class="card product"><div class="label">${escapeHtml(p.category)}</div><h3>${escapeHtml(p.name)}</h3><div class="stock">${Number(p.stock)} <span class="muted">unidades</span></div><div class="muted">Venta: ${money(p.price,p.currency)} · Costo: ${money(p.cost,p.currency)}</div><div class="bar"><span style="width:${Math.min(Number(p.stock)*10,100)}%"></span></div></div>`).join('')||'<div class="card muted">No hay productos.</div>'}</div>`;
}

function finance(c){
  const crc=totals('CRC'),usd=totals('USD');
  c.innerHTML=`<div class="grid three"><div class="card"><div class="label">Ingresos CRC</div><div class="metric">${money(crc.total)}</div></div><div class="card"><div class="label">Ingresos USD</div><div class="metric">${money(usd.total,'USD')}</div></div><div class="card"><div class="label">Gastos CRC / USD</div><div class="metric">${money(crc.expenses)} · ${money(usd.expenses,'USD')}</div></div></div><div class="section-title"><h2>GASTOS</h2><button class="primary" onclick="openExpense()">+ GASTO</button></div><div class="table-wrap"><table><thead><tr><th>Concepto</th><th>Monto</th><th>Fecha</th></tr></thead><tbody>${state.expenses.slice().reverse().map(x=>`<tr><td>${escapeHtml(x.note)}</td><td>${money(x.amount,x.currency)}</td><td>${String(x.created_at||'').slice(0,10)}</td></tr>`).join('')||'<tr><td colspan="3" class="muted">No hay gastos.</td></tr>'}</tbody></table></div>`;
}

function customers(c){c.innerHTML=`<div class="section-title"><h2>CLIENTES</h2><button class="primary" onclick="openCustomer()">+ CLIENTE</button></div><div class="product-list">${state.customers.map(x=>`<div class="card"><h3>${escapeHtml(x.name)}</h3><div class="muted">${escapeHtml(x.phone||'Sin teléfono')}</div>${x.email?`<div class="muted">${escapeHtml(x.email)}</div>`:''}</div>`).join('')||'<div class="card muted">Agrega tu primer cliente.</div>'}</div>`;}

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

function receiptText(s,amount){return `HYPEFRIENDS BUSINESS\nCOMPROBANTE DE PAGO\n\nCliente: ${s.customer}\nVenta: ${s.id}\nPago recibido: ${money(amount,s.currency)}\nTotal compra: ${money(s.total,s.currency)}\nTotal abonado: ${money(s.paid,s.currency)}\nSaldo pendiente: ${money(Number(s.total)-Number(s.paid),s.currency)}\n\nSIN INTERESES\nGracias por comprar en HYPEFRIENDS.`;}

function showReceipt(s,amount){
  modal(`<div class="receipt" id="receiptPreview"><div class="receipt-head">HYPEFRIENDS</div><div class="muted">STREETWEAR & DROPS · COMPROBANTE DE PAGO</div><hr><div class="receipt-row"><span>Cliente</span><b>${escapeHtml(s.customer)}</b></div><div class="receipt-row"><span>Venta</span><b>${escapeHtml(s.id)}</b></div><div class="receipt-row"><span>Pago recibido</span><b>${money(amount,s.currency)}</b></div><div class="receipt-row"><span>Total compra</span><b>${money(s.total,s.currency)}</b></div><div class="receipt-row"><span>Total abonado</span><b>${money(s.paid,s.currency)}</b></div><hr><div class="receipt-row"><span>Saldo pendiente</span><b class="receipt-total">${money(Number(s.total)-Number(s.paid),s.currency)}</b></div><hr><b>SIN INTERESES</b><p class="muted">Gracias por comprar en HYPEFRIENDS.</p></div><div class="actions" style="margin-top:14px"><button class="primary" onclick="shareReceiptImage('${s.id}',${Number(amount)})">📲 COMPARTIR IMAGEN</button><button class="outline light-button" onclick="shareReceiptText('${s.id}',${Number(amount)})">WHATSAPP / TEXTO</button><button class="outline light-button" onclick="closeModal()">CERRAR</button></div>`);
}

function buildReceiptCanvas(s,amount){
  const canvas=document.createElement('canvas'); canvas.width=900; canvas.height=1120;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#090909'; ctx.textAlign='left';
  ctx.font='900 48px Arial'; ctx.fillText('HYPEFRIENDS',60,90);
  ctx.font='700 22px Arial'; ctx.fillText('BUSINESS · COMPROBANTE DE PAGO',60,135);
  ctx.strokeStyle='#cccccc'; ctx.setLineDash([8,8]); ctx.beginPath(); ctx.moveTo(60,175); ctx.lineTo(840,175); ctx.stroke(); ctx.setLineDash([]);
  const rows=[['Cliente',s.customer],['Venta',s.id],['Pago recibido',money(amount,s.currency)],['Total compra',money(s.total,s.currency)],['Total abonado',money(s.paid,s.currency)],['Saldo pendiente',money(Number(s.total)-Number(s.paid),s.currency)]];
  let y=240; ctx.font='500 25px Arial';
  rows.forEach(([a,b],i)=>{ctx.fillStyle='#777';ctx.fillText(a,60,y);ctx.fillStyle='#090909';ctx.font=i===5?'900 38px Arial':'700 26px Arial';ctx.fillText(String(b),840,y,{align:'right'});ctx.textAlign='left';y+=95;ctx.font='500 25px Arial';});
  ctx.strokeStyle='#cccccc';ctx.beginPath();ctx.moveTo(60,y-40);ctx.lineTo(840,y-40);ctx.stroke();
  ctx.font='900 28px Arial';ctx.fillStyle='#090909';ctx.fillText('SIN INTERESES',60,y+25);
  ctx.font='500 21px Arial';ctx.fillStyle='#777';ctx.fillText('Gracias por comprar en HYPEFRIENDS.',60,y+70);
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

function openProduct(){modal(`<h2>NUEVO PRODUCTO</h2><div class="form"><label>Nombre<input id="pName" required></label><div class="form-grid"><label>Categoría<input id="pCat" value="General"></label><label>Stock<input id="pStock" type="number" value="1" min="0"></label><label>Costo<input id="pCost" type="number" value="0" min="0" step="0.01"></label><label>Precio<input id="pPrice" type="number" value="0" min="0" step="0.01"></label></div><label>Moneda<select id="pCurrency"><option value="CRC">₡ Colones</option><option value="USD">$ Dólares</option></select></label><button class="primary" onclick="createProduct()">GUARDAR PRODUCTO</button></div>`);}

async function createProduct(){
  const row={name:$('#pName').value.trim()||'Producto',category:$('#pCat').value.trim()||'General',stock:Number($('#pStock').value||0),cost:Number($('#pCost').value||0),price:Number($('#pPrice').value||0),currency:$('#pCurrency').value};
  const {error}=await db.from('products').insert(row); if(error){console.error(error);return toast('No se pudo guardar el producto');}
  await loadAll();closeModal();render('inventory');toast('PRODUCTO GUARDADO EN LA NUBE');
}

function openExpense(){modal(`<h2>REGISTRAR GASTO</h2><div class="form"><label>Concepto<input id="eNote" placeholder="Compra de mercadería, envío..."></label><label>Monto<input id="eAmount" type="number" min="0" step="0.01"></label><label>Moneda<select id="eCurrency"><option value="CRC">₡ Colones</option><option value="USD">$ Dólares</option></select></label><button class="primary" onclick="createExpense()">GUARDAR GASTO</button></div>`);}

async function createExpense(){
  const row={note:$('#eNote').value.trim()||'Gasto',amount:Number($('#eAmount').value||0),currency:$('#eCurrency').value,created_by:state.user.id};
  if(row.amount<=0)return toast('Monto inválido');
  const {error}=await db.from('expenses').insert(row); if(error){console.error(error);return toast('No se pudo guardar el gasto');}
  await loadAll();closeModal();render('finance');toast('GASTO REGISTRADO EN LA NUBE');
}

function openCustomer(){modal(`<h2>NUEVO CLIENTE</h2><div class="form"><label>Nombre<input id="cName" required></label><label>Teléfono<input id="cPhone" type="tel"></label><label>Correo<input id="cEmail" type="email"></label><button class="primary" onclick="createCustomer()">GUARDAR CLIENTE</button></div>`);}

async function createCustomer(){
  const row={name:$('#cName').value.trim()||'Cliente',phone:$('#cPhone').value.trim()||null,email:$('#cEmail').value.trim()||null};
  const {error}=await db.from('customers').insert(row); if(error){console.error(error);return toast('No se pudo guardar el cliente');}
  await loadAll();closeModal();render('customers');toast('CLIENTE GUARDADO EN LA NUBE');
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;});
async function installApp(){if(deferredPrompt){deferredPrompt.prompt();deferredPrompt=null;}else toast('En iPhone usa Compartir → Agregar a pantalla de inicio');}

boot();
