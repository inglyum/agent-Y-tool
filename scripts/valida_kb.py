#!/usr/bin/env python3
"""Controlla le schede in knowledge/: fonti presenti, data_verifica valida e non scaduta."""
import datetime
import pathlib
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent / "knowledge"
MAX_GIORNI = 30  # oltre questa età i dati commerciali vanno riverificati


def valorizzato(v):
    if isinstance(v, dict):
        return any(valorizzato(x) for x in v.values())
    return v not in (None, [], "")


def main():
    errori, avvisi = [], []
    oggi = datetime.date.today()
    for cartella in ("macchine", "accessori", "materiali"):
        for f in sorted((ROOT / cartella).glob("*.yaml")):
            scheda = yaml.safe_load(f.read_text()) or {}
            dati = {k: v for k, v in scheda.items() if k not in ("fonti", "data_verifica", "nome", "slug")}
            if not valorizzato(dati):
                continue
            if not scheda.get("fonti"):
                errori.append(f"{f}: dati presenti senza 'fonti'")
            data = scheda.get("data_verifica")
            if not data:
                errori.append(f"{f}: manca 'data_verifica'")
                continue
            if isinstance(data, str):
                try:
                    data = datetime.date.fromisoformat(data)
                except ValueError:
                    errori.append(f"{f}: data_verifica non valida ({data})")
                    continue
            if valorizzato(scheda.get("commerciale")) and (oggi - data).days > MAX_GIORNI:
                avvisi.append(f"{f}: dati commerciali verificati il {data}, riverificare")
            for p in (scheda.get("parametri_ufficiali") or []):
                if not p.get("fonte"):
                    errori.append(f"{f}: parametro ufficiale senza fonte")
    for a in avvisi:
        print("AVVISO", a)
    for e in errori:
        print("ERRORE", e)
    print(f"{len(errori)} errori, {len(avvisi)} avvisi")
    return 1 if errori else 0


if __name__ == "__main__":
    sys.exit(main())
