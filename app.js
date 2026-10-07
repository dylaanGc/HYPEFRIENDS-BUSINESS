/* =========================================================
   HYPEFRIENDS BUSINESS
   SUPABASE + MULTI DISPOSITIVO + REALTIME + AUTO SYNC
   ========================================================= */

const SUPABASE_URL = 'https://ynowgseafpcfgvsmkub.supabase.co';

const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_2DSB2bN-_Q4JAm5WO4QruA_E4sXrEuH';


// =========================================================
// SUPABASE
// =========================================================

if (
  !window.supabase ||
  typeof window.supabase.createClient !== 'function'
) {
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.querySelector('#loginError');

    if (el) {
      el.textContent =
        'No se pudo cargar Supabase. Recarga la página.';
    }
  });

  throw new Error('Supabase JS no cargó');
}


const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    },

    realtime: {
      params: {
        eventsPerSecond: 10
      }
    }
  }
);


// =========================================================
// ESTADO
// =========================================================

const state = {

  user: null,

  session: null,

  sales: [],

  products: [],

  expenses: [],

  customers: [],

  view: 'dashboard',

  realtime: null,

  syncTimer: null,

  loading: false

};


// =========================================================
// PRODUCTOS INICIALES
// =========================================================

const DEFAULT_PRODUCTS = [

  {
    name: 'CORE HOODIE',
    category: 'Hoodie',
    stock: 5,
    cost: 30000,
    price: 48000,
    currency: 'CRC'
  },

  {
    name: 'SHORT CORTEIZ',
    category: 'Shorts',
    stock: 8,
    cost: 15000,
    price: 25000,
    currency: 'CRC'
  },

  {
    name: 'CAP CHROME HEARTS',
    category: 'Gorra',
    stock: 9,
    cost: 9000,
    price: 15000,
    currency: 'CRC'
  },

  {
    name: 'CAMISETA CHROME HEARTS',
    category: 'Camiseta',
    stock: 15,
    cost: 15000,
    price: 28000,
    currency: 'CRC'
  }

];


// =========================================================
// UTILIDADES
// =========================================================

const $ = selector =>
  document.querySelector(selector);


const money = (n, currency = 'CRC') => {

  const value = Number(n || 0);

  if (currency === 'USD') {

    return '$' +
      value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });

  }

  return '₡' +
    Math.round(value).toLocaleString('es-CR');

};


const today = () =>
  new Date().toISOString().slice(0, 10);


const escapeHtml = value =>
  String(value ?? '').replace(
    /[&<>'"]/g,
    ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[ch])
  );


const toast = message => {

  const t = $('#toast');

  if (!t) return;

  t.textContent = message;

  t.classList.add('show');

  setTimeout(() => {
    t.classList.remove('show');
  }, 2200);

};


// =========================================================
// ESTADO DE SINCRONIZACIÓN
// =========================================================

function setSync(ok, text) {

  const dot = $('#syncDot');

  const label = $('#syncText');

  if (dot) {

    dot.style.background =
      ok ? '#4caf74' : '#c86643';

  }

  if (label) {

    label.textContent = text;

  }

}


// =========================================================
// LOGIN
// =========================================================

function showLogin(show = true) {

  const login = $('#loginScreen');

  const app = $('#app');

  if (login) {

    login.classList.toggle(
      'hidden',
      !show
    );

  }

  if (app) {

    app.classList.toggle(
      'app-visible',
      !show
    );

    app.classList.toggle(
      'hidden-app',
      show
    );

  }

}


// =========================================================
// BOOT
// =========================================================

async function boot() {

  console.log('================================');
  console.log('HYPEFRIENDS BUSINESS');
  console.log('Supabase iniciado');
  console.log('URL:', SUPABASE_URL);
  console.log('================================');


  const loginForm = $('#loginForm');

  if (loginForm) {

    loginForm.addEventListener(
      'submit',
      login
    );

  }


  const logoutBtn = $('#logoutBtn');

  if (logoutBtn) {

    logoutBtn.addEventListener(
      'click',
      logout
    );

  }


  const closeModalBtn = $('#closeModal');

  if (closeModalBtn) {

    closeModalBtn.onclick =
      closeModal;

  }


  const newSaleBtn = $('#newSaleBtn');

  if (newSaleBtn) {

    newSaleBtn.onclick =
      openSale;

  }


  const installBtn = $('#installBtn');

  if (installBtn) {

    installBtn.onclick =
      installApp;

  }


  document
    .querySelectorAll('.nav')
    .forEach(button => {

      button.onclick = () =>
        render(button.dataset.view);

    });


  // -------------------------------------------------------
  // SESIÓN
  // -------------------------------------------------------

  const {
    data: {
      session
    }
  } = await db.auth.getSession();


  console.log(
    'Sesión encontrada:',
    !!session
  );


  if (session) {

    await startApp(session);

  }


  // -------------------------------------------------------
  // CAMBIOS DE LOGIN
  // -------------------------------------------------------

  db.auth.onAuthStateChange(
    (_event, sessionNow) => {

      console.log(
        'Auth:',
        _event
      );


      setTimeout(() => {

        if (sessionNow) {

          if (
            !state.session ||
            state.session.access_token !==
            sessionNow.access_token
          ) {

            startApp(sessionNow);

          }

        } else {

          stopApp();

        }

      }, 0);

    }
  );


  // -------------------------------------------------------
  // SERVICE WORKER
  // -------------------------------------------------------

  if ('serviceWorker' in navigator) {

    try {

      const registration =
        await navigator.serviceWorker.register(
          './sw.js',
          {
            updateViaCache: 'none'
          }
        );

      console.log(
        'Service Worker:',
        registration
      );

      await registration.update();

    } catch (error) {

      console.error(
        'Error Service Worker:',
        error
      );

    }

  }

}


