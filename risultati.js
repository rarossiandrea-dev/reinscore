// ReinScore · la pagina dei risultati in diretta (tappa 5).
//
// Legge dal database pubblico di CloudKit i record che la segreteria pubblica dall'app:
// «m-<id>» (la testata, con l'elenco dei gruppi) e «g-<id>-<gruppo>» (ordine e classifiche).
// L'indirizzo è ...?m=<id>; con ?demo=1 legge demo.json, per provarla senza rete.

const CONFIGURAZIONE = {
  contenitore: "iCloud.com.andrearossi.ReinScore",
  // API token «Pagina risultati» della CloudKit Console (Settings › Tokens & Keys), creato il
  // 2/10/2026. Solo lettura e valido solo da rarossiandrea-dev.github.io: può stare in chiaro.
  token: "18fb0466bc127d43f69c92fac35047285fb3d06a948dc782836ccceaf97a6cfb",
  // «development» finché l'app è in prova; «production» quando è sull'App Store.
  ambiente: "development",
  ogniSecondi: 15,
};

// --- le lingue: quella del browser, se c'è, altrimenti inglese ---

const TESTI = {
  it: { inDiretta: "risultati in diretta", caricamento: "Caricamento…", aggiornato: "Aggiornato alle {0}",
        nonAggiornato: "Non riesco ad aggiornare, riprovo…", nonTrovato: "Risultati non disponibili: la pubblicazione è spenta o l'indirizzo è sbagliato.",
        inPista: "In pista", classifica: "Classifica", ordine: "Ordine di partenza", provvisoria: "Classifica provvisoria",
        ritirato: "Ritirato", zero: "0", noScore: "NS", attesa: "in attesa", runOff: "run-off", tieJudge: "Tie Judge",
        coCampioni: "co-campioni", pattern: "Pattern {0}", giudici: "Giudici: {0}", nessuno: "Ancora nessun punteggio." },
  en: { inDiretta: "live results", caricamento: "Loading…", aggiornato: "Updated at {0}",
        nonAggiornato: "Can't update, retrying…", nonTrovato: "Results not available: publishing is off or the address is wrong.",
        inPista: "In the arena", classifica: "Results", ordine: "Draw", provvisoria: "Provisional results",
        ritirato: "Scratched", zero: "0", noScore: "NS", attesa: "waiting", runOff: "run-off", tieJudge: "Tie Judge",
        coCampioni: "co-champions", pattern: "Pattern {0}", giudici: "Judges: {0}", nessuno: "No scores yet." },
  de: { inDiretta: "Live-Ergebnisse", caricamento: "Lädt…", aggiornato: "Aktualisiert um {0}",
        nonAggiornato: "Aktualisierung fehlgeschlagen, neuer Versuch…", nonTrovato: "Ergebnisse nicht verfügbar: Veröffentlichung aus oder falsche Adresse.",
        inPista: "In der Arena", classifica: "Ergebnisliste", ordine: "Startreihenfolge", provvisoria: "Vorläufiges Ergebnis",
        ritirato: "Zurückgezogen", zero: "0", noScore: "NS", attesa: "wartet", runOff: "Stechen", tieJudge: "Tie Judge",
        coCampioni: "Co-Sieger", pattern: "Pattern {0}", giudici: "Richter: {0}", nessuno: "Noch keine Ergebnisse." },
  fr: { inDiretta: "résultats en direct", caricamento: "Chargement…", aggiornato: "Mis à jour à {0}",
        nonAggiornato: "Mise à jour impossible, nouvel essai…", nonTrovato: "Résultats indisponibles : publication désactivée ou adresse erronée.",
        inPista: "En piste", classifica: "Classement", ordine: "Ordre de départ", provvisoria: "Classement provisoire",
        ritirato: "Forfait", zero: "0", noScore: "NS", attesa: "en attente", runOff: "barrage", tieJudge: "Tie Judge",
        coCampioni: "co-champions", pattern: "Pattern {0}", giudici: "Juges : {0}", nessuno: "Pas encore de score." },
};
const lingua = (navigator.languages || [navigator.language || "en"])
  .map(l => l.slice(0, 2).toLowerCase()).find(l => TESTI[l]) || "en";
document.documentElement.lang = lingua;
function t(chiave, ...argomenti) {
  let testo = (TESTI[lingua][chiave] ?? TESTI.it[chiave] ?? chiave);
  argomenti.forEach((a, i) => { testo = testo.replace("{" + i + "}", a); });
  return testo;
}
document.querySelectorAll("[data-t]").forEach(e => { e.textContent = t(e.dataset.t); });

