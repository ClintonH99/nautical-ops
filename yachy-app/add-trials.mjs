import fetch from "node-fetch";

const PADDLE_API_KEY = "pdl_live_apikey_01knwjgtfc8jxnwyexcqvgz03f_QGSMzk4382mdVfY6VYF5xX_Ay0";
const PADDLE_API_URL = "https://api.paddle.com";

async function getAllPrices() {
  console.log("📦 Fetching all prices from Paddle...\n");
  let prices = [];
  let after = null;

  do {
    const url = after
      ? `${PADDLE_API_URL}/prices?per_page=50&after=${after}`
      : `${PADDLE_API_URL}/prices?per_page=50`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${PADDLE_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("❌ Failed to fetch prices:", JSON.stringify(data, null, 2));
      process.exit(1);
    }

    prices = prices.concat(data.data);

    const hasMore = data.meta?.pagination?.has_more;
    after = hasMore ? data.data[data.data.length - 1].id : null;

  } while (after);

  return prices;
}

async function addTrialToPrice(price) {
  const res = await fetch(`${PADDLE_API_URL}/prices/${price.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${PADDLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      trial_period: {
        interval: "day",
        frequency: 30,
      },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`❌ Failed on ${price.id} (${price.name}):`, JSON.stringify(data, null, 2));
    return false;
  }

  console.log(`✅ Trial added → ${price.id} | ${price.name}`);
  return true;
}

async function run() {
  const prices = await getAllPrices();
  console.log(`Found ${prices.length} prices. Adding 30-day trials...\n`);

  let success = 0;
  let failed = 0;

  for (const price of prices) {
    const ok = await addTrialToPrice(price);
    ok ? success++ : failed++;
  }

  console.log(`\n🎉 Done! ${success} succeeded, ${failed} failed.`);
}

run();