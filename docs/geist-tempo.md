# Warum der Geist langsam denkt (Recherche 2026-11-19)

## Messung (Testlauf Bit/Albo, Haiku über Claude Code)
- Reaktion nach Event bis zur nächsten Aktion: median 3.6 s (ohne Unterbruch), 5.3 s (plan_failed), 6.2 s (plan_done)
- Eine Modellrunde (Tool-Ergebnis → nächster Toolcall): median 2.1 s, p90 5.3 s
- Kontext pro Runde: ~48k Tokens (10 Mio. Cache-Reads / ~210 Runden); Agentendateien zusammen nur ~20 KB
  → Grossteil ist System-Prompt und Werkzeuge von Claude Code plus wachsender Verlauf
- Neustarts selten (5 Sitzungen in ~2 h): Prozessstart ist nicht der Hauptgrund
- Fast die Hälfte der Befehle sind Einzelbefehle (`MoveTo` 32×, `Wait` 66×) statt `Act`-Pläne (51×)

## Recherche (Quellen)
- Langlebiger Prozess: `claude -p --input-format stream-json --output-format stream-json`, Nachrichten über stdin;
  Agent SDK mit Async-Generator und `interrupt()` – https://code.claude.com/docs/en/cli-reference,
  https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- Schlanker ohne `--bare` (das braucht API-Key): `--system-prompt` ersetzt den System-Prompt, `--tools` schränkt Werkzeuge ein,
  `--strict-mcp-config --mcp-config`, `--disable-slash-commands` – https://code.claude.com/docs/en/cli-reference
- Agent SDK und `claude -p` mit Abo-Login laufen über die Abo-Limits – https://support.claude.com/en/articles/15036540
- Direkte API Haiku 5.5: 0.10 $/0.50 $ pro MTok, Cache-Hit 0.01 $; TTFT mit Thinking low 5.8 s;
  ohne Thinking deutlich schneller (nicht gemessen) – https://platform.claude.com/docs/en/about-claude/pricing,
  https://artificialanalysis.ai/models/releases/claude-haiku-5-5
- Fine-grained Tool Streaming (`eager_input_streaming`) – https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming
- Muster: PIANO/Project Sid (https://arxiv.org/abs/2411.00114), Talker-Reasoner (https://arxiv.org/abs/2410.08328),
  Generative Agents (https://arxiv.org/abs/2304.03442), Voyager (https://arxiv.org/abs/2305.16291), Mindcraft
- Lokal (8 GB): Qwen3.5 4B 97.5 % bei Tool-Calls über LM Studio, Qwen3.5 9B Q4 ~6.6 GB –
  https://www.jdhodges.com/blog/local-llms-on-tool-calling-2026-pt1-local-lm/

## Umgesetzt: Option A (2026-11-19)
Claude-Runner startet mit `--tools ""`, `--mcp-config` (Welt als MCP-Server `welt`), `--setting-sources ""`,
`--disable-slash-commands`, `--effort low`, eigenem `--system-prompt` (Harness-Notiz + `worldRules()` + SOUL.md).
Leerer Lauf: ~24k → ~740 Tokens Grundkontext. Testlauf 90 s mit Haiku (isolierter Server, eigener Datenordner):
- Reaktion nach `plan_done`/`plan_failed` bis zum nächsten `act`: 1.0–2.1 s, mit Gedächtnis-Schreiben dazwischen bis 3.7 s
  (vorher median 3.6–6.2 s)
- ~7k Tokens pro Runde (vorher ~48k); nur noch `act`-Pläne, keine Einzel-`MoveTo`
- Nebeneffekt: Agenten bekommen Gians globales CLAUDE.md und SessionStart-Hook nicht mehr in den Kontext
- Rest: Neustart nach Laufende kostet ~2.7 s (→ Option C)

## Idee für B: Schlafen und Träumen
Energie als neues Bedürfnis; müde Agenten gehen schlafen. Im Schlaf läuft ein eigener Lauf, der das Gedächtnis
ordnet (SEMANTIC/EPISODIC schreiben, „träumen"). Tagsüber schreibt der Geist dann kaum noch → weniger Zusatzrunden.

## Optionen
| # | Option | Gewinn (Schätzung) | Aufwand | Haken |
|---|---|---|---|---|
| A | Claude Code schlank: eigener System-Prompt, nur nötige Werkzeuge, MCP-Tools statt curl, `--effort low` | gross (Kontext 48k → wenige k) | klein–mittel | bleibt Abo; Gedächtnisdateien brauchen weiter Read/Write |
| B | Pro Event eine Runde: Beobachtung im Event, Gedächtnis nur selten/asynchron schreiben | gross | klein | Prompt- und Eventdesign |
| C | Langlebiger Prozess (stream-json über stdin), Events als Nachrichten statt Wait-Polling | mittel | mittel | Kontext wächst, Kompaktierung |
| D | Direkte API, Haiku ohne Thinking, Caching, `say` streamen | gross (~1 s) | mittel | API-Key, kleine Kosten, nicht Abo |
| E | Lokal Qwen3.5 als Talker (Smalltalk, einfache Pläne), Claude als seltener Planer | gross bei Dialog | gross | schwächere Pläne, VRAM |
| F | Bedingte Folgepläne im Körper („wenn Durst > x …") | gefühlt gross | mittel | mehr Serverlogik |
