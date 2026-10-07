/* =========================================================
   HYPEFRIENDS BUSINESS
   SUPABASE + REALTIME + PWA
   ========================================================= */


/* =========================================================
   SUPABASE
   ========================================================= */

const SUPABASE_URL =
  'https://ynowgseafcpcfgvsmkub.supabase.co';

const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_2DSB2bN-_Q4JAm5WO4QruA_E4sXrEuH';


/* =========================================================
   COMPROBAR SUPABASE
   ========================================================= */

if (
  !window.supabase ||
  typeof window.supabase.createClient !== 'function'
) {

  document.addEventListener('DOMContentLoaded', () => {

    const el = document.querySelector('#loginError');

    if (el) {

      el.textContent =
        'No se pudo cargar Supabase. Comprueba que index.html cargue correctamente la librerÃ­a de Supabase.';
    }

  });

  throw new Error('Supabase JS no cargÃ³');

}


/* =========================================================
   CLIENTE SUPABASE
   ========================================================= */

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);


/* =========================================================
   ESTADO
   ========================================================= */

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


/* =========================================================
   PRODUCTOS INICIALES
   ========================================================= */

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


/* =========================================================
   UTILIDADES
   ========================================================= */

const $ = selector =>
  document.querySelector(selector);


const money = (n, currency = 'CRC') => {

  if (currency === 'USD') {

    return '$' +
      Number(n || 0).toLocaleString(
        'en-US',
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }
      );

  }

  return 'â‚¡' +
    Math.round(Number(n || 0))
      .toLocaleString('es-CR');

};


const today = () =>
  new Date().toISOString().slice(0, 10);


const escapeHtml = value => {

  return String(value ?? '')
    .replace(
      /[&<>'"]/g,
      character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      })[character]
    );

};


const toast = message => {

  const element = $('#toast');

  if (!element) return;

  element.textContent = message;

  element.classList.add('show');

  setTimeout(() => {

    element.classList.remove('show');

  }, 2200);

};


/* =========================================================
   INDICADOR DE SINCRONIZACIÃ“N
   ========================================================= */

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


/* =========================================================
   LOGIN
   ========================================================= */

function showLogin(show = true) {

  $('#loginScreen')?.classList.toggle(
    'hidden',
    !show
  );

  $('#app')?.classList.toggle(
    'app-visible',
    !show
  );

  $('#app')?.classList.toggle(
    'hidden-app',
    show
  );

}


/* =========================================================
   BOOT
   ========================================================= */

async function boot() {

  console.log('ðŸš€ HYPEFRIENDS BUSINESS iniciando...');

  console.log(
    'ðŸŒ Supabase:',
    SUPABASE_URL
  );


  /* Botones */

  $('#loginForm')?.addEventListener(
    'submit',
    login
  );

  $('#logoutBtn')?.addEventListener(
    'click',
    logout
  );

  if ($('#closeModal')) {

    $('#closeModal').onclick =
      closeModal;

  }

  if ($('#newSaleBtn')) {

    $('#newSaleBtn').onclick =
      openSale;

  }

  if ($('#installBtn')) {

    $('#installBtn').onclick =
      installApp;

  }


  document
    .querySelectorAll('.nav')
    .forEach(button => {

      button.onclick = () => {

        render(
          button.dataset.view
        );

      };

    });


  /* Recuperar sesiÃ³n */

  try {

    const {
      data: { session },
      error
    } = await db.auth.getSession();


    if (error) {

      console.error(
        'âŒ Error obteniendo sesiÃ³n:',
        error
      );

    }


    if (session) {

      console.log(
        'âœ… SesiÃ³n encontrada:',
        session.user.email
      );

      await startApp(session);

    } else {

      console.log(
        'â„¹ï¸ No hay sesiÃ³n activa'
      );

      showLogin(true);

    }

  } catch (error) {

    console.error(
      'âŒ Error de inicio:',
      error
    );

  }


  /* Auth listener */

  db.auth.onAuthStateChange(
    (_event, sessionNow) => {

      console.log(
        'ðŸ” Auth:',
        _event,
        sessionNow?.user?.email || 'sin sesiÃ³n'
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


  /* Service Worker */

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
        'âœ… Service Worker registrado:',
        registration.scope
      );


      /*
        Buscar actualizaciÃ³n inmediatamente.
      */

      registration.update();


      /*
        Si hay nuevo Service Worker,
        recargar cuando tome control.
      */

      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => {

          console.log(
            'ðŸ”„ Nuevo Service Worker activo'
          );

        }
      );

    } catch (error) {

      console.error(
        'âŒ Error Service Worker:',
        error
      );

    }

  }

}


