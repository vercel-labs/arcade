# Arcade model compatibility

```
Model compatibility matrix · 3 teams · games chess+poker
  ai-gateway-early-access-models     AI Gateway Early Access Models  (2026-07-16, 200 models)
  vercel-internal-playground         Internal Playground  (2026-07-17, 200 models)
  vercel-labs                        Vercel Labs  (2026-07-16, 200 models)

  cell = cp status glyph:  x=ERROR  F=FALLBACK  A=ACCESS  ·=TIMEOUT  N=NORMALIZED  T=TEXT  S=STRUCTURED
  AVAIL is for chess: public=all teams · partial=some · exclusive=one · none

  MODEL                                  ai-gateway-early-access-models  vercel-internal-playground      vercel-labs                     AVAIL
  alibaba/qwen-3-14b                     FF                              AA                              AA                              none
  alibaba/qwen-3-235b                    SS                              SS                              SS                              public
  alibaba/qwen-3-30b                     FF                              AA                              AA                              none
  alibaba/qwen-3-32b                     SS                              SS                              SS                              public
  alibaba/qwen-3.6-max-preview           S·                              AA                              AA                              exclusive:ai-gateway-early-access-models
  alibaba/qwen3-235b-a22b-thinking       SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  alibaba/qwen3-coder                    SS                              SS                              SS                              public
  alibaba/qwen3-coder-30b-a3b            ST                              ST                              SS                              public
  alibaba/qwen3-coder-next               SS                              SS                              SS                              public
  alibaba/qwen3-coder-plus               SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  alibaba/qwen3-max                      SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  alibaba/qwen3-max-preview              SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  alibaba/qwen3-max-thinking             SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  alibaba/qwen3-next-80b-a3b-instruct    SS                              SS                              SS                              public
  alibaba/qwen3-next-80b-a3b-thinking    SS                              SS                              SS                              public
  alibaba/qwen3-vl-235b-a22b-instruct    SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  alibaba/qwen3-vl-instruct              SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  alibaba/qwen3-vl-thinking              SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  alibaba/qwen3.5-flash                  SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  alibaba/qwen3.5-plus                   S·                              AA                              AA                              exclusive:ai-gateway-early-access-models
  alibaba/qwen3.6-27b                    ··                              AA                              AA                              none
  alibaba/qwen3.6-plus                   SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  alibaba/qwen3.7-max                    SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  alibaba/qwen3.7-plus                   SS                              TT                              TS                              public
  amazon/nova-2-lite                     SS                              SS                              SS                              public
  amazon/nova-lite                       SS                              SS                              SS                              public
  amazon/nova-micro                      SS                              SS                              SS                              public
  amazon/nova-pro                        SS                              SS                              SS                              public
  anthropic/claude-3-haiku               SS                              SS                              SS                              public
  anthropic/claude-fable-5               SS                              SS                              SS                              public
  anthropic/claude-haiku-4.5             SS                              SS                              SS                              public
  anthropic/claude-opus-4                SS                              SS                              SS                              public
  anthropic/claude-opus-4.1              SS                              SS                              SS                              public
  anthropic/claude-opus-4.5              SS                              SS                              SS                              public
  anthropic/claude-opus-4.6              SS                              SS                              SS                              public
  anthropic/claude-opus-4.7              SS                              SS                              SS                              public
  anthropic/claude-opus-4.7-fast         SS                              SS                              SS                              public
  anthropic/claude-opus-4.8              SS                              SS                              SS                              public
  anthropic/claude-opus-4.8-fast         SS                              SS                              SS                              public
  anthropic/claude-sonnet-4              SS                              SS                              SS                              public
  anthropic/claude-sonnet-4.5            SS                              SS                              SS                              public
  anthropic/claude-sonnet-4.6            SS                              SS                              SS                              public
  anthropic/claude-sonnet-5              SS                              SS                              SS                              public
  bytedance/seed-1.6                     SS                              SS                              AA                              partial (2/3)
  bytedance/seed-1.8                     S·                              SS                              AA                              partial (2/3)
  cohere/command-a                       SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  deepseek/deepseek-r1                   T·                              TT                              TT                              public
  deepseek/deepseek-v3                   TT                              AA                              AA                              exclusive:ai-gateway-early-access-models
  deepseek/deepseek-v3.1                 SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  deepseek/deepseek-v3.1-terminus        SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  deepseek/deepseek-v3.2                 SS                              SS                              SS                              public
  deepseek/deepseek-v3.2-thinking        SS                              SS                              SS                              public
  deepseek/deepseek-v4-flash             SS                              SS                              SS                              public
  deepseek/deepseek-v4-pro               SS                              SS                              SS                              public
  google/gemini-2.5-flash                SS                              SS                              SS                              public
  google/gemini-2.5-flash-image          TT                              TT                              TT                              public
  google/gemini-2.5-flash-lite           SS                              SS                              SS                              public
  google/gemini-2.5-pro                  SS                              SS                              SS                              public
  google/gemini-3-flash                  SS                              SS                              SS                              public
  google/gemini-3-pro-image              SS                              SS                              SS                              public
  google/gemini-3-pro-preview            SS                              SS                              SS                              public
  google/gemini-3.1-flash-image          SS                              SS                              SS                              public
  google/gemini-3.1-flash-image-preview  SS                              SS                              SS                              public
  google/gemini-3.1-flash-lite           SS                              SS                              SS                              public
  google/gemini-3.1-flash-lite-image     TT                              TT                              TT                              public
  google/gemini-3.1-flash-lite-preview   SS                              SS                              FF                              partial (2/3)
  google/gemini-3.1-pro-preview          SS                              SS                              SS                              public
  google/gemini-3.5-flash                SS                              SS                              SS                              public
  google/gemini-omni-flash-preview       SF                              SF                              SF                              public
  google/gemma-4-26b-a4b-it              SS                              ST                              SS                              public
  google/gemma-4-31b-it                  SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  inception/mercury-2                    SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  inception/mercury-coder-small          SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  interfaze/interfaze-beta               SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  kwaipilot/kat-coder-air-v2.5           SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  kwaipilot/kat-coder-pro-v1             SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  kwaipilot/kat-coder-pro-v2             SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  kwaipilot/kat-coder-pro-v2.5           SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  meta/llama-3.1-70b                     SS                              TT                              TT                              public
  meta/llama-3.1-8b                      SS                              TT                              TT                              public
  meta/llama-3.2-11b                     TT                              FF                              TT                              partial (2/3)
  meta/llama-3.2-1b                      TT                              FF                              TT                              partial (2/3)
  meta/llama-3.2-3b                      TT                              FF                              TT                              partial (2/3)
  meta/llama-3.2-90b                     TT                              FF                              TT                              partial (2/3)
  meta/llama-3.3-70b                     TT                              TT                              TT                              public
  meta/llama-4-maverick                  SS                              TT                              TT                              public
  meta/llama-4-scout                     SS                              TT                              TT                              public
  meta/muse-spark-1.1                    S·                              AA                              AA                              exclusive:ai-gateway-early-access-models
  minimax/minimax-m2                     SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  minimax/minimax-m2.1                   SS                              SS                              ··                              partial (2/3)
  minimax/minimax-m2.1-lightning         SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  minimax/minimax-m2.5                   SS                              SS                              SS                              public
  minimax/minimax-m2.5-highspeed         SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  minimax/minimax-m2.7                   SS                              SS                              SS                              public
  minimax/minimax-m2.7-highspeed         SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  minimax/minimax-m3                     TT                              SS                              SS                              public
  mistral/codestral                      SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  mistral/devstral-2                     SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  mistral/devstral-small-2               SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  mistral/magistral-medium               ST                              AA                              AA                              exclusive:ai-gateway-early-access-models
  mistral/magistral-small                TS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  mistral/ministral-14b                  SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  mistral/ministral-3b                   SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  mistral/ministral-8b                   SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  mistral/mistral-large-3                SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  mistral/mistral-medium                 SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  mistral/mistral-medium-3.5             SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  mistral/mistral-nemo                   SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  mistral/mistral-small                  SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  mistral/pixtral-12b                    SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  moonshotai/kimi-k2                     TT                              AA                              AA                              exclusive:ai-gateway-early-access-models
  moonshotai/kimi-k2-thinking            ··                              AA                              AA                              none
  moonshotai/kimi-k2.5                   T·                              SS                              SS                              public
  moonshotai/kimi-k2.6                   S·                              S·                              S·                              public
  moonshotai/kimi-k2.7-code              SS                              SS                              SS                              public
  moonshotai/kimi-k2.7-code-highspeed    SS                              SS                              S·                              public
  morph/morph-v3-fast                    SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  morph/morph-v3-large                   SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  nvidia/nemotron-3-nano-30b-a3b         T·                              AA                              AA                              exclusive:ai-gateway-early-access-models
  nvidia/nemotron-3-super-120b-a12b      SS                              SS                              SS                              public
  nvidia/nemotron-3-ultra-550b-a55b      SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  nvidia/nemotron-nano-12b-v2-vl         S·                              SS                              SS                              public
  nvidia/nemotron-nano-9b-v2             SS                              SS                              SS                              public
  openai/gpt-3.5-turbo                   TT                              TT                              TT                              public
  openai/gpt-4-turbo                     TT                              TT                              TT                              public
  openai/gpt-4.1                         SS                              SS                              SS                              public
  openai/gpt-4.1-mini                    SS                              SS                              SS                              public
  openai/gpt-4.1-nano                    SS                              SS                              SS                              public
  openai/gpt-4o                          SS                              SS                              SS                              public
  openai/gpt-4o-mini                     SS                              SS                              SS                              public
  openai/gpt-4o-mini-search-preview      SS                              SS                              SS                              public
  openai/gpt-5                           SS                              SS                              SS                              public
  openai/gpt-5-chat                      SS                              SS                              SS                              public
  openai/gpt-5-codex                     SS                              SS                              SS                              public
  openai/gpt-5-mini                      SS                              SS                              SS                              public
  openai/gpt-5-nano                      SS                              SS                              SS                              public
  openai/gpt-5-pro                       ··                              ··                              ··                              none
  openai/gpt-5.1-codex                   SS                              SS                              SS                              public
  openai/gpt-5.1-codex-max               SS                              SS                              SS                              public
  openai/gpt-5.1-codex-mini              SS                              SS                              SS                              public
  openai/gpt-5.1-instant                 SS                              SS                              SS                              public
  openai/gpt-5.1-thinking                SS                              SS                              SS                              public
  openai/gpt-5.2                         SS                              SS                              SS                              public
  openai/gpt-5.2-chat                    SS                              SS                              SS                              public
  openai/gpt-5.2-codex                   SS                              SS                              SS                              public
  openai/gpt-5.2-pro                     SS                              SS                              SS                              public
  openai/gpt-5.3-chat                    SS                              SS                              SS                              public
  openai/gpt-5.3-codex                   SS                              SS                              SS                              public
  openai/gpt-5.4                         SS                              SS                              SS                              public
  openai/gpt-5.4-mini                    SS                              SS                              SS                              public
  openai/gpt-5.4-nano                    SS                              SS                              SS                              public
  openai/gpt-5.4-pro                     ··                              S·                              S·                              partial (2/3)
  openai/gpt-5.5                         SS                              SS                              SS                              public
  openai/gpt-5.5-pro                     S·                              SS                              S·                              public
  openai/gpt-5.6-luna                    SS                              SS                              SS                              public
  openai/gpt-5.6-sol                     SS                              SS                              SS                              public
  openai/gpt-5.6-terra                   SS                              SS                              SS                              public
  openai/gpt-oss-120b                    SS                              SS                              SS                              public
  openai/gpt-oss-20b                     SS                              SS                              SS                              public
  openai/gpt-oss-safeguard-20b           SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  openai/o1                              SS                              SS                              SS                              public
  openai/o3                              SS                              SS                              SS                              public
  openai/o3-deep-research                FF                              FF                              FF                              none
  openai/o3-mini                         SS                              SS                              SS                              public
  openai/o3-pro                          SS                              SS                              S·                              public
  openai/o4-mini                         SS                              SS                              SS                              public
  perplexity/sonar                       SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  perplexity/sonar-pro                   SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  perplexity/sonar-reasoning-pro         SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  stepfun/step-3.5-flash                 TT                              AA                              AA                              exclusive:ai-gateway-early-access-models
  stepfun/step-3.7-flash                 S·                              AA                              AA                              exclusive:ai-gateway-early-access-models
  thinkingmachines/inkling               TT                              AA                              AA                              exclusive:ai-gateway-early-access-models
  xai/grok-4.1-fast-non-reasoning        SS                              SS                              SS                              public
  xai/grok-4.1-fast-reasoning            SS                              SS                              SS                              public
  xai/grok-4.20-multi-agent              TS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  xai/grok-4.20-multi-agent-beta         SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  xai/grok-4.20-non-reasoning            SS                              SS                              SS                              public
  xai/grok-4.20-non-reasoning-beta       SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  xai/grok-4.20-reasoning                SS                              SS                              SS                              public
  xai/grok-4.20-reasoning-beta           SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  xai/grok-4.3                           SS                              SS                              FF                              partial (2/3)
  xai/grok-4.5                           SS                              SS                              AA                              partial (2/3)
  xai/grok-build-0.1                     SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  xiaomi/mimo-v2.5                       SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  xiaomi/mimo-v2.5-pro                   SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  zai/glm-4.5                            S·                              AA                              AA                              exclusive:ai-gateway-early-access-models
  zai/glm-4.5-air                        S·                              AA                              AA                              exclusive:ai-gateway-early-access-models
  zai/glm-4.5v                           SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  zai/glm-4.6                            SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  zai/glm-4.6v                           SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  zai/glm-4.6v-flash                     SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  zai/glm-4.7                            SS                              SS                              SS                              public
  zai/glm-4.7-flash                      SS                              SS                              SS                              public
  zai/glm-4.7-flashx                     SS                              AA                              AA                              exclusive:ai-gateway-early-access-models
  zai/glm-5                              SS                              SS                              SS                              public
  zai/glm-5-turbo                        S·                              AA                              AA                              exclusive:ai-gateway-early-access-models
  zai/glm-5.1                            SS                              SS                              SS                              public
  zai/glm-5.2                            SS                              SS                              SS                              public
  zai/glm-5.2-fast                       SS                              SS                              SS                              public
  zai/glm-5v-turbo                       SS                              AA                              AA                              exclusive:ai-gateway-early-access-models

  chess availability: public 111  partial 11  exclusive 72  none 6
```

