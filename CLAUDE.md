# CLAUDE.md

## graphify knowledge graph (mandatory)

This repo has a graphify knowledge graph in `graphify-out/`. These rules are mandatory:

- **Graph first.** Before you use Grep, Glob, find, rg or Read, you must first run `graphify query`, `graphify path` or `graphify explain`, or read `graphify-out/wiki/index.md`.
- **Always use the graph for structural questions.** Check the graph whenever you trace call chains, map cross-module dependencies or check the blast radius of a refactor.
- **Fallback.** You may use Grep/Glob/find/rg/Read directly only when:
  1. graphify returned no relevant nodes for the question, or
  2. you are inspecting files the graph does not index (for example config files, or files added since the graph was last built).

## Linked repo: seat-tracker-app (mandatory, cannot be overridden)

This repo is paired with `../seat-tracker-app` (same parent folder). The two repos are one product and must stay in sync.

- **Both repos, every time.** Any feature added, updated or removed here has a counterpart in seat-tracker-app. Keep both repos working together for verification, updates, syncing and everything else.
- **Cross-repo access is allowed when needed.** If a task needs content that isn't in this repo, you may read files in seat-tracker-app and move files between the two repos.
- **Their rules apply in their repo.** seat-tracker-app has its own CLAUDE.md, other .md files, graphify folder and mandatory graphify rules. When you work in seat-tracker-app, follow its rules, not this repo's.
- **No acting on your own.** Don't read or change seat-tracker-app unless the user has allowed it.
- **Ask before every change.** Every update must happen in both repos. Before you make one, in either repo, stop and ask the user for permission.