// =========================================================
// LOGIN
// =========================================================

async function login(e) {

  e.preventDefault();


  const email =
    $('#loginEmail')?.value.trim();

  const password =
    $('#loginPassword')?.value;


  if ($('#loginError')) {

    $('#loginError').textContent =
      'Conectando...';

  }


  if (!email || !password) {

    if ($('#loginError')) {

      $('#loginError').textContent =
        'Escribe el correo y la contraseña.';

    }

    return;

  }


  try {

    const {
      data,
      error
    } = await db.auth.signInWithPassword({
      email,
      password
    });


    if (error) {

      console.error(
        'Supabase login:',
        error
      );


      if ($('#loginError')) {

        $('#loginError').textContent =
          error.message;

      }

      return;

    }


    console.log(
      'Login correcto'
    );


    if (data?.session) {

      await startApp(
        data.session
      );

    }

  } catch (error) {

    console.error(
      error
    );


    if ($('#loginError')) {

      $('#loginError').textContent =
        error.message ||
        'Error inesperado';

    }

  }

}


// =========================================================
// LOGOUT
// =========================================================

async function logout() {

  stopAutoSync();

  if (state.realtime) {

    await db.removeChannel(
      state.realtime
    );

    state.realtime = null;

  }


  await db.auth.signOut();

}


// =========================================================
// START APP
// =========================================================

async function startApp(session) {

  console.log(
    'Iniciando aplicación...'
  );


  state.session = session;

  state.user = session.user;


  const email =
    state.user.email ||
    'Usuario';


  if ($('#userEmail')) {

    $('#userEmail').textContent =
      email;

  }


  showLogin(false);


  setSync(
    true,
    'Conectando con Supabase...'
  );


  await ensureProfile();


  await loadAll();


  subscribeRealtime();


  startAutoSync();


  render(state.view);


  setSync(
    true,
    'Sincronizado con Supabase'
  );


  console.log(
    'Aplicación lista'
  );

}


// =========================================================
// STOP APP
// =========================================================

function stopApp() {

  stopAutoSync();


  if (state.realtime) {

    db.removeChannel(
      state.realtime
    );

  }


  state.realtime = null;

  state.user = null;

  state.session = null;

  state.sales = [];

  state.products = [];

  state.expenses = [];

  state.customers = [];


  showLogin(true);

}


// =========================================================
// PERFIL
// =========================================================

async function ensureProfile() {

  if (!state.user) return;


  const {
    error
  } = await db
    .from('profiles')
    .upsert(
      {
        id: state.user.id,

        name:
          state.user.user_metadata?.name ||
          state.user.email?.split('@')[0] ||
          'Socio'
      },
      {
        onConflict: 'id'
      }
    );


  if (error) {

    console.warn(
      'Profile:',
      error.message
    );

  }

}


// =========================================================
// CARGAR TODO
// =========================================================

async function loadAll() {

  if (!state.user) return;


  if (state.loading) {

    return;

  }


  state.loading = true;


  try {

    setSync(
      true,
      'Actualizando datos...'
    );


    const [

      productsResult,

      customersResult,

      expensesResult,

      salesResult

    ] = await Promise.all([

      db
        .from('products')
        .select('*')
        .order(
          'created_at',
          {
            ascending: true
          }
        ),

      db
        .from('customers')
        .select('*')
        .order(
          'created_at',
          {
            ascending: true
          }
        ),

      db
        .from('expenses')
        .select('*')
        .order(
          'created_at',
          {
            ascending: true
          }
        ),

      db
        .from('sales')
        .select(`
          *,
          customers(name,phone,email),
          sale_items(*,products(name)),
          payments(*)
        `)
        .order(
          'created_at',
          {
            ascending: true
          }
        )

    ]);


    // -----------------------------------------------------
    // ERRORES
    // -----------------------------------------------------

    if (productsResult.error) {

      console.error(
        'PRODUCTS ERROR:',
        productsResult.error
      );

    }


    if (customersResult.error) {

      console.error(
        'CUSTOMERS ERROR:',
        customersResult.error
      );

    }


    if (expensesResult.error) {

      console.error(
        'EXPENSES ERROR:',
        expensesResult.error
      );

    }


    if (salesResult.error) {

      console.error(
        'SALES ERROR:',
        salesResult.error
      );

    }


    // -----------------------------------------------------
    // GUARDAR ESTADO
    // -----------------------------------------------------

    state.products =
      productsResult.data || [];


    state.customers =
      customersResult.data || [];


    state.expenses =
      expensesResult.data || [];


    state.sales =
      (salesResult.data || []).map(
        sale => ({

          ...sale,

          customer:
            sale.customers?.name ||
            'Cliente',

          payments:
            (sale.payments || [])
              .sort(
                (a, b) =>
                  String(
                    a.created_at
                  ).localeCompare(
                    String(
                      b.created_at
                    )
                  )
              )

        })
      );


    // -----------------------------------------------------
    // PRODUCTOS INICIALES
    // -----------------------------------------------------

    if (
      !state.products.length
    ) {

      await seedProducts();

    }


    console.log(
      'Datos cargados:',
      {
        products:
          state.products.length,

        customers:
          state.customers.length,

        expenses:
          state.expenses.length,

        sales:
          state.sales.length
      }
    );


    setSync(
      true,
      'Sincronizado'
    );


  } catch (error) {

    console.error(
      'LOAD ALL ERROR:',
      error
    );


    setSync(
      false,
      'Error de sincronización'
    );


  } finally {

    state.loading = false;

  }

}


