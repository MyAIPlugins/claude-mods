# usage-meter

Mod di Claude Code: una riga sopra il prompt, nel desktop e nel terminale, con la percentuale usata del limite settimanale dell'abbonamento e il tempo al reset.

```
Weekly limit 13% · reset 1g 5h (Monday 9, 11:30)   5h 15% · reset 4h 29m
```

- Il dato è quello di `/usage`: arriva dal motore (`session.measure`, finestre `seven_day` e `five_hour`) a ogni risposta del modello. Non è una stima.
- È il limite dell'account: conta anche altre sessioni e dispositivi, ma questa sessione lo aggiorna solo quando fa una richiesta.
- Prima della prima risposta della sessione la riga dice `n/d · in attesa della prima risposta`; senza login con abbonamento `n/d · non riportato`.
- Il 5h compare solo quando le API riportano quella finestra.
- Ambra dall'80%, rosso dal 95%. Un toast per soglia per finestra, ricordato tra sessioni in `$.store`.
- In una finestra stretta cade prima il 5h, poi la data.

Soglie, etichette e intervallo del conto alla rovescia: costanti in cima a `hooks/register.tsx`.

## Installazione

Al prompt di una sessione Claude Code nel terminale:

```
/plugin install usage-meter --marketplace MyAIPlugins/claude-mods
```

Le altre vie (shell, app desktop) sono nel [README del repository](../README.md).

## Sviluppo

Per provarla da una copia locale, in `~/.claude/settings.json`:

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "<percorso>/claude-mods/usage-meter" }
```

Vale per le sessioni avviate dopo la modifica, desktop e terminale. La cartella è osservata: salvare un file ricarica la mod.

```bash
claude plugin validate .
```

```bash
claude plugin test .
```