/* =========================================================
   LOGIN
   ========================================================= */

async function login(event) {

  event.preventDefault();


  const email =
    $('#loginEmail')?.value.trim();

  const password =
    $('#loginPassword')?.value || '';


  $('#loginError').textContent =
    'Conectando...';


  if (!email || !password) {

    $('#loginError').textContent =
      'Escribe el correo y la contraseÃ±a.';

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
        'âŒ Supabase login:',
        error
      );


      const message =
        String(error.message || '')
          .toLowerCase();


      if (
        message.includes(
          'email not confirmed'
        )
      ) {

        $('#loginError').textContent =
          'Este correo todavÃ­a no estÃ¡ confirmado en Supabase.';

      } else if (
        message.includes(
          'invalid login credentials'
        )
      ) {

        $('#loginError').textContent =
          'Correo o contraseÃ±a incorrectos.';

      } else {

        $('#loginError').textContent =
          `Error de Supabase: ${error.message}`;

      }

      return;

    }


    console.log(
      'âœ… Login correcto'
    );


    $('#loginError').textContent =
      'âœ“ Acceso correcto.';


    if (data?.session) {

      await startApp(data.session);

    }

  } catch (error) {

    console.error(
      'âŒ Login exception:',
      error
    );

    $('#loginError').textContent =
      `Error inesperado: ${error.message || error}`;

  }

}


/* =========================================================
   LOGOUT
   ========================================================= */

async function logout() {

  if (state.realtime) {

    try {

      await db.removeChannel(
        state.realtime
      );

    } catch (error) {

      console.warn(error);

    }

    state.realtime = null;

  }


  await db.auth.signOut();

}


/* =========================================================
   INICIAR APP
   ========================================================= */

async function startApp(session) {

  console.log(
    'ðŸš€ Iniciando aplicaciÃ³n'
  );


  state.session = session;

  state.user = session.user;


  $('#userEmail').textContent =
    state.user.email || 'Usuario';


  showLogin(false);


  setSync(
    true,
    'Conectando con Supabase...'
  );


  await ensureProfile();


  await loadAll();


  /*
    IMPORTANTE:
    conectar Realtime DESPUÃ‰S de cargar datos.
  */

  subscribeRealtime();


  render(state.view);


  setSync(
    true,
    'Sincronizado con Supabase'
  );

}


/* =========================================================
   DETENER APP
   ========================================================= */

function stopApp() {

  console.log(
    'ðŸ›‘ Cerrando aplicaciÃ³n'
  );


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


/* =========================================================
   PERFIL
   ========================================================= */

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
      'âš ï¸ Profile:',
      error.message
    );

  }

}


/* =========================================================
   CARGAR TODOS LOS DATOS
   ========================================================= */

async function loadAll() {

  console.log(
    'â˜ï¸ Cargando datos desde Supabase...'
  );


  setSync(
    true,
    'Cargando datos...'
  );


  try {

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


    const error =
      productsResult.error ||
      customersResult.error ||
      expensesResult.error ||
      salesResult.error;


    if (error) {

      console.error(
        'âŒ Error cargando datos:',
        error
      );


      setSync(
        false,
        'Error de conexiÃ³n'
      );


      toast(
        'No se pudieron cargar los datos'
      );


      return;

    }


    state.products =
      productsResult.data || [];


    state.customers =
      customersResult.data || [];


    state.expenses =
      expensesResult.data || [];


    state.sales =
      (salesResult.data || [])
        .map(sale => ({

          ...sale,

          customer:
            sale.customers?.name ||
            'Cliente',

          payments:
            (sale.payments || [])
              .sort(
                (a, b) =>
                  String(a.created_at)
                    .localeCompare(
                      String(b.created_at)
                    )
              )

        }));


    console.log(
      'âœ… Datos cargados:',
      {
        products: state.products.length,
        customers: state.customers.length,
        expenses: state.expenses.length,
        sales: state.sales.length
      }
    );


    /*
      Solo crear productos iniciales
      si realmente no existe ninguno.
    */

    if (!state.products.length) {

      await seedProducts();

    }


    setSync(
      true,
      'Datos actualizados'
    );

  } catch (error) {

    console.error(
      'âŒ loadAll exception:',
      error
    );


    setSync(
      false,
      'Error cargando datos'
    );

  }

}


