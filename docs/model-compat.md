# Arcade model compatibility report

_Generated 2026-07-16 · team **AI Gateway Early Access Models** (ai-gateway-early-access-models) · 200 models · normalizer: anthropic/claude-haiku-4.5_

Each model ran the real chess `ModelPlayer` fallback ladder once from the start position. Status = the highest rung that produced a **legal, attributable** move.

| status | meaning |
| --- | --- |
| `STRUCTURED` | native structured output (JSON schema) gave a legal move |
| `TEXT` | no structured-output support → plain-text soft parse recovered the move |
| `NORMALIZED` | both deterministic rungs failed → 2nd-LLM normalizer recovered it |
| `FALLBACK` | every rung failed → random legal move only (last resort) |
| `ACCESS` | provider unreachable on this team (403 / no_providers_available) |
| `TIMEOUT` / `ERROR` | deadline / other failure |

## Summary

- **Playable (STRUCTURED + TEXT + NORMALIZED): 194 / 200**
- STRUCTURED: 176
- TEXT: 18
- NORMALIZED: 0
- FALLBACK: 3
- ACCESS: 0
- TIMEOUT: 3
- ERROR: 0

## Results

| model | status | structured | move | ms | detail |
| --- | --- | --- | --- | --- | --- |
| `alibaba/qwen-3-235b` | STRUCTURED | yes | e4 | 1073 |  |
| `alibaba/qwen-3-32b` | STRUCTURED | yes | e4 | 2319 |  |
| `alibaba/qwen-3.6-max-preview` | STRUCTURED | yes | e4 | 16931 |  |
| `alibaba/qwen3-235b-a22b-thinking` | STRUCTURED | yes | e4 | 8488 |  |
| `alibaba/qwen3-coder` | STRUCTURED | yes | e4 | 1677 |  |
| `alibaba/qwen3-coder-30b-a3b` | STRUCTURED | yes | e4 | 604 |  |
| `alibaba/qwen3-coder-next` | STRUCTURED | yes | e4 | 738 |  |
| `alibaba/qwen3-coder-plus` | STRUCTURED | yes | e4 | 2019 |  |
| `alibaba/qwen3-max` | STRUCTURED | yes | e4 | 2525 |  |
| `alibaba/qwen3-max-preview` | STRUCTURED | yes | e4 | 1633 |  |
| `alibaba/qwen3-max-thinking` | STRUCTURED | yes | e4 | 2553 |  |
| `alibaba/qwen3-next-80b-a3b-instruct` | STRUCTURED | yes | e4 | 844 |  |
| `alibaba/qwen3-next-80b-a3b-thinking` | STRUCTURED | yes | e4 | 5750 |  |
| `alibaba/qwen3-vl-235b-a22b-instruct` | STRUCTURED | yes | e4 | 1676 |  |
| `alibaba/qwen3-vl-instruct` | STRUCTURED | yes | e4 | 1390 |  |
| `alibaba/qwen3-vl-thinking` | STRUCTURED | yes | e4 | 3879 |  |
| `alibaba/qwen3.5-flash` | STRUCTURED | yes | e4 | 14692 |  |
| `alibaba/qwen3.5-plus` | STRUCTURED | yes | e4 | 27715 |  |
| `alibaba/qwen3.6-plus` | STRUCTURED | yes | e4 | 17285 |  |
| `alibaba/qwen3.7-max` | STRUCTURED | yes | e4 | 7146 |  |
| `alibaba/qwen3.7-plus` | STRUCTURED | yes | e4 | 10220 |  |
| `amazon/nova-2-lite` | STRUCTURED | yes | e4 | 829 |  |
| `amazon/nova-lite` | STRUCTURED | yes | e4 | 654 |  |
| `amazon/nova-micro` | STRUCTURED | yes | e4 | 527 |  |
| `amazon/nova-pro` | STRUCTURED | yes | e4 | 713 |  |
| `anthropic/claude-3-haiku` | STRUCTURED | yes | e4 | 999 |  |
| `anthropic/claude-fable-5` | STRUCTURED | yes | e4 | 4056 |  |
| `anthropic/claude-haiku-4.5` | STRUCTURED | yes | e4 | 1257 |  |
| `anthropic/claude-opus-4` | STRUCTURED | yes | e4 | 3037 |  |
| `anthropic/claude-opus-4.1` | STRUCTURED | yes | e4 | 3642 |  |
| `anthropic/claude-opus-4.5` | STRUCTURED | yes | e4 | 2014 |  |
| `anthropic/claude-opus-4.6` | STRUCTURED | yes | e4 | 3960 |  |
| `anthropic/claude-opus-4.7` | STRUCTURED | yes | e4 | 2233 |  |
| `anthropic/claude-opus-4.7-fast` | STRUCTURED | yes | e4 | 2108 |  |
| `anthropic/claude-opus-4.8` | STRUCTURED | yes | e4 | 2292 |  |
| `anthropic/claude-opus-4.8-fast` | STRUCTURED | yes | e4 | 1437 |  |
| `anthropic/claude-sonnet-4` | STRUCTURED | yes | e4 | 1450 |  |
| `anthropic/claude-sonnet-4.5` | STRUCTURED | yes | e4 | 1799 |  |
| `anthropic/claude-sonnet-4.6` | STRUCTURED | yes | e4 | 2733 |  |
| `anthropic/claude-sonnet-5` | STRUCTURED | yes | e4 | 2579 |  |
| `bytedance/seed-1.6` | STRUCTURED | yes | e4 | 9696 |  |
| `bytedance/seed-1.8` | STRUCTURED | yes | e4 | 8566 |  |
| `cohere/command-a` | STRUCTURED | yes | e4 | 1058 |  |
| `deepseek/deepseek-v3.1` | STRUCTURED | yes | e4 | 2610 |  |
| `deepseek/deepseek-v3.1-terminus` | STRUCTURED | yes | e4 | 3524 |  |
| `deepseek/deepseek-v3.2` | STRUCTURED | yes | e4 | 1043 |  |
| `deepseek/deepseek-v3.2-thinking` | STRUCTURED | yes | e4 | 2020 |  |
| `deepseek/deepseek-v4-flash` | STRUCTURED | yes | e4 | 1537 |  |
| `deepseek/deepseek-v4-pro` | STRUCTURED | yes | e4 | 2816 |  |
| `google/gemini-2.5-flash` | STRUCTURED | yes | e4 | 2759 |  |
| `google/gemini-2.5-flash-lite` | STRUCTURED | yes | e4 | 677 |  |
| `google/gemini-2.5-pro` | STRUCTURED | yes | e4 | 7215 |  |
| `google/gemini-3-flash` | STRUCTURED | yes | e4 | 3415 |  |
| `google/gemini-3-pro-image` | STRUCTURED | yes | e4 | 5520 |  |
| `google/gemini-3-pro-preview` | STRUCTURED | yes | e4 | 2972 |  |
| `google/gemini-3.1-flash-image` | STRUCTURED | yes | e4 | 2700 |  |
| `google/gemini-3.1-flash-image-preview` | STRUCTURED | yes | e4 | 2124 |  |
| `google/gemini-3.1-flash-lite` | STRUCTURED | yes | e4 | 1025 |  |
| `google/gemini-3.1-flash-lite-preview` | STRUCTURED | yes | e4 | 913 |  |
| `google/gemini-3.1-pro-preview` | STRUCTURED | yes | e4 | 2469 |  |
| `google/gemini-3.5-flash` | STRUCTURED | yes | e4 | 1312 |  |
| `google/gemini-omni-flash-preview` | STRUCTURED | yes | e4 | 3465 |  |
| `google/gemma-4-26b-a4b-it` | STRUCTURED | yes | e4 | 1302 |  |
| `google/gemma-4-31b-it` | STRUCTURED | yes | e4 | 3824 |  |
| `inception/mercury-2` | STRUCTURED | yes | e4 | 637 |  |
| `inception/mercury-coder-small` | STRUCTURED | yes | e4 | 852 |  |
| `interfaze/interfaze-beta` | STRUCTURED | yes | e4 | 2713 |  |
| `kwaipilot/kat-coder-air-v2.5` | STRUCTURED | yes | e4 | 1421 |  |
| `kwaipilot/kat-coder-pro-v1` | STRUCTURED | yes | e4 | 1658 |  |
| `kwaipilot/kat-coder-pro-v2` | STRUCTURED | yes | e4 | 1785 |  |
| `kwaipilot/kat-coder-pro-v2.5` | STRUCTURED | yes | e4 | 3128 |  |
| `meta/llama-3.1-70b` | STRUCTURED | yes | e4 | 4380 |  |
| `meta/llama-3.1-8b` | STRUCTURED | yes | Nf3 | 1258 |  |
| `meta/llama-4-maverick` | STRUCTURED | yes | e4 | 1309 |  |
| `meta/llama-4-scout` | STRUCTURED | yes | e4 | 1876 |  |
| `meta/muse-spark-1.1` | STRUCTURED | yes | e4 | 13875 |  |
| `minimax/minimax-m2` | STRUCTURED | yes | e4 | 5519 |  |
| `minimax/minimax-m2.1` | STRUCTURED | yes | e4 | 8095 |  |
| `minimax/minimax-m2.1-lightning` | STRUCTURED | yes | e4 | 4996 |  |
| `minimax/minimax-m2.5` | STRUCTURED | yes | e4 | 4662 |  |
| `minimax/minimax-m2.5-highspeed` | STRUCTURED | yes | e4 | 4819 |  |
| `minimax/minimax-m2.7` | STRUCTURED | yes | e4 | 6718 |  |
| `mistral/codestral` | STRUCTURED | yes | e4 | 604 |  |
| `mistral/devstral-2` | STRUCTURED | yes | e4 | 823 |  |
| `mistral/devstral-small-2` | STRUCTURED | yes | e4 | 4048 |  |
| `mistral/magistral-medium` | STRUCTURED | yes | e4 | 1062 |  |
| `mistral/magistral-small` | STRUCTURED | yes | e4 | 617 |  |
| `mistral/ministral-14b` | STRUCTURED | yes | e4 | 1909 |  |
| `mistral/ministral-3b` | STRUCTURED | yes | e4 | 586 |  |
| `mistral/ministral-8b` | STRUCTURED | yes | e4 | 1361 |  |
| `mistral/mistral-large-3` | STRUCTURED | yes | e4 | 1195 |  |
| `mistral/mistral-medium` | STRUCTURED | yes | e4 | 2071 |  |
| `mistral/mistral-medium-3.5` | STRUCTURED | yes | e4 | 879 |  |
| `mistral/mistral-nemo` | STRUCTURED | yes | e4 | 6866 |  |
| `mistral/mistral-small` | STRUCTURED | yes | e4 | 664 |  |
| `mistral/pixtral-12b` | STRUCTURED | yes | e4 | 945 |  |
| `moonshotai/kimi-k2.5` | STRUCTURED | yes | e4 | 11471 |  |
| `moonshotai/kimi-k2.6` | STRUCTURED | yes | e4 | 15841 |  |
| `moonshotai/kimi-k2.7-code` | STRUCTURED | yes | e4 | 2568 |  |
| `moonshotai/kimi-k2.7-code-highspeed` | STRUCTURED | yes | e4 | 1364 |  |
| `morph/morph-v3-fast` | STRUCTURED | yes | e4 | 859 |  |
| `morph/morph-v3-large` | STRUCTURED | yes | e4 | 2341 |  |
| `nvidia/nemotron-3-super-120b-a12b` | STRUCTURED | yes | e4 | 798 |  |
| `nvidia/nemotron-3-ultra-550b-a55b` | STRUCTURED | yes | e4 | 501 |  |
| `nvidia/nemotron-nano-12b-v2-vl` | STRUCTURED | yes | e4 | 599 |  |
| `nvidia/nemotron-nano-9b-v2` | STRUCTURED | yes | e4 | 714 |  |
| `openai/gpt-4.1` | STRUCTURED | yes | e4 | 758 |  |
| `openai/gpt-4.1-mini` | STRUCTURED | yes | e4 | 892 |  |
| `openai/gpt-4.1-nano` | STRUCTURED | yes | e4 | 1582 |  |
| `openai/gpt-4o` | STRUCTURED | yes | e4 | 1314 |  |
| `openai/gpt-4o-mini` | STRUCTURED | yes | e4 | 990 |  |
| `openai/gpt-4o-mini-search-preview` | STRUCTURED | yes | e4 | 1834 |  |
| `openai/gpt-5` | STRUCTURED | yes | e4 | 2451 |  |
| `openai/gpt-5-chat` | STRUCTURED | yes | e4 | 843 |  |
| `openai/gpt-5-codex` | STRUCTURED | yes | e4 | 1024 |  |
| `openai/gpt-5-mini` | STRUCTURED | yes | e4 | 3178 |  |
| `openai/gpt-5-nano` | STRUCTURED | yes | e4 | 5325 |  |
| `openai/gpt-5.1-codex` | STRUCTURED | yes | e4 | 1037 |  |
| `openai/gpt-5.1-codex-max` | STRUCTURED | yes | e4 | 1168 |  |
| `openai/gpt-5.1-codex-mini` | STRUCTURED | yes | e4 | 1062 |  |
| `openai/gpt-5.1-instant` | STRUCTURED | yes | e4 | 3083 |  |
| `openai/gpt-5.1-thinking` | STRUCTURED | yes | e4 | 1761 |  |
| `openai/gpt-5.2` | STRUCTURED | yes | e4 | 1343 |  |
| `openai/gpt-5.2-chat` | STRUCTURED | yes | e4 | 1586 |  |
| `openai/gpt-5.2-codex` | STRUCTURED | yes | e4 | 1297 |  |
| `openai/gpt-5.2-pro` | STRUCTURED | yes | e4 | 8100 |  |
| `openai/gpt-5.3-chat` | STRUCTURED | yes | e4 | 1678 |  |
| `openai/gpt-5.3-codex` | STRUCTURED | yes | e4 | 1335 |  |
| `openai/gpt-5.4` | STRUCTURED | yes | e4 | 1384 |  |
| `openai/gpt-5.4-mini` | STRUCTURED | yes | e4 | 1226 |  |
| `openai/gpt-5.4-nano` | STRUCTURED | yes | e4 | 973 |  |
| `openai/gpt-5.4-pro` | STRUCTURED | yes | e4 | 19070 |  |
| `openai/gpt-5.5` | STRUCTURED | yes | e4 | 2509 |  |
| `openai/gpt-5.5-pro` | STRUCTURED | yes | e4 | 9369 |  |
| `openai/gpt-5.6-luna` | STRUCTURED | yes | e4 | 1035 |  |
| `openai/gpt-5.6-sol` | STRUCTURED | yes | e4 | 1922 |  |
| `openai/gpt-5.6-terra` | STRUCTURED | yes | e4 | 1175 |  |
| `openai/gpt-oss-120b` | STRUCTURED | yes | e4 | 821 |  |
| `openai/gpt-oss-20b` | STRUCTURED | yes | e4 | 1527 |  |
| `openai/gpt-oss-safeguard-20b` | STRUCTURED | yes | e4 | 735 |  |
| `openai/o1` | STRUCTURED | yes | e4 | 2067 |  |
| `openai/o3` | STRUCTURED | yes | e4 | 1305 |  |
| `openai/o3-mini` | STRUCTURED | yes | e4 | 1658 |  |
| `openai/o3-pro` | STRUCTURED | yes | e4 | 13244 |  |
| `openai/o4-mini` | STRUCTURED | yes | e4 | 1710 |  |
| `perplexity/sonar` | STRUCTURED | yes | e4 | 2005 |  |
| `perplexity/sonar-pro` | STRUCTURED | yes | e4 | 2349 |  |
| `perplexity/sonar-reasoning-pro` | STRUCTURED | yes | e4 | 4156 |  |
| `stepfun/step-3.7-flash` | STRUCTURED | yes | e4 | 15505 |  |
| `xai/grok-4.1-fast-non-reasoning` | STRUCTURED | yes | e4 | 640 |  |
| `xai/grok-4.1-fast-reasoning` | STRUCTURED | yes | e4 | 3114 |  |
| `xai/grok-4.20-multi-agent` | STRUCTURED | yes | e4 | 2665 |  |
| `xai/grok-4.20-multi-agent-beta` | STRUCTURED | yes | e4 | 4515 |  |
| `xai/grok-4.20-non-reasoning` | STRUCTURED | yes | e4 | 657 |  |
| `xai/grok-4.20-non-reasoning-beta` | STRUCTURED | yes | e4 | 833 |  |
| `xai/grok-4.20-reasoning` | STRUCTURED | yes | e4 | 2112 |  |
| `xai/grok-4.20-reasoning-beta` | STRUCTURED | yes | e4 | 1934 |  |
| `xai/grok-4.3` | STRUCTURED | yes | e4 | 4349 |  |
| `xai/grok-4.5` | STRUCTURED | yes | e4 | 2909 |  |
| `xai/grok-build-0.1` | STRUCTURED | yes | e4 | 4442 |  |
| `xiaomi/mimo-v2.5` | STRUCTURED | yes | e4 | 5267 |  |
| `xiaomi/mimo-v2.5-pro` | STRUCTURED | yes | e4 | 2298 |  |
| `zai/glm-4.5` | STRUCTURED | yes | e4 | 13969 |  |
| `zai/glm-4.5-air` | STRUCTURED | yes | e4 | 12110 |  |
| `zai/glm-4.5v` | STRUCTURED | yes | e4 | 6302 |  |
| `zai/glm-4.6` | STRUCTURED | yes | e4 | 9853 |  |
| `zai/glm-4.6v` | STRUCTURED | yes | e4 | 4596 |  |
| `zai/glm-4.7` | STRUCTURED | yes | e4 | 622 |  |
| `zai/glm-4.7-flash` | STRUCTURED | yes | d4 | 1185 |  |
| `zai/glm-4.7-flashx` | STRUCTURED | yes | e4 | 34361 |  |
| `zai/glm-5` | STRUCTURED | yes | e4 | 946 |  |
| `zai/glm-5-turbo` | STRUCTURED | yes | e4 | 3632 |  |
| `zai/glm-5.1` | STRUCTURED | yes | e4 | 719 |  |
| `zai/glm-5.2` | STRUCTURED | yes | e4 | 5388 |  |
| `zai/glm-5.2-fast` | STRUCTURED | yes | e4 | 1380 |  |
| `zai/glm-5v-turbo` | STRUCTURED | yes | e4 | 3718 |  |
| `deepseek/deepseek-v3` | TEXT | no | e4 | 5539 | structured output unsupported; plain-text fallback |
| `google/gemini-2.5-flash-image` | TEXT | no | e4 | 1812 | structured output unsupported; plain-text fallback |
| `google/gemini-3.1-flash-lite-image` | TEXT | no | e4 | 1566 | structured output unsupported; plain-text fallback |
| `meta/llama-3.2-11b` | TEXT | no | e4 | 785 | structured output unsupported; plain-text fallback |
| `meta/llama-3.2-1b` | TEXT | no | e4 | 540 | structured output unsupported; plain-text fallback |
| `meta/llama-3.2-3b` | TEXT | no | e4 | 1446 | structured output unsupported; plain-text fallback |
| `meta/llama-3.2-90b` | TEXT | no | e4 | 1007 | structured output unsupported; plain-text fallback |
| `meta/llama-3.3-70b` | TEXT | no | e4 | 1146 | structured output unsupported; plain-text fallback |
| `minimax/minimax-m2.7-highspeed` | TEXT | no | e4 | 16226 | structured output unsupported; plain-text fallback |
| `minimax/minimax-m3` | TEXT | no | e4 | 3633 | structured output unsupported; plain-text fallback |
| `moonshotai/kimi-k2` | TEXT | no | e4 | 5395 | structured output unsupported; plain-text fallback |
| `moonshotai/kimi-k2-thinking` | TEXT | no | e4 | 11706 | structured output unsupported; plain-text fallback |
| `nvidia/nemotron-3-nano-30b-a3b` | TEXT | no | e4 | 13163 | structured output unsupported; plain-text fallback |
| `openai/gpt-3.5-turbo` | TEXT | no | e4 | 1048 | structured output unsupported; plain-text fallback |
| `openai/gpt-4-turbo` | TEXT | no | e4 | 2698 | structured output unsupported; plain-text fallback |
| `stepfun/step-3.5-flash` | TEXT | no | e4 | 2286 | structured output unsupported; plain-text fallback |
| `thinkingmachines/inkling` | TEXT | no | e4 | 6257 | structured output unsupported; plain-text fallback |
| `zai/glm-4.6v-flash` | TEXT | no | e4 | 8999 | structured output unsupported; plain-text fallback |
| `alibaba/qwen-3-14b` | FALLBACK | no |  | 748 | all ladder rungs failed — HTTP 400 [AI_APICallError] max_tokens=65536 cannot be greater than max_model_len=max_total_tokens=40960. Please request fewer output tokens. (parameter=max_tokens, value=65536) |
| `alibaba/qwen-3-30b` | FALLBACK | no |  | 812 | all ladder rungs failed — HTTP 400 [AI_APICallError] This model's maximum context length is 40960 tokens. However, you requested 65577 tokens (41 in the messages, 65536 in the completion). Please reduce the |
| `openai/o3-deep-research` | FALLBACK | no |  | 704 | all ladder rungs failed — HTTP 400 [AI_APICallError] Invalid parameter: 'text.format' of type 'json_schema' is not supported with model version `o3-deep-research`. |
| `alibaba/qwen3.6-27b` | TIMEOUT | — |  | 45012 | Delay was aborted |
| `deepseek/deepseek-r1` | TIMEOUT | — |  | 45003 | Delay was aborted |
| `openai/gpt-5-pro` | TIMEOUT | — |  | 45002 | Delay was aborted |

