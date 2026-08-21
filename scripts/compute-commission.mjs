// HENNA10 – naliczanie prowizji afiliacyjnej dla EXTENSIONS HAIR SHOP
//
// Co robi ten skrypt (jednym zdaniem na krok):
// 1. Loguje sie do Shopify Admin API (client credentials grant – token na 24h, pobierany na nowo przy kazdym uruchomieniu).
// 2. Pobiera zamowienia zlozone z kodem rabatowym HENNA10 od ostatniego przetworzonego zamowienia.
// 3. Liczy 5% prowizji od wartosci KAZDEGO zamowienia PO rabacie 10% (bez kosztow wysylki).
// 4. Dopisuje te kwoty do "zaleglej" prowizji (metapole na koncie klienta-partnerki w Shopify).
// 5. Jesli zalegla prowizja jeszcze nigdy nie przekroczyla 50 EUR – czeka, az przekroczy (jednorazowy prog).
//    Po przekroczeniu progu PIERWSZY raz: cala zalegla kwota staje sie realnym kredytem w sklepie,
//    a od tego momentu KAZDA kolejna prowizja (nawet mala) jest dopisywana do kredytu od razu, bez czekania na kolejne 50 EUR.
// 6. Zapisuje historie zamowien do data/henna10_orders.json i generuje stronke podgladu docs/index.html.
//
// Wszystkie kwoty w EUR (waluta bazowa sklepu).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

// ---------- Konfiguracja (z zmiennych srodowiskowych / GitHub Secrets) ----------

const SHOP_DOMAIN = requireEnv("SHOPIFY_STORE_DOMAIN");           // np. c2cae8-b1.myshopify.com
const CLIENT_ID = requireEnv("SHOPIFY_CLIENT_ID");
const CLIENT_SECRET = requireEnv("SHOPIFY_CLIENT_SECRET");
const CUSTOMER_GID = requireEnv("AFFILIATE_CUSTOMER_ID");         // gid://shopify/Customer/xxxx
const DISCOUNT_CODE = process.env.DISCOUNT_CODE || "HENNA10";
const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE || "0.05");
const THRESHOLD_AMOUNT = parseFloat(process.env.THRESHOLD_AMOUNT || "50");
const CURRENCY_CODE = process.env.CURRENCY_CODE || "EUR";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";
const PARTNER_NAME = process.env.PARTNER_NAME || "Partner";
const AFFILIATE_PANEL_TITLE = process.env.AFFILIATE_PANEL_TITLE || "HENNA10 Affiliate Dashboard";
const SHOP_PUBLIC_URL = process.env.SHOP_PUBLIC_URL || "e-hairshop.com";

const LEDGER_PATH = new URL("../data/henna10_orders.json", import.meta.url);
const HTML_PATH = new URL("../docs/index.html", import.meta.url);

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Brakuje zmiennej srodowiskowej ${name}. Sprawdz sekrety w GitHub Actions.`);
  }
  return v;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------- Shopify API ----------

async function getAccessToken() {
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new Error(`Nie udalo sie pobrac tokenu dostepu (HTTP ${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Odpowiedz OAuth nie zawiera access_token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function shopifyGraphQL(token, query, variables = {}) {
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`Blad GraphQL: ${JSON.stringify(json.errors)}`);
  }
  if (json.data && Object.values(json.data).some((v) => v && v.userErrors && v.userErrors.length)) {
    throw new Error(`Blad mutacji Shopify: ${JSON.stringify(json.data)}`);
  }
  return json.data;
}

async function getCustomerState(token) {
  const query = `
    query($id: ID!) {
      customer(id: $id) {
        id
        displayName
        metafields(namespace: "affiliate", first: 10) {
          edges { node { key value } }
        }
        storeCreditAccounts(first: 10) {
          edges { node { id balance { amount currencyCode } } }
        }
      }
    }`;
  const data = await shopifyGraphQL(token, query, { id: CUSTOMER_GID });
  const customer = data.customer;
  if (!customer) throw new Error(`Nie znaleziono klienta ${CUSTOMER_GID}`);

  const mf = {};
  for (const edge of customer.metafields.edges) mf[edge.node.key] = edge.node.value;

  const account = customer.storeCreditAccounts.edges.find(
    (e) => e.node.balance.currencyCode === CURRENCY_CODE
  );

  return {
    displayName: customer.displayName,
    pending: parseFloat(mf.henna10_pending_commission ?? "0"),
    unlocked: (mf.henna10_unlocked ?? "false") === "true",
    lastProcessedAt: mf.henna10_last_processed_at || "2000-01-01T00:00:00Z",
    liveBalance: account ? parseFloat(account.node.balance.amount) : 0,
  };
}

