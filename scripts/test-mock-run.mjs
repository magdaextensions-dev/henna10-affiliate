// Lokalny test z podstawionym fetch – sprawdza logike bez laczenia sie z prawdziwym Shopify.
process.env.SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
process.env.SHOPIFY_CLIENT_ID = "test_client_id";
process.env.SHOPIFY_CLIENT_SECRET = "test_client_secret";
process.env.AFFILIATE_CUSTOMER_ID = "gid://shopify/Customer/1";
process.env.THRESHOLD_AMOUNT = "50";
process.env.COMMISSION_RATE = "0.05";

// Stan "bazy danych" symulowanego Shopify (in-memory)
let mockState = {
  pending: "0",
  unlocked: "false",
  lastProcessedAt: "2000-01-01T00:00:00Z",
  balance: 0,
};

// Kolejne partie zamowien zwracane przy kolejnych wywolaniach skryptu (symulacja kolejnych miesiecy)
const ORDER_BATCHES = [
  // Run 1: dwa zamowienia, suma prowizji 30 (nie przekracza 50) -> powinno tylko zaktualizowac "pending"
  [
    { id: "gid://shopify/Order/1", name: "#1001", createdAt: "2026-09-01T10:00:00Z", subtotal: "300.00" }, // 5% = 15
    { id: "gid://shopify/Order/2", name: "#1002", createdAt: "2026-09-05T10:00:00Z", subtotal: "300.00" }, // 5% = 15 -> suma pending = 30
  ],
  // Run 2: jedno zamowienie, prowizja 25 -> pending 30+25=55 >= 50 -> powinno wydac kredyt 55, unlocked=true, pending=0
  [
    { id: "gid://shopify/Order/3", name: "#1003", createdAt: "2026-10-01T10:00:00Z", subtotal: "500.00" }, // 5% = 25
  ],
  // Run 3: jedno male zamowienie po odblokowaniu -> powinno dopisac 10 EUR OD RAZU (bez czekania na kolejne 50)
  [
    { id: "gid://shopify/Order/4", name: "#1004", createdAt: "2026-11-01T10:00:00Z", subtotal: "200.00" }, // 5% = 10
  ],
  // Run 4: brak nowych zamowien -> nic sie nie zmienia
  [],
];

let batchIndex = 0;

global.fetch = async (url, opts) => {
  const body = opts?.body ? JSON.parse(opts.body) : {};

  if (url.includes("/admin/oauth/access_token")) {
    return jsonResponse({ access_token: "mock_token", expires_in: 86400 });
  }

  if (url.includes("/graphql.json")) {
    const q = body.query;

    if (q.includes("customer(id: $id)")) {
      return jsonResponse({
        data: {
          customer: {
            id: "gid://shopify/Customer/1",
            displayName: "Henna Maria",
            metafields: {
              edges: [
                { node: { key: "henna10_pending_commission", value: mockState.pending } },
                { node: { key: "henna10_unlocked", value: mockState.unlocked } },
                { node: { key: "henna10_last_processed_at", value: mockState.lastProcessedAt } },
              ],
            },
            storeCreditAccounts: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/StoreCreditAccount/1",
                    balance: { amount: mockState.balance.toFixed(2), currencyCode: "EUR" },
                  },
                },
              ],
            },
          },
        },
      });
    }

    if (q.includes("orders(first: 250")) {
      const batch = ORDER_BATCHES[batchIndex] || [];
      return jsonResponse({
        data: {
          orders: {
            edges: batch.map((o) => ({
              node: {
                id: o.id,
                name: o.name,
                createdAt: o.createdAt,
                cancelledAt: null,
                displayFinancialStatus: "PAID",
                currentSubtotalPriceSet: { shopMoney: { amount: o.subtotal, currencyCode: "EUR" } },
              },
            })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    }

    if (q.includes("storeCreditAccountCredit")) {
      const amount = parseFloat(body.variables.creditInput.creditAmount.amount);
      mockState.balance += amount;
      return jsonResponse({
        data: {
          storeCreditAccountCredit: {
            storeCreditAccountTransaction: {
              id: "gid://shopify/StoreCreditAccountCreditTransaction/1",
              balanceAfterTransaction: { amount: mockState.balance.toFixed(2), currencyCode: "EUR" },
            },
            userErrors: [],
          },
        },
      });
    }

    if (q.includes("metafieldsSet")) {
      for (const mf of body.variables.metafields) {
        if (mf.key === "henna10_pending_commission") mockState.pending = mf.value;
        if (mf.key === "henna10_unlocked") mockState.unlocked = mf.value;
        if (mf.key === "henna10_last_processed_at") mockState.lastProcessedAt = mf.value;
      }
      return jsonResponse({ data: { metafieldsSet: { metafields: [], userErrors: [] } } });
    }
  }

  throw new Error("Nieobsluzone zapytanie w mocku: " + url + " / " + (body.query || "").slice(0, 60));
};

function jsonResponse(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) };
}

const { runOnce } = await import("./compute-commission.mjs?nocache=" + Date.now());

for (let i = 0; i < ORDER_BATCHES.length; i++) {
  batchIndex = i;
  console.log(`\n=== RUN ${i + 1} (batch ${i}) ===`);
  await runOnce();
  console.log("Stan mocka po runie:", JSON.parse(JSON.stringify(mockState)));
}
