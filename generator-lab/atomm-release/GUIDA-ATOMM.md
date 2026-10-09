# Pubblicare i generatori INGLY su Atomm — guida copia e incolla

Ogni cartella qui dentro è **un'app Atomm completa**:

| Cartella | App Atomm (slug) | Cosa fa |
|---|---|---|
| `label-generator/` | label-generator | Targhette, portachiavi, insegne |
| `box-generator/` | box-generator | Scatole a incastro e organizer |
| `layer-light-generator/` | layer-light-generator | Quadri multilivello e lampade |
| `batch-nesting/` | batch-nesting | Disposizione pezzi su lastra |
| `image-prep/` | image-prep | Foto e loghi per incisione |
| `material-cost-lab/` | material-cost-lab | Catalogo materiali e preventivi |

In ogni cartella trovi 3 file:

- `<slug>.html` → il **codice** da caricare (file unico, contiene già tutto: SDK, font, grafica)
- `cover.png` → l'**immagine di copertina** 4:3
- `LISTING.md` → **titolo, descrizioni e mestieri** da copiare

---

## Procedura (uguale per ogni app)

### 0. Scarica i file sul computer
Su GitHub apri la cartella dell'app, clicca su ogni file e poi su **Download raw file** (icona ⤓).
Ti servono `<slug>.html` e `cover.png`. Tieni aperto `LISTING.md` per copiare i testi.

### 1. Crea l'app
Su https://dev.atomm.com/console crea una nuova app e usa come nome lo **slug** della tabella
(per la prima: `label-generator`, che hai già creato).

### 2. Debug locale — puoi saltarlo
Il passo 1 della console ("Aggiungi l'SDK") è **già fatto**: lo script
`platform-sdk.js` è dentro ogni file `.html`.
L'anteprima locale serve solo per provare prima di caricare; vedi "Anteprima locale (facoltativa)" sotto.

### 3. Dettagli dell'annuncio
Apri la scheda **Dettagli dell'annuncio** e incolla da `LISTING.md`:

1. **Immagine di copertina** → carica `cover.png`
2. **Titolo della carta** → copia il blocco "Titolo"
3. **Breve descrizione** → copia il blocco "Breve descrizione"
4. **Descrizione dettagliata** → copia il blocco "Descrizione dettagliata"
5. **Mestiere** → seleziona le voci indicate in "Mestiere da selezionare"
6. Clicca **Salva** (crea la bozza)

### 4. Artefatto di codice
Scheda **artefatto di codice** → trascina il file `<slug>.html` nel riquadro.

### 5. Invia per la revisione
Scheda **Invia per la revisione** → controlla che la checklist sia tutta verde → spunta
la **Dichiarazione di autorizzazione commerciale** → **Invia per la revisione**.

> Prima di inviare, prova il pulsante **Esporta** della piattaforma nell'anteprima:
> la revisione rifiuta le app senza esportazione funzionante. In queste app l'esportazione è collegata
> all'hook ufficiale `atomm.lifecycle.on('export', …)` e restituisce un file reale (SVG, ZIP, PNG o CSV).
> Se il progetto contiene errori (per esempio un foro fuori dal pezzo), l'esportazione viene rifiutata con un messaggio.

---

## Anteprima locale (facoltativa)

Serve [Node.js](https://nodejs.org) installato. Dalla cartella `generator-lab`:

```bash
npm run serve -- label-generator
```

Poi nella console Atomm, passo **Debug locale**, incolla come indirizzo:

```
http://127.0.0.1:5173
```

Per un'altra app sostituisci `label-generator` con il suo slug.

---

## Cosa verificare prima di inviare (2 minuti)

- [ ] L'anteprima mostra il pezzo e i parametri a destra rispondono
- [ ] Il pulsante **Esporta** della piattaforma scarica un file
- [ ] Il file si apre in LightBurn / xTool Creative Space / Inkscape con le misure giuste in mm
- [ ] Il titolo e le descrizioni sono quelli di `LISTING.md`

## Aggiornare un'app già pubblicata
Ricevi il nuovo `<slug>.html` (stesso percorso), caricalo di nuovo nella scheda **artefatto di codice**
e invia di nuovo per la revisione.