/* =========================================================
   PRODUCTOS INICIALES
   ========================================================= */

async function seedProducts() {

  console.log(
    'ðŸŒ± Creando productos iniciales...'
  );


  const {
    data,
    error
  } = await db
    .from('products')
    .insert(
      DEFAULT_PRODUCTS
    )
    .select();


  if (error) {

    console.warn(
      'âš ï¸ Seed products:',
      error.message
    );

    return;

  }


  state.products =
    data || [];

}


/* =========================================================
   REALTIME
   ========================================================= */

function subscribeRealtime() {

  /*
    Eliminar canal anterior.
  */

  if (state.realtime) {

    console.log(
      'â™»ï¸ Eliminando canal Realtime anterior'
    );

    db.removeChannel(
      state.realtime
    );

    state.realtime = null;

  }


  if (!state.user) {

    console.warn(
      'âš ï¸ Realtime: no existe usuario'
    );

    return;

  }


  /*
    Nombre Ãºnico del canal.
  */

  const channelName =
    `hypefriends-business-${state.user.id}-${Date.now()}`;


  console.log(
    'ðŸ“¡ Creando canal:',
    channelName
  );


  const channel =
    db.channel(channelName);


  /*
    TABLAS QUE ESCUCHAMOS.
  */

  const tables = [

    'products',

    'customers',

    'sales',

    'sale_items',

    'payments',

    'expenses'

  ];


  tables.forEach(table => {

    console.log(
      `ðŸ‘‚ Escuchando Realtime: ${table}`
    );


    channel.on(

      'postgres_changes',

      {

        event: '*',

        schema: 'public',

        table: table

      },

      async payload => {

        console.log(
          `ðŸ”„ REALTIME RECIBIDO â†’ ${table}`,
          payload
        );


        /*
          Cuando otro dispositivo modifica
          Supabase, volvemos a consultar
          TODOS los datos.
        */

        try {

          await loadAll();


          render(
            state.view
          );


          setSync(
            true,
            `Actualizado: ${table}`
          );


        } catch (error) {

          console.error(
            'âŒ Error procesando Realtime:',
            error
          );

        }

      }

    );

  });


  /*
    CONECTAR.
  */

  state.realtime =
    channel.subscribe(
      (status, error) => {

        console.log(
          'ðŸ“¡ REALTIME STATUS:',
          status,
          error || ''
        );


        if (
          status === 'SUBSCRIBED'
        ) {

          console.log(
            'âœ…âœ… REALTIME CONECTADO'
          );


          setSync(
            true,
            'Sincronizado en tiempo real'
          );

        }


        if (
          status === 'CHANNEL_ERROR'
        ) {

          console.error(
            'âŒ REALTIME CHANNEL ERROR:',
            error
          );


          setSync(
            false,
            'Error de sincronizaciÃ³n'
          );

        }


        if (
          status === 'TIMED_OUT'
        ) {

          console.warn(
            'â±ï¸ REALTIME TIMEOUT'
          );


          setSync(
            false,
            'Reintentando...'
          );


          setTimeout(
            () => {

              if (state.user) {

                subscribeRealtime();

              }

            },
            3000
          );

        }


        if (
          status === 'CLOSED'
        ) {

          console.warn(
            'ðŸ”Œ REALTIME CERRADO'
          );


          setSync(
            false,
            'SincronizaciÃ³n desconectada'
          );

        }

      }
    );

}


/* =========================================================
   TOTALES
   ========================================================= */

