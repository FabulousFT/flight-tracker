// netlify/functions/store.js
// Uses Netlify Blobs for persistent cloud storage.
// Requires Netlify deploy (won't work locally without netlify dev).

const BLOB_KEY = "flights";

export const handler = async (event, context) => {
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
    // Import blobs - available at runtime on Netlify
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name: "flight-tracker", consistency: "strong" });

    // GET → load
    if (event.httpMethod === "GET") {
      const data = await store.get(BLOB_KEY);
      if (data === null || data === undefined) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: "No saved data yet — save first." }),
        };
      }
      return { statusCode: 200, headers, body: data };
    }

    // POST → save
    if (event.httpMethod === "POST") {
      const body = event.body;
      if (!body) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Empty body" }) };
      }

      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
      }

      if (!Array.isArray(parsed?.flights)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Expected { flights: [] }" }) };
      }

      await store.set(BLOB_KEY, body);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          count: parsed.flights.length,
          savedAt: new Date().toISOString(),
        }),
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  } catch (err) {
    console.error("Store error:", err.message);
    // Return a helpful error so the client knows what happened
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: err.message,
        hint: "Netlify Blobs requires deployment on Netlify. Check function logs in Netlify dashboard.",
      }),
    };
  }
};