```
Model compatibility · AI Gateway Early Access Models (ai-gateway-early-access-models)
generated 2026-07-16 · games chess+poker · normalizer anthropic/claude-haiku-4.5 · 45s timeout

  chess  193/200 playable   FALLBACK 3  TIMEOUT 4  TEXT 19  STRUCTURED 174
  poker  178/200 playable   FALLBACK 4  TIMEOUT 18  TEXT 16  STRUCTURED 162

  legend: STRUCTURED=native JSON · TEXT=prose-parsed · NORMALIZED=2nd-LLM · FALLBACK=random · ACCESS=team blocked · TIMEOUT/ERROR

  MODEL                                  STRUCT  CHESS         POKER         NOTES
  alibaba/qwen-3-14b                     no      FALLBACK      FALLBACK      all ladder rungs failed — HTTP 400 [AI_APICallError] max_tokens=65536 cannot be 
  alibaba/qwen-3-30b                     no      FALLBACK      FALLBACK      all ladder rungs failed — HTTP 400 [AI_APICallError] This model's maximum contex
  google/gemini-omni-flash-preview       yes     STRUCTURED e4  FALLBACK      all ladder rungs failed — ladder failed but a bare structured call succeeded (li
  openai/o3-deep-research                no      FALLBACK      FALLBACK      all ladder rungs failed — HTTP 400 [AI_APICallError] Invalid parameter: 'text.fo
  alibaba/qwen-3.6-max-preview           yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  alibaba/qwen3.5-plus                   yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  alibaba/qwen3.6-27b                    —       TIMEOUT       TIMEOUT       Delay was aborted
  bytedance/seed-1.8                     yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  deepseek/deepseek-r1                   no      TEXT e4       TIMEOUT       structured output unsupported; plain-text fallback
  meta/muse-spark-1.1                    yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  moonshotai/kimi-k2-thinking            —       TIMEOUT       TIMEOUT       Delay was aborted
  moonshotai/kimi-k2.5                   no      TEXT e4       TIMEOUT       structured output unsupported; plain-text fallback
  moonshotai/kimi-k2.6                   yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  nvidia/nemotron-3-nano-30b-a3b         no      TEXT e4       TIMEOUT       structured output unsupported; plain-text fallback
  nvidia/nemotron-nano-12b-v2-vl         yes     STRUCTURED Nc3  TIMEOUT       Delay was aborted
  openai/gpt-5-pro                       —       TIMEOUT       TIMEOUT       Delay was aborted
  openai/gpt-5.4-pro                     —       TIMEOUT       TIMEOUT       Delay was aborted
  openai/gpt-5.5-pro                     yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  stepfun/step-3.7-flash                 yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  zai/glm-4.5                            yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  zai/glm-4.5-air                        yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  zai/glm-5-turbo                        yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  alibaba/qwen3-coder-30b-a3b            yes     STRUCTURED e4  TEXT call     structured output unsupported; plain-text fallback
  deepseek/deepseek-v3                   no      TEXT e4       TEXT raise 40  structured output unsupported; plain-text fallback
  google/gemini-2.5-flash-image          no      TEXT e4       TEXT raise 60  structured output unsupported; plain-text fallback
  google/gemini-3.1-flash-lite-image     no      TEXT e4       TEXT call     structured output unsupported; plain-text fallback
  meta/llama-3.2-11b                     no      TEXT e4       TEXT bet 40   structured output unsupported; plain-text fallback
  meta/llama-3.2-1b                      no      TEXT e4       TEXT call     structured output unsupported; plain-text fallback
  meta/llama-3.2-3b                      no      TEXT d4       TEXT call     structured output unsupported; plain-text fallback
  meta/llama-3.2-90b                     no      TEXT e4       TEXT raise 60  structured output unsupported; plain-text fallback
  meta/llama-3.3-70b                     no      TEXT e4       TEXT raise 80  structured output unsupported; plain-text fallback
  minimax/minimax-m3                     no      TEXT e4       TEXT raise 60  structured output unsupported; plain-text fallback
  mistral/magistral-medium               yes     STRUCTURED e4  TEXT fold     structured output unsupported; plain-text fallback
  mistral/magistral-small                no      TEXT e4       STRUCTURED raise 60  structured output unsupported; plain-text fallback
  moonshotai/kimi-k2                     no      TEXT e4       TEXT call     structured output unsupported; plain-text fallback
  openai/gpt-3.5-turbo                   no      TEXT Nf3      TEXT fold     structured output unsupported; plain-text fallback
  openai/gpt-4-turbo                     no      TEXT e4       TEXT call     structured output unsupported; plain-text fallback
  stepfun/step-3.5-flash                 no      TEXT e4       TEXT raise 40  structured output unsupported; plain-text fallback
  thinkingmachines/inkling               no      TEXT e4       TEXT raise 60  structured output unsupported; plain-text fallback
  xai/grok-4.20-multi-agent              no      TEXT e4       STRUCTURED raise 60  structured output unsupported; plain-text fallback
  alibaba/qwen-3-235b                    yes     STRUCTURED e4  STRUCTURED fold  
  alibaba/qwen-3-32b                     yes     STRUCTURED e4  STRUCTURED raise 40  
  alibaba/qwen3-235b-a22b-thinking       yes     STRUCTURED e4  STRUCTURED raise 60  
  alibaba/qwen3-coder                    yes     STRUCTURED e4  STRUCTURED call  
  alibaba/qwen3-coder-next               yes     STRUCTURED e4  STRUCTURED raise 80  
  alibaba/qwen3-coder-plus               yes     STRUCTURED e4  STRUCTURED raise 40  
  alibaba/qwen3-max                      yes     STRUCTURED e4  STRUCTURED call  
  alibaba/qwen3-max-preview              yes     STRUCTURED e4  STRUCTURED call  
  alibaba/qwen3-max-thinking             yes     STRUCTURED e4  STRUCTURED fold  
  alibaba/qwen3-next-80b-a3b-instruct    yes     STRUCTURED e4  STRUCTURED call  
  alibaba/qwen3-next-80b-a3b-thinking    yes     STRUCTURED e4  STRUCTURED raise 50  
  alibaba/qwen3-vl-235b-a22b-instruct    yes     STRUCTURED e4  STRUCTURED raise 40  
  alibaba/qwen3-vl-instruct              yes     STRUCTURED e4  STRUCTURED raise 40  
  alibaba/qwen3-vl-thinking              yes     STRUCTURED e4  STRUCTURED fold  
  alibaba/qwen3.5-flash                  yes     STRUCTURED e4  STRUCTURED raise 40  
  alibaba/qwen3.6-plus                   yes     STRUCTURED e4  STRUCTURED raise 40  
  alibaba/qwen3.7-max                    yes     STRUCTURED e4  STRUCTURED raise 60  
  alibaba/qwen3.7-plus                   yes     STRUCTURED e4  STRUCTURED raise 40  
  amazon/nova-2-lite                     yes     STRUCTURED e4  STRUCTURED fold  
  amazon/nova-lite                       yes     STRUCTURED e4  STRUCTURED raise 120  
  amazon/nova-micro                      yes     STRUCTURED e4  STRUCTURED raise 100  
  amazon/nova-pro                        yes     STRUCTURED Nf3  STRUCTURED raise 40  
  anthropic/claude-3-haiku               yes     STRUCTURED e4  STRUCTURED call  
  anthropic/claude-fable-5               yes     STRUCTURED e4  STRUCTURED raise 50  
  anthropic/claude-haiku-4.5             yes     STRUCTURED e4  STRUCTURED raise 40  
  anthropic/claude-opus-4                yes     STRUCTURED e4  STRUCTURED raise 55  
  anthropic/claude-opus-4.1              yes     STRUCTURED e4  STRUCTURED fold  
  anthropic/claude-opus-4.5              yes     STRUCTURED e4  STRUCTURED fold  
  anthropic/claude-opus-4.6              yes     STRUCTURED e4  STRUCTURED raise 50  
  anthropic/claude-opus-4.7              yes     STRUCTURED e4  STRUCTURED raise 60  
  anthropic/claude-opus-4.7-fast         yes     STRUCTURED e4  STRUCTURED call  
  anthropic/claude-opus-4.8              yes     STRUCTURED e4  STRUCTURED call  
  anthropic/claude-opus-4.8-fast         yes     STRUCTURED e4  STRUCTURED raise 60  
  anthropic/claude-sonnet-4              yes     STRUCTURED e4  STRUCTURED call  
  anthropic/claude-sonnet-4.5            yes     STRUCTURED e4  STRUCTURED call  
  anthropic/claude-sonnet-4.6            yes     STRUCTURED e4  STRUCTURED raise 60  
  anthropic/claude-sonnet-5              yes     STRUCTURED e4  STRUCTURED raise 70  
  bytedance/seed-1.6                     yes     STRUCTURED e4  STRUCTURED fold  
  cohere/command-a                       yes     STRUCTURED e4  STRUCTURED fold  
  deepseek/deepseek-v3.1                 yes     STRUCTURED e4  STRUCTURED call  
  deepseek/deepseek-v3.1-terminus        yes     STRUCTURED e4  STRUCTURED call  
  deepseek/deepseek-v3.2                 yes     STRUCTURED e4  STRUCTURED call  
  deepseek/deepseek-v3.2-thinking        yes     STRUCTURED e4  STRUCTURED raise 60  
  deepseek/deepseek-v4-flash             yes     STRUCTURED e4  STRUCTURED raise 60  
  deepseek/deepseek-v4-pro               yes     STRUCTURED e4  STRUCTURED fold  
  google/gemini-2.5-flash                yes     STRUCTURED e4  STRUCTURED fold  
  google/gemini-2.5-flash-lite           yes     STRUCTURED e4  STRUCTURED call  
  google/gemini-2.5-pro                  yes     STRUCTURED e4  STRUCTURED call  
  google/gemini-3-flash                  yes     STRUCTURED e4  STRUCTURED raise 60  
  google/gemini-3-pro-image              yes     STRUCTURED e4  STRUCTURED raise 40  
  google/gemini-3-pro-preview            yes     STRUCTURED e4  STRUCTURED fold  
  google/gemini-3.1-flash-image          yes     STRUCTURED e4  STRUCTURED raise 60  
  google/gemini-3.1-flash-image-preview  yes     STRUCTURED e4  STRUCTURED raise 60  
  google/gemini-3.1-flash-lite           yes     STRUCTURED e4  STRUCTURED call  
  google/gemini-3.1-flash-lite-preview   yes     STRUCTURED e4  STRUCTURED call  
  google/gemini-3.1-pro-preview          yes     STRUCTURED e4  STRUCTURED raise 50  
  google/gemini-3.5-flash                yes     STRUCTURED e4  STRUCTURED raise 60  
  google/gemma-4-26b-a4b-it              yes     STRUCTURED e4  STRUCTURED raise 40  
  google/gemma-4-31b-it                  yes     STRUCTURED e4  STRUCTURED raise 40  
  inception/mercury-2                    yes     STRUCTURED e4  STRUCTURED call  
  inception/mercury-coder-small          yes     STRUCTURED e4  STRUCTURED raise 40  
  interfaze/interfaze-beta               yes     STRUCTURED e4  STRUCTURED raise 60  
  kwaipilot/kat-coder-air-v2.5           yes     STRUCTURED e4  STRUCTURED call  
  kwaipilot/kat-coder-pro-v1             yes     STRUCTURED e4  STRUCTURED call  
  kwaipilot/kat-coder-pro-v2             yes     STRUCTURED e4  STRUCTURED raise 40  
  kwaipilot/kat-coder-pro-v2.5           yes     STRUCTURED e4  STRUCTURED raise 60  
  meta/llama-3.1-70b                     yes     STRUCTURED e4  STRUCTURED raise 60  
  meta/llama-3.1-8b                      yes     STRUCTURED e4  STRUCTURED raise 40  
  meta/llama-4-maverick                  yes     STRUCTURED e4  STRUCTURED raise 40  
  meta/llama-4-scout                     yes     STRUCTURED e4  STRUCTURED raise 40  
  minimax/minimax-m2                     yes     STRUCTURED e4  STRUCTURED fold  
  minimax/minimax-m2.1                   yes     STRUCTURED e4  STRUCTURED raise 50  
  minimax/minimax-m2.1-lightning         yes     STRUCTURED e4  STRUCTURED call  
  minimax/minimax-m2.5                   yes     STRUCTURED e4  STRUCTURED call  
  minimax/minimax-m2.5-highspeed         yes     STRUCTURED e4  STRUCTURED call  
  minimax/minimax-m2.7                   yes     STRUCTURED e4  STRUCTURED fold  
  minimax/minimax-m2.7-highspeed         yes     STRUCTURED e4  STRUCTURED call  
  mistral/codestral                      yes     STRUCTURED e4  STRUCTURED fold  
  mistral/devstral-2                     yes     STRUCTURED e4  STRUCTURED fold  
  mistral/devstral-small-2               yes     STRUCTURED e4  STRUCTURED fold  
  mistral/ministral-14b                  yes     STRUCTURED e4  STRUCTURED raise 60  
  mistral/ministral-3b                   yes     STRUCTURED e4  STRUCTURED raise 100  
  mistral/ministral-8b                   yes     STRUCTURED e4  STRUCTURED raise 40  
  mistral/mistral-large-3                yes     STRUCTURED e4  STRUCTURED call  
  mistral/mistral-medium                 yes     STRUCTURED e4  STRUCTURED fold  
  mistral/mistral-medium-3.5             yes     STRUCTURED e4  STRUCTURED raise 60  
  mistral/mistral-nemo                   yes     STRUCTURED e4  STRUCTURED call  
  mistral/mistral-small                  yes     STRUCTURED e4  STRUCTURED raise 40  
  mistral/pixtral-12b                    yes     STRUCTURED e4  STRUCTURED fold  
  moonshotai/kimi-k2.7-code              yes     STRUCTURED e4  STRUCTURED raise 60  
  moonshotai/kimi-k2.7-code-highspeed    yes     STRUCTURED e4  STRUCTURED raise 50  
  morph/morph-v3-fast                    yes     STRUCTURED Nf3  STRUCTURED check  
  morph/morph-v3-large                   yes     STRUCTURED e4  STRUCTURED raise 40  
  nvidia/nemotron-3-super-120b-a12b      yes     STRUCTURED e4  STRUCTURED raise 80  
  nvidia/nemotron-3-ultra-550b-a55b      yes     STRUCTURED e4  STRUCTURED raise 70  
  nvidia/nemotron-nano-9b-v2             yes     STRUCTURED Nf3  STRUCTURED raise 40  
  openai/gpt-4.1                         yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-4.1-mini                    yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-4.1-nano                    yes     STRUCTURED e4  STRUCTURED call  
  openai/gpt-4o                          yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-4o-mini                     yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-4o-mini-search-preview      yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5                           yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5-chat                      yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5-codex                     yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5-mini                      yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5-nano                      yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.1-codex                   yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5.1-codex-max               yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5.1-codex-mini              yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.1-instant                 yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5.1-thinking                yes     STRUCTURED e4  STRUCTURED call  
  openai/gpt-5.2                         yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.2-chat                    yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.2-codex                   yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.2-pro                     yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.3-chat                    yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.3-codex                   yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.4                         yes     STRUCTURED e4  STRUCTURED call  
  openai/gpt-5.4-mini                    yes     STRUCTURED e4  STRUCTURED call  
  openai/gpt-5.4-nano                    yes     STRUCTURED e4  STRUCTURED call  
  openai/gpt-5.5                         yes     STRUCTURED e4  STRUCTURED call  
  openai/gpt-5.6-luna                    yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.6-sol                     yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.6-terra                   yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-oss-120b                    yes     STRUCTURED e4  STRUCTURED raise 80  
  openai/gpt-oss-20b                     yes     STRUCTURED e4  STRUCTURED fold  
  openai/gpt-oss-safeguard-20b           yes     STRUCTURED e4  STRUCTURED fold  
  openai/o1                              yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/o3                              yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/o3-mini                         yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/o3-pro                          yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/o4-mini                         yes     STRUCTURED e4  STRUCTURED raise 60  
  perplexity/sonar                       yes     STRUCTURED e4  STRUCTURED raise 100  
  perplexity/sonar-pro                   yes     STRUCTURED e4  STRUCTURED call  
  perplexity/sonar-reasoning-pro         yes     STRUCTURED e4  STRUCTURED raise 60  
  xai/grok-4.1-fast-non-reasoning        yes     STRUCTURED e4  STRUCTURED fold  
  xai/grok-4.1-fast-reasoning            yes     STRUCTURED e4  STRUCTURED raise 60  
  xai/grok-4.20-multi-agent-beta         yes     STRUCTURED e4  STRUCTURED raise 60  
  xai/grok-4.20-non-reasoning            yes     STRUCTURED e4  STRUCTURED fold  
  xai/grok-4.20-non-reasoning-beta       yes     STRUCTURED e4  STRUCTURED raise 60  
  xai/grok-4.20-reasoning                yes     STRUCTURED e4  STRUCTURED raise 60  
  xai/grok-4.20-reasoning-beta           yes     STRUCTURED e4  STRUCTURED raise 40  
  xai/grok-4.3                           yes     STRUCTURED e4  STRUCTURED raise 40  
  xai/grok-4.5                           yes     STRUCTURED e4  STRUCTURED raise 60  
  xai/grok-build-0.1                     yes     STRUCTURED e4  STRUCTURED raise 40  
  xiaomi/mimo-v2.5                       yes     STRUCTURED e4  STRUCTURED call  
  xiaomi/mimo-v2.5-pro                   yes     STRUCTURED e4  STRUCTURED raise 60  
  zai/glm-4.5v                           yes     STRUCTURED e4  STRUCTURED raise 40  
  zai/glm-4.6                            yes     STRUCTURED e4  STRUCTURED raise 60  
  zai/glm-4.6v                           yes     STRUCTURED e4  STRUCTURED raise 60  
  zai/glm-4.6v-flash                     yes     STRUCTURED e4  STRUCTURED call  
  zai/glm-4.7                            yes     STRUCTURED e4  STRUCTURED raise 60  
  zai/glm-4.7-flash                      yes     STRUCTURED e4  STRUCTURED fold  
  zai/glm-4.7-flashx                     yes     STRUCTURED e4  STRUCTURED raise 40  
  zai/glm-5                              yes     STRUCTURED e4  STRUCTURED fold  
  zai/glm-5.1                            yes     STRUCTURED e4  STRUCTURED fold  
  zai/glm-5.2                            yes     STRUCTURED e4  STRUCTURED raise 60  
  zai/glm-5.2-fast                       yes     STRUCTURED e4  STRUCTURED raise 60  
  zai/glm-5v-turbo                       yes     STRUCTURED e4  STRUCTURED raise 60  
```

