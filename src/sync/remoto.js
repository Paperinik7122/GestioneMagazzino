// Comunicazione con il servizio sul Raspberry (cartella server/). Solo fetch: si prova anche in Node.

/** Errore di comunicazione. tipo: 'rete' | 'accesso' | 'bloccato' | 'conflitto' | 'rifiutato' | 'server' */
export class ErroreRemoto extends Error {
  constructor(tipo, messaggio, extra = {}) {
    super(messaggio);
    this.name = 'ErroreRemoto';
    this.tipo = tipo;
    Object.assign(this, extra);
  }
}

export function normalizzaCodice(testo) {
  return String(testo ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

async function comprimi(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const flusso = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(flusso).arrayBuffer());
  } catch { return null; }
}

/**
 * base: indirizzo della cartella "api/" (nel browser è relativo alla pagina, quindi funziona
 * qualunque sia il percorso con cui NGINX pubblica l'app, es. /magazzino/).
 */
export function creaRemoto({ base, fetchFn = (...a) => globalThis.fetch(...a) } = {}) {
  const url = (percorso) => new URL(percorso, base ?? new URL('./api/', globalThis.location?.href)).href;

  async function chiama(percorso, { metodo = 'GET', codice = null, intestazioni = {}, corpo, ms = 15000 } = {}) {
    const h = { ...intestazioni };
    if (codice) h.Authorization = `Bearer ${codice}`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      return await fetchFn(url(percorso), { method: metodo, headers: h, body: corpo, cache: 'no-store', signal: ac.signal });
    } catch (e) {
      throw new ErroreRemoto('rete', e?.name === 'AbortError' ? 'Il server non risponde.' : 'Non riesco a raggiungere il server.');
    } finally { clearTimeout(t); }
  }

  async function errore(res) {
    let o = null;
    try { o = await res.json(); } catch { /* risposta non JSON */ }
    const msg = o?.messaggio;
    if (res.status === 401) return new ErroreRemoto('accesso', msg ?? 'Codice di accesso non valido.');
    if (res.status === 429) return new ErroreRemoto('bloccato', msg ?? 'Troppi tentativi: riprova più tardi.');
    if (res.status === 412) return new ErroreRemoto('conflitto', 'I dati sul server sono cambiati.', { revisione: o?.revisione });
    if (res.status === 422 || res.status === 413 || res.status === 400) return new ErroreRemoto('rifiutato', msg ?? 'Il server ha rifiutato i dati.');
    return new ErroreRemoto('server', msg ?? `Il server ha risposto con un errore (${res.status}).`);
  }

  return {
    /** 'ok' = c'è il servizio; 'assente' = niente servizio (es. solo file statici); 'irraggiungibile' = non risponde. */
    async ping() {
      let res;
      try { res = await chiama('ping', { ms: 4000 }); } catch { return 'irraggiungibile'; }
      if (res.status >= 500) return 'irraggiungibile';
      if (!res.ok) return 'assente';
      try {
        const o = await res.json();
        return o?.servizio === 'gestione-magazzino' ? 'ok' : 'assente';
      } catch { return 'assente'; }
    },

    /** { archivio, revisione, aggiornato, dimensione } */
    async stato(codice) {
      const res = await chiama('stato', { codice });
      if (!res.ok) throw await errore(res);
      return res.json();
    },

    /** { bytes, revisione, archivio } */
    async scarica(codice) {
      const res = await chiama('db', { codice, ms: 120000 });
      if (!res.ok) throw await errore(res);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        revisione: Number(res.headers.get('X-Revisione')),
        archivio: res.headers.get('X-Archivio'),
      };
    },

    /** Sostituisce i dati sul server, ma solo se partivano dalla revisione indicata. { revisione, archivio } */
    async carica(codice, bytes, revisioneBase, { forzaStorico = false } = {}) {
      const compressi = await comprimi(bytes);
      const intestazioni = { 'If-Match': `"${revisioneBase}"`, 'Content-Type': 'application/octet-stream' };
      if (compressi) intestazioni['Content-Encoding'] = 'gzip';
      if (forzaStorico) intestazioni['X-Storico'] = 'forza';
      const res = await chiama('db', { metodo: 'PUT', codice, intestazioni, corpo: compressi ?? bytes, ms: 120000 });
      if (!res.ok) throw await errore(res);
      return res.json();
    },
  };
}
