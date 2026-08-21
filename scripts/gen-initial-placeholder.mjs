// Jednorazowy generator startowej (puste) wersji docs/index.html i data/henna10_orders.json,
// zeby repo od razu mialo poprawnie wygladajacy placeholder przed pierwszym prawdziwym uruchomieniem w GitHub Actions.
process.env.SHOPIFY_STORE_DOMAIN = "c2cae8-b1.myshopify.com";
process.env.SHOPIFY_CLIENT_ID = "placeholder";
process.env.SHOPIFY_CLIENT_SECRET = "placeholder";
process.env.AFFILIATE_CUSTOMER_ID = "gid://shopify/Customer/10963720241494";
process.env.DISCOUNT_CODE = "HENNA10";

global.fetch = async (url, opts) => {
  const body = opts?.body ? JSON.parse(opts.body) : {};
  const j = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
  if (url.includes("/admin/oauth/access_token")) return j({ access_token: "placeholder" });
  if (body.query?.includes("customer(id: $id)")) {
    return j({
      data: {
        customer: {
          id: process.env.AFFILIATE_CUSTOMER_ID,
          displayName: "Henna Maria",
          metafields: { edges: [
            { node: { key: "henna10_pending_commission", value: "0" } },
            { node: { key: "henna10_unlocked", value: "false" } },
            { node: { key: "henna10_last_processed_at", value: "2026-08-21T06:55:23Z" } },
          ] },
          storeCreditAccounts: { edges: [] },
        },
      },
    });
  }
  if (body.query?.includes("orders(first: 250")) {
    return j({ data: { orders: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } });
  }
  if (body.query?.includes("metafieldsSet")) {
    return j({ data: { metafieldsSet: { metafields: [], userErrors: [] } } });
  }
  throw new Error("unexpected call in placeholder generator: " + (body.query || "").slice(0, 40));
};

const { runOnce } = await import("./compute-commission.mjs");
await runOnce();
