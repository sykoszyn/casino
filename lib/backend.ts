const BACKEND_URL = process.env.NEXT_PUBLIC_WHATSAPP_BACKEND_URL || 'http://localhost:4000';

async function request(path: string, options?: RequestInit) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status} llamando a ${path}`);
  return data;
}

export const whatsappBackend = {
  connect: (instanceId: string) => request(`/instances/${instanceId}/connect`, { method: 'POST' }),
  requestPairingCode: (instanceId: string, phoneNumber: string) =>
    request(`/instances/${instanceId}/pairing-code`, {
      method: 'POST',
      body: JSON.stringify({ phoneNumber }),
    }),
  disconnect: (instanceId: string) => request(`/instances/${instanceId}/disconnect`, { method: 'POST' }),
  remove: (instanceId: string) => request(`/instances/${instanceId}`, { method: 'DELETE' }),
  status: (instanceId: string) => request(`/instances/${instanceId}/status`),
  send: (instanceId: string, to: string, text: string) =>
    request(`/instances/${instanceId}/send`, { method: 'POST', body: JSON.stringify({ to, text }) }),
  sendMedia: (instanceId: string, to: string, mediaBase64: string, mimeType: string, caption?: string) =>
    request(`/instances/${instanceId}/send-media`, {
      method: 'POST',
      body: JSON.stringify({ to, mediaBase64, mimeType, caption }),
    }),
  setBlocked: (instanceId: string, jid: string, blocked: boolean) =>
    request(`/instances/${instanceId}/block`, { method: 'POST', body: JSON.stringify({ jid, blocked }) }),
};