function totals(currency) {

  const sales =
    state.sales.filter(
      sale =>
        sale.currency === currency
    );


  const total =
    sales.reduce(
      (sum, sale) =>
        sum + Number(sale.total || 0),
      0
    );


  const paid =
    sales.reduce(
      (sum, sale) =>
        sum + Number(sale.paid || 0),
      0
    );


  const expenses =
    state.expenses
      .filter(
        expense =>
          expense.currency === currency
      )
      .reduce(
        (sum, expense) =>
          sum + Number(
            expense.amount || 0
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


/* =========================================================
   RENDER
   ========================================================= */

function render(view = 'dashboard') {

  state.view = view;


  document
    .querySelectorAll('.nav')
    .forEach(button => {

      button.classList.toggle(
        'active',
        button.dataset.view === view
      );

    });


  const titles = {

    dashboard: 'DASHBOARD',

    sales: 'VENTAS',

    inventory: 'INVENTARIO',

    finance: 'FINANZAS',

    customers: 'CLIENTES',

    history: 'HISTORIAL'

  };


  if ($('#viewTitle')) {

    $('#viewTitle').textContent =
      titles[view] ||
      'DASHBOARD';

  }


  const content =
    $('#content');


  if (!content) return;


  if (view === 'dashboard') {

    dashboard(content);

  }


  if (view === 'sales') {

    sales(content);

  }


  if (view === 'inventory') {

    inventory(content);

  }


  if (view === 'finance') {

    finance(content);

  }


  if (view === 'customers') {

    customers(content);

  }


  if (view === 'history') {

    history(content);

  }

}


/* =========================================================
   DASHBOARD
   ========================================================= */

function dashboard(c) {

  const crc =
    totals('CRC');

  const usd =
    totals('USD');


  const stock =
    state.products.reduce(
      (sum, product) =>
        sum + Number(
          product.stock || 0
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
          ${money(crc.total, 'CRC')}
        </div>

      </div>


      <div class="card">

        <div class="label">
          Cobrado CRC
        </div>

        <div class="metric orange">
          ${money(crc.paid, 'CRC')}
        </div>

      </div>


      <div class="card">

        <div class="label">
          Ventas USD
        </div>

        <div class="metric">
          ${money(usd.total, 'USD')}
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
            ÃšLTIMAS VENTAS
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
              ${money(crc.due, 'CRC')}
            </div>

          </div>


          <div class="card">

            <div class="label">
              Por cobrar USD
            </div>

            <div class="metric orange">
              ${money(usd.due, 'USD')}
            </div>

          </div>


          <div class="card">

            <div class="label">
              Gastos CRC / USD
            </div>

            <div class="metric">
              ${money(crc.expenses, 'CRC')}
              Â·
              ${money(usd.expenses, 'USD')}
            </div>

          </div>


          <div class="card">

            <div class="label">
              Productos con stock bajo
            </div>

            <div class="metric">
              ${
                state.products.filter(
                  p => Number(p.stock) <= 3
                ).length
              }
            </div>

          </div>

        </div>

      </div>

    </div>

  `;

}


/* =========================================================
   TABLA DE VENTAS
   ========================================================= */

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
            rows.map(sale => `

              <tr>

                <td>

                  <b>
                    ${escapeHtml(sale.customer)}
                  </b>

                  <br>

                  <span class="muted">
                    ${escapeHtml(sale.id)}
                  </span>

                </td>


                <td>
                  ${money(
                    sale.total,
                    sale.currency
                  )}
                </td>


                <td>
                  ${money(
                    sale.paid,
                    sale.currency
                  )}
                </td>


                <td>

                  <span
                    class="badge ${
                      Number(sale.paid) >=
                      Number(sale.total)
                        ? 'green'
                        : 'orange'
                    }"
                  >

                    ${
                      Number(sale.paid) >=
                      Number(sale.total)
                        ? 'Pagada'
                        : 'Pendiente'
                    }

                  </span>

                </td>


                <td>

                  ${
                    Number(sale.paid) <
                    Number(sale.total)

                    ?

                    `<button
                      class="primary small"
                      onclick="openPayment('${sale.id}')"
                    >
                      ABONO
                    </button>`

                    :

                    ''

                  }

                </td>

              </tr>

            `).join('')

            ||

            `
              <tr>

                <td
                  colspan="5"
                  class="muted"
                >
                  No hay ventas todavÃ­a.
                </td>

              </tr>
            `

          }

        </tbody>

      </table>

    </div>

  `;

}


/* =========================================================
   VENTAS
   ========================================================= */

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


/* =========================================================
   INVENTARIO
   ========================================================= */

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
        state.products
          .map(product => `

            <div class="card product">

              <div class="label">
                ${escapeHtml(
                  product.category
                )}
              </div>

              <h3>
                ${escapeHtml(
                  product.name
                )}
              </h3>

              <div class="stock">

                ${Number(product.stock)}

                <span class="muted">
                  unidades
                </span>

              </div>

              <div class="muted">

                Venta:
                ${money(
                  product.price,
                  product.currency
                )}

                Â·

                Costo:
                ${money(
                  product.cost,
                  product.currency
                )}

              </div>

              <div class="bar">

                <span
                  style="
                    width:${Math.min(
                      Number(product.stock) * 10,
                      100
                    )}%
                  "
                ></span>

              </div>

            </div>

          `)
          .join('')

        ||

        `
          <div class="card muted">
            No hay productos.
          </div>
        `

      }

    </div>

  `;

}


/* =========================================================
   FINANZAS
   ========================================================= */

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
          ${money(crc.total, 'CRC')}
        </div>

      </div>


      <div class="card">

        <div class="label">
          Ingresos USD
        </div>

        <div class="metric">
          ${money(usd.total, 'USD')}
        </div>

      </div>


      <div class="card">

        <div class="label">
          Gastos CRC / USD
        </div>

        <div class="metric">

          ${money(crc.expenses, 'CRC')}

          Â·

          ${money(usd.expenses, 'USD')}

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
              .map(expense => `

                <tr>

                  <td>
                    ${escapeHtml(
                      expense.note
                    )}
                  </td>

                  <td>
                    ${money(
                      expense.amount,
                      expense.currency
                    )}
                  </td>

                  <td>
                    ${String(
                      expense.created_at || ''
                    ).slice(0, 10)}
                  </td>

                </tr>

              `)
              .join('')

            ||

            `
              <tr>

                <td
                  colspan="3"
                  class="muted"
                >
                  No hay gastos.
                </td>

              </tr>
            `

          }

        </tbody>

      </table>

    </div>

  `;

}


/* =========================================================
   CLIENTES
   ========================================================= */

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
        state.customers
          .map(customer => `

            <div class="card">

              <h3>
                ${escapeHtml(
                  customer.name
                )}
              </h3>

              <div class="muted">
                ${escapeHtml(
                  customer.phone ||
                  'Sin telÃ©fono'
                )}
              </div>

              ${
                customer.email

                ?

                `<div class="muted">
                  ${escapeHtml(
                    customer.email
                  )}
                </div>`

                :

                ''

              }

            </div>

          `)
          .join('')

        ||

        `
          <div class="card muted">
            Agrega tu primer cliente.
          </div>
        `

      }

    </div>

  `;

}


/* =========================================================
   HISTORIAL
   ========================================================= */

function history(c) {

  const rows = [];


  state.sales.forEach(sale => {

    sale.payments.forEach(payment => {

      rows.push({

        type: 'Pago',

        desc:
          `${sale.customer} Â· ${sale.id}`,

        amount:
          payment.amount,

        currency:
          payment.currency ||
          sale.currency,

        date:
          String(
            payment.created_at || ''
          ).slice(0, 10)

      });

    });

  });


  state.expenses.forEach(expense => {

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
          expense.created_at || ''
        ).slice(0, 10)

    });

  });


  rows.sort(
    (a, b) =>
      b.date.localeCompare(a.date)
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
            rows.map(row => `

              <tr>

                <td>

                  <span class="badge">
                    ${row.type}
                  </span>

                </td>

                <td>
                  ${escapeHtml(
                    row.desc
                  )}
                </td>

                <td>
                  ${money(
                    row.amount,
                    row.currency
                  )}
                </td>

                <td>
                  ${row.date}
                </td>

              </tr>

            `).join('')

            ||

            `
              <tr>

                <td
                  colspan="4"
                  class="muted"
                >
                  No hay movimientos.
                </td>

              </tr>
            `

          }

        </tbody>

      </table>

    </div>

  `;

}