// =========================================================
// PRODUCTOS INICIALES
// =========================================================

async function seedProducts() {

  const {
    data,
    error
  } = await db
    .from('products')
    .insert(
      DEFAULT_PRODUCTS
    )
    .select();


  if (!error) {

    state.products =
      data || [];

  } else {

    console.warn(
      'Seed products:',
      error.message
    );

  }

}


// =========================================================
// REALTIME
// =========================================================

function subscribeRealtime() {

  console.log(
    'Configurando Supabase Realtime...'
  );


  if (state.realtime) {

    db.removeChannel(
      state.realtime
    );

    state.realtime = null;

  }


  const channelName =
    'hypefriends-sync-' +
    state.user.id +
    '-' +
    Math.random()
      .toString(36)
      .slice(2);


  const channel =
    db.channel(channelName);


  const tables = [

    'products',

    'customers',

    'sales',

    'sale_items',

    'payments',

    'expenses'

  ];


  tables.forEach(table => {

    channel.on(

      'postgres_changes',

      {

        event: '*',

        schema: 'public',

        table: table

      },

      payload => {

        console.log(
          '🔄 REALTIME:',
          table,
          payload
        );


        // No esperamos a que termine
        // para evitar bloquear otros eventos.

        loadAll()
          .then(() => {

            render(
              state.view
            );

          });

      }

    );

  });


  state.realtime =
    channel.subscribe(
      status => {

        console.log(
          '📡 SUPABASE REALTIME:',
          status
        );


        if (
          status === 'SUBSCRIBED'
        ) {

          setSync(
            true,
            'Tiempo real conectado'
          );


          console.log(
            '✅ REALTIME CONECTADO'
          );

        }


        if (
          status ===
          'CHANNEL_ERROR'
        ) {

          setSync(
            false,
            'Realtime con error'
          );


          console.error(
            '❌ REALTIME ERROR'
          );

        }


        if (
          status ===
          'TIMED_OUT'
        ) {

          setSync(
            false,
            'Realtime agotado'
          );

        }


        if (
          status === 'CLOSED'
        ) {

          setSync(
            false,
            'Realtime cerrado'
          );

        }

      }
    );

}


// =========================================================
// SINCRONIZACIÓN AUTOMÁTICA
// =========================================================

function startAutoSync() {

  stopAutoSync();


  console.log(
    '🔁 Auto Sync iniciado'
  );


  state.syncTimer =
    setInterval(
      async () => {

        if (
          !state.user
        ) {

          return;

        }


        console.log(
          '🔄 Auto Sync...'
        );


        await loadAll();


        render(
          state.view
        );

      },

      3000

    );

}


function stopAutoSync() {

  if (
    state.syncTimer
  ) {

    clearInterval(
      state.syncTimer
    );

    state.syncTimer = null;

  }

}


// =========================================================
// TOTALES
// =========================================================

function totals(currency) {

  const sales =
    state.sales.filter(
      s =>
        s.currency ===
        currency
    );


  const total =
    sales.reduce(
      (a, s) =>
        a +
        Number(
          s.total || 0
        ),
      0
    );


  const paid =
    sales.reduce(
      (a, s) =>
        a +
        Number(
          s.paid || 0
        ),
      0
    );


  const expenses =
    state.expenses
      .filter(
        e =>
          e.currency ===
          currency
      )
      .reduce(
        (a, e) =>
          a +
          Number(
            e.amount || 0
          ),
        0
      );


  return {

    total,

    paid,

    due:
      Math.max(
        total - paid,
        0
      ),

    expenses

  };

}


// =========================================================
// RENDER
// =========================================================

function render(
  view = 'dashboard'
) {

  state.view = view;


  document
    .querySelectorAll('.nav')
    .forEach(button => {

      button.classList.toggle(
        'active',
        button.dataset.view ===
        view
      );

    });


  if ($('#viewTitle')) {

    $('#viewTitle').textContent = {

      dashboard:
        'DASHBOARD',

      sales:
        'VENTAS',

      inventory:
        'INVENTARIO',

      finance:
        'FINANZAS',

      customers:
        'CLIENTES',

      history:
        'HISTORIAL'

    }[view] ||
      'DASHBOARD';

  }


  const content =
    $('#content');


  if (!content) return;


  if (
    view === 'dashboard'
  ) {

    dashboard(content);

  }


  if (
    view === 'sales'
  ) {

    sales(content);

  }


  if (
    view === 'inventory'
  ) {

    inventory(content);

  }


  if (
    view === 'finance'
  ) {

    finance(content);

  }


  if (
    view === 'customers'
  ) {

    customers(content);

  }


  if (
    view === 'history'
  ) {

    history(content);

  }

}


// =========================================================
// DASHBOARD
// =========================================================

