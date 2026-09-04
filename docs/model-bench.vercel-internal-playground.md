# Arcade model speed benchmark

_Generated 2026-09-04T07:43:49.216Z · team **Internal Playground** (vercel-internal-playground) · each model as seat 0 against one fixed opponent: 5 chess moves, 2 poker hands, Islanders setup + turns to 22 actions. Latency is the whole decision, every fallback rung included._

- fast: 42
- ok: 52
- slow: 31
- broken: 13

| model | verdict | chess p50 s | poker p50 s | islanders p50 s | chess p90 s | poker p90 s | islanders p90 s | retries | $/M in | $/M out | errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `openai/gpt-4.1-nano-fast` | fast | 0.8 | 1.1 | 1.4 | 1.0 | 1.4 | 2.3 | 3 | 0.20 | 0.80 |  |
| `amazon/nova-lite` | fast | 1.2 | 1.0 | 1.4 | 1.4 | 1.0 | 2.4 | 5 | 0.06 | 0.24 |  |
| `google/gemini-3.5-flash-lite` | fast | 0.9 | 1.3 | 1.6 | 1.1 | 1.3 | 2.1 | 1 | 0.30 | 2.50 |  |
| `openai/gpt-4o-fast` | fast | 0.8 | 1.6 | 1.6 | 1.1 | 1.8 | 2.1 | 0 | 4.25 | 17.00 |  |
| `openai/gpt-4o-mini-fast` | fast | 0.9 | 1.3 | 1.6 | 0.9 | 2.4 | 2.6 | 3 | 0.25 | 1.00 |  |
| `openai/gpt-5.4-mini-fast` | fast | 0.8 | 1.6 | 1.3 | 1.3 | 2.9 | 1.8 | 1 | 1.50 | 9.00 |  |
| `amazon/nova-micro` | fast | 0.6 | 0.9 | 1.7 | 1.2 | 1.1 | 4.1 | 18 | 0.04 | 0.14 | No object generated: response did not match schema. |
| `openai/gpt-4.1-fast` | fast | 1.0 | 1.3 | 1.7 | 5.9 | 1.9 | 2.3 | 0 | 3.50 | 14.00 |  |
| `google/gemini-3.1-flash-lite` | fast | 1.1 | 1.4 | 1.8 | 1.4 | 1.8 | 2.0 | 0 | 0.25 | 1.50 |  |
| `amazon/nova-pro` | fast | 0.7 | 1.2 | 1.8 | 0.8 | 1.4 | 2.4 | 1 | 0.80 | 3.20 |  |
| `openai/gpt-5.4-mini` | fast | 0.9 | 1.4 | 1.9 | 1.3 | 1.4 | 2.0 | 0 | 0.75 | 4.50 |  |
| `google/gemini-2.5-flash-lite` | fast | 0.7 | 1.7 | 1.9 | 0.7 | 2.4 | 2.5 | 0 | 0.10 | 0.40 |  |
| `openai/gpt-4o-mini` | fast | 0.9 | 1.9 | 1.8 | 1.3 | 2.2 | 3.0 | 2 | 0.15 | 0.60 |  |
| `openai/gpt-5.2-fast` | fast | 1.2 | 2.1 | 1.9 | 1.3 | 3.9 | 3.0 | 1 | 3.50 | 28.00 |  |
| `openai/gpt-4.1-mini-fast` | fast | 0.7 | 2.1 | 2.1 | 1.0 | 2.1 | 3.0 | 0 | 0.70 | 2.80 |  |
| `openai/gpt-5.3-codex` | fast | 1.5 | 2.1 | 1.8 | 1.8 | 5.4 | 2.0 | 0 | 1.75 | 14.00 |  |
| `openai/gpt-5.3-codex-fast` | fast | 1.6 | 2.1 | 1.6 | 1.9 | 3.6 | 2.0 | 0 | 3.50 | 28.00 |  |
| `anthropic/claude-opus-4.8-fast` | fast | 1.1 | 2.1 | 2.2 | 1.6 | 3.8 | 3.8 | 0 | 10.00 | 50.00 |  |
| `openai/gpt-4.1` | fast | 1.0 | 1.9 | 2.2 | 1.3 | 3.0 | 2.9 | 0 | 2.00 | 8.00 |  |
| `spacexai/grok-4.1-fast-non-reasoning` | fast | 0.8 | 1.4 | 2.3 | 4.1 | 1.6 | 5.5 | 5 | 0.20 | 0.50 |  |
| `openai/gpt-5.4-nano` | fast | 1.2 | 1.6 | 2.4 | 1.3 | 1.9 | 2.8 | 0 | 0.20 | 1.25 |  |
| `openai/gpt-4o` | fast | 0.9 | 2.2 | 2.5 | 1.1 | 2.9 | 3.0 | 0 | 2.50 | 10.00 |  |
| `openai/gpt-4.1-nano` | fast | 0.8 | 1.3 | 2.5 | 1.4 | 1.5 | 8.0 | 15 | 0.10 | 0.40 |  |
| `nvidia/nemotron-nano-12b-v2-vl` | fast | 0.9 | 1.7 | 2.5 | 1.0 | 1.7 | 611.8 | 11 | 0.20 | 0.60 | No object generated: could not parse the response. |
| `openai/gpt-5.1-thinking-fast` | fast | 1.1 | 2.6 | 1.9 | 1.6 | 3.8 | 4.9 | 1 | 2.50 | 20.00 |  |
| `openai/gpt-5.6-luna-fast` | fast | 1.4 | 2.5 | 2.8 | 1.6 | 2.5 | 7.0 | 2 | 0.40 | 2.40 |  |
| `alibaba/qwen-3-32b` | fast | 0.8 | 2.3 | 3.0 | 1.3 | 2.8 | 6.2 | 5 | 0.16 | 0.64 | No object generated: could not parse the response. |
| `openai/gpt-5.4-fast` | fast | 1.3 | 3.1 | 2.0 | 1.5 | 5.9 | 3.1 | 0 | 5.00 | 30.00 |  |
| `openai/gpt-4.1-mini` | fast | 1.1 | 2.7 | 3.2 | 1.3 | 4.2 | 5.5 | 0 | 0.40 | 1.60 |  |
| `nvidia/nemotron-3-super-120b-a12b` | fast | 0.8 | 2.6 | 3.3 | 1.4 | 305.7 | 9.2 | 8 | 0.15 | 0.65 | No object generated: response did not match schema. |
| `openai/gpt-5.2` | fast | 1.6 | 3.3 | 3.5 | 1.7 | 5.3 | 4.2 | 0 | 1.75 | 14.00 |  |
| `openai/gpt-5.4` | fast | 1.3 | 3.5 | 2.7 | 1.5 | 3.8 | 3.7 | 0 | 2.50 | 15.00 |  |
| `amazon/nova-2-lite` | fast | 1.0 | 3.7 | 2.9 | 2.2 | 3.7 | 6.8 | 4 | 0.30 | 2.50 | No output generated. |
| `moonshotai/kimi-k2.5` | fast | 1.1 | 3.0 | 4.0 | 4.8 | 3.0 | 8.0 | 1 | 0.60 | 3.00 | No object generated: could not parse the response. |
| `zai/glm-5.2-fast` | fast | 1.9 | 2.3 | 4.3 | 2.8 | 4.7 | 11.9 | 0 | 2.10 | 6.60 |  |
| `spacexai/grok-4.20-non-reasoning-beta` | fast | 0.8 | 4.3 | 3.8 | 1.0 | 5.3 | 5.0 | 0 | 1.25 | 2.50 |  |
| `spacexai/grok-4.20-non-reasoning` | fast | 0.9 | 4.5 | 4.0 | 1.5 | 5.2 | 5.3 | 0 | 1.25 | 2.50 |  |
| `zai/glm-4.7` | fast | 0.9 | 4.5 | 3.4 | 3.2 | 6.1 | 5.6 | 1 | 0.60 | 2.20 | No object generated: could not parse the response. |
| `zai/glm-5` | fast | 0.9 | 3.3 | 4.6 | 5.2 | 16.6 | 18.2 | 2 | 1.00 | 3.20 | No object generated: could not parse the response. |
| `openai/gpt-5.6-sol-fast` | fast | 1.8 | 4.1 | 4.6 | 2.7 | 4.1 | 11.6 | 0 | 4.00 | 20.00 |  |
| `openai/gpt-5.1-thinking` | fast | 1.3 | 4.6 | 4.0 | 1.4 | 8.3 | 9.8 | 3 | 1.25 | 10.00 |  |
| `openai/gpt-5.6-terra-fast` | fast | 1.4 | 4.7 | 4.7 | 1.6 | 6.5 | 5.8 | 0 | 4.00 | 24.00 |  |
| `anthropic/claude-3-haiku` | ok | 1.1 | 2.6 | 5.1 | 1.3 | 3.7 | 6.2 | 10 | 0.25 | 1.25 | No object generated: response did not match schema. |
| `anthropic/claude-opus-5-fast` | ok | 1.1 | 3.4 | 5.1 | 1.2 | 4.6 | 11.0 | 0 | 10.00 | 50.00 |  |
| `zai/glm-4.7-flash` | ok | 0.8 | 2.3 | 5.1 | 1.9 | 2.6 | 33.6 | 6 | 0.07 | 0.40 | No object generated: could not parse the response. |
| `alibaba/qwen3-coder-30b-a3b` | ok | 5.1 | 3.1 | 2.7 | 16.2 | 10.1 | 7.3 | 17 | 0.15 | 0.60 | No object generated: could not parse the response. |
| `openai/gpt-5.6-luna` | ok | 2.4 | 4.2 | 5.6 | 5.2 | 11.9 | 9.9 | 0 | 0.20 | 1.20 |  |
| `alibaba/qwen3-coder-next` | ok | 2.8 | 3.2 | 5.9 | 3.2 | 6.5 | 14.6 | 2 | 0.50 | 1.20 |  |
| `google/gemini-3.7-flash` | ok | 2.4 | 4.6 | 6.5 | 4.5 | 8.8 | 9.0 | 0 | 0.75 | 3.75 |  |
| `openai/gpt-5.6-terra` | ok | 2.1 | 5.7 | 6.6 | 2.2 | 13.9 | 13.2 | 0 | 2.00 | 12.00 |  |
| `anthropic/claude-opus-4.7` | ok | 2.1 | 4.8 | 6.7 | 2.3 | 23.5 | 15.5 | 0 | 5.00 | 25.00 |  |
| `anthropic/claude-opus-4.8` | ok | 1.9 | 4.2 | 6.9 | 2.5 | 14.4 | 12.5 | 0 | 5.00 | 25.00 |  |
| `alibaba/qwen3-coder` | ok | 2.4 | 3.2 | 6.9 | 3.5 | 3.9 | 14.1 | 10 | 1.50 | 7.50 | No object generated: response did not match schema. |
| `google/gemma-4-26b-a4b-it` | ok | 0.9 | 5.1 | 7.4 | 2.0 | 6.3 | 16.2 | 4 | 0.15 | 0.60 | No object generated: response did not match schema. |
| `openai/o4-mini-fast` | ok | 1.5 | 4.9 | 7.5 | 1.8 | 5.5 | 24.0 | 0 | 2.00 | 8.00 |  |
| `spacexai/grok-4.3` | ok | 4.8 | 8.0 | 5.3 | 4.9 | 8.1 | 6.9 | 0 | 1.25 | 2.50 |  |
| `google/gemini-3.5-flash` | ok | 2.5 | 3.6 | 8.3 | 3.9 | 4.7 | 16.6 | 0 | 1.50 | 9.00 |  |
| `minimax/minimax-m2.1` | ok | 5.3 | 5.4 | 8.3 | 78.3 | 45.5 | 19.3 | 3 | 0.30 | 1.20 |  |
| `google/gemini-3.8-flash` | ok | 2.0 | 3.9 | 8.4 | 3.6 | 3.9 | 11.4 | 0 | 0.75 | 3.75 |  |
| `anthropic/claude-sonnet-5` | ok | 1.7 | 2.5 | 8.5 | 1.9 | 3.1 | 30.9 | 0 | 2.00 | 10.00 |  |
| `google/gemini-3.6-flash` | ok | 2.6 | 3.2 | 8.9 | 8.1 | 6.1 | 15.9 | 0 | 0.75 | 3.75 |  |
| `moonshotai/kimi-k3-fast` | ok | 2.9 | 9.0 | 8.7 | 3.7 | 13.2 | 59.5 | 0 | 4.50 | 22.50 |  |
| `openai/gpt-5.6-sol` | ok | 2.1 | 4.6 | 9.2 | 3.0 | 12.7 | 13.9 | 0 | 2.00 | 10.00 |  |
| `openai/o4-mini` | ok | 2.4 | 4.0 | 9.4 | 3.9 | 4.0 | 25.3 | 1 | 1.10 | 4.40 |  |
| `google/gemini-3.1-pro-preview` | ok | 3.0 | 7.3 | 9.6 | 3.6 | 9.8 | 22.5 | 0 | 2.00 | 12.00 |  |
| `anthropic/claude-sonnet-4` | ok | 1.6 | 5.8 | 9.6 | 2.7 | 8.4 | 12.7 | 0 | 3.00 | 15.00 |  |
| `openai/o3-fast` | ok | 2.4 | 4.5 | 10.0 | 4.0 | 32.3 | 32.8 | 0 | 3.50 | 14.00 |  |
| `anthropic/claude-haiku-4.5` | ok | 1.3 | 4.1 | 10.3 | 1.4 | 4.1 | 34.5 | 0 | 1.00 | 5.00 |  |
| `deepseek/deepseek-v4-flash` | ok | 4.2 | 10.0 | 10.4 | 7.1 | 20.0 | 26.4 | 0 | 0.13 | 0.26 |  |
| `deepseek/deepseek-v3.2` | ok | 1.2 | 8.3 | 10.5 | 4.0 | 20.4 | 21.4 | 0 | 0.28 | 0.42 |  |
| `openai/o3-mini` | ok | 2.4 | 10.5 | 7.1 | 4.3 | 11.8 | 17.1 | 0 | 1.10 | 4.40 |  |
| `alibaba/qwen-3-235b` | ok | 1.6 | 7.0 | 10.7 | 2.3 | 8.3 | 15.9 | 2 | 0.22 | 0.88 | No object generated: response did not match schema. |
| `deepseek/deepseek-v4-flash-0731` | ok | 5.4 | 6.3 | 11.1 | 8.6 | 59.4 | 44.8 | 0 | 0.08 | 0.15 |  |
| `deepseek/deepseek-v3.2-thinking` | ok | 4.0 | 2.8 | 11.3 | 8.2 | 2.8 | 16.5 | 2 | 0.62 | 1.85 |  |
| `openai/gpt-oss-safeguard-120b` | ok | 1.9 | 11.3 | 9.4 | 5.3 | 26.6 | 22.7 | 2 | 0.15 | 0.60 |  |
| `anthropic/claude-fable-5.1` | ok | 5.3 | 7.1 | 11.6 | 5.7 | 11.3 | 23.5 | 0 | 10.00 | 50.00 |  |
| `anthropic/claude-fable-5` | ok | 4.1 | 11.5 | 11.9 | 5.1 | 16.3 | 29.2 | 0 | 10.00 | 50.00 |  |
| `anthropic/claude-opus-4.5` | ok | 2.7 | 9.1 | 13.2 | 2.9 | 19.6 | 22.7 | 1 | 5.00 | 25.00 |  |
| `google/gemini-2.5-flash` | ok | 3.0 | 13.3 | 10.5 | 4.3 | 51.0 | 22.4 | 0 | 0.30 | 2.50 |  |
| `openai/o1` | ok | 5.3 | 6.1 | 13.4 | 10.4 | 14.0 | 42.0 | 1 | 15.00 | 60.00 |  |
| `anthropic/claude-opus-5` | ok | 2.3 | 5.0 | 14.3 | 2.6 | 8.8 | 32.0 | 0 | 5.00 | 25.00 |  |
| `openai/o3` | ok | 4.3 | 4.4 | 15.9 | 10.2 | 7.8 | 42.7 | 0 | 2.00 | 8.00 |  |
| `openai/gpt-oss-20b` | ok | 16.3 | 12.1 | 8.8 | 140.5 | 20.5 | 48.6 | 14 | 0.05 | 0.20 | No output generated. |
| `openai/gpt-5-mini-fast` | ok | 2.3 | 16.6 | 10.7 | 5.4 | 22.3 | 13.9 | 0 | 0.45 | 3.60 |  |
| `minimax/minimax-m3` | ok | 1.5 | 7.4 | 17.1 | 2.8 | 20.2 | 99.0 | 4 | 0.30 | 1.20 |  |
| `openai/gpt-5-fast` | ok | 4.1 | 10.3 | 17.4 | 10.1 | 17.1 | 29.8 | 0 | 2.50 | 20.00 |  |
| `alibaba/qwen3-next-80b-a3b-instruct` | ok | 0.9 | 4.6 | 17.9 | 1.1 | 4.6 | 26.8 | 13 | 0.15 | 1.20 | No object generated: response did not match schema. |
| `nvidia/nemotron-3.5-lightning` | ok | 10.4 | 17.6 | 17.9 | 34.0 | 21.5 | 45.7 | 3 | 0.05 | 0.20 |  |
| `openai/gpt-5.5-fast` | ok | 2.5 | 6.4 | 18.0 | 9.7 | 10.3 | 30.0 | 0 | 12.50 | 75.00 |  |
| `openai/gpt-oss-120b` | ok | 3.8 | 18.4 | 11.9 | 15.3 | 21.3 | 20.2 | 2 | 0.10 | 0.50 |  |
| `openai/gpt-5.5` | ok | 3.1 | 18.8 | 13.2 | 12.7 | 72.4 | 59.9 | 0 | 5.00 | 30.00 |  |
| `zai/glm-5.2` | ok | 3.4 | 10.4 | 19.3 | 5.7 | 12.5 | 42.9 | 0 | 0.80 | 2.55 |  |
| `openai/gpt-5-mini` | ok | 3.1 | 12.5 | 19.4 | 5.8 | 27.8 | 39.5 | 1 | 0.25 | 2.00 |  |
| `spacexai/grok-4.1-fast-reasoning` | ok | 9.9 | 6.1 | 19.6 | 29.3 | 8.8 | 42.7 | 0 | 0.20 | 0.50 |  |
| `anthropic/claude-sonnet-4.5` | slow | 2.5 | 10.2 | 20.1 | 2.8 | 11.1 | 26.6 | 0 | 3.00 | 15.00 |  |
| `spacexai/grok-4.5` | slow | 5.4 | 10.4 | 22.2 | 6.5 | 10.4 | 51.1 | 0 | 2.00 | 6.00 |  |
| `minimax/minimax-m2.5` | slow | 12.0 | 11.7 | 22.3 | 29.4 | 11.7 | 33.4 | 2 | 0.30 | 1.20 | No object generated: could not parse the response. |
| `deepseek/deepseek-v4-pro-0813` | slow | 4.3 | 6.0 | 24.1 | 5.2 | 6.0 | 125.5 | 0 | 0.66 | 1.98 |  |
| `deepseek/deepseek-v4-flash-vision-exp` | slow | 1.8 | 7.8 | 25.1 | 5.1 | 16.6 | 58.9 | 3 | 0.22 | 0.66 |  |
| `alibaba/qwen3-next-80b-a3b-thinking` | slow | 16.1 | 29.2 | 0.9 | 36.3 | 42.5 | 115.8 | 12 | 0.15 | 1.20 | No object generated: response did not match schema. |
| `anthropic/claude-opus-4.6` | slow | 2.9 | 9.8 | 30.2 | 3.3 | 22.5 | 39.3 | 0 | 5.00 | 25.00 |  |
| `anthropic/claude-sonnet-4.6` | slow | 2.8 | 9.0 | 30.7 | 3.2 | 14.5 | 85.0 | 0 | 3.00 | 15.00 |  |
| `google/gemini-3-flash` | slow | 15.0 | 13.2 | 31.2 | 20.0 | 30.5 | 50.8 | 0 | 0.50 | 3.00 |  |
| `spacexai/grok-4.20-multi-agent-beta` | slow | 6.2 | 31.4 | 27.6 | 7.9 | 31.4 | 63.7 | 1 | 1.25 | 2.50 | No object generated: could not parse the response. |
| `spacexai/grok-build-0.1` | slow | 5.5 | 15.7 | 33.3 | 6.3 | 15.7 | 132.7 | 0 | 1.00 | 2.00 |  |
| `spacexai/grok-4.20-multi-agent` | slow | 6.8 | 24.6 | 34.1 | 7.1 | 116.4 | 81.9 | 4 | 1.25 | 2.50 | No object generated: could not parse the response. |
| `google/gemini-2.5-pro` | slow | 7.6 | 15.4 | 34.3 | 12.7 | 25.1 | 51.7 | 0 | 1.25 | 10.00 |  |
| `spacexai/grok-4.20-reasoning` | slow | 4.5 | 34.5 | 19.8 | 6.9 | 42.0 | 64.8 | 0 | 1.25 | 2.50 |  |
| `moonshotai/kimi-k3` | slow | 5.3 | 11.4 | 35.3 | 8.7 | 42.5 | 81.0 | 1 | 3.00 | 15.00 | Failed after 3 attempts. Last error: Service temporarily unavailable. Please try again shortly. |
| `spacexai/grok-4.20-reasoning-beta` | slow | 5.5 | 36.1 | 31.3 | 10.3 | 36.1 | 47.1 | 0 | 1.25 | 2.50 |  |
| `moonshotai/kimi-k2.7-code` | slow | 2.9 | 14.6 | 37.0 | 8.6 | 147.6 | 74.7 | 0 | 0.95 | 4.00 |  |
| `openai/gpt-5` | slow | 11.5 | 31.4 | 38.1 | 19.1 | 183.8 | 69.7 | 0 | 1.25 | 10.00 |  |
| `nvidia/nemotron-nano-9b-v2` | slow | 14.2 | 43.6 | 30.9 | 55.0 | 43.6 | 48.4 | 23 | 0.06 | 0.23 | No object generated: could not parse the response. |
| `openai/o3-pro` | slow | 19.1 | 36.7 | 46.5 | 66.5 | 123.3 | 86.6 | 0 | 20.00 | 80.00 |  |
| `openai/gpt-5-nano` | slow | 14.5 | 49.9 | 36.4 | 24.5 | 64.4 | 114.7 | 7 | 0.05 | 0.40 |  |
| `meta/muse-glimmer-30b` | slow | 14.3 | 53.0 | 28.1 | 41.3 | 100.0 | 83.2 | 1 | 0.35 | 1.50 | No object generated: response did not match schema. |
| `spacexai/grok-4.6` | slow | 9.4 | 22.6 | 55.2 | 12.1 | 28.8 | 122.7 | 0 | 2.00 | 6.00 |  |
| `zai/glm-5.3-flash` | slow | 4.3 | 4.2 | 59.8 | 5.7 | 8.9 | 464.0 | 0 | 0.15 | 0.50 |  |
| `openai/gpt-5.2-pro` | slow | 16.0 | 56.2 | 72.7 | 28.3 | 69.9 | 106.4 | 0 | 21.00 | 168.00 |  |
| `openai/gpt-oss-safeguard-20b` | slow | 10.2 | 50.0 | 73.7 | 97.1 | 147.0 | 132.6 | 2 | 0.07 | 0.20 | No object generated: could not parse the response. |
| `moonshotai/kimi-k2.6` | slow | 7.3 | 42.4 | 78.8 | 13.5 | 91.3 | 197.9 | 0 | 0.95 | 4.00 |  |
| `alibaba/qwen3.8-max` | slow | 2.6 | 10.7 | 90.6 | 3.7 | 50.0 | 230.6 | 0 | 2.00 | 6.00 | No output generated. |
| `alibaba/qwen3.8-2.4t-a95b` | slow | 2.7 | 56.2 | 135.7 | 5.7 | 56.2 | 509.6 | 1 | 2.00 | 6.00 | No output generated. |
| `openai/gpt-5.4-pro` | slow | 19.9 | 132.9 | 237.9 | 42.2 | 149.0 | 276.3 | 0 | 30.00 | 180.00 |  |
| `zai/glm-5.3` | slow | 6.9 | 30.2 | 264.5 | 9.7 | 36.4 | 416.7 | 0 | 0.70 | 2.20 |  |
| `minimax/minimax-m3-free` (free) | broken | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0 | 0.00 | 0.00 | Your team has restricted access to this provider. Contact the owner of the account for more details. |
| `meta/llama-4-maverick` | broken | 0.2 | 0.2 | 0.2 | 0.2 | 0.3 | 0.3 | 0 | 0.24 | 0.97 | This model doesn't support the toolConfig.toolChoice.any field. Remove toolConfig.toolChoice.any and |
| `meta/llama-3.1-70b` | broken | 0.2 | 0.1 | 0.2 | 0.2 | 0.2 | 0.3 | 0 | 0.72 | 0.72 | This model doesn't support the toolConfig.toolChoice.any field. Remove toolConfig.toolChoice.any and |
| `meta/llama-3.3-70b` | broken | 0.1 | 0.2 | 0.2 | 0.2 | 0.2 | 0.3 | 0 | 0.72 | 0.72 | This model doesn't support the toolConfig.toolChoice.any field. Remove toolConfig.toolChoice.any and |
| `meta/llama-3.1-8b` | broken | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0 | 0.22 | 0.22 | This model doesn't support the toolConfig.toolChoice.any field. Remove toolConfig.toolChoice.any and |
| `deepseek/deepseek-r1` | broken | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.3 | 0 | 1.35 | 5.40 | This model doesn't support tool use. |
| `meta/llama-4-scout` | broken | 0.2 | 0.2 | 0.2 | 0.3 | 0.2 | 0.2 | 0 | 0.17 | 0.66 | This model doesn't support the toolConfig.toolChoice.any field. Remove toolConfig.toolChoice.any and |
| `openai/gpt-4-turbo` | broken | 0.3 | 0.3 | 0.3 | 0.4 | 0.3 | 0.5 | 0 | 10.00 | 30.00 | Invalid parameter: 'text.format' of type 'json_schema' is not supported with model version `gpt-4-tu |
| `openai/gpt-3.5-turbo` | broken | 0.4 | 0.4 | 0.3 | 0.5 | 0.4 | 0.5 | 0 | 0.50 | 1.50 | Invalid parameter: 'text.format' of type 'json_schema' is not supported with model version `gpt-3.5- |
| `anthropic/claude-opus-4` | broken | 0.4 | 0.5 | 0.4 | 0.4 | 0.6 | 0.5 | 1 | 15.00 | 75.00 | max_tokens: 128000 > 32000, which is the maximum allowed number of output tokens for claude-opus-4-2 |
| `private/kimi-k3` | broken | 13.3 | 13.2 | 13.4 | 16.0 | 15.3 | 18.3 | 18 |  |  | Failed after 3 attempts. Last error: model has no ready backend |
| `openai/gpt-5.5-pro` | broken | 36.2 | 234.7 | 0.0 | 111.3 | 234.7 | 0.0 | 0 | 30.00 | 180.00 |  |
| `openai/gpt-5-pro` | broken | 84.5 | 575.7 | 0.0 | 462.7 | 575.7 | 0.0 | 2 | 15.00 | 120.00 | Failed after 3 attempts. Last error: Service temporarily unavailable. Please try again shortly. |

