// Unione a tre vie (tappa 2): mette insieme le modifiche fatte su questo dispositivo (anche offline)
// con quelle che un altro dispositivo ha già salvato sul server, RIGA PER RIGA.
//
//   base  = i dati come erano all'ultimo allineamento con il server (la copia che ogni dispositivo si tiene)
//   mio   = i dati di questo dispositivo, con le modifiche non ancora inviate
//   loro  = i dati attuali del server
//
// Per ogni riga (riconosciuta dal suo `uid`, mai dal numero `id`, che può coincidere tra dispositivi):
//   - cambiata solo da una parte -> si prende quella (anche se è stata eliminata);
//   - cambiata da entrambe in campi diversi -> si prendono entrambe le modifiche;
//   - stesso campo cambiato in due modi -> vince il più recente, e lo si scrive nel report;
//   - eliminata da una parte e modificata dall'altra -> si tiene la riga (non si perde nulla), e lo si scrive.
// Poi si sistemano le conseguenze: stessi nomi creati su due dispositivi (un solo contatto/posizione),
// numeri doppi (un ordine nuovo prende il primo numero libero), prodotto assegnato a due ordini,
// elementi che puntano a qualcosa di eliminato.
//
// La funzione MODIFICA `loro` (che è una copia appena scaricata, non i dati vivi) e la restituisce:
// il chiamante la invia al server e poi la mette al posto dei dati di questo dispositivo.
import { all, transaction } from '../db/util.js';
import { norm } from '../db/normalizza.js';

// Tabelle con identificativo `uid` (k) o chiave propria; `rif` = colonne che puntano ad altre tabelle.
const TABELLE = [
  { t: 'contatti', k: 'uid', rif: {}, nome: true },
  { t: 'posizioni', k: 'uid', rif: {}, nome: true },
  { t: 'prodotti', k: 'uid', rif: {} },
  { t: 'codici', k: 'codice', rif: { prodotto_id: 'prodotti' }, tecnica: true },
  { t: 'ordini', k: 'uid', rif: { contatto_id: 'contatti' } },
  { t: 'magazzino', k: 'uid', rif: { posizione_id: 'posizioni', ordine_in: 'ordini', ordine_out: 'ordini' } },
  { t: 'righe_ordine', k: 'uid', rif: { ordine_id: 'ordini', magazzino_id: 'magazzino' } },
];
const per = (t) => TABELLE.find((s) => s.t === t);
const SENZA_CONFRONTO = new Set(['id', 'uid', 'updated_at', '_id']);

const NOMI_CAMPI = {
  nome: 'nome', tipo: 'tipo', telefono: 'telefono', indirizzo: 'indirizzo', email: 'e-mail', note: 'note',
  ordine: 'ordine', speciale: 'speciale', data_emissione: 'data di emissione', data_evasione: 'data di evasione',
  contatto_id: 'cliente/fornitore', catalogo: 'catalogo', evaso: 'evaso', totale: 'totale',
  codice: 'codice', posizione_id: 'posizione', data_acquisto: 'data di acquisto', prezzo_acquisto: 'prezzo di acquisto',
  catalogo_acquisto: 'catalogo di acquisto', ordine_in: 'ordine di ingresso', motivo_in: 'motivo di ingresso',
  in_magazzino: 'in magazzino', ordine_out: 'ordine di consegna', motivo_out: 'motivo di uscita',
  prezzo_out: 'prezzo di uscita', data_uscita: 'data di uscita', prezzo: 'prezzo', magazzino_id: 'prodotto collegato',
  ricevuta: 'ricevuta', omaggio: 'omaggio', ordine_id: 'ordine',
};

// ---------------------------------------------------------------- lettura

const logico = (mappa, v) => (v === null || v === undefined ? null : (mappa.has(v) ? `u:${mappa.get(v)}` : v));
const eRif = (v) => typeof v === 'string' && v.startsWith('u:');