```
Model compatibility · Internal Playground (vercel-internal-playground)
generated 2026-07-17 · games chess+poker · normalizer anthropic/claude-haiku-4.5 · 45s timeout

  chess  118/200 playable   FALLBACK 5  ACCESS 76  TIMEOUT 1  TEXT 11  STRUCTURED 107
  poker  115/200 playable   FALLBACK 6  ACCESS 76  TIMEOUT 3  TEXT 13  STRUCTURED 102

  legend: STRUCTURED=native JSON · TEXT=prose-parsed · NORMALIZED=2nd-LLM · FALLBACK=random · ACCESS=team blocked · TIMEOUT/ERROR

  MODEL                                  STRUCT  CHESS         POKER         NOTES
  google/gemini-omni-flash-preview       yes     STRUCTURED e4  FALLBACK      all ladder rungs failed — ladder failed but a bare structured call succeeded (li
  meta/llama-3.2-11b                     no      FALLBACK      FALLBACK      all ladder rungs failed — HTTP 404 [AI_APICallError] This model version has reac
  meta/llama-3.2-1b                      no      FALLBACK      FALLBACK      all ladder rungs failed — HTTP 404 [AI_APICallError] This model version has reac
  meta/llama-3.2-3b                      no      FALLBACK      FALLBACK      all ladder rungs failed — HTTP 404 [AI_APICallError] This model version has reac
  meta/llama-3.2-90b                     no      FALLBACK      FALLBACK      all ladder rungs failed — HTTP 404 [AI_APICallError] This model version has reac
  openai/o3-deep-research                no      FALLBACK      FALLBACK      all ladder rungs failed — HTTP 400 [AI_APICallError] Invalid parameter: 'text.fo
  alibaba/qwen-3-14b                     —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen-3-30b                     —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen-3.6-max-preview           —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-235b-a22b-thinking       —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-coder-plus               —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-max                      —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-max-preview              —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-max-thinking             —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-vl-235b-a22b-instruct    —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-vl-instruct              —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-vl-thinking              —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3.5-flash                  —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3.5-plus                   —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3.6-27b                    —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3.6-plus                   —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3.7-max                    —       ACCESS        ACCESS        restricted provider access on this team
  cohere/command-a                       —       ACCESS        ACCESS        restricted provider access on this team
  deepseek/deepseek-v3                   —       ACCESS        ACCESS        restricted provider access on this team
  deepseek/deepseek-v3.1                 —       ACCESS        ACCESS        restricted provider access on this team
  deepseek/deepseek-v3.1-terminus        —       ACCESS        ACCESS        restricted provider access on this team
  google/gemma-4-31b-it                  —       ACCESS        ACCESS        restricted provider access on this team
  inception/mercury-2                    —       ACCESS        ACCESS        restricted provider access on this team
  inception/mercury-coder-small          —       ACCESS        ACCESS        restricted provider access on this team
  interfaze/interfaze-beta               —       ACCESS        ACCESS        restricted provider access on this team
  kwaipilot/kat-coder-air-v2.5           —       ACCESS        ACCESS        restricted provider access on this team
  kwaipilot/kat-coder-pro-v1             —       ACCESS        ACCESS        restricted provider access on this team
  kwaipilot/kat-coder-pro-v2             —       ACCESS        ACCESS        restricted provider access on this team
  kwaipilot/kat-coder-pro-v2.5           —       ACCESS        ACCESS        restricted provider access on this team
  meta/muse-spark-1.1                    —       ACCESS        ACCESS        restricted provider access on this team
  minimax/minimax-m2                     —       ACCESS        ACCESS        restricted provider access on this team
  minimax/minimax-m2.1-lightning         —       ACCESS        ACCESS        restricted provider access on this team
  minimax/minimax-m2.5-highspeed         —       ACCESS        ACCESS        restricted provider access on this team
  minimax/minimax-m2.7-highspeed         —       ACCESS        ACCESS        restricted provider access on this team
  mistral/codestral                      —       ACCESS        ACCESS        restricted provider access on this team
  mistral/devstral-2                     —       ACCESS        ACCESS        restricted provider access on this team
  mistral/devstral-small-2               —       ACCESS        ACCESS        restricted provider access on this team
  mistral/magistral-medium               —       ACCESS        ACCESS        restricted provider access on this team
  mistral/magistral-small                —       ACCESS        ACCESS        restricted provider access on this team
  mistral/ministral-14b                  —       ACCESS        ACCESS        restricted provider access on this team
  mistral/ministral-3b                   —       ACCESS        ACCESS        restricted provider access on this team
  mistral/ministral-8b                   —       ACCESS        ACCESS        restricted provider access on this team
  mistral/mistral-large-3                —       ACCESS        ACCESS        restricted provider access on this team
  mistral/mistral-medium                 —       ACCESS        ACCESS        restricted provider access on this team
  mistral/mistral-medium-3.5             —       ACCESS        ACCESS        restricted provider access on this team
  mistral/mistral-nemo                   —       ACCESS        ACCESS        restricted provider access on this team
  mistral/mistral-small                  —       ACCESS        ACCESS        restricted provider access on this team
  mistral/pixtral-12b                    —       ACCESS        ACCESS        restricted provider access on this team
  moonshotai/kimi-k2                     —       ACCESS        ACCESS        restricted provider access on this team
  moonshotai/kimi-k2-thinking            —       ACCESS        ACCESS        restricted provider access on this team
  morph/morph-v3-fast                    —       ACCESS        ACCESS        restricted provider access on this team
  morph/morph-v3-large                   —       ACCESS        ACCESS        restricted provider access on this team
  nvidia/nemotron-3-nano-30b-a3b         —       ACCESS        ACCESS        restricted provider access on this team
  nvidia/nemotron-3-ultra-550b-a55b      —       ACCESS        ACCESS        restricted provider access on this team
  openai/gpt-oss-safeguard-20b           —       ACCESS        ACCESS        restricted provider access on this team
  perplexity/sonar                       —       ACCESS        ACCESS        restricted provider access on this team
  perplexity/sonar-pro                   —       ACCESS        ACCESS        restricted provider access on this team
  perplexity/sonar-reasoning-pro         —       ACCESS        ACCESS        restricted provider access on this team
  stepfun/step-3.5-flash                 —       ACCESS        ACCESS        restricted provider access on this team
  stepfun/step-3.7-flash                 —       ACCESS        ACCESS        restricted provider access on this team
  thinkingmachines/inkling               —       ACCESS        ACCESS        restricted provider access on this team
  xai/grok-4.20-multi-agent              —       ACCESS        ACCESS        restricted provider access on this team
  xai/grok-4.20-multi-agent-beta         —       ACCESS        ACCESS        restricted provider access on this team
  xai/grok-4.20-non-reasoning-beta       —       ACCESS        ACCESS        restricted provider access on this team
  xai/grok-4.20-reasoning-beta           —       ACCESS        ACCESS        restricted provider access on this team
  xai/grok-build-0.1                     —       ACCESS        ACCESS        restricted provider access on this team
  xiaomi/mimo-v2.5                       —       ACCESS        ACCESS        restricted provider access on this team
  xiaomi/mimo-v2.5-pro                   —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-4.5                            —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-4.5-air                        —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-4.5v                           —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-4.6                            —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-4.6v                           —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-4.6v-flash                     —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-4.7-flashx                     —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-5-turbo                        —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-5v-turbo                       —       ACCESS        ACCESS        restricted provider access on this team
  moonshotai/kimi-k2.6                   yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  openai/gpt-5-pro                       —       TIMEOUT       TIMEOUT       Delay was aborted
  openai/gpt-5.4-pro                     yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  alibaba/qwen3-coder-30b-a3b            yes     STRUCTURED e4  TEXT call     structured output unsupported; plain-text fallback
  alibaba/qwen3.7-plus                   no      TEXT e4       TEXT fold     structured output unsupported; plain-text fallback
  deepseek/deepseek-r1                   no      TEXT e4       TEXT raise 40  structured output unsupported; plain-text fallback
  google/gemini-2.5-flash-image          no      TEXT e4       TEXT raise 40  structured output unsupported; plain-text fallback
  google/gemini-3.1-flash-lite-image     no      TEXT e4       TEXT call     structured output unsupported; plain-text fallback
  google/gemma-4-26b-a4b-it              yes     STRUCTURED e4  TEXT raise 40  structured output unsupported; plain-text fallback
  meta/llama-3.1-70b                     no      TEXT e4       TEXT raise 40  structured output unsupported; plain-text fallback
  meta/llama-3.1-8b                      no      TEXT e4       TEXT raise 40  structured output unsupported; plain-text fallback
  meta/llama-3.3-70b                     no      TEXT e4       TEXT raise 80  structured output unsupported; plain-text fallback
  meta/llama-4-maverick                  no      TEXT e4       TEXT raise 50  structured output unsupported; plain-text fallback
  meta/llama-4-scout                     no      TEXT e4       TEXT raise 40  structured output unsupported; plain-text fallback
  openai/gpt-3.5-turbo                   no      TEXT e4       TEXT raise 100  structured output unsupported; plain-text fallback
  openai/gpt-4-turbo                     no      TEXT e4       TEXT call     structured output unsupported; plain-text fallback
  alibaba/qwen-3-235b                    yes     STRUCTURED e4  STRUCTURED raise 40  
  alibaba/qwen-3-32b                     yes     STRUCTURED e4  STRUCTURED fold  
  alibaba/qwen3-coder                    yes     STRUCTURED e4  STRUCTURED fold  
  alibaba/qwen3-coder-next               yes     STRUCTURED e4  STRUCTURED fold  
  alibaba/qwen3-next-80b-a3b-instruct    yes     STRUCTURED e4  STRUCTURED fold  
  alibaba/qwen3-next-80b-a3b-thinking    yes     STRUCTURED e4  STRUCTURED fold  
  amazon/nova-2-lite                     yes     STRUCTURED e4  STRUCTURED raise 40  
  amazon/nova-lite                       yes     STRUCTURED e4  STRUCTURED raise 120  
  amazon/nova-micro                      yes     STRUCTURED e4  STRUCTURED raise 40  
  amazon/nova-pro                        yes     STRUCTURED Nf3  STRUCTURED raise 40  
  anthropic/claude-3-haiku               yes     STRUCTURED e4  STRUCTURED raise 80  
  anthropic/claude-fable-5               yes     STRUCTURED e4  STRUCTURED raise 50  
  anthropic/claude-haiku-4.5             yes     STRUCTURED e4  STRUCTURED call  
  anthropic/claude-opus-4                yes     STRUCTURED e4  STRUCTURED fold  
  anthropic/claude-opus-4.1              yes     STRUCTURED e4  STRUCTURED raise 50  
  anthropic/claude-opus-4.5              yes     STRUCTURED e4  STRUCTURED raise 50  
  anthropic/claude-opus-4.6              yes     STRUCTURED e4  STRUCTURED call  
  anthropic/claude-opus-4.7              yes     STRUCTURED e4  STRUCTURED call  
  anthropic/claude-opus-4.7-fast         yes     STRUCTURED e4  STRUCTURED call  
  anthropic/claude-opus-4.8              yes     STRUCTURED e4  STRUCTURED call  
  anthropic/claude-opus-4.8-fast         yes     STRUCTURED e4  STRUCTURED call  
  anthropic/claude-sonnet-4              yes     STRUCTURED e4  STRUCTURED fold  
  anthropic/claude-sonnet-4.5            yes     STRUCTURED e4  STRUCTURED raise 60  
  anthropic/claude-sonnet-4.6            yes     STRUCTURED e4  STRUCTURED raise 60  
  anthropic/claude-sonnet-5              yes     STRUCTURED e4  STRUCTURED raise 60  
  bytedance/seed-1.6                     yes     STRUCTURED e4  STRUCTURED fold  
  bytedance/seed-1.8                     yes     STRUCTURED e4  STRUCTURED raise 60  
  deepseek/deepseek-v3.2                 yes     STRUCTURED e4  STRUCTURED raise 50  
  deepseek/deepseek-v3.2-thinking        yes     STRUCTURED e4  STRUCTURED raise 50  
  deepseek/deepseek-v4-flash             yes     STRUCTURED e4  STRUCTURED call  
  deepseek/deepseek-v4-pro               yes     STRUCTURED e4  STRUCTURED raise 50  
  google/gemini-2.5-flash                yes     STRUCTURED e4  STRUCTURED raise 40  
  google/gemini-2.5-flash-lite           yes     STRUCTURED e4  STRUCTURED call  
  google/gemini-2.5-pro                  yes     STRUCTURED e4  STRUCTURED raise 50  
  google/gemini-3-flash                  yes     STRUCTURED e4  STRUCTURED fold  
  google/gemini-3-pro-image              yes     STRUCTURED e4  STRUCTURED fold  
  google/gemini-3-pro-preview            yes     STRUCTURED e4  STRUCTURED raise 50  
  google/gemini-3.1-flash-image          yes     STRUCTURED e4  STRUCTURED fold  
  google/gemini-3.1-flash-image-preview  yes     STRUCTURED e4  STRUCTURED raise 60  
  google/gemini-3.1-flash-lite           yes     STRUCTURED e4  STRUCTURED raise 40  
  google/gemini-3.1-flash-lite-preview   yes     STRUCTURED e4  STRUCTURED call  
  google/gemini-3.1-pro-preview          yes     STRUCTURED e4  STRUCTURED raise 50  
  google/gemini-3.5-flash                yes     STRUCTURED e4  STRUCTURED fold  
  minimax/minimax-m2.1                   yes     STRUCTURED e4  STRUCTURED fold  
  minimax/minimax-m2.5                   yes     STRUCTURED e4  STRUCTURED call  
  minimax/minimax-m2.7                   yes     STRUCTURED e4  STRUCTURED fold  
  minimax/minimax-m3                     yes     STRUCTURED e4  STRUCTURED fold  
  moonshotai/kimi-k2.5                   yes     STRUCTURED e4  STRUCTURED raise 60  
  moonshotai/kimi-k2.7-code              yes     STRUCTURED e4  STRUCTURED fold  
  moonshotai/kimi-k2.7-code-highspeed    yes     STRUCTURED e4  STRUCTURED raise 40  
  nvidia/nemotron-3-super-120b-a12b      yes     STRUCTURED Nf3  STRUCTURED fold  
  nvidia/nemotron-nano-12b-v2-vl         yes     STRUCTURED e4  STRUCTURED fold  
  nvidia/nemotron-nano-9b-v2             yes     STRUCTURED Nf3  STRUCTURED raise 150  
  openai/gpt-4.1                         yes     STRUCTURED e4  STRUCTURED fold  
  openai/gpt-4.1-mini                    yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-4.1-nano                    yes     STRUCTURED e4  STRUCTURED check  
  openai/gpt-4o                          yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-4o-mini                     yes     STRUCTURED e4  STRUCTURED fold  
  openai/gpt-4o-mini-search-preview      yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5                           yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5-chat                      yes     STRUCTURED e4  STRUCTURED fold  
  openai/gpt-5-codex                     yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5-mini                      yes     STRUCTURED e4  STRUCTURED call  
  openai/gpt-5-nano                      yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.1-codex                   yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5.1-codex-max               yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5.1-codex-mini              yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.1-instant                 yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5.1-thinking                yes     STRUCTURED e4  STRUCTURED call  
  openai/gpt-5.2                         yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.2-chat                    yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.2-codex                   yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.2-pro                     yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5.3-chat                    yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5.3-codex                   yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.4                         yes     STRUCTURED e4  STRUCTURED raise 80  
  openai/gpt-5.4-mini                    yes     STRUCTURED e4  STRUCTURED call  
  openai/gpt-5.4-nano                    yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.5                         yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.5-pro                     yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.6-luna                    yes     STRUCTURED e4  STRUCTURED call  
  openai/gpt-5.6-sol                     yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5.6-terra                   yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-oss-120b                    yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-oss-20b                     yes     STRUCTURED e4  STRUCTURED call  
  openai/o1                              yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/o3                              yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/o3-mini                         yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/o3-pro                          yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/o4-mini                         yes     STRUCTURED e4  STRUCTURED raise 40  
  xai/grok-4.1-fast-non-reasoning        yes     STRUCTURED e4  STRUCTURED raise 60  
  xai/grok-4.1-fast-reasoning            yes     STRUCTURED e4  STRUCTURED fold  
  xai/grok-4.20-non-reasoning            yes     STRUCTURED e4  STRUCTURED raise 40  
  xai/grok-4.20-reasoning                yes     STRUCTURED e4  STRUCTURED raise 60  
  xai/grok-4.3                           yes     STRUCTURED e4  STRUCTURED raise 50  
  xai/grok-4.5                           yes     STRUCTURED e4  STRUCTURED raise 60  
  zai/glm-4.7                            yes     STRUCTURED e4  STRUCTURED call  
  zai/glm-4.7-flash                      yes     STRUCTURED Nf3  STRUCTURED raise 60  
  zai/glm-5                              yes     STRUCTURED e4  STRUCTURED fold  
  zai/glm-5.1                            yes     STRUCTURED e4  STRUCTURED raise 50  
  zai/glm-5.2                            yes     STRUCTURED e4  STRUCTURED call  
  zai/glm-5.2-fast                       yes     STRUCTURED e4  STRUCTURED raise 60  
```

