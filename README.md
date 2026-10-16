# AI Limits Meter — Claude Code & Codex

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/renatodouek.ai-limits-meter?label=VS%20Code%20Marketplace&color=F5C518)](https://marketplace.visualstudio.com/items?itemName=renatodouek.ai-limits-meter)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/renatodouek.ai-limits-meter?color=F5C518)](https://marketplace.visualstudio.com/items?itemName=renatodouek.ai-limits-meter)

**PT-BR** · [English below](#english)

Veja seus limites de **5 horas** e **semanal** do Claude Code e do Codex o tempo todo dentro do VS Code, junto com o consumo em **R$ / US$** e **tokens**, sem precisar abrir a tela de uso.

![AI Limits Meter](media/screenshot.png)

## O que mostra

- **Barras de limite (5h e semanal)** que começam vazias e enchem até 100%, mostrando quanto já foi usado e quando renova. A barra fica laranja a partir de 80% e vermelha a partir de 92%.
- **Consumo** do último prompt, da sessão atual, da janela de 5h, de hoje e da semana, em R$, US$ e tokens. Passe o mouse em uma linha para ver o detalhe: entrada, saída, cache e número de chamadas.
- **Barra de status** sempre visível, por exemplo `Claude 82%·25%  Codex 64%·53%  R$ 6,56`. Clique nela para abrir o painel.
- **Avisos** quando você atinge 80% e 95% de um limite (configurável).

## De onde vêm os números

| | Claude Code | Codex |
|---|---|---|
| % dos limites | O mesmo endpoint que a tela "Usage" do Claude usa, com o login que o Claude Code já guarda no seu PC | Gravados pelo próprio Codex nos logs de sessão (`~/.codex/sessions`) |
| Tokens e custo | Logs locais (`~/.claude/projects`) | Logs locais (`~/.codex/sessions`) |

- **O custo é o equivalente ao preço da API.** Planos por assinatura (Pro, Max, ChatGPT Plus/Pro) não cobram por token. O valor serve para você ter noção do quanto está consumindo.
- **Cotação US$→R$:** é buscada uma vez por dia em APIs gratuitas (AwesomeAPI, com a ExchangeRate-API como reserva). Se preferir, defina um valor fixo em `aiLimitsMeter.usdToBrl`.
- **Codex:** os limites só são atualizados quando você usa o Codex, porque é nesse momento que ele grava os valores. Depois que uma janela renova, ela volta automaticamente a 100%.
- O endpoint de limites do Claude não é oficialmente documentado e pode mudar.

## Privacidade

- Nada é enviado para terceiros e não há telemetria.
- O token do Claude Code é lido do seu computador e enviado **somente** para `api.anthropic.com`.
- A única outra conexão feita é a consulta da cotação do dólar.

## Instalação

**Pelo Marketplace:** procure por **AI Limits Meter** na aba Extensões ou [instale por aqui](https://marketplace.visualstudio.com/items?itemName=renatodouek.ai-limits-meter).

**Por arquivo `.vsix`:**
1. Abra a aba Extensões.
2. Clique em `⋯` e depois em **Install from VSIX…**.
3. Escolha o arquivo.

**Onde posicionar os painéis:** a extensão tem **dois painéis independentes**, um para o **Claude Code** e outro para o **Codex**. Arraste cada aba para o lugar que funciona melhor para aquela IA: barra lateral esquerda, barra lateral direita ou painel inferior. A barra de status também mostra um item separado para cada uma.

**Uma IA por projeto:** clique no ícone de projeto no topo do painel, ou rode **AI Limits: Choose AI for this project**, e escolha Claude Code, Codex ou ambos. A escolha fica salva só naquele projeto: o painel da outra IA some e o que fica aparece na posição que você definiu para ele.

O VS Code não permite que uma extensão se encaixe dentro do chat de outra, então os painéis não podem ficar acima da caixa de prompt. O VS Code guarda a posição que você escolher.

## Configurações

| Configuração | Padrão | O que faz |
|---|---|---|
| `aiLimitsMeter.currency` | `both` | `both`, `brl` ou `usd` |
| `aiLimitsMeter.usdToBrl` | `0` | Cotação fixa (0 = automática) |
| `aiLimitsMeter.barColor` | `#F5C518` | Cor das barras |
| `aiLimitsMeter.statusBar` | `limitsAndCost` | `limitsAndCost`, `limits` ou `off` |
| `aiLimitsMeter.warnAtPercentUsed` | `[80, 95]` | Quando avisar (`[]` desliga os avisos) |
| `aiLimitsMeter.providers` | `["claude","codex"]` | Quais ferramentas acompanhar |
| `aiLimitsMeter.apiPollSeconds` | `120` | Intervalo de consulta dos limites do Claude (mínimo 60) |
| `aiLimitsMeter.customPrices` | `{}` | Preços de modelos novos, em US$ por 1M de tokens |

---

## English

Always-visible **5-hour** and **weekly** limits for Claude Code and Codex in VS Code, plus usage in **US$ / R$** and **tokens**.

- Limit bars start empty and fill up to 100% as you use them, with the reset time. Bars turn orange from 80% and red from 92%.
- Usage is shown for the last prompt, current session, 5h window, today and week. Hover a row for the input/output/cache breakdown.
- Separate panels and status bar items for Claude Code and Codex, so you can place each one where it fits best.
- Per-project choice of which AI to track: run **AI Limits: Choose AI for this project**.
- A status bar item is always visible, and you get notifications at 80% and 95% of a limit.
- **Claude limits** come from the same endpoint as Claude's Usage screen, using the login Claude Code already stores. **Codex limits** come from Codex's own session logs. **Tokens and cost** come from local logs.
- Cost is the **API-equivalent** price. Subscription plans are not billed per token.
- No telemetry. Your Claude token is only ever sent to `api.anthropic.com`.
- Set `aiLimitsMeter.currency` to `usd` if you don't need BRL.

Not affiliated with Anthropic or OpenAI. MIT licensed.