/* =========================================================
   MODAL
   ========================================================= */

function modal(html) {

  $('#modalContent').innerHTML =
    html;

  $('#modal').classList.remove(
    'hidden'
  );

}


function closeModal() {

  $('#modal').classList.add(
    'hidden'
  );

}


/* =========================================================
   NUEVA VENTA
   ========================================================= */

function openSale() {

  if (!state.products.length) {

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
            state.customers
              .map(customer => `

                <option
                  value="${customer.id}"
                >
                  ${escapeHtml(
                    customer.name
                  )}
                </option>

              `)
              .join('')
          }

        </select>

      </label>


      <label>

        Producto

        <select id="fProduct">

          ${
            state.products
              .map(product => `

                <option
                  value="${product.id}"
                >

                  ${escapeHtml(
                    product.name
                  )}

                  â€”

                  ${money(
                    product.price,
                    product.currency
                  )}

                  â€”

                  stock
                  ${product.stock}

                </option>

              `)
              .join('')
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
          â‚¡0
        </strong>

        <small
          id="saleCurrencyHint"
        ></small>

      </div>


      <button
        class="primary"
        onclick="createSale()"
      >
        REGISTRAR VENTA
      </button>

    </div>

  `);


  ['fProduct', 'fQty']
    .forEach(id => {

      $('#' + id)?.addEventListener(
        'input',
        updateSaleTotal
      );

      $('#' + id)?.addEventListener(
        'change',
        updateSaleTotal
      );

    });


  updateSaleTotal();

}


/* =========================================================
   ACTUALIZAR TOTAL
   ========================================================= */

function updateSaleTotal() {

  const product =
    state.products.find(
      p =>
        p.id ===
        $('#fProduct')?.value
    );


  if (!product) return;


  const quantity =
    Number(
      $('#fQty')?.value || 1
    );


  $('#saleTotal').textContent =
    money(
      Number(product.price) *
        quantity,
      product.currency
    );


  $('#saleCurrencyHint').textContent =
    `Moneda de la venta: ${
      product.currency === 'USD'
        ? 'DÃ³lares'
        : 'Colones'
    }`;

}


/* =========================================================
   CREAR VENTA
   ========================================================= */

async function createSale() {

  const product =
    state.products.find(
      p =>
        p.id ===
        $('#fProduct').value
    );


  const quantity =
    Number(
      $('#fQty').value
    );


  const paid =
    Number(
      $('#fPaid').value || 0
    );


  const customerId =
    $('#fCustomer').value ||
    null;


  if (!product || quantity <= 0) {

    return toast(
      'Datos de venta invÃ¡lidos'
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
      Math.max(paid, 0),
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
  } = await db
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

    setSync(
      false,
      'Error guardando'
    );

    return toast(
      'No se pudo registrar la venta'
    );

  }


  const {
    error: itemError
  } = await db
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

    toast(
      'Venta creada, pero fallÃ³ el detalle'
    );

  }


  if (realPaid > 0) {

    const {
      error: paymentError
    } = await db
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
  } = await db
    .from('products')
    .update({

      stock:
        Number(product.stock) -
        quantity,

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

    toast(
      'Venta creada, pero no se pudo actualizar stock'
    );

  }


  await loadAll();


  closeModal();


  render('sales');


  toast(
    'VENTA REGISTRADA EN LA NUBE'
  );

}


/* =========================================================
   ABONO
   ========================================================= */

function openPayment(id) {

  const sale =
    state.sales.find(
      s => s.id === id
    );


  if (!sale) return;


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

      Â·

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
          Number(sale.total) -
          Number(sale.paid),
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
          max="${
            Number(sale.total) -
            Number(sale.paid)
          }"
          step="0.01"
        >

      </label>


      <button
        class="primary"
        onclick="addPayment('${sale.id}')"
      >
        REGISTRAR ABONO Y COMPROBANTE
      </button>

    </div>

  `);

}


