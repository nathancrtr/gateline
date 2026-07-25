# Model Key — Gate Frontend Redesign Competition

This document reveals which AI model produced each candidate. The reviewer did not have this information during evaluation.

| Candidate | Model | Lab | Agent | WebDev Arena Rank |
|---|---|---|---|---|
| **A** | `openrouter/z-ai/glm-5.2` | Zhipu (GLM) | `general` | #4 (1592) |
| **B** | `openrouter/moonshotai/kimi-k2.7-code` | Moonshot (Kimi) | `implementer` | #29 (1470) |
| **C** | `openrouter/deepseek/deepseek-v4-pro` | DeepSeek | `implementer` | #31 (1459) |

## Reviewer's ranking (blind)

1. **Candidate A** (GLM-5.2) — approved, fewest defects, strongest point of view
2. **Candidate B** (Kimi K2.7-code) — request-changes, solid second with fixable issues
3. **Candidate C** (DeepSeek V4 Pro) — request-changes (blocking), profile violation + missing chrome

## Notes

- All three models are frontier open models from different labs, selected via Arena WebDev leaderboard research.
- The model swap required an opencode restart (agent definitions are cached at startup).
- Candidate B was originally built first (mislabeled as "A"), then overwritten when the GLM-5.2 build ran. It was recovered from opencode's SQLite database (which caches all tool outputs) and written to `candidate-b/`.
- The reviewer's verdict aligns with the Arena ranking (A/GLM-5.2 is the highest-ranked model on WebDev and won the competition), though the sample size is too small to draw conclusions about model quality from a single task.
