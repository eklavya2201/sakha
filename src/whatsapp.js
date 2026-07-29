const GRAPH_VERSION = process.env.GRAPH_VERSION || "v23.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

function authHeaders() {
  return { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
}

async function graphFetch(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...authHeaders(), ...options.headers } });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${await res.text()}`);
  return res;
}

// A media id from a webhook resolves to a short-lived download URL.
export async function downloadMedia(mediaId) {
  const meta = await (await graphFetch(`${GRAPH}/${mediaId}`)).json();
  const file = await graphFetch(meta.url);
  return Buffer.from(await file.arrayBuffer());
}