/* =========================================================
   AGREGAR ABONO
   ========================================================= */

async function addPayment(id) {

  const sale =
    state.sales.find(
      s => s.id === id
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
      'Monto de abono invÃ¡lido'
    );

  }


  const {
    error: paymentError
  } = await db
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
  } = await db
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
      'Abono creado, pero no se actualizÃ³ la venta'
    );

  }


  await loadAll();


  const updated =
    state.sales.find(
      s => s.id === id
    );


  showReceipt(
    updated,
    amount
  );


  render('sales');

}


/* =========================================================
   COMPROBANTE
   ========================================================= */

function receiptText(
  sale,
  amount
) {

  return `HYPEFRIENDS BUSINESS
COMPROBANTE DE PAGO

Cliente: ${sale.customer}
Venta: ${sale.id}
Pago recibido: ${money(amount, sale.currency)}
Total compra: ${money(sale.total, sale.currency)}
Total abonado: ${money(sale.paid, sale.currency)}
Saldo pendiente: ${money(Number(sale.total) - Number(sale.paid), sale.currency)}

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
        STREETWEAR & DROPS Â· COMPROBANTE DE PAGO
      </div>

      <hr>

      <div class="receipt-row">

        <span>
          Cliente
        </span>

        <b>
          ${escapeHtml(
            sale.customer
          )}
        </b>

      </div>


      <div class="receipt-row">

        <span>
          Venta
        </span>

        <b>
          ${escapeHtml(
            sale.id
          )}
        </b>

      </div>


      <div class="receipt-row">

        <span>
          Pago recibido
        </span>

        <b>
          ${money(
            amount,
            sale.currency
          )}
        </b>

      </div>


      <div class="receipt-row">

        <span>
          Total compra
        </span>

        <b>
          ${money(
            sale.total,
            sale.currency
          )}
        </b>

      </div>


      <div class="receipt-row">

        <span>
          Total abonado
        </span>

        <b>
          ${money(
            sale.paid,
            sale.currency
          )}
        </b>

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
        class="primary"
        onclick="shareReceiptImage('${sale.id}',${Number(amount)})"
      >
        ðŸ“² COMPARTIR IMAGEN
      </button>


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


/* =========================================================
   CANVAS COMPROBANTE
   ========================================================= */

function buildReceiptCanvas(
  sale,
  amount
) {

  const canvas =
    document.createElement(
      'canvas'
    );


  canvas.width = 900;

  canvas.height = 1120;


  const ctx =
    canvas.getContext(
      '2d'
    );


  ctx.fillStyle =
    '#ffffff';

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height
  );


  ctx.fillStyle =
    '#090909';

  ctx.textAlign =
    'left';


  ctx.font =
    '900 48px Arial';

  ctx.fillText(
    'HYPEFRIENDS',
    60,
    90
  );


  ctx.font =
    '700 22px Arial';

  ctx.fillText(
    'BUSINESS Â· COMPROBANTE DE PAGO',
    60,
    135
  );


  ctx.strokeStyle =
    '#cccccc';

  ctx.setLineDash(
    [8, 8]
  );

  ctx.beginPath();

  ctx.moveTo(
    60,
    175
  );

  ctx.lineTo(
    840,
    175
  );

  ctx.stroke();

  ctx.setLineDash([]);


  const rows = [

    [
      'Cliente',
      sale.customer
    ],

    [
      'Venta',
      sale.id
    ],

    [
      'Pago recibido',
      money(
        amount,
        sale.currency
      )
    ],

    [
      'Total compra',
      money(
        sale.total,
        sale.currency
      )
    ],

    [
      'Total abonado',
      money(
        sale.paid,
        sale.currency
      )
    ],

    [
      'Saldo pendiente',
      money(
        Number(sale.total) -
        Number(sale.paid),
        sale.currency
      )
    ]

  ];


  let y = 240;


  ctx.font =
    '500 25px Arial';


  rows.forEach(
    ([label, value], index) => {

      ctx.fillStyle =
        '#777';

      ctx.fillText(
        label,
        60,
        y
      );


      ctx.fillStyle =
        '#090909';


      ctx.font =
        index === 5
          ? '900 38px Arial'
          : '700 26px Arial';


      ctx.textAlign =
        'right';


      ctx.fillText(
        String(value),
        840,
        y
      );


      ctx.textAlign =
        'left';


      y += 95;


      ctx.font =
        '500 25px Arial';

    }
  );


  ctx.strokeStyle =
    '#cccccc';


  ctx.beginPath();

  ctx.moveTo(
    60,
    y - 40
  );

  ctx.lineTo(
    840,
    y - 40
  );

  ctx.stroke();


  ctx.font =
    '900 28px Arial';

  ctx.fillStyle =
    '#090909';


  ctx.fillText(
    'SIN INTERESES',
    60,
    y + 25
  );


  ctx.font =
    '500 21px Arial';

  ctx.fillStyle =
    '#777';


  ctx.fillText(
    'Gracias por comprar en HYPEFRIENDS.',
    60,
    y + 70
  );


  return canvas;

}


/* =========================================================
   COMPARTIR IMAGEN
   ========================================================= */

async function shareReceiptImage(
  id,
  amount
) {

  const sale =
    state.sales.find(
      s => s.id === id
    );


  if (!sale) return;


  const canvas =
    buildReceiptCanvas(
      sale,
      amount
    );


  canvas.toBlob(
    async blob => {

      const file =
        new File(
          [
            blob
          ],
          `HYPEFRIENDS-${id}.png`,
          {
            type: 'image/png'
          }
        );


      if (
        navigator.share &&
        (
          !navigator.canShare ||
          navigator.canShare({
            files: [file]
          })
        )
      ) {

        try {

          await navigator.share({

            title:
              'Comprobante HYPEFRIENDS',

            text:
              receiptText(
                sale,
                amount
              ),

            files: [
              file
            ]

          });


          toast(
            'Comprobante listo para compartir'
          );

        } catch (error) {

        }

      } else {

        const url =
          URL.createObjectURL(
            blob
          );


        const link =
          document.createElement(
            'a'
          );


        link.href =
          url;

        link.download =
          `HYPEFRIENDS-${id}.png`;


        link.click();


        setTimeout(
          () =>
            URL.revokeObjectURL(
              url
            ),
          1000
        );


        toast(
          'Imagen generada'
        );

      }

    },

    'image/png'

  );

}


/* =========================================================
   COMPARTIR TEXTO
   ========================================================= */

async function shareReceiptText(
  id,
  amount
) {

  const sale =
    state.sales.find(
      s => s.id === id
    );


  if (!sale) return;


  const text =
    receiptText(
      sale,
      amount
    );


  if (navigator.share) {

    try {

      await navigator.share({

        title:
          'Comprobante HYPEFRIENDS',

        text

      });

      return;

    } catch (error) {

    }

  }


  try {

    await navigator.clipboard.writeText(
      text
    );

    toast(
      'Comprobante copiado'
    );

  } catch (error) {

    console.error(error);

  }

}


/* =========================================================
   NUEVO PRODUCTO
   ========================================================= */

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

          CategorÃ­a

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
            â‚¡ Colones
          </option>

          <option value="USD">
            $ DÃ³lares
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


/* =========================================================
   CREAR PRODUCTO
   ========================================================= */

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
        $('#pStock').value || 0
      ),

    cost:
      Number(
        $('#pCost').value || 0
      ),

    price:
      Number(
        $('#pPrice').value || 0
      ),

    currency:
      $('#pCurrency').value

  };


  console.log(
    'ðŸ“¦ Guardando producto:',
    row
  );


  const {
    data,
    error
  } = await db
    .from('products')
    .insert(row)
    .select()
    .single();


  if (error) {

    console.error(
      'âŒ Error creando producto:',
      error
    );

    return toast(
      'No se pudo guardar el producto'
    );

  }


  console.log(
    'âœ… Producto guardado:',
    data
  );


  await loadAll();


  closeModal();


  render('inventory');


  toast(
    'PRODUCTO GUARDADO EN LA NUBE'
  );

}


/* =========================================================
   NUEVO GASTO
   ========================================================= */

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
          placeholder="Compra de mercaderÃ­a, envÃ­o..."
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
            â‚¡ Colones
          </option>

          <option value="USD">
            $ DÃ³lares
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


/* =========================================================
   CREAR GASTO
   ========================================================= */

async function createExpense() {

  const row = {

    note:
      $('#eNote').value.trim() ||
      'Gasto',

    amount:
      Number(
        $('#eAmount').value || 0
      ),

    currency:
      $('#eCurrency').value,

    created_by:
      state.user.id

  };


  if (row.amount <= 0) {

    return toast(
      'Monto invÃ¡lido'
    );

  }


  const {
    error
  } = await db
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


/* =========================================================
   NUEVO CLIENTE
   ========================================================= */

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

        TelÃ©fono

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


/* =========================================================
   CREAR CLIENTE
   ========================================================= */

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
  } = await db
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


/* =========================================================
   INSTALACIÃ“N PWA
   ========================================================= */

let deferredPrompt = null;


window.addEventListener(
  'beforeinstallprompt',
  event => {

    event.preventDefault();

    deferredPrompt = event;

  }
);


async function installApp() {

  if (deferredPrompt) {

    deferredPrompt.prompt();

    deferredPrompt = null;

  } else {

    toast(
      'En iPhone usa Compartir â†’ Agregar a pantalla de inicio'
    );

  }

}


/* =========================================================
   INICIAR
   ========================================================= */

boot();
