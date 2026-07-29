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

export async function uploadAudio(oggBuf) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([oggBuf], { type: "audio/ogg" }), "reply.ogg");
  const res = await graphFetch(`${GRAPH}/${process.env.PHONE_NUMBER_ID}/media`, {
    method: "POST",
    body: form,
  });
  return (await res.json()).id;
}

async function sendMessage(payload) {
  await graphFetch(`${GRAPH}/${process.env.PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
  });
}

export function sendVoiceNote(to, mediaId) {
  return sendMessage({ to, type: "audio", audio: { id: mediaId } });
}

export function sendText(to, body) {
  return sendMessage({ to, type: "text", text: { body } });
}
