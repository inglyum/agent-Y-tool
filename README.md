# agent-Y-tool

Agente di consulenza sull'ecosistema xTool (Italia/Europa).

- `AGENT.md` — istruzioni operative / prompt di sistema: fonti, gerarchia, regola "non inventare", flusso Utente → Post-vendita.
- `knowledge/fonti.yaml` — registro delle fonti con priorità.
- `knowledge/schemi/` — modelli di scheda per macchine, accessori, materiali.
- `knowledge/{macchine,accessori,materiali,community}/` — knowledge base (da popolare con dati verificati).
- `scripts/valida_kb.py` — verifica che ogni dato abbia fonte e data di verifica.

```sh
pip install pyyaml
python3 scripts/valida_kb.py
```
