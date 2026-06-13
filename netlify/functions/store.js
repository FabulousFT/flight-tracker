// netlify/functions/store.js
// Uses Netlify Blobs — no external accounts, no API keys, no setup.
// @netlify/blobs is provided by Netlify at runtime — do not bundle it.

import { getStore } from "@netlify/blobs";

const BLOB_KEY = "flights";

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  try {
    const store = getStore("flight-tracker");

    if (event.httpMethod === "GET") {
      const data = await store.get(BLOB_KEY);
      if (data === null) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "No saved data yet. Save first." }) };
      }
      return { statusCode: 200, headers, body: data };
    }

    if (event.httpMethod === "POST") {
      const body = event.body;
      if (!body) return { statusCode: 400, headers, body: JSON.stringify({ error: "Empty body" }) };
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed?.flights)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid format" }) };
      }
      await store.set(BLOB_KEY, body);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, count: parsed.flights.length, savedAt: new Date().toISOString() }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  } catch (err) {
    console.error("Store error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