function dashboard(c) {

  const crc =
    totals('CRC');

  const usd =
    totals('USD');


  const stock =
    state.products.reduce(
      (a, p) =>
        a +
        Number(
          p.stock || 0
        ),
      0
    );


  c.innerHTML = `

    <div class="grid stats">

      <div class="card">
        <div class="label">
          Ventas CRC
        </div>

        <div class="metric">
          ${money(crc.total,'CRC')}
        </div>
      </div>


      <div class="card">

        <div class="label">
          Cobrado CRC
        </div>

        <div class="metric orange">
          ${money(crc.paid,'CRC')}
        </div>

      </div>


      <div class="card">

        <div class="label">
          Ventas USD
        </div>

        <div class="metric">
          ${money(usd.total,'USD')}
        </div>

      </div>


      <div class="card">

        <div class="label">
          Stock total
        </div>

        <div class="metric">
          ${stock}
        </div>

      </div>

    </div>


    <div class="grid two">

      <div>

        <div class="section-title">

          <h2>
            ÚLTIMAS VENTAS
          </h2>

          <button
            class="primary small"
            onclick="openSale()"
          >
            + VENTA
          </button>

        </div>

        ${saleTable(5)}

      </div>


      <div>

        <div class="section-title">

          <h2>
            RESUMEN
          </h2>

        </div>


        <div class="grid">

          <div class="card">

            <div class="label">
              Por cobrar CRC
            </div>

            <div class="metric orange">
              ${money(crc.due,'CRC')}
            </div>

          </div>


          <div class="card">

            <div class="label">
              Por cobrar USD
            </div>

            <div class="metric orange">
              ${money(usd.due,'USD')}
            </div>

          </div>


          <div class="card">

            <div class="label">
              Gastos CRC / USD
            </div>

            <div class="metric">
              ${money(crc.expenses,'CRC')}
              ·
              ${money(usd.expenses,'USD')}
            </div>

          </div>


          <div class="card">

            <div class="label">
              Productos con stock bajo
            </div>

            <div class="metric">
              ${
                state.products.filter(
                  p =>
                    Number(p.stock) <= 3
                ).length
              }
            </div>

          </div>

        </div>

      </div>

    </div>

  `;

}


// =========================================================
// TABLA VENTAS
// =========================================================

function saleTable(n = 99) {

  const rows =
    state.sales
      .slice(-n)
      .reverse();


  return `

    <div class="table-wrap">

      <table>

        <thead>

          <tr>

            <th>
              Cliente
            </th>

            <th>
              Total
            </th>

            <th>
              Pagado
            </th>

            <th>
              Estado
            </th>

            <th></th>

          </tr>

        </thead>


        <tbody>

          ${
            rows.map(
              s => `

                <tr>

                  <td>

                    <b>
                      ${escapeHtml(
                        s.customer
                      )}
                    </b>

                    <br>

                    <span class="muted">
                      ${escapeHtml(
                        s.id
                      )}
                    </span>

                  </td>


                  <td>
                    ${money(
                      s.total,
                      s.currency
                    )}
                  </td>


                  <td>
                    ${money(
                      s.paid,
                      s.currency
                    )}
                  </td>


                  <td>

                    <span
                      class="badge ${
                        s.paid >= s.total
                          ? 'green'
                          : 'orange'
                      }"
                    >

                      ${
                        s.paid >= s.total
                          ? 'Pagada'
                          : 'Pendiente'
                      }

                    </span>

                  </td>


                  <td>

                    ${
                      s.paid < s.total

                        ? `

                          <button
                            class="primary small"
                            onclick="openPayment('${s.id}')"
                          >
                            ABONO
                          </button>

                        `

                        : ''

                    }

                  </td>

                </tr>

              `
            ).join('')
          }


          ${
            !rows.length

              ? `

                <tr>

                  <td
                    colspan="5"
                    class="muted"
                  >
                    No hay ventas todavía.
                  </td>

                </tr>

              `

              : ''

          }

        </tbody>

      </table>

    </div>

  `;

}


// =========================================================
// VENTAS
// =========================================================

function sales(c) {

  c.innerHTML = `

    <div class="section-title">

      <h2>
        TODAS LAS VENTAS
      </h2>

      <button
        class="primary"
        onclick="openSale()"
      >
        + NUEVA VENTA
      </button>

    </div>

    ${saleTable()}

  `;

}


// =========================================================
// INVENTARIO
// =========================================================

function inventory(c) {

  c.innerHTML = `

    <div class="section-title">

      <h2>
        PRODUCTOS
      </h2>

      <button
        class="primary"
        onclick="openProduct()"
      >
        + PRODUCTO
      </button>

    </div>


    <div class="product-list">

      ${
        state.products.map(
          p => `

            <div class="card product">

              <div class="label">
                ${escapeHtml(
                  p.category
                )}
              </div>

              <h3>
                ${escapeHtml(
                  p.name
                )}
              </h3>

              <div class="stock">

                ${Number(
                  p.stock
                )}

                <span class="muted">
                  unidades
                </span>

              </div>

              <div class="muted">

                Venta:
                ${money(
                  p.price,
                  p.currency
                )}

                ·

                Costo:
                ${money(
                  p.cost,
                  p.currency
                )}

              </div>

              <div class="bar">

                <span
                  style="
                    width:${Math.min(
                      Number(p.stock) * 10,
                      100
                    )}%
                  "
                ></span>

              </div>

            </div>

          `
        ).join('')
      }


      ${
        !state.products.length

          ? `

            <div class="card muted">
              No hay productos.
            </div>

          `

          : ''

      }

    </div>

  `;

}


// =========================================================
// FINANZAS
// =========================================================

function finance(c) {

  const crc =
    totals('CRC');

  const usd =
    totals('USD');


  c.innerHTML = `

    <div class="grid three">

      <div class="card">

        <div class="label">
          Ingresos CRC
        </div>

        <div class="metric">
          ${money(
            crc.total,
            'CRC'
          )}
        </div>

      </div>


      <div class="card">

        <div class="label">
          Ingresos USD
        </div>

        <div class="metric">
          ${money(
            usd.total,
            'USD'
          )}
        </div>

      </div>


      <div class="card">

        <div class="label">
          Gastos CRC / USD
        </div>

        <div class="metric">

          ${money(
            crc.expenses,
            'CRC'
          )}

          ·

          ${money(
            usd.expenses,
            'USD'
          )}

        </div>

      </div>

    </div>


    <div class="section-title">

      <h2>
        GASTOS
      </h2>

      <button
        class="primary"
        onclick="openExpense()"
      >
        + GASTO
      </button>

    </div>


    <div class="table-wrap">

      <table>

        <thead>

          <tr>

            <th>
              Concepto
            </th>

            <th>
              Monto
            </th>

            <th>
              Fecha
            </th>

          </tr>

        </thead>


        <tbody>

          ${
            state.expenses
              .slice()
              .reverse()
              .map(
                x => `

                  <tr>

                    <td>
                      ${escapeHtml(
                        x.note
                      )}
                    </td>

                    <td>
                      ${money(
                        x.amount,
                        x.currency
                      )}
                    </td>

                    <td>
                      ${String(
                        x.created_at || ''
                      ).slice(0,10)}
                    </td>

                  </tr>

                `
              )
              .join('')
          }


          ${
            !state.expenses.length

              ? `

                <tr>

                  <td
                    colspan="3"
                    class="muted"
                  >
                    No hay gastos.
                  </td>

                </tr>

              `

              : ''

          }

        </tbody>

      </table>

    </div>

  `;

}


// =========================================================
// CLIENTES
// =========================================================

function customers(c) {

  c.innerHTML = `

    <div class="section-title">

      <h2>
        CLIENTES
      </h2>

      <button
        class="primary"
        onclick="openCustomer()"
      >
        + CLIENTE
      </button>

    </div>


    <div class="product-list">

      ${
        state.customers.map(
          x => `

            <div class="card">

              <h3>
                ${escapeHtml(
                  x.name
                )}
              </h3>

              <div class="muted">
                ${escapeHtml(
                  x.phone ||
                  'Sin teléfono'
                )}
              </div>

              ${
                x.email

                  ? `

                    <div class="muted">
                      ${escapeHtml(
                        x.email
                      )}
                    </div>

                  `

                  : ''

              }

            </div>

          `
        ).join('')
      }


      ${
        !state.customers.length

          ? `

            <div class="card muted">
              Agrega tu primer cliente.
            </div>

          `

          : ''

      }

    </div>

  `;

}


// =========================================================
// HISTORIAL
// =========================================================

function history(c) {

  const rows = [];


  state.sales.forEach(
    sale => {

      sale.payments.forEach(
        payment => {

          rows.push({

            type: 'Pago',

            desc:
              `${sale.customer} · ${sale.id}`,

            amount:
              payment.amount,

            currency:
              payment.currency ||
              sale.currency,

            date:
              String(
                payment.created_at ||
                ''
              ).slice(0,10)

          });

        }
      );

    }
  );


  state.expenses.forEach(
    expense => {

      rows.push({

        type: 'Gasto',

        desc:
          expense.note,

        amount:
          expense.amount,

        currency:
          expense.currency,

        date:
          String(
            expense.created_at ||
            ''
          ).slice(0,10)

      });

    }
  );


  rows.sort(
    (a,b) =>
      b.date.localeCompare(
        a.date
      )
  );


  c.innerHTML = `

    <div class="section-title">

      <h2>
        MOVIMIENTOS
      </h2>

    </div>


    <div class="table-wrap">

      <table>

        <thead>

          <tr>

            <th>
              Tipo
            </th>

            <th>
              Detalle
            </th>

            <th>
              Monto
            </th>

            <th>
              Fecha
            </th>

          </tr>

        </thead>


        <tbody>

          ${
            rows.map(
              r => `

                <tr>

                  <td>

                    <span class="badge">
                      ${r.type}
                    </span>

                  </td>

                  <td>
                    ${escapeHtml(
                      r.desc
                    )}
                  </td>

                  <td>
                    ${money(
                      r.amount,
                      r.currency
                    )}
                  </td>

                  <td>
                    ${r.date}
                  </td>

                </tr>

              `
            ).join('')
          }


          ${
            !rows.length

              ? `

                <tr>

                  <td
                    colspan="4"
                    class="muted"
                  >
                    No hay movimientos.
                  </td>

                </tr>

              `

              : ''

          }

        </tbody>

      </table>

    </div>

  `;

}


// =========================================================
// MODAL
// =========================================================

function modal(html) {

  const content =
    $('#modalContent');

  const modalElement =
    $('#modal');


  if (!content ||
      !modalElement) {

    return;

  }


  content.innerHTML =
    html;


  modalElement.classList.remove(
    'hidden'
  );

}


