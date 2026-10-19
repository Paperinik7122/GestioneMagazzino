// Migrazione dal database dell'app B4A (TabMagazzino, TabOrdini, ...) allo schema v1.
// Non modifica mai il vecchio DB. Restituisce un report con conteggi e anomalie
// da mostrare all'utente.

import { all, run, scalar, transaction } from './util.js';
import { creaSchema, POSIZIONE_DA_COLLOCARE } from './schema.js';
import { norm, chiave, chiaveEquivalenza } from './normalizza.js';

const MOTIVI_IN = { inventario: 'Inventario', trovato: 'Trovato', regalo: 'Regalo' };
const MOTIVI_OUT = {
  usato: 'Usato', usata: 'Usato', perso: 'Perso', persa: 'Perso',
  regalato: 'Regalato', regalata: 'Regalato', buttato: 'Buttato', buttata: 'Buttato',
};

/** "gg.mm.aaaa" -> "AAAA-MM-GG" (null se non valida). */
export function dataIso(s) {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(norm(s));
  if (!m) return null;
  const [, g, me, a] = m;
  const d = new Date(Date.UTC(+a, +me - 1, +g));
  if (d.getUTCFullYear() !== +a || d.getUTCMonth() !== +me - 1 || d.getUTCDate() !== +g) return null;
  return `${a}-${me.padStart(2, '0')}-${g.padStart(2, '0')}`;
}

