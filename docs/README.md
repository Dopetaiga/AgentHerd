# AgentHerd docs

| Folder | Answers | Who writes it |
| --- | --- | --- |
| [spec/](spec/00-baseline.md) | **What** AgentHerd does and its contracts | Maintainer, with agents; updated with every behavior change |
| [adr/](adr/README.md) | **Why** a hard-to-reverse choice was made | One ADR per decision; never edited after acceptance |
| [../plans/](../plans/README.md) | **How** to build the next step, as executable steps for an agent | Written before implementation, kept after |
| [references.md](references.md) | Which projects we studied and what we took from them | |

How a change flows:

1. A new need or question goes into `spec/open-questions.md` or straight into a spec draft.
2. A choice with real alternatives becomes an ADR.
3. When the spec is stable, a plan splits the work into verified steps.
4. An agent (or a human) executes the plan; code, spec, tests and the plan state change together.

Writing style: English, short sentences, common words, tables for facts, one H1 per page,
relative links. Facts that are not yet checked are marked **(verify)** and listed as open questions.
