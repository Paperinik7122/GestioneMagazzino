// Scheda di un contatto (statistiche e storico), separata da contatti.js per non creare import circolari con ordini.js.
import { all, get, scalar } from '../db/util.js';
import { oggiIso } from './errori.js';
import { elencoOrdini } from './ordini.js';

const GIORNI = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const arrotonda = (n) => Math.round(n * 100) / 100;

/**
 * Scheda di un contatto: ordini aperti e chiusi, quanto ha speso (o quanto abbiamo ordinato, per un
 * fornitore), prodotti più acquistati e abitudini. Conta solo gli ordini chiusi (consegnati/ricevuti).
 * I prodotti sono raggruppati per codice.
 */
export function schedaContatto(db, id, oggi = oggiIso()) {
  const contatto = get(db, 'SELECT * FROM contatti WHERE id = ?', [id]);
  if (!contatto) return null;
  const tipoOrdini = contatto.tipo === 'F' ? 'A' : 'V';
  // il tipo del contatto può non coincidere con i suoi ordini (es. "io"): conta gli ordini veri
  const tutti = elencoOrdini(db, { tipi: ['V', 'A'], conEvasi: true, contattoId: id });
  const mioTipo = tutti.some((o) => o.tipo === tipoOrdini) || !tutti.length ? tipoOrdini : tutti[0].tipo;
  const ordini = tutti.filter((o) => o.tipo === mioTipo);
  const aperti = ordini.filter((o) => !o.evaso);
  const chiusi = ordini.filter((o) => o.evaso).sort((a, b) => (b.data_evasione ?? '').localeCompare(a.data_evasione ?? '') || b.id - a.id);

  const speso = arrotonda(chiusi.reduce((s, o) => s + (o.totale ?? 0), 0));
  const dateChiusura = chiusi.map((o) => o.data_evasione ?? o.data_emissione).sort();
  const ultimo = dateChiusura.at(-1) ?? null;
  const primo = dateChiusura[0] ?? null;
  const unAnnoFa = new Date(Date.parse(oggi) - 365 * 86400000).toISOString().slice(0, 10);
  const spesoUltimoAnno = arrotonda(chiusi.filter((o) => (o.data_evasione ?? o.data_emissione) >= unAnnoFa)
    .reduce((s, o) => s + (o.totale ?? 0), 0));

  // ogni quanti giorni ordina, in media (serve almeno 2 ordini chiusi)
  const giorniMedi = dateChiusura.length >= 2 ? Math.round(GIORNI(primo, ultimo) / (dateChiusura.length - 1)) : null;

  const prodotti = all(db, `SELECT r.codice, MAX(r.nome) AS nome, COUNT(*) AS quantita, SUM(r.prezzo) AS totale,
      MAX(COALESCE(o.data_evasione, o.data_emissione)) AS ultima
    FROM righe_ordine r JOIN ordini o ON o.id = r.ordine_id
    WHERE o.contatto_id = ? AND o.tipo = ? AND o.evaso = 1
    GROUP BY r.codice ORDER BY quantita DESC, totale DESC, nome LIMIT 5`, [id, mioTipo])
    .map((p) => ({ ...p, totale: arrotonda(p.totale) }));
  const nProdotti = scalar(db, `SELECT COUNT(*) FROM righe_ordine r JOIN ordini o ON o.id = r.ordine_id
    WHERE o.contatto_id = ? AND o.tipo = ? AND o.evaso = 1`, [id, mioTipo]) ?? 0;

  const catalogo = all(db, `SELECT catalogo, COUNT(*) AS n FROM ordini WHERE contatto_id = ? AND tipo = ? AND catalogo <> ''
    GROUP BY catalogo ORDER BY n DESC, catalogo LIMIT 1`, [id, mioTipo])[0]?.catalogo ?? null;

  return {
    contatto, tipoOrdini: mioTipo, aperti, chiusi,
    prodottiDaOrdinare: mioTipo === 'V' ? aperti.reduce((s, o) => s + o.daOrdinare, 0) : 0,
    prontiDaConsegnare: mioTipo === 'V' ? aperti.filter((o) => o.nRighe > 0 && o.collegate === o.nRighe).length : 0,
    totaleAperti: arrotonda(aperti.reduce((s, o) => s + o.totaleCorrente, 0)),
    speso, spesoUltimoAnno, nChiusi: chiusi.length, nProdotti,
    media: chiusi.length ? arrotonda(speso / chiusi.length) : null,
    primo, ultimo,
    giorniDallUltimo: ultimo ? GIORNI(ultimo, oggi) : null,
    giorniMedi, prodotti, catalogoFrequente: catalogo,
  };
}