function closeModal() {

  $('#modal')?.classList.add(
    'hidden'
  );

}


// =========================================================
// NUEVA VENTA
// =========================================================

function openSale() {

  if (
    !state.products.length
  ) {

    return toast(
      'Primero agrega un producto'
    );

  }


  modal(`

    <h2>
      NUEVA VENTA
    </h2>


    <div class="form">

      <label>

        Cliente

        <select id="fCustomer">

          <option value="">
            Cliente nuevo / sin registrar
          </option>

          ${
            state.customers.map(
              c => `

                <option
                  value="${c.id}"
                >
                  ${escapeHtml(
                    c.name
                  )}
                </option>

              `
            ).join('')
          }

        </select>

      </label>


      <label>

        Producto

        <select id="fProduct">

          ${
            state.products.map(
              p => `

                <option
                  value="${p.id}"
                >
                  ${escapeHtml(
                    p.name
                  )}
                  —
                  ${money(
                    p.price,
                    p.currency
                  )}
                  —
                  stock ${p.stock}
                </option>

              `
            ).join('')
          }

        </select>

      </label>


      <div class="form-grid">

        <label>

          Cantidad

          <input
            id="fQty"
            type="number"
            min="1"
            value="1"
          >

        </label>


        <label>

          Pago recibido

          <input
            id="fPaid"
            type="number"
            min="0"
            value="0"
          >

        </label>

      </div>


      <div class="total-box">

        TOTAL

        <strong id="saleTotal">
          ₡0
        </strong>

        <small id="saleCurrencyHint"></small>

      </div>


      <button
        class="primary"
        onclick="createSale()"
      >
        REGISTRAR VENTA
      </button>

    </div>

  `);


  [
    'fProduct',
    'fQty'
  ].forEach(
    id => {

      $('#' + id)
        ?.addEventListener(
          'input',
          updateSaleTotal
        );

    }
  );


  updateSaleTotal();

}


// =========================================================
// TOTAL VENTA
// =========================================================

function updateSaleTotal() {

  const product =
    state.products.find(
      x =>
        x.id ===
        $('#fProduct')?.value
    );


  if (!product) return;


  const quantity =
    Number(
      $('#fQty')?.value ||
      1
    );


  if ($('#saleTotal')) {

    $('#saleTotal').textContent =
      money(
        Number(product.price) *
        quantity,
        product.currency
      );

  }


  if ($('#saleCurrencyHint')) {

    $('#saleCurrencyHint')
      .textContent =
      `Moneda de la venta: ${
        product.currency === 'USD'
          ? 'Dólares'
          : 'Colones'
      }`;

  }

}


// =========================================================
// CREAR VENTA
// =========================================================

async function createSale() {

  const product =
    state.products.find(
      x =>
        x.id ===
        $('#fProduct').value
    );


  const quantity =
    Number(
      $('#fQty').value
    );


  const paid =
    Number(
      $('#fPaid').value ||
      0
    );


  const customerId =
    $('#fCustomer').value ||
    null;


  if (
    !product ||
    quantity <= 0
  ) {

    return toast(
      'Datos de venta inválidos'
    );

  }


  if (
    quantity >
    Number(product.stock)
  ) {

    return toast(
      'No hay suficiente stock'
    );

  }


  const total =
    Number(product.price) *
    quantity;


  const realPaid =
    Math.min(
      Math.max(
        paid,
        0
      ),
      total
    );


  const status =
    realPaid >= total
      ? 'paid'
      : 'pending';


  setSync(
    true,
    'Guardando venta...'
  );


  const {
    data: sale,
    error: saleError
  } =
    await db
      .from('sales')
      .insert({

        customer_id:
          customerId,

        total,

        paid:
          realPaid,

        currency:
          product.currency,

        status,

        created_by:
          state.user.id

      })
      .select()
      .single();


  if (saleError) {

    console.error(
      saleError
    );

    return toast(
      'No se pudo registrar la venta'
    );

  }


  const {
    error: itemError
  } =
    await db
      .from('sale_items')
      .insert({

        sale_id:
          sale.id,

        product_id:
          product.id,

        quantity,

        unit_price:
          product.price,

        unit_cost:
          product.cost

      });


  if (itemError) {

    console.error(
      itemError
    );

  }


  if (realPaid > 0) {

    const {
      error: paymentError
    } =
      await db
        .from('payments')
        .insert({

          sale_id:
            sale.id,

          amount:
            realPaid,

          currency:
            product.currency,

          created_by:
            state.user.id

        });


    if (paymentError) {

      console.error(
        paymentError
      );

    }

  }


  const {
    error: stockError
  } =
    await db
      .from('products')
      .update({

        stock:
          Number(
            product.stock
          ) - quantity,

        updated_at:
          new Date().toISOString()

      })
      .eq(
        'id',
        product.id
      );


  if (stockError) {

    console.error(
      stockError
    );

  }


  await loadAll();

  closeModal();

  render('sales');

  toast(
    'VENTA REGISTRADA EN LA NUBE'
  );

}


// =========================================================
// ABONO
// =========================================================