/** Tutte le righe di un database, con i riferimenti tra tabelle espressi come `u:<uid>` invece che come numeri. */
function leggi(db) {
  const grezze = {};
  const idUid = {};
  for (const s of TABELLE) {
    grezze[s.t] = all(db, `SELECT * FROM ${s.t}`);
    if (s.k === 'uid') idUid[s.t] = new Map(grezze[s.t].map((r) => [r.id, r.uid]));
  }
  const tab = {};
  for (const s of TABELLE) {
    const m = new Map();
    for (const r of grezze[s.t]) {
      const o = { ...r, _id: r.id };
      for (const [col, altra] of Object.entries(s.rif)) o[col] = logico(idUid[altra], r[col]);
      m.set(r[s.k], o);
    }
    tab[s.t] = m;
  }
  const meta = new Map(all(db, 'SELECT chiave, valore FROM meta').map((r) => [r.chiave, r.valore]));
  return { tab, meta };
}

const colonne = (...righe) => {
  const c = new Set();
  for (const r of righe) if (r) for (const k of Object.keys(r)) if (!SENZA_CONFRONTO.has(k)) c.add(k);
  return [...c];
};
const stesso = (a, b) => (a ?? null) === (b ?? null);
const uguali = (a, b) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return colonne(a, b).every((c) => stesso(a[c], b[c]));
};
const piuRecente = (a, b) => ((a.updated_at ?? 0) >= (b.updated_at ?? 0) ? a : b);

// ---------------------------------------------------------------- unione di una tabella

function unisciTabella(s, B, M, T, eventi) {
  const out = new Map();
  const chiavi = new Set([...B.keys(), ...M.keys(), ...T.keys()]);
  for (const k of chiavi) {
    const b = B.get(k); const m = M.get(k); const t = T.get(k);
    const mioCambiato = !uguali(b, m);
    const loroCambiato = !uguali(b, t);
    let r;
    if (!mioCambiato) r = t;
    else if (!loroCambiato) r = m;
    else if (!m && !t) r = undefined;
    else if (!m || !t) { // eliminata da una parte, modificata dall'altra
      r = m ?? t;
      if (b) eventi.push({ tipo: 'eliminata-e-modificata', t: s.t, k, eliminataQui: !m });
    } else if (uguali(m, t)) r = t;
    else {
      r = { ...t };
      for (const c of colonne(m, t, b)) {
        if (stesso(m[c], t[c])) { r[c] = t[c]; continue; }
        if (b && stesso(m[c], b[c])) { r[c] = t[c]; continue; }
        if (b && stesso(t[c], b[c])) { r[c] = m[c]; continue; }
        const vince = piuRecente(m, t) === m ? m : t;
        r[c] = vince[c];
        if (!s.tecnica) eventi.push({ tipo: 'conflitto', t: s.t, k, c, mio: m[c], loro: t[c], vince: vince === m ? 'mio' : 'loro' });
      }
      r.updated_at = Math.max(m.updated_at ?? 0, t.updated_at ?? 0);
      r._id = t._id;
      r.uid = t.uid ?? m.uid;
    }
    if (r) out.set(k, r);
  }
  return out;
}

// ---------------------------------------------------------------- unione dei database

/**
 * @param {{base, mio, loro}} dati  database sql.js. `loro` viene modificato e restituito.
 * @returns {{ db, report: { voci: Array<{tipo:string, testo:string}>, mie: number, loro: number } }}
 */
