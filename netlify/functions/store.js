// netlify/functions/store.js
// Uses Netlify Blobs - available natively on Netlify, no npm install needed.
// The key fix: use require() not import() for Netlify's built-in modules.

exports.handler = async function(event, context) {
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
    // Netlify Blobs is injected into the runtime environment
    const { getStore } = require("@netlify/blobs");
    const store = getStore("flight-tracker");
    const BLOB_KEY = "flights";

    if (event.httpMethod === "GET") {
      const data = await store.get(BLOB_KEY);
      if (!data) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "No saved data yet — save first." }) };
      }
      return { statusCode: 200, headers, body: data };
    }

    if (event.httpMethod === "POST") {
      const body = event.body;
      if (!body) return { statusCode: 400, headers, body: JSON.stringify({ error: "Empty body" }) };
      let parsed;
      try { parsed = JSON.parse(body); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }
      if (!Array.isArray(parsed?.flights)) return { statusCode: 400, headers, body: JSON.stringify({ error: "Expected { flights: [] }" }) };
      await store.set(BLOB_KEY, body);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, count: parsed.flights.length, savedAt: new Date().toISOString() }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  } catch (err) {
    console.error("Store error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