/** Numero da testo italiano ("6,5" o "6.5"); null se vuoto o non valido. */
export function numero(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = norm(v).replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Variante più frequente di un insieme di scritture (a parità, la prima incontrata). */
function piuFrequente(valori) {
  const conta = new Map();
  for (const v of valori) conta.set(v, (conta.get(v) ?? 0) + 1);
  let best = null;
  let bestN = -1;
  for (const [v, n] of conta) if (n > bestN) { best = v; bestN = n; }
  return best;
}

export function posizioneCanonica(s) {
  const t = norm(s);
  if (t === '') return '';
  if (/^(temporane[ao]|provvisori[ao])$/i.test(t)) return POSIZIONE_DA_COLLOCARE;
  return t;
}

export function catalogoCanonico(s) {
  return norm(s).toUpperCase();
}

/**
 * @param oldDb database sql.js del vecchio formato (sola lettura)
 * @param newDb database sql.js vuoto: viene creato lo schema v1 e riempito
 */
export function migraDaB4A(oldDb, newDb) {
  const report = { conteggi: {}, anomalie: [], proposteUnioneContatti: [] };
  const anomalia = (tipo, n, esempi = []) => {
    if (n > 0) report.anomalie.push({ tipo, n, esempi: esempi.slice(0, 5) });
  };

  const vOrdini = all(oldDb, 'SELECT * FROM TabOrdini ORDER BY Numero');
  const vRighe = all(oldDb, 'SELECT rowid AS rid, * FROM TabDettaglioOrdini ORDER BY rowid');
  const vMag = all(oldDb, 'SELECT rowid AS rid, * FROM TabMagazzino ORDER BY rowid');
  const ordiniPerNumero = new Map(vOrdini.map((o) => [Number(o.Numero), o]));

  transaction(newDb, () => {
    creaSchema(newDb);

    // ---- Contatti: unisco solo le varianti che differiscono per maiuscole e spazi ----
    const varianti = new Map(); // chiave -> { scritture[], tipi:Set }
    for (const o of vOrdini) {
      const k = chiave(o.Contatto);
      if (!k) continue;
      if (!varianti.has(k)) varianti.set(k, { scritture: [], tipi: new Set() });
      const v = varianti.get(k);
      v.scritture.push(norm(o.Contatto));
      v.tipi.add(o.Verso === 'A' ? 'F' : 'C');
    }
    const contattoIdPerChiave = new Map();
    const misti = [];
    for (const [k, v] of varianti) {
      const nome = piuFrequente(v.scritture);
      const tipo = v.tipi.has('C') ? 'C' : 'F';
      if (v.tipi.size > 1) misti.push(nome);
      const { lastId } = run(newDb, 'INSERT INTO contatti(nome, tipo) VALUES (?, ?)', [nome, tipo]);
      contattoIdPerChiave.set(k, lastId);
    }
    anomalia('Contatti usati sia come cliente sia come fornitore', misti.length, misti);
    report.conteggi.contattiOriginali = new Set(vOrdini.map((o) => String(o.Contatto ?? ''))).size;
    report.conteggi.contatti = varianti.size;

    // Proposte di unione: stessa prima parola (da confermare a mano dall'utente).
    const perPrima = new Map();
    for (const [k, id] of contattoIdPerChiave) {
      const prima = k.split(' ')[0];
      if (!perPrima.has(prima)) perPrima.set(prima, []);
      perPrima.get(prima).push(piuFrequente(varianti.get(k).scritture));
    }
    for (const nomi of perPrima.values()) if (nomi.length > 1) report.proposteUnioneContatti.push(nomi);

    // ---- Posizioni ----
    const posVarianti = new Map();
    for (const m of vMag) {
      const c = posizioneCanonica(m.Posizione);
      if (!c) continue;
      const k = c.toLowerCase();
      if (!posVarianti.has(k)) posVarianti.set(k, []);
      posVarianti.get(k).push(c);
    }
    const posIdPerChiave = new Map([[POSIZIONE_DA_COLLOCARE.toLowerCase(),
      scalar(newDb, 'SELECT id FROM posizioni WHERE speciale = 1')]]);
    const nomiPos = [...posVarianti.entries()]
      .filter(([k]) => !posIdPerChiave.has(k))
      .map(([k, v]) => [k, piuFrequente(v)])
      .sort((a, b) => a[1].localeCompare(b[1], 'it', { numeric: true }));
    nomiPos.forEach(([k, nome], i) => {
      const { lastId } = run(newDb, 'INSERT INTO posizioni(nome, ordine) VALUES (?, ?)', [nome, i + 1]);
      posIdPerChiave.set(k, lastId);
    });
    const daCollocareId = posIdPerChiave.get(POSIZIONE_DA_COLLOCARE.toLowerCase());
    report.conteggi.posizioni = posIdPerChiave.size;

    // ---- Ordini ----
    let totaleDiverso = 0;
    const sommaRighe = new Map();
    for (const r of vRighe) {
      const n = Number(r.Ordine);
      sommaRighe.set(n, (sommaRighe.get(n) ?? 0) + (numero(r.Prezzo) ?? 0));
    }
    for (const o of vOrdini) {
      const numeroOrd = Number(o.Numero);
      const evaso = o.Evaso === 'S' ? 1 : 0;
      const emissione = dataIso(o.DataEmissione) ?? '1970-01-01';
      const evasione = evaso ? dataIso(o.DataEvasione) : null;
      let totale = null;
      if (evaso) {
        totale = numero(o.Totale);
        const calc = Math.round((sommaRighe.get(numeroOrd) ?? 0) * 100) / 100;
        if (totale === null) totale = calc;
        else if (Math.abs(totale - calc) > 0.005) totaleDiverso++;
      }
      run(newDb,
        `INSERT INTO ordini(id, tipo, data_emissione, data_evasione, contatto_id, catalogo, note, evaso, totale)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [numeroOrd, o.Verso === 'A' ? 'A' : 'V', emissione, evasione,
          contattoIdPerChiave.get(chiave(o.Contatto)) ?? scalar(newDb, 'SELECT id FROM contatti ORDER BY id LIMIT 1'),
          catalogoCanonico(o.Catalogo), norm(o.Note), evaso, totale]);
    }
    anomalia('Ordini chiusi con totale diverso dalla somma delle righe (tenuto il totale originale)', totaleDiverso);
    report.conteggi.ordini = vOrdini.length;

    // ---- Codici e prodotti equivalenti (nome equivalente => stesso prodotto) ----
    const nomiPerCodice = new Map();
    const aggiungiNome = (codice, nome) => {
      const c = norm(codice);
      if (!c) return;
      if (!nomiPerCodice.has(c)) nomiPerCodice.set(c, []);
      nomiPerCodice.get(c).push(norm(nome));
    };
    for (const m of vMag) aggiungiNome(m.Codice, m.NomeProdotto);
    for (const r of vRighe) aggiungiNome(r.Codice, r.NomeProdotto);
    const prodottoPerNome = new Map();
    let codiciConNomiDiversi = [];
    for (const [codice, nomi] of nomiPerCodice) {
      const nome = piuFrequente(nomi);
      if (new Set(nomi.map(chiave)).size > 1) codiciConNomiDiversi.push(codice);
      const k = chiaveEquivalenza(nome) || chiave(nome);
      if (!prodottoPerNome.has(k)) {
        prodottoPerNome.set(k, run(newDb, 'INSERT INTO prodotti(nome) VALUES (?)', [nome]).lastId);
      }
      run(newDb, 'INSERT INTO codici(codice, nome, prodotto_id) VALUES (?,?,?)',
        [codice, nome, prodottoPerNome.get(k)]);
    }
    anomalia('Codici scritti con nomi diversi (preso il più frequente)', codiciConNomiDiversi.length, codiciConNomiDiversi);
    report.conteggi.codici = nomiPerCodice.size;
    report.conteggi.prodottiEquivalenti = prodottoPerNome.size;

    // ---- Magazzino ----
    // Collegamenti riga -> prodotto: se due righe puntano allo stesso prodotto
    // (id riusati nel vecchio DB) vince quella dell'ordine di uscita.
    const magPerId = new Map(vMag.map((m) => [m.rid, m]));
    const collegamenti = new Map(); // magId -> riga
    const orfani = [];
    const doppi = [];
    for (const r of vRighe) {
      const magId = Number(r.IDMagazzinoAssociato) || 0;
      if (!magId) continue;
      const ord = ordiniPerNumero.get(Number(r.Ordine));
      if (!ord || ord.Verso !== 'V') continue;
      const m = magPerId.get(magId);
      if (!m) { orfani.push(`riga ${r.rid} (ordine ${r.Ordine})`); continue; }
      const gia = collegamenti.get(magId);
      const questaGiusta = String(m.OrdineOut) === String(r.Ordine);
      if (!gia) collegamenti.set(magId, { riga: r, giusta: questaGiusta });
      else {
        doppi.push(`prodotto ${magId}: righe ${gia.riga.rid} e ${r.rid}`);
        if (!gia.giusta && questaGiusta) collegamenti.set(magId, { riga: r, giusta: true });
      }
    }
    const righeCollegate = new Set([...collegamenti.values()].map((c) => c.riga.rid));
    anomalia('Righe d’ordine cliente che puntavano a un prodotto non più in archivio (collegamento tolto)', orfani.length, orfani);
    anomalia('Prodotti collegati da più righe d’ordine (tenuta la riga dell’ordine di uscita)', doppi.length, doppi);

    let senzaPrezzo = [];
    let inOrdineInesistente = 0;
    let uscitiSenzaMotivo = [];
    let senzaPosizione = [];
    let senzaDataAcquisto = 0;
    for (const m of vMag) {
      const inMag = m.InMagazzino === 'si' ? 1 : 0;

      // Entrata: numero ordine fornitore oppure motivo
      let ordineIn = null;
      let motivoIn = null;
      const oin = norm(m.OrdineIn);
      let ordA = null;
      if (/^\d+$/.test(oin)) {
        ordineIn = Number(oin);
        ordA = ordiniPerNumero.get(ordineIn);
        if (!ordA || ordA.Verso !== 'A') { inOrdineInesistente++; ordA = null; }
      } else if (oin) {
        motivoIn = MOTIVI_IN[oin.toLowerCase()] ?? null;
      }
      const dataAcq = ordA ? (dataIso(ordA.DataEvasione) ?? dataIso(ordA.DataEmissione)) : null;
      const catAcq = ordA ? catalogoCanonico(ordA.Catalogo) : '';
      if (!dataAcq) senzaDataAcquisto++;

      // Uscita
      let ordineOut = null;
      let motivoOut = null;
      const oout = norm(m.OrdineOut);
      if (!inMag) {
        if (/^\d+$/.test(oout)) ordineOut = Number(oout);
        else if (oout) motivoOut = MOTIVI_OUT[oout.toLowerCase()] ?? null;
        if (!ordineOut && !motivoOut) uscitiSenzaMotivo.push(`${m.rid} (${norm(m.NomeProdotto)})`);
      }
      // Un prodotto ancora in magazzino ma con OrdineOut è semplicemente "impegnato":
      // il collegamento sta nella riga d'ordine.

      // Prezzo di acquisto
      let prezzoIn = numero(m.PrezzoIn);
      if ((prezzoIn === null || prezzoIn === 0) && ordineIn && ordA) senzaPrezzo.push(m.rid);

      // Posizione
      let pos = posizioneCanonica(m.Posizione);
      let posId = pos ? posIdPerChiave.get(pos.toLowerCase()) : null;
      if (!posId && inMag) { posId = daCollocareId; senzaPosizione.push(`${m.rid} (${norm(m.NomeProdotto)})`); }

      run(newDb,
        `INSERT INTO magazzino(id, codice, nome, posizione_id, data_acquisto, prezzo_acquisto, catalogo_acquisto,
           ordine_in, motivo_in, in_magazzino, ordine_out, motivo_out, prezzo_out, data_uscita, note)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [m.rid, norm(m.Codice), norm(m.NomeProdotto), posId, dataAcq, prezzoIn, catAcq,
          ordineIn, motivoIn, inMag, ordineOut, motivoOut, numero(m.PrezzoOut),
          !inMag && ordineOut ? (dataIso(ordiniPerNumero.get(ordineOut)?.DataEvasione) ?? null) : null,
          norm(m.Note)]);
    }
    anomalia('Prodotti con prezzo di acquisto mancante o a zero (da completare)', senzaPrezzo.length, senzaPrezzo.map(String));
    anomalia('Prodotti entrati con un numero d’ordine che non esiste più (data di acquisto non ricavabile)', inOrdineInesistente);
    anomalia('Prodotti usciti senza ordine né motivo (da completare)', uscitiSenzaMotivo.length, uscitiSenzaMotivo);
    anomalia('Prodotti in magazzino senza posizione (messi in “Da collocare”)', senzaPosizione.length, senzaPosizione);
    report.conteggi.prodottiSenzaDataAcquisto = senzaDataAcquisto;
    report.conteggi.magazzino = vMag.length;
    report.conteggi.inMagazzino = vMag.filter((m) => m.InMagazzino === 'si').length;

    // ---- Righe d'ordine ----
    let ricevutaOrdineAperto = 0;
    for (const r of vRighe) {
      const numeroOrd = Number(r.Ordine);
      const ord = ordiniPerNumero.get(numeroOrd);
      if (!ord) continue;
      let magazzinoId = null;
      let ricevuta = 0;
      if (ord.Verso === 'V') {
        magazzinoId = righeCollegate.has(r.rid) ? Number(r.IDMagazzinoAssociato) : null;
      } else {
        // Ordine fornitore: nel vecchio schema Nuovo=0 significava "spuntata".
        // In un ordine ancora aperto quelle righe erano state create dall'autocompila
        // con Nuovo=0 per errore: le considero da verificare.
        if (ord.Evaso === 'S') ricevuta = Number(r.Nuovo) === 0 ? 1 : 0;
        else { ricevuta = 0; if (Number(r.Nuovo) === 0) ricevutaOrdineAperto++; }
      }
      run(newDb,
        `INSERT INTO righe_ordine(id, ordine_id, codice, nome, prezzo, magazzino_id, ricevuta, omaggio)
         VALUES (?,?,?,?,?,?,?,0)`,
        [r.rid, numeroOrd, norm(r.Codice), norm(r.NomeProdotto), numero(r.Prezzo) ?? 0, magazzinoId, ricevuta]);
    }
    anomalia('Righe di ordini fornitore aperti segnate come già verificate dal vecchio autocompila (rimesse da verificare)', ricevutaOrdineAperto);
    report.conteggi.righeOrdine = vRighe.length;

    run(newDb, "INSERT OR REPLACE INTO meta(chiave, valore) VALUES ('migrato_da_b4a', ?)", [new Date().toISOString()]);
  });

  return report;
}