export function unisci({ base, mio, loro }) {
  const B = leggi(base); const M = leggi(mio); const T = leggi(loro);
  const eventi = [];
  const merged = {};
  const nuoveMie = new Set(); const nuoveLoro = new Set();
  let mie = 0; let loroN = 0;

  for (const s of TABELLE) {
    for (const [k, m] of M.tab[s.t]) if (!B.tab[s.t].has(k)) nuoveMie.add(`${s.t}:${k}`);
    for (const [k, t] of T.tab[s.t]) if (!B.tab[s.t].has(k)) nuoveLoro.add(`${s.t}:${k}`);
    if (!s.tecnica) {
      const chiavi = new Set([...B.tab[s.t].keys(), ...M.tab[s.t].keys(), ...T.tab[s.t].keys()]);
      for (const k of chiavi) {
        if (!uguali(B.tab[s.t].get(k), M.tab[s.t].get(k))) mie += 1;
        if (!uguali(B.tab[s.t].get(k), T.tab[s.t].get(k))) loroN += 1;
      }
    }
    merged[s.t] = unisciTabella(s, B.tab[s.t], M.tab[s.t], T.tab[s.t], eventi);
  }

  // Le conseguenze si sistemano a ripetizione finché non cambia più nulla (un ripristino può creare un nome doppio, ecc.).
  for (let giro = 0; giro < 4; giro += 1) {
    const a = unisciNomiUguali({ merged, B, T, eventi });
    const b = ripristinaGenitori({ merged, B, M, T, eventi });
    if (!a && !b) break;
  }
  togliCollegamentiDoppi(merged, eventi);
  togliCollegamentiVenduti(merged, eventi);
  segnalaDoppiaRicezione(merged, nuoveMie, nuoveLoro, eventi);

  const ids = assegnaId({ merged, B, M, T, eventi });
  const meta = unisciMeta(B.meta, M.meta, T.meta);

  scrivi(loro, merged, ids, meta);
  const report = { voci: descrivi({ eventi, merged, ids, B, M, T }), mie, loro: loroN };
  return { db: loro, report };
}

// ---------------------------------------------------------------- conseguenze

function riscriviRif(merged, da, a) {
  for (const s of TABELLE) {
    for (const [col] of Object.entries(s.rif)) {
      for (const r of merged[s.t].values()) if (r[col] === `u:${da}`) r[col] = `u:${a}`;
    }
  }
}

/** Contatti e posizioni con lo stesso nome (a meno di maiuscole/spazi): un solo elemento. */
function unisciNomiUguali({ merged, B, T, eventi }) {
  let cambiato = false;
  for (const s of TABELLE.filter((x) => x.nome)) {
    const gruppi = new Map();
    for (const [k, r] of merged[s.t]) {
      const chiave = norm(r.nome).toLowerCase();
      if (!gruppi.has(chiave)) gruppi.set(chiave, []);
      gruppi.get(chiave).push(k);
    }
    for (const chiavi of gruppi.values()) {
      if (chiavi.length < 2) continue;
      chiavi.sort((x, y) => (B.tab[s.t].has(y) - B.tab[s.t].has(x)) || (T.tab[s.t].has(y) - T.tab[s.t].has(x)) || (x < y ? -1 : 1));
      const [vincente, ...altri] = chiavi;
      for (const k of altri) {
        const r = merged[s.t].get(k);
        const v = merged[s.t].get(vincente);
        cambiato = true;
        if (B.tab[s.t].has(k) && B.tab[s.t].has(vincente)) {
          // due elementi già esistenti, uno rinominato come l'altro: non si uniscono, si distingue
          let n = 2;
          while ([...merged[s.t].values()].some((x) => norm(x.nome).toLowerCase() === `${norm(r.nome)} (${n})`.toLowerCase())) n += 1;
          eventi.push({ tipo: 'rinominato', t: s.t, k, da: r.nome, a: `${norm(r.nome)} (${n})` });
          r.nome = `${norm(r.nome)} (${n})`;
        } else {
          for (const c of ['telefono', 'indirizzo', 'email', 'note']) if (c in v && !v[c] && r[c]) v[c] = r[c];
          riscriviRif(merged, k, vincente);
          merged[s.t].delete(k);
          eventi.push({ tipo: 'unito', t: s.t, k: vincente, nome: v.nome });
        }
      }
    }
  }
  return cambiato;
}