function openPayment(id) {

  const sale =
    state.sales.find(
      x => x.id === id
    );


  if (!sale) return;


  const due =
    Number(sale.total) -
    Number(sale.paid);


  modal(`

    <h2>
      REGISTRAR ABONO
    </h2>


    <p>

      <b>
        ${escapeHtml(
          sale.customer
        )}
      </b>

      ·

      ${escapeHtml(
        sale.id
      )}

    </p>


    <div class="card">

      <div class="label">
        Saldo pendiente
      </div>

      <div class="metric orange">

        ${money(
          due,
          sale.currency
        )}

      </div>

    </div>


    <div class="form">

      <label>

        Monto del abono

        <input
          id="payAmount"
          type="number"
          min="0.01"
          max="${due}"
          step="0.01"
        >

      </label>


      <button
        class="primary"
        onclick="addPayment('${sale.id}')"
      >
        REGISTRAR ABONO
      </button>

    </div>

  `);

}


// =========================================================
// AGREGAR ABONO
// =========================================================

async function addPayment(id) {

  const sale =
    state.sales.find(
      x => x.id === id
    );


  const amount =
    Number(
      $('#payAmount').value
    );


  if (!sale) return;


  const due =
    Number(sale.total) -
    Number(sale.paid);


  if (
    !amount ||
    amount <= 0 ||
    amount > due
  ) {

    return toast(
      'Monto de abono inválido'
    );

  }


  const {
    error: paymentError
  } =
    await db
      .from('payments')
      .insert({

        sale_id:
          id,

        amount,

        currency:
          sale.currency,

        created_by:
          state.user.id

      });


  if (paymentError) {

    console.error(
      paymentError
    );

    return toast(
      'No se pudo registrar el abono'
    );

  }


  const newPaid =
    Number(sale.paid) +
    amount;


  const {
    error: saleError
  } =
    await db
      .from('sales')
      .update({

        paid:
          newPaid,

        status:
          newPaid >=
          Number(sale.total)
            ? 'paid'
            : 'pending'

      })
      .eq(
        'id',
        id
      );


  if (saleError) {

    console.error(
      saleError
    );

    return toast(
      'Abono creado, pero venta no actualizada'
    );

  }


  await loadAll();


  const updated =
    state.sales.find(
      x => x.id === id
    );


  showReceipt(
    updated,
    amount
  );


  render('sales');

}


// =========================================================
// COMPROBANTE
// =========================================================

function receiptText(
  sale,
  amount
) {

  return `HYPEFRIENDS BUSINESS
COMPROBANTE DE PAGO

Cliente: ${sale.customer}
Venta: ${sale.id}
Pago recibido: ${money(amount,sale.currency)}
Total compra: ${money(sale.total,sale.currency)}
Total abonado: ${money(sale.paid,sale.currency)}
Saldo pendiente: ${money(Number(sale.total)-Number(sale.paid),sale.currency)}

SIN INTERESES
Gracias por comprar en HYPEFRIENDS.`;

}


function showReceipt(
  sale,
  amount
) {

  modal(`

    <div
      class="receipt"
      id="receiptPreview"
    >

      <div class="receipt-head">
        HYPEFRIENDS
      </div>

      <div class="muted">
        STREETWEAR & DROPS · COMPROBANTE DE PAGO
      </div>

      <hr>

      <div class="receipt-row">
        <span>Cliente</span>
        <b>${escapeHtml(
          sale.customer
        )}</b>
      </div>

      <div class="receipt-row">
        <span>Venta</span>
        <b>${escapeHtml(
          sale.id
        )}</b>
      </div>

      <div class="receipt-row">
        <span>Pago recibido</span>
        <b>${money(
          amount,
          sale.currency
        )}</b>
      </div>

      <div class="receipt-row">
        <span>Total compra</span>
        <b>${money(
          sale.total,
          sale.currency
        )}</b>
      </div>

      <div class="receipt-row">
        <span>Total abonado</span>
        <b>${money(
          sale.paid,
          sale.currency
        )}</b>
      </div>

      <hr>

      <div class="receipt-row">

        <span>
          Saldo pendiente
        </span>

        <b class="receipt-total">
          ${money(
            Number(sale.total) -
            Number(sale.paid),
            sale.currency
          )}
        </b>

      </div>

      <hr>

      <b>
        SIN INTERESES
      </b>

      <p class="muted">
        Gracias por comprar en HYPEFRIENDS.
      </p>

    </div>


    <div
      class="actions"
      style="margin-top:14px"
    >

      <button
        class="outline light-button"
        onclick="shareReceiptText('${sale.id}',${Number(amount)})"
      >
        WHATSAPP / TEXTO
      </button>

      <button
        class="outline light-button"
        onclick="closeModal()"
      >
        CERRAR
      </button>

    </div>

  `);

}


// =========================================================
// PRODUCTO
// =========================================================

function openProduct() {

  modal(`

    <h2>
      NUEVO PRODUCTO
    </h2>


    <div class="form">

      <label>

        Nombre

        <input
          id="pName"
          required
        >

      </label>


      <div class="form-grid">

        <label>

          Categoría

          <input
            id="pCat"
            value="General"
          >

        </label>


        <label>

          Stock

          <input
            id="pStock"
            type="number"
            value="1"
            min="0"
          >

        </label>


        <label>

          Costo

          <input
            id="pCost"
            type="number"
            value="0"
            min="0"
            step="0.01"
          >

        </label>


        <label>

          Precio

          <input
            id="pPrice"
            type="number"
            value="0"
            min="0"
            step="0.01"
          >

        </label>

      </div>


      <label>

        Moneda

        <select id="pCurrency">

          <option value="CRC">
            ₡ Colones
          </option>

          <option value="USD">
            $ Dólares
          </option>

        </select>

      </label>


      <button
        class="primary"
        onclick="createProduct()"
      >
        GUARDAR PRODUCTO
      </button>

    </div>

  `);

}