async function fetchQualifyingOrders(token, sinceIso) {
  const orders = [];
  let cursor = null;
  const searchQuery = `discount_code:${DISCOUNT_CODE} created_at:>'${sinceIso}'`;

  for (;;) {
    const query = `
      query($q: String!, $after: String) {
        orders(first: 250, after: $after, query: $q, sortKey: CREATED_AT) {
          edges {
            node {
              id
              name
              createdAt
              cancelledAt
              displayFinancialStatus
              currentSubtotalPriceSet { shopMoney { amount currencyCode } }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`;
    const data = await shopifyGraphQL(token, query, { q: searchQuery, after: cursor });
    for (const edge of data.orders.edges) {
      const o = edge.node;
      if (o.cancelledAt) continue; // pomijamy anulowane
      if (o.displayFinancialStatus !== "PAID") continue; // pomijamy nieoplacone / zwroty / czesciowe zwroty
      orders.push({
        order_id: o.id,
        order_name: o.name,
        created_at: o.createdAt,
        subtotal_after_discount: parseFloat(o.currentSubtotalPriceSet.shopMoney.amount),
        currency: o.currentSubtotalPriceSet.shopMoney.currencyCode,
      });
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  return orders;
}

async function creditStoreAccount(token, amount) {
  const mutation = `
    mutation($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
      storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
        storeCreditAccountTransaction {
          id
          balanceAfterTransaction { amount currencyCode }
        }
        userErrors { field message code }
      }
    }`;
  const data = await shopifyGraphQL(token, mutation, {
    id: CUSTOMER_GID,
    creditInput: {
      creditAmount: { amount: amount.toFixed(2), currencyCode: CURRENCY_CODE },
      notify: false,
    },
  });
  const errs = data.storeCreditAccountCredit.userErrors;
  if (errs && errs.length) {
    throw new Error(`Nie udalo sie dopisac kredytu: ${JSON.stringify(errs)}`);
  }
  return data.storeCreditAccountCredit.storeCreditAccountTransaction.balanceAfterTransaction.amount;
}

async function saveCustomerState(token, { pending, unlocked, lastProcessedAt }) {
  const mutation = `
    mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key value }
        userErrors { field message }
      }
    }`;
  await shopifyGraphQL(token, mutation, {
    metafields: [
      {
        ownerId: CUSTOMER_GID,
        namespace: "affiliate",
        key: "henna10_pending_commission",
        type: "number_decimal",
        value: pending.toFixed(2),
      },
      {
        ownerId: CUSTOMER_GID,
        namespace: "affiliate",
        key: "henna10_unlocked",
        type: "boolean",
        value: unlocked ? "true" : "false",
      },
      {
        ownerId: CUSTOMER_GID,
        namespace: "affiliate",
        key: "henna10_last_processed_at",
        type: "date_time",
        value: lastProcessedAt,
      },
    ],
  });
}

// ---------- Ledger (historia zamowien do wyswietlenia na stronce) ----------

async function loadLedger() {
  if (!existsSync(LEDGER_PATH)) return [];
  const raw = await readFile(LEDGER_PATH, "utf8");
  return JSON.parse(raw);
}

async function saveLedger(ledger) {
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

// ---------- Strona podgladu (HTML) ----------

function renderHtml(ledger, summary) {
  const rows = ledger
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(
      (o) => `
        <tr>
          <td>${o.order_name}</td>
          <td>${new Date(o.created_at).toLocaleDateString("en-GB")}</td>
          <td>${o.subtotal_after_discount.toFixed(2)} ${o.currency}</td>
          <td>${o.commission.toFixed(2)} ${o.currency}</td>
          <td>${o.credited ? "added to credit" : "accumulating"}</td>
        </tr>`
    )
    .join("\n");

  const generatedAt = new Date().toLocaleString("en-GB", { timeZone: "Europe/Warsaw" });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${AFFILIATE_PANEL_TITLE}</title>
<style>
  :root {
    --bg: #faf7f5;
    --card: #ffffff;
    --ink: #2b2320;
    --muted: #7a6f68;
    --accent: #a9744f;
    --line: #ece3dd;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--ink);
    padding: 32px 16px 64px;
  }
  .wrap { max-width: 880px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 14px; margin-bottom: 28px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 28px; }
  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 18px 20px;
  }
  .card .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
  .card .value { font-size: 24px; font-weight: 600; color: var(--accent); }
  .card .note { font-size: 12px; color: var(--muted); margin-top: 6px; }
  table { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 12px; overflow: hidden; border: 1px solid var(--line); }
  th, td { text-align: left; padding: 10px 14px; font-size: 14px; border-bottom: 1px solid var(--line); }
  th { background: #f4ede8; color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; }
  tr:last-child td { border-bottom: none; }
  .footer { color: var(--muted); font-size: 12px; margin-top: 20px; text-align: center; }
  .empty { padding: 28px; text-align: center; color: var(--muted); background: var(--card); border-radius: 12px; border: 1px solid var(--line); }
</style>
</head>
<body>
  <div class="wrap">
    <h1>${AFFILIATE_PANEL_TITLE}</h1>
    <div class="sub">Discount code: <strong>${DISCOUNT_CODE}</strong> · view only, updated automatically</div>

    <div class="cards">
      <div class="card">
        <div class="label">Available store credit</div>
        <div class="value">${summary.liveBalance.toFixed(2)} ${CURRENCY_CODE}</div>
        <div class="note">Usable on your next order at ${SHOP_PUBLIC_URL}</div>
      </div>
      <div class="card">
        <div class="label">${summary.unlocked ? "Accrued this period" : `Accumulating toward ${THRESHOLD_AMOUNT} ${CURRENCY_CODE}`}</div>
        <div class="value">${summary.pending.toFixed(2)} ${CURRENCY_CODE}</div>
        <div class="note">${summary.unlocked ? "Every new commission is added to your credit automatically" : `Once it reaches ${THRESHOLD_AMOUNT} ${CURRENCY_CODE}, it becomes usable store credit`}</div>
      </div>
      <div class="card">
        <div class="label">Commission rate</div>
        <div class="value">${(COMMISSION_RATE * 100).toFixed(0)}%</div>
        <div class="note">of order value after the 10% discount</div>
      </div>
    </div>

    ${
      rows
        ? `<table>
      <thead>
        <tr><th>Order</th><th>Date</th><th>Value after discount</th><th>Commission (${(COMMISSION_RATE * 100).toFixed(0)}%)</th><th>Status</th></tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>`
        : `<div class="empty">No orders with code ${DISCOUNT_CODE} yet.</div>`
    }

    <div class="footer">Last updated: ${generatedAt} (Warsaw time) · EXTENSIONS HAIR SHOP</div>
  </div>
</body>
</html>
`;
}

// ---------- Main ----------

export async function runOnce() {
  console.log("HENNA10: pobieranie tokenu dostepu...");
  const token = await getAccessToken();

  console.log("HENNA10: odczyt stanu konta partnerki...");
  const state = await getCustomerState(token);
  console.log(
    `Stan przed: pending=${state.pending} unlocked=${state.unlocked} lastProcessedAt=${state.lastProcessedAt} liveBalance=${state.liveBalance}`
  );

  console.log(`HENNA10: pobieranie zamowien od ${state.lastProcessedAt}...`);
  const newOrders = await fetchQualifyingOrders(token, state.lastProcessedAt);
  console.log(`Znaleziono ${newOrders.length} nowych zakwalifikowanych zamowien.`);

  const ledger = await loadLedger();
  const existingIds = new Set(ledger.map((o) => o.order_id));

  let newCommissionTotal = 0;
  let latestProcessedAt = state.lastProcessedAt;

  for (const o of newOrders) {
    if (existingIds.has(o.order_id)) continue; // bezpiecznik przed duplikatami
    const commission = round2(o.subtotal_after_discount * COMMISSION_RATE);
    newCommissionTotal = round2(newCommissionTotal + commission);
    ledger.push({ ...o, commission, credited: false });
    existingIds.add(o.order_id);
    if (new Date(o.created_at) > new Date(latestProcessedAt)) {
      latestProcessedAt = o.created_at;
    }
  }

  let pending = state.pending;
  let unlocked = state.unlocked;
  let liveBalance = state.liveBalance;
  let issuedThisRun = 0;

  if (!unlocked) {
    pending = round2(pending + newCommissionTotal);
    if (pending >= THRESHOLD_AMOUNT) {
      console.log(`HENNA10: prog ${THRESHOLD_AMOUNT} ${CURRENCY_CODE} przekroczony – wydaje kredyt ${pending} ${CURRENCY_CODE}.`);
      liveBalance = parseFloat(await creditStoreAccount(token, pending));
      issuedThisRun = pending;
      unlocked = true;
      pending = 0;
    }
  } else if (newCommissionTotal > 0) {
    console.log(`HENNA10: prog juz odblokowany – dopisuje ${newCommissionTotal} ${CURRENCY_CODE} do kredytu.`);
    liveBalance = parseFloat(await creditStoreAccount(token, newCommissionTotal));
    issuedThisRun = newCommissionTotal;
  }

  if (issuedThisRun > 0) {
    // oznacz jako "zaliczone do kredytu" wszystkie wpisy, ktore jeszcze nie byly oznaczone
    for (const entry of ledger) {
      if (!entry.credited) entry.credited = true;
    }
  }

  await saveCustomerState(token, { pending, unlocked, lastProcessedAt: latestProcessedAt });
  await saveLedger(ledger);

  const totalCommissionAllTime = round2(ledger.reduce((s, o) => s + o.commission, 0));
  const html = renderHtml(ledger, { pending, unlocked, liveBalance, totalCommissionAllTime });
  await mkdir(new URL("../docs/", import.meta.url), { recursive: true });
  await writeFile(HTML_PATH, html, "utf8");

  console.log("HENNA10: gotowe.");
  console.log(
    `Stan po: pending=${pending} unlocked=${unlocked} lastProcessedAt=${latestProcessedAt} liveBalance=${liveBalance} issuedThisRun=${issuedThisRun}`
  );
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runOnce().catch((err) => {
    console.error("HENNA10 – blad:", err);
    process.exit(1);
  });
}