/** Una riga che punta a qualcosa che nel risultato non c'è più (eliminato da un'altra parte): lo si rimette. */
function ripristinaGenitori({ merged, B, M, T, eventi }) {
  let cambiato = false;
  let ancora = true;
  while (ancora) {
    ancora = false;
    for (const s of TABELLE) {
      for (const r of merged[s.t].values()) {
        for (const [col, altra] of Object.entries(s.rif)) {
          if (!eRif(r[col])) continue;
          const k = r[col].slice(2);
          if (merged[altra].has(k)) continue;
          const candidati = [M.tab[altra].get(k), T.tab[altra].get(k), B.tab[altra].get(k)].filter(Boolean);
          if (!candidati.length) { r[col] = null; continue; }
          merged[altra].set(k, candidati.reduce((x, y) => piuRecente(x, y)));
          eventi.push({ tipo: 'ripristinato', t: altra, k });
          ancora = true;
          cambiato = true;
        }
      }
    }
  }
  return cambiato;
}

/**
 * Uno stesso prodotto di magazzino non può essere assegnato a due ordini: resta quello dell'ordine a cui è già stato
 * consegnato, altrimenti il collegamento più vecchio.
 */
function togliCollegamentiDoppi(merged, eventi) {
  const consegnata = (r) => {
    const p = merged.magazzino.get(String(r.magazzino_id).slice(2));
    return p && !p.in_magazzino && p.ordine_out === r.ordine_id ? 0 : 1;
  };
  const per_prodotto = new Map();
  for (const [k, r] of merged.righe_ordine) {
    if (!eRif(r.magazzino_id)) continue;
    if (!per_prodotto.has(r.magazzino_id)) per_prodotto.set(r.magazzino_id, []);
    per_prodotto.get(r.magazzino_id).push([k, r]);
  }
  for (const [prodotto, righe] of per_prodotto) {
    if (righe.length < 2) continue;
    righe.sort(([, a], [, b]) => (consegnata(a) - consegnata(b)) || ((a.updated_at ?? 0) - (b.updated_at ?? 0)) || (a._id - b._id));
    const [[kTenuta]] = righe;
    for (const [k, r] of righe.slice(1)) {
      r.magazzino_id = null;
      eventi.push({ tipo: 'collegamento-tolto', k, tenuta: kTenuta, prodotto: prodotto.slice(2) });
    }
  }
}

/** Un prodotto già consegnato (su un altro dispositivo) a un ordine non può restare assegnato a un ordine ancora aperto. */
function togliCollegamentiVenduti(merged, eventi) {
  for (const [k, r] of merged.righe_ordine) {
    if (!eRif(r.magazzino_id)) continue;
    const prodotto = merged.magazzino.get(r.magazzino_id.slice(2));
    const ordine = merged.ordini.get(String(r.ordine_id).slice(2));
    if (!prodotto || !ordine || ordine.evaso) continue;
    if (!prodotto.in_magazzino && prodotto.ordine_out !== r.ordine_id) {
      eventi.push({ tipo: 'collegamento-venduto', k, prodotto: r.magazzino_id.slice(2) });
      r.magazzino_id = null;
    }
  }
}

/** Lo stesso ordine fornitore ricevuto su due dispositivi: i prodotti entrati potrebbero essere doppi. Si segnala, non si tocca. */
function segnalaDoppiaRicezione(merged, nuoveMie, nuoveLoro, eventi) {
  const gruppi = new Map();
  for (const [k, r] of merged.magazzino) {
    if (!eRif(r.ordine_in)) continue;
    const mio = nuoveMie.has(`magazzino:${k}`);
    const loro = nuoveLoro.has(`magazzino:${k}`);
    if (!mio && !loro) continue;
    const g = gruppi.get(r.ordine_in) ?? { mio: 0, loro: 0 };
    if (mio) g.mio += 1;
    if (loro) g.loro += 1;
    gruppi.set(r.ordine_in, g);
  }
  for (const [ordine, g] of gruppi) {
    if (g.mio && g.loro) eventi.push({ tipo: 'doppia-ricezione', ordine: ordine.slice(2), mio: g.mio, loro: g.loro });
  }
}

// ---------------------------------------------------------------- numeri (id)