// =========================================================
// CREAR PRODUCTO
// =========================================================

async function createProduct() {

  const row = {

    name:
      $('#pName').value.trim() ||
      'Producto',

    category:
      $('#pCat').value.trim() ||
      'General',

    stock:
      Number(
        $('#pStock').value ||
        0
      ),

    cost:
      Number(
        $('#pCost').value ||
        0
      ),

    price:
      Number(
        $('#pPrice').value ||
        0
      ),

    currency:
      $('#pCurrency').value

  };


  console.log(
    'Guardando producto:',
    row
  );


  const {
    data,
    error
  } =
    await db
      .from('products')
      .insert(row)
      .select()
      .single();


  if (error) {

    console.error(
      'ERROR PRODUCTO:',
      error
    );

    return toast(
      'No se pudo guardar el producto'
    );

  }


  console.log(
    'Producto guardado:',
    data
  );


  await loadAll();

  closeModal();

  render('inventory');

  toast(
    'PRODUCTO GUARDADO EN LA NUBE'
  );

}


// =========================================================
// GASTOS
// =========================================================

function openExpense() {

  modal(`

    <h2>
      REGISTRAR GASTO
    </h2>


    <div class="form">

      <label>

        Concepto

        <input
          id="eNote"
          placeholder="Compra de mercadería, envío..."
        >

      </label>


      <label>

        Monto

        <input
          id="eAmount"
          type="number"
          min="0"
          step="0.01"
        >

      </label>


      <label>

        Moneda

        <select id="eCurrency">

          <option value="CRC">
            ₡ Colones
          </option>

          <option value="USD">
            $ Dólares
          </option>

        </select>

      </label>


      <button
        class="primary"
        onclick="createExpense()"
      >
        GUARDAR GASTO
      </button>

    </div>

  `);

}


// =========================================================
// CREAR GASTO
// =========================================================

async function createExpense() {

  const row = {

    note:
      $('#eNote').value.trim() ||
      'Gasto',

    amount:
      Number(
        $('#eAmount').value ||
        0
      ),

    currency:
      $('#eCurrency').value,

    created_by:
      state.user.id

  };


  if (
    row.amount <= 0
  ) {

    return toast(
      'Monto inválido'
    );

  }


  const {
    error
  } =
    await db
      .from('expenses')
      .insert(row);


  if (error) {

    console.error(
      error
    );

    return toast(
      'No se pudo guardar el gasto'
    );

  }


  await loadAll();

  closeModal();

  render('finance');

  toast(
    'GASTO REGISTRADO EN LA NUBE'
  );

}


// =========================================================
// CLIENTE
// =========================================================

function openCustomer() {

  modal(`

    <h2>
      NUEVO CLIENTE
    </h2>


    <div class="form">

      <label>

        Nombre

        <input
          id="cName"
          required
        >

      </label>


      <label>

        Teléfono

        <input
          id="cPhone"
          type="tel"
        >

      </label>


      <label>

        Correo

        <input
          id="cEmail"
          type="email"
        >

      </label>


      <button
        class="primary"
        onclick="createCustomer()"
      >
        GUARDAR CLIENTE
      </button>

    </div>

  `);

}


// =========================================================
// CREAR CLIENTE
// =========================================================

async function createCustomer() {

  const row = {

    name:
      $('#cName').value.trim() ||
      'Cliente',

    phone:
      $('#cPhone').value.trim() ||
      null,

    email:
      $('#cEmail').value.trim() ||
      null

  };


  const {
    error
  } =
    await db
      .from('customers')
      .insert(row);


  if (error) {

    console.error(
      error
    );

    return toast(
      'No se pudo guardar el cliente'
    );

  }


  await loadAll();

  closeModal();

  render('customers');

  toast(
    'CLIENTE GUARDADO EN LA NUBE'
  );

}


// =========================================================
// COMPARTIR TEXTO
// =========================================================

async function shareReceiptText(
  id,
  amount
) {

  const sale =
    state.sales.find(
      x => x.id === id
    );


  if (!sale) return;


  const text =
    receiptText(
      sale,
      amount
    );


  if (
    navigator.share
  ) {

    try {

      await navigator.share({

        title:
          'Comprobante HYPEFRIENDS',

        text

      });

      return;

    } catch (error) {}

  }


  try {

    await navigator.clipboard.writeText(
      text
    );

    toast(
      'Comprobante copiado'
    );

  } catch (error) {

    toast(
      'No se pudo copiar'
    );

  }

}


// =========================================================
// INSTALACIÓN PWA
// =========================================================

let deferredPrompt;


window.addEventListener(
  'beforeinstallprompt',
  event => {

    event.preventDefault();

    deferredPrompt =
      event;

  }
);


async function installApp() {

  if (
    deferredPrompt
  ) {

    deferredPrompt.prompt();

    deferredPrompt = null;

  } else {

    toast(
      'En iPhone usa Compartir → Agregar a pantalla de inicio'
    );

  }

}


// =========================================================
// ARRANQUE
// =========================================================

boot();

