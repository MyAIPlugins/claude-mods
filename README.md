# claude-mods

Mod per Claude Code, valide nel terminale e nell'app desktop.

| Mod | Cosa fa |
| --- | --- |
| [usage-meter](usage-meter/) | Riga sopra il prompt con la % usata del limite settimanale dell'abbonamento (e del limite 5h) e il tempo al reset |

## Installazione

Al prompt di una sessione Claude Code nel terminale:

```
/plugin install usage-meter --marketplace MyAIPlugins/claude-mods
```

Rispondi `y` ad `Add marketplace?`, poi scegli lo scope `user` con Invio: la mod è attiva subito e in ogni sessione successiva, anche in quelle del desktop.

Da una shell:

```bash
claude plugin install usage-meter --marketplace MyAIPlugins/claude-mods
```

Nell'app desktop, dove `/plugin` non è disponibile: clic su + accanto al prompt, poi Plugins, Add marketplace con `MyAIPlugins/claude-mods`, poi Add plugin.

## Licenza

MIT, vedi [LICENSE](LICENSE).