/** I numeri interni (e i numeri d'ordine) sono locali di ogni dispositivo: chi arriva dopo prende il primo libero. */
function assegnaId({ merged, B, M, T, eventi }) {
  const ids = {};
  for (const s of TABELLE.filter((x) => x.k === 'uid')) {
    const usati = new Set();
    const finale = new Map();
    const prova = (k, id) => { if (id != null && !usati.has(id)) { finale.set(k, id); usati.add(id); return true; } return false; };
    const chiavi = [...merged[s.t].keys()].sort();
    for (const k of chiavi) if (T.tab[s.t].has(k)) prova(k, T.tab[s.t].get(k)._id);
    for (const k of chiavi) if (!finale.has(k) && M.tab[s.t].has(k)) prova(k, M.tab[s.t].get(k)._id);
    for (const k of chiavi) if (!finale.has(k) && B.tab[s.t].has(k)) prova(k, B.tab[s.t].get(k)._id);
    let prossimo = Math.max(0, ...usati) + 1;
    for (const k of chiavi) if (!finale.has(k)) { finale.set(k, prossimo); usati.add(prossimo); prossimo += 1; }
    ids[s.t] = finale;
    if (s.t === 'ordini') {
      for (const k of chiavi) {
        const mio = M.tab.ordini.get(k);
        if (mio && !T.tab.ordini.has(k) && finale.get(k) !== mio._id) {
          eventi.push({ tipo: 'rinumerato', k, da: mio._id, a: finale.get(k) });
        }
      }
    }
  }
  return ids;
}

function unisciMeta(b, m, t) {
  const out = new Map();
  for (const k of new Set([...b.keys(), ...m.keys(), ...t.keys()])) {
    let v;
    if (stesso(m.get(k), b.get(k))) v = t.get(k);
    else if (stesso(t.get(k), b.get(k))) v = m.get(k);
    else if (k === 'ultimo_backup') v = [m.get(k), t.get(k)].filter(Boolean).sort().pop();
    else v = t.get(k);
    if (v !== undefined && v !== null) out.set(k, v);
  }
  return out;
}

// ---------------------------------------------------------------- scrittura