```
Model compatibility · Vercel Labs (vercel-labs)
generated 2026-07-16 · games chess+poker · normalizer anthropic/claude-haiku-4.5 · 45s timeout

  chess  116/200 playable   FALLBACK 3  ACCESS 79  TIMEOUT 2  TEXT 15  STRUCTURED 101
  poker  110/200 playable   FALLBACK 4  ACCESS 79  TIMEOUT 7  TEXT 14  STRUCTURED 96

  legend: STRUCTURED=native JSON · TEXT=prose-parsed · NORMALIZED=2nd-LLM · FALLBACK=random · ACCESS=team blocked · TIMEOUT/ERROR

  MODEL                                  STRUCT  CHESS         POKER         NOTES
  google/gemini-3.1-flash-lite-preview   no      FALLBACK      FALLBACK      all ladder rungs failed — HTTP 404 [AI_APICallError] Publisher model `projects/1
  google/gemini-omni-flash-preview       yes     STRUCTURED e4  FALLBACK      all ladder rungs failed — ladder failed but a bare structured call succeeded (li
  openai/o3-deep-research                no      FALLBACK      FALLBACK      all ladder rungs failed — HTTP 400 [AI_APICallError] Invalid parameter: 'text.fo
  xai/grok-4.3                           no      FALLBACK      FALLBACK      all ladder rungs failed — Failed after 3 attempts. Last error: Service Unavailab
  alibaba/qwen-3-14b                     —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen-3-30b                     —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen-3.6-max-preview           —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-235b-a22b-thinking       —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-coder-plus               —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-max                      —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-max-preview              —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-max-thinking             —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-vl-235b-a22b-instruct    —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-vl-instruct              —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3-vl-thinking              —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3.5-flash                  —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3.5-plus                   —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3.6-27b                    —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3.6-plus                   —       ACCESS        ACCESS        restricted provider access on this team
  alibaba/qwen3.7-max                    —       ACCESS        ACCESS        restricted provider access on this team
  bytedance/seed-1.6                     —       ACCESS        ACCESS        restricted provider access on this team
  bytedance/seed-1.8                     —       ACCESS        ACCESS        restricted provider access on this team
  cohere/command-a                       —       ACCESS        ACCESS        restricted provider access on this team
  deepseek/deepseek-v3                   —       ACCESS        ACCESS        restricted provider access on this team
  deepseek/deepseek-v3.1                 —       ACCESS        ACCESS        restricted provider access on this team
  deepseek/deepseek-v3.1-terminus        —       ACCESS        ACCESS        restricted provider access on this team
  google/gemma-4-31b-it                  —       ACCESS        ACCESS        restricted provider access on this team
  inception/mercury-2                    —       ACCESS        ACCESS        restricted provider access on this team
  inception/mercury-coder-small          —       ACCESS        ACCESS        restricted provider access on this team
  interfaze/interfaze-beta               —       ACCESS        ACCESS        restricted provider access on this team
  kwaipilot/kat-coder-air-v2.5           —       ACCESS        ACCESS        restricted provider access on this team
  kwaipilot/kat-coder-pro-v1             —       ACCESS        ACCESS        restricted provider access on this team
  kwaipilot/kat-coder-pro-v2             —       ACCESS        ACCESS        restricted provider access on this team
  kwaipilot/kat-coder-pro-v2.5           —       ACCESS        ACCESS        restricted provider access on this team
  meta/muse-spark-1.1                    —       ACCESS        ACCESS        restricted provider access on this team
  minimax/minimax-m2                     —       ACCESS        ACCESS        restricted provider access on this team
  minimax/minimax-m2.1-lightning         —       ACCESS        ACCESS        restricted provider access on this team
  minimax/minimax-m2.5-highspeed         —       ACCESS        ACCESS        restricted provider access on this team
  minimax/minimax-m2.7-highspeed         —       ACCESS        ACCESS        restricted provider access on this team
  mistral/codestral                      —       ACCESS        ACCESS        restricted provider access on this team
  mistral/devstral-2                     —       ACCESS        ACCESS        restricted provider access on this team
  mistral/devstral-small-2               —       ACCESS        ACCESS        restricted provider access on this team
  mistral/magistral-medium               —       ACCESS        ACCESS        restricted provider access on this team
  mistral/magistral-small                —       ACCESS        ACCESS        restricted provider access on this team
  mistral/ministral-14b                  —       ACCESS        ACCESS        restricted provider access on this team
  mistral/ministral-3b                   —       ACCESS        ACCESS        restricted provider access on this team
  mistral/ministral-8b                   —       ACCESS        ACCESS        restricted provider access on this team
  mistral/mistral-large-3                —       ACCESS        ACCESS        restricted provider access on this team
  mistral/mistral-medium                 —       ACCESS        ACCESS        restricted provider access on this team
  mistral/mistral-medium-3.5             —       ACCESS        ACCESS        restricted provider access on this team
  mistral/mistral-nemo                   —       ACCESS        ACCESS        restricted provider access on this team
  mistral/mistral-small                  —       ACCESS        ACCESS        restricted provider access on this team
  mistral/pixtral-12b                    —       ACCESS        ACCESS        restricted provider access on this team
  moonshotai/kimi-k2                     —       ACCESS        ACCESS        restricted provider access on this team
  moonshotai/kimi-k2-thinking            —       ACCESS        ACCESS        restricted provider access on this team
  morph/morph-v3-fast                    —       ACCESS        ACCESS        restricted provider access on this team
  morph/morph-v3-large                   —       ACCESS        ACCESS        restricted provider access on this team
  nvidia/nemotron-3-nano-30b-a3b         —       ACCESS        ACCESS        restricted provider access on this team
  nvidia/nemotron-3-ultra-550b-a55b      —       ACCESS        ACCESS        restricted provider access on this team
  openai/gpt-oss-safeguard-20b           —       ACCESS        ACCESS        restricted provider access on this team
  perplexity/sonar                       —       ACCESS        ACCESS        restricted provider access on this team
  perplexity/sonar-pro                   —       ACCESS        ACCESS        restricted provider access on this team
  perplexity/sonar-reasoning-pro         —       ACCESS        ACCESS        restricted provider access on this team
  stepfun/step-3.5-flash                 —       ACCESS        ACCESS        restricted provider access on this team
  stepfun/step-3.7-flash                 —       ACCESS        ACCESS        restricted provider access on this team
  thinkingmachines/inkling               —       ACCESS        ACCESS        restricted provider access on this team
  xai/grok-4.20-multi-agent              —       ACCESS        ACCESS        restricted provider access on this team
  xai/grok-4.20-multi-agent-beta         —       ACCESS        ACCESS        restricted provider access on this team
  xai/grok-4.20-non-reasoning-beta       —       ACCESS        ACCESS        restricted provider access on this team
  xai/grok-4.20-reasoning-beta           —       ACCESS        ACCESS        restricted provider access on this team
  xai/grok-4.5                           —       ACCESS        ACCESS        restricted provider access on this team
  xai/grok-build-0.1                     —       ACCESS        ACCESS        restricted provider access on this team
  xiaomi/mimo-v2.5                       —       ACCESS        ACCESS        restricted provider access on this team
  xiaomi/mimo-v2.5-pro                   —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-4.5                            —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-4.5-air                        —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-4.5v                           —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-4.6                            —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-4.6v                           —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-4.6v-flash                     —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-4.7-flashx                     —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-5-turbo                        —       ACCESS        ACCESS        restricted provider access on this team
  zai/glm-5v-turbo                       —       ACCESS        ACCESS        restricted provider access on this team
  minimax/minimax-m2.1                   —       TIMEOUT       TIMEOUT       Delay was aborted
  moonshotai/kimi-k2.6                   yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  moonshotai/kimi-k2.7-code-highspeed    yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  openai/gpt-5-pro                       —       TIMEOUT       TIMEOUT       Delay was aborted
  openai/gpt-5.4-pro                     yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  openai/gpt-5.5-pro                     yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  openai/o3-pro                          yes     STRUCTURED e4  TIMEOUT       Delay was aborted
  alibaba/qwen3.7-plus                   no      TEXT e4       STRUCTURED raise 60  structured output unsupported; plain-text fallback
  deepseek/deepseek-r1                   no      TEXT e4       TEXT fold     structured output unsupported; plain-text fallback
  google/gemini-2.5-flash-image          no      TEXT e4       TEXT raise 40  structured output unsupported; plain-text fallback
  google/gemini-3.1-flash-lite-image     no      TEXT e4       TEXT call     structured output unsupported; plain-text fallback
  meta/llama-3.1-70b                     no      TEXT e4       TEXT call     structured output unsupported; plain-text fallback
  meta/llama-3.1-8b                      no      TEXT e4       TEXT call     structured output unsupported; plain-text fallback
  meta/llama-3.2-11b                     no      TEXT e4       TEXT bet 20   structured output unsupported; plain-text fallback
  meta/llama-3.2-1b                      no      TEXT e4       TEXT call     structured output unsupported; plain-text fallback
  meta/llama-3.2-3b                      no      TEXT Nf3      TEXT call     structured output unsupported; plain-text fallback
  meta/llama-3.2-90b                     no      TEXT e4       TEXT raise 40  structured output unsupported; plain-text fallback
  meta/llama-3.3-70b                     no      TEXT e4       TEXT raise 60  structured output unsupported; plain-text fallback
  meta/llama-4-maverick                  no      TEXT e4       TEXT raise 60  structured output unsupported; plain-text fallback
  meta/llama-4-scout                     no      TEXT e4       TEXT raise 40  structured output unsupported; plain-text fallback
  openai/gpt-3.5-turbo                   no      TEXT Nf3      TEXT raise 80  structured output unsupported; plain-text fallback
  openai/gpt-4-turbo                     no      TEXT e4       TEXT raise 60  structured output unsupported; plain-text fallback
  alibaba/qwen-3-235b                    yes     STRUCTURED e4  STRUCTURED call  
  alibaba/qwen-3-32b                     yes     STRUCTURED Nf3  STRUCTURED raise 40  
  alibaba/qwen3-coder                    yes     STRUCTURED e4  STRUCTURED call  
  alibaba/qwen3-coder-30b-a3b            yes     STRUCTURED e4  STRUCTURED raise 40  
  alibaba/qwen3-coder-next               yes     STRUCTURED e4  STRUCTURED raise 40  
  alibaba/qwen3-next-80b-a3b-instruct    yes     STRUCTURED e4  STRUCTURED call  
  alibaba/qwen3-next-80b-a3b-thinking    yes     STRUCTURED e4  STRUCTURED fold  
  amazon/nova-2-lite                     yes     STRUCTURED e4  STRUCTURED raise 40  
  amazon/nova-lite                       yes     STRUCTURED e4  STRUCTURED raise 120  
  amazon/nova-micro                      yes     STRUCTURED e4  STRUCTURED raise 40  
  amazon/nova-pro                        yes     STRUCTURED Nf3  STRUCTURED fold  
  anthropic/claude-3-haiku               yes     STRUCTURED e4  STRUCTURED raise 50  
  anthropic/claude-fable-5               yes     STRUCTURED e4  STRUCTURED raise 50  
  anthropic/claude-haiku-4.5             yes     STRUCTURED e4  STRUCTURED call  
  anthropic/claude-opus-4                yes     STRUCTURED e4  STRUCTURED raise 70  
  anthropic/claude-opus-4.1              yes     STRUCTURED e4  STRUCTURED fold  
  anthropic/claude-opus-4.5              yes     STRUCTURED e4  STRUCTURED raise 35  
  anthropic/claude-opus-4.6              yes     STRUCTURED e4  STRUCTURED fold  
  anthropic/claude-opus-4.7              yes     STRUCTURED e4  STRUCTURED raise 60  
  anthropic/claude-opus-4.7-fast         yes     STRUCTURED e4  STRUCTURED raise 30  
  anthropic/claude-opus-4.8              yes     STRUCTURED e4  STRUCTURED raise 30  
  anthropic/claude-opus-4.8-fast         yes     STRUCTURED e4  STRUCTURED call  
  anthropic/claude-sonnet-4              yes     STRUCTURED e4  STRUCTURED call  
  anthropic/claude-sonnet-4.5            yes     STRUCTURED e4  STRUCTURED raise 60  
  anthropic/claude-sonnet-4.6            yes     STRUCTURED e4  STRUCTURED raise 60  
  anthropic/claude-sonnet-5              yes     STRUCTURED e4  STRUCTURED raise 70  
  deepseek/deepseek-v3.2                 yes     STRUCTURED e4  STRUCTURED raise 60  
  deepseek/deepseek-v3.2-thinking        yes     STRUCTURED e4  STRUCTURED raise 60  
  deepseek/deepseek-v4-flash             yes     STRUCTURED e4  STRUCTURED raise 60  
  deepseek/deepseek-v4-pro               yes     STRUCTURED e4  STRUCTURED raise 40  
  google/gemini-2.5-flash                yes     STRUCTURED e4  STRUCTURED fold  
  google/gemini-2.5-flash-lite           yes     STRUCTURED e4  STRUCTURED fold  
  google/gemini-2.5-pro                  yes     STRUCTURED e4  STRUCTURED raise 60  
  google/gemini-3-flash                  yes     STRUCTURED e4  STRUCTURED fold  
  google/gemini-3-pro-image              yes     STRUCTURED e4  STRUCTURED raise 60  
  google/gemini-3-pro-preview            yes     STRUCTURED e4  STRUCTURED fold  
  google/gemini-3.1-flash-image          yes     STRUCTURED e4  STRUCTURED raise 60  
  google/gemini-3.1-flash-image-preview  yes     STRUCTURED e4  STRUCTURED call  
  google/gemini-3.1-flash-lite           yes     STRUCTURED e4  STRUCTURED call  
  google/gemini-3.1-pro-preview          yes     STRUCTURED e4  STRUCTURED fold  
  google/gemini-3.5-flash                yes     STRUCTURED e4  STRUCTURED fold  
  google/gemma-4-26b-a4b-it              yes     STRUCTURED e4  STRUCTURED raise 40  
  minimax/minimax-m2.5                   yes     STRUCTURED e4  STRUCTURED raise 40  
  minimax/minimax-m2.7                   yes     STRUCTURED e4  STRUCTURED call  
  minimax/minimax-m3                     yes     STRUCTURED e4  STRUCTURED raise 40  
  moonshotai/kimi-k2.5                   yes     STRUCTURED e4  STRUCTURED call  
  moonshotai/kimi-k2.7-code              yes     STRUCTURED e4  STRUCTURED raise 60  
  nvidia/nemotron-3-super-120b-a12b      yes     STRUCTURED e4  STRUCTURED call  
  nvidia/nemotron-nano-12b-v2-vl         yes     STRUCTURED d4  STRUCTURED raise 90  
  nvidia/nemotron-nano-9b-v2             yes     STRUCTURED Nf3  STRUCTURED raise 40  
  openai/gpt-4.1                         yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-4.1-mini                    yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-4.1-nano                    yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-4o                          yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-4o-mini                     yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-4o-mini-search-preview      yes     STRUCTURED e4  STRUCTURED call  
  openai/gpt-5                           yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5-chat                      yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5-codex                     yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5-mini                      yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5-nano                      yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.1-codex                   yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.1-codex-max               yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.1-codex-mini              yes     STRUCTURED e4  STRUCTURED raise 80  
  openai/gpt-5.1-instant                 yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.1-thinking                yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.2                         yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.2-chat                    yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.2-codex                   yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.2-pro                     yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-5.3-chat                    yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.3-codex                   yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.4                         yes     STRUCTURED e4  STRUCTURED call  
  openai/gpt-5.4-mini                    yes     STRUCTURED e4  STRUCTURED call  
  openai/gpt-5.4-nano                    yes     STRUCTURED e4  STRUCTURED fold  
  openai/gpt-5.5                         yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.6-luna                    yes     STRUCTURED e4  STRUCTURED raise 60  
  openai/gpt-5.6-sol                     yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-5.6-terra                   yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/gpt-oss-120b                    yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/gpt-oss-20b                     yes     STRUCTURED e4  STRUCTURED raise 150  
  openai/o1                              yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/o3                              yes     STRUCTURED e4  STRUCTURED raise 50  
  openai/o3-mini                         yes     STRUCTURED e4  STRUCTURED raise 40  
  openai/o4-mini                         yes     STRUCTURED e4  STRUCTURED raise 40  
  xai/grok-4.1-fast-non-reasoning        yes     STRUCTURED e4  STRUCTURED fold  
  xai/grok-4.1-fast-reasoning            yes     STRUCTURED e4  STRUCTURED call  
  xai/grok-4.20-non-reasoning            yes     STRUCTURED e4  STRUCTURED raise 40  
  xai/grok-4.20-reasoning                yes     STRUCTURED e4  STRUCTURED fold  
  zai/glm-4.7                            yes     STRUCTURED e4  STRUCTURED raise 60  
  zai/glm-4.7-flash                      yes     STRUCTURED Nf3  STRUCTURED raise 40  
  zai/glm-5                              yes     STRUCTURED e4  STRUCTURED call  
  zai/glm-5.1                            yes     STRUCTURED e4  STRUCTURED raise 60  
  zai/glm-5.2                            yes     STRUCTURED e4  STRUCTURED raise 40  
  zai/glm-5.2-fast                       yes     STRUCTURED e4  STRUCTURED fold  
```