// I nomi arrivano da chi compila la gara: si scrivono sempre come testo, mai come HTML.
function h(testo) {
  return String(testo ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const parametri = new URLSearchParams(location.search);
const id = (parametri.get("m") || "").replace(/[^a-z0-9]/g, "");
const demo = parametri.get("demo") === "1";

let stato = { testata: null, gruppi: {}, gruppo: null, categoria: {} };

// --- dove si leggono i dati ---

async function leggiDemo() {
  const d = await (await fetch("demo.json", { cache: "no-store" })).json();
  return { testata: d.testata, gruppi: d.gruppi };
}

let database = null;
function apriCloudKit() {
  return new Promise((risolvi, rifiuta) => {
    const avvia = () => {
      CloudKit.configure({
        containers: [{
          containerIdentifier: CONFIGURAZIONE.contenitore,
          apiTokenAuth: { apiToken: CONFIGURAZIONE.token, persist: false },
          environment: CONFIGURAZIONE.ambiente,
        }],
      });
      database = CloudKit.getDefaultContainer().publicCloudDatabase;
      risolvi();
    };
    if (window.CloudKit) { avvia(); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.apple-cloudkit.com/ck/2/cloudkit.js";
    s.async = true;
    s.onerror = rifiuta;
    window.addEventListener("cloudkitloaded", avvia, { once: true });
    document.head.appendChild(s);
  });
}

async function leggiRecord(nomi) {
  const risposta = await database.fetchRecords(nomi);
  // «Non trovato» non è un guasto: la pubblicazione è spenta o l'indirizzo è sbagliato.
  const guasto = (risposta.errors || []).find(e => e.ckErrorCode !== "NOT_FOUND");
  if (guasto) throw guasto;
  const fuori = {};
  for (const r of risposta.records) {
    if (r.fields && r.fields.json) fuori[r.recordName] = JSON.parse(r.fields.json.value);
  }
  return fuori;
}

async function leggiCloudKit() {
  if (!database) await apriCloudKit();
  const testate = await leggiRecord(["m-" + id]);
  const testata = testate["m-" + id];
  if (!testata) return null;
  const nomi = testata.gruppi.map(g => g.record);
  const gruppi = nomi.length ? await leggiRecord(nomi) : {};
  return { testata, gruppi };
}

// --- il disegno ---

function ora() {
  return new Date().toLocaleTimeString(lingua, { hour: "2-digit", minute: "2-digit" });
}

function giorno(iso) {
  const [a, m, g] = iso.split("-").map(Number);
  return new Date(a, m - 1, g).toLocaleDateString(lingua, { day: "numeric", month: "long", year: "numeric" });
}

function totale(riga) {
  if (riga.stato === "ritirato") return `<td class="totale spento">${h(t("ritirato"))}</td>`;
  if (riga.stato === "attesa") return `<td class="totale spento">—</td>`;
  return `<td class="totale">${h(riga.totale)}</td>`;
}

function disegnaTestata() {
  const m = stato.testata;
  document.getElementById("nome").textContent = m.nome;
  document.getElementById("luogo").textContent = [m.luogo, giorno(m.inizio)].filter(Boolean).join(" · ");
  document.title = "ReinScore · " + m.nome;
  const scelte = document.getElementById("gruppi");
  scelte.innerHTML = m.gruppi.length > 1
    ? m.gruppi.map(g => `<button class="scelta ${g.record === stato.gruppo ? "attiva" : ""}" data-gruppo="${h(g.record)}">${h(g.nome)}</button>`).join("")
    : "";
  scelte.querySelectorAll("[data-gruppo]").forEach(b => b.onclick = () => { stato.gruppo = b.dataset.gruppo; disegna(); });
}

function disegnaGruppo() {
  const g = stato.gruppi[stato.gruppo];
  const qui = document.getElementById("contenuto");
  if (!g) { qui.innerHTML = `<div class="vuoto">${h(t("caricamento"))}</div>`; return; }
  let html = "";
  html += `<div class="sotto" style="margin:2px 2px 0">${h(t("pattern", g.pattern))} · ${h(t("giudici", g.giudici.filter(Boolean).join(", ")))}</div>`;

  const inPista = g.inPista ? g.ordine.find(p => p.testiera === g.inPista) : null;
  if (inPista) {
    html += `<div class="carta pista"><div><div class="titolo-carta">${h(t("inPista"))}</div><div class="num">${h(inPista.testiera)}</div></div>
             <div class="chi"><strong>${h(inPista.cavallo)}</strong><span>${h(inPista.cavaliere)}</span></div></div>`;
  }

  if (!stato.categoria[stato.gruppo] || !g.classifiche.some(c => c.categoria === stato.categoria[stato.gruppo])) {
    stato.categoria[stato.gruppo] = g.classifiche[0]?.categoria;
  }
  const scelta = g.classifiche.find(c => c.categoria === stato.categoria[stato.gruppo]);
  if (g.classifiche.length > 1) {
    html += `<nav class="scelte">${g.classifiche.map(c =>
      `<button class="scelta ${c === scelta ? "attiva" : ""}" data-categoria="${h(c.categoria)}">${h(c.categoria)}${c.codice ? " · " + h(c.codice) : ""}</button>`).join("")}</nav>`;
  }
  if (scelta) {
    html += `<div class="carta"><div class="titolo-carta">${h(t("classifica"))} · ${h(scelta.categoria)}</div>`;
    if (scelta.provvisoria) html += `<div class="avviso">${h(t("provvisoria"))}</div>`;
    const righe = scelta.righe.filter(r => r.stato !== "attesa");
    if (!righe.length) html += `<div class="dettaglio">${h(t("nessuno"))}</div>`;
    html += "<table>" + righe.map(r => `
      <tr>
        <td class="posto">${h(r.posto || "--")}</td>
        <td class="testiera">${h(r.testiera)}</td>
        <td><div class="cavallo">${h(r.cavallo)}${r.nota ? `<span class="nota">${h(t(r.nota))}</span>` : ""}</div>
            <div class="dettaglio">${h(r.cavaliere)}${r.proprietario ? " · " + h(r.proprietario) : ""}</div>
            ${r.giudici.length > 1 && r.giudici.some(Boolean) ? `<div class="giudici">${r.giudici.map(h).join(" · ")}</div>` : ""}</td>
        ${totale(r)}
      </tr>`).join("") + "</table></div>";
  }

  html += `<div class="carta"><details><summary>${h(t("ordine"))}</summary><table style="margin-top:8px">` +
    g.ordine.map(p => `
      <tr>
        <td class="testiera">${p.draw}</td>
        <td class="testiera">${h(p.testiera)}</td>
        <td><div class="cavallo ${p.stato === "ritirato" ? "ritirato" : ""}">${h(p.cavallo)}</div>
            <div class="dettaglio">${h(p.cavaliere)} · ${h(p.categorie.join(" · "))}</div></td>
        ${totale(p)}
      </tr>`).join("") + "</table></details></div>";
  qui.innerHTML = html;
  qui.querySelectorAll("[data-categoria]").forEach(b => b.onclick = () => { stato.categoria[stato.gruppo] = b.dataset.categoria; disegna(); });
}

function disegna() {
  disegnaTestata();
  disegnaGruppo();
}

function segnala(ok) {
  document.getElementById("punto").classList.toggle("fermo", !ok);
  document.getElementById("aggiornato").textContent = ok ? t("aggiornato", ora()) : t("nonAggiornato");
}

let ultimo = "";
async function aggiorna() {
  try {
    const dati = demo ? await leggiDemo() : await leggiCloudKit();
    if (!dati) {
      document.getElementById("nome").textContent = "ReinScore";
      document.getElementById("contenuto").innerHTML = `<div class="vuoto">${h(t("nonTrovato"))}</div>`;
      segnala(true);
      return;
    }
    const impronta = JSON.stringify(dati);
    if (impronta !== ultimo) {
      ultimo = impronta;
      stato.testata = dati.testata;
      stato.gruppi = dati.gruppi;
      const records = dati.testata.gruppi.map(g => g.record);
      if (!records.includes(stato.gruppo)) stato.gruppo = records[0] || null;
      disegna();
    }
    segnala(true);
  } catch (e) {
    console.error(e);
    if (!stato.testata) document.getElementById("contenuto").innerHTML = `<div class="vuoto">${h(t("nonAggiornato"))}</div>`;
    segnala(false);
  }
}

if (!id && !demo) {
  document.getElementById("nome").textContent = "ReinScore";
  document.getElementById("contenuto").innerHTML = `<div class="vuoto">${h(t("nonTrovato"))}</div>`;
} else {
  aggiorna();
  setInterval(() => { if (!document.hidden) aggiorna(); }, CONFIGURAZIONE.ogniSecondi * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) aggiorna(); });
}