function scrivi(db, merged, ids, meta) {
  db.run('PRAGMA foreign_keys = OFF');
  transaction(db, () => {
    for (const s of [...TABELLE].reverse()) db.run(`DELETE FROM ${s.t}`);
    db.run('DELETE FROM meta');
    for (const s of TABELLE) {
      const cols = all(db, `PRAGMA table_info(${s.t})`).map((c) => c.name);
      const sql = `INSERT INTO ${s.t}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      const righe = [...merged[s.t].entries()].sort(([a], [b]) => (a < b ? -1 : 1));
      for (const [k, r] of righe) {
        const valori = cols.map((c) => {
          if (c === 'id') return ids[s.t].get(k);
          if (s.rif[c]) {
            const v = r[c];
            if (eRif(v)) return ids[s.rif[c]].get(v.slice(2));
            return v ?? null;
          }
          return r[c] ?? null;
        });
        db.run(sql, valori);
      }
    }
    for (const [k, v] of meta) db.run('INSERT INTO meta(chiave, valore) VALUES (?, ?)', [k, v]);
  });
}

// ---------------------------------------------------------------- report in italiano

function descrivi({ eventi, merged, ids, B, M, T }) {
  const riga = (t, k) => merged[t]?.get(k) ?? M.tab[t].get(k) ?? T.tab[t].get(k) ?? B.tab[t].get(k);
  const etichetta = (t, k) => {
    const r = riga(t, k);
    if (!r) return 'un elemento';
    if (t === 'contatti') return `il contatto «${r.nome}»`;
    if (t === 'posizioni') return `la posizione «${r.nome}»`;
    if (t === 'ordini') return `l’ordine n. ${ids.ordini.get(k) ?? r._id}`;
    if (t === 'magazzino') return `il prodotto ${r.codice} (${r.nome})`;
    if (t === 'righe_ordine') {
      const o = riga('ordini', String(r.ordine_id).slice(2));
      return `la riga ${r.codice} dell’ordine n. ${o ? (ids.ordini.get(String(r.ordine_id).slice(2)) ?? o._id) : '?'}`;
    }
    return 'un elemento';
  };
  const valore = (v) => {
    if (v === null || v === undefined || v === '') return 'vuoto';
    if (typeof v === 'string') return `«${v.length > 40 ? `${v.slice(0, 40)}…` : v}»`;
    return String(v);
  };
  const voci = [];
  const maius = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  for (const e of eventi) {
    if (e.tipo === 'conflitto') {
      const colonna = NOMI_CAMPI[e.c] ?? e.c.replace(/_/g, ' ');
      let mio = valore(e.mio); let loro = valore(e.loro);
      const rif = per(e.t)?.rif[e.c];
      if (rif) {
        const nome = (v) => (eRif(v) ? (riga(rif, v.slice(2))?.nome ?? riga(rif, v.slice(2))?.id ?? 'altro') : 'vuoto');
        mio = `«${nome(e.mio)}»`; loro = `«${nome(e.loro)}»`;
        if (rif === 'ordini') { mio = eRif(e.mio) ? `n. ${ids.ordini.get(e.mio.slice(2))}` : 'vuoto'; loro = eRif(e.loro) ? `n. ${ids.ordini.get(e.loro.slice(2))}` : 'vuoto'; }
      }
      voci.push({ tipo: 'attenzione', testo: `${maius(etichetta(e.t, e.k))}: ${colonna} cambiato in due modi (qui ${mio}, altrove ${loro}). Ho tenuto il più recente: ${e.vince === 'mio' ? mio : loro}.` });
    } else if (e.tipo === 'eliminata-e-modificata') {
      voci.push({ tipo: 'attenzione', testo: `${maius(etichetta(e.t, e.k))} era stato eliminato ${e.eliminataQui ? 'su questo dispositivo' : 'su un altro dispositivo'} ma modificato dall’altra parte: l’ho tenuto. Se non serve, eliminalo di nuovo.` });
    } else if (e.tipo === 'ripristinato') {
      voci.push({ tipo: 'attenzione', testo: `${maius(etichetta(e.t, e.k))} era stato eliminato ma c’è qualcosa di nuovo che lo usa: l’ho rimesso.` });
    } else if (e.tipo === 'unito') {
      voci.push({ tipo: 'info', testo: `${maius(etichetta(e.t, e.k))} era stato creato su due dispositivi con lo stesso nome: ne ho fatto uno solo.` });
    } else if (e.tipo === 'rinominato') {
      voci.push({ tipo: 'attenzione', testo: `Due ${e.t === 'contatti' ? 'contatti' : 'posizioni'} avevano lo stesso nome «${e.da}»: uno ora si chiama «${e.a}».` });
    } else if (e.tipo === 'rinumerato') {
      voci.push({ tipo: 'attenzione', testo: `L’ordine n. ${e.da} creato su questo dispositivo ora è il n. ${e.a}, perché il numero ${e.da} era già stato usato da un altro dispositivo.` });
    } else if (e.tipo === 'collegamento-tolto') {
      voci.push({ tipo: 'attenzione', testo: `${maius(etichetta('magazzino', e.prodotto))} era assegnato a due ordini: resta con ${etichetta('righe_ordine', e.tenuta)} (consegnato o assegnato prima), ho tolto il collegamento con ${etichetta('righe_ordine', e.k)}. Controlla quell’ordine e collega un altro prodotto.` });
    } else if (e.tipo === 'collegamento-venduto') {
      voci.push({ tipo: 'attenzione', testo: `${maius(etichetta('magazzino', e.prodotto))} è stato consegnato a un altro ordine mentre era assegnato a ${etichetta('righe_ordine', e.k)}: ho tolto quel collegamento. Controlla l’ordine e collega un altro prodotto.` });
    } else if (e.tipo === 'doppia-ricezione') {
      voci.push({ tipo: 'attenzione', testo: `L’ordine fornitore n. ${ids.ordini.get(e.ordine) ?? '?'} risulta ricevuto su due dispositivi (${e.mio} prodotti qui, ${e.loro} altrove): i prodotti in magazzino potrebbero essere doppi. Controlla in Magazzino.` });
    }
  }
  return voci;
}
