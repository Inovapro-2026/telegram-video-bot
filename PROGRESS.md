# Progresso — Telegram Video Bot

## Status atual

Projeto independente criado em `telegram-video-bot/`. Nenhum arquivo do ClipBR foi alterado. O bot está rodando localmente em long polling e **nenhum deploy foi feito na Discloud**.

## Fase 1 — Audição e preparação

- Sistema auditado: Ubuntu 26.04.1 x86_64, Node.js v26.12.1, npm 11.20.0, FFmpeg/ffprobe 8.0.1 e yt-dlp 2026.10.26.
- Token Telegram local validado com sucesso, sem exibir seu valor. Bot identificado: `@clipbrofc_bot`.
- Documentação da Discloud consultada: `MAIN` obrigatório, `dist/` reservado ao build, `.discloudignore` usa nomes exatos sem wildcards, `APT` aceita `tools, ffmpeg, yt-dlp`.
- Nenhuma credencial foi copiada para o código, testes, logs ou pacotes.

## Fase 2 — Implementação e testes locais

- Estrutura criada com comandos, callbacks, serviços de mídia, configuração, testes e script de verificação real.
- Implementados `/start`, `/help`, `/cancel`, validação de links, botões de qualidade, progresso, rate limit, concorrência, cancelamento, timeout, verificação de arquivo, limite do Telegram e limpeza de temporários.
- Qualidades exibidas somente quando presentes nos formatos reais retornados pelo yt-dlp; URLs normalizadas para `watch?v=<id>`.
- Processos externos executados sem shell e com `--ignore-config`; sem cookies, proxy, DRM, login ou antiautomação.
- `npm test` passou com **23/23 testes**. Build de produção passou.
- Testes cobrem metadados, formatação, limites, fluxo de botões, concorrência, cancelamento, limpeza, FFmpeg, transporte Telegram, fallback para documento, rejeição por tamanho e preferência de faixa de áudio original.

## Fase 3 — Validação real e correções

- Metadados reais OK com vídeo autorizado CC-BY `aqz-KE-bpKQ`: 360p, 480p, 720p HD, 1080p Full HD, melhor qualidade e MP3.
- Bloqueio real do yt-dlp para vídeo indisponível foi tratado com mensagem genérica, sem dados sensíveis.
- `/start` real foi processado pelo bot em execução.
- Callback obsoleto de sessão antiga foi processado com aviso curto e sem recriar mensagem de erro: log `Callback obsoleto ignorado`.
- A entrega real com Telegraf falhou com `socket hang up` em `sendDocument`/`sendAudio`. O serviço de entrega foi reescrito com `fetch` nativo (`FormData` + `Blob`), com fallback único para documento.
- O script de verificação real também passou a usar `fetch` nativo para `getMe`, eliminando uma falha transitória de `ECONNRESET` do Telegraf.

### Diagnóstico do vídeo não entregue ao usuário

- O usuário escolheu 720p para o vídeo `4Inenz1duLw` e não recebeu o arquivo.
- Os logs não mostravam falha porque o limite antigo era 45 MiB e o arquivo estimado em 720p era de 46 MB. O bot tratou isso como `FileTooLargeError`, exibiu aviso de tamanho no chat e limpou o temporário — sem gerar log de erro.
- O limite foi aumentado para `MAX_FILE_SIZE_MB=47` (47 MiB ≈ 49,3 MB), ainda abaixo do limite de 50 MB da Bot API do Telegram.
- Após a alteração, `npm test` passou, o bot foi reiniciado e aquele mesmo vídeo em 720p foi baixado e entregue com sucesso: 48.227.018 bytes.

### Diagnóstico do áudio em inglês

- O usuário informou que o vídeo entregue estava com áudio em inglês.
- O vídeo `4Inenz1duLw` possui faixas `140-0` (en-US) e `140-1` (pt-BR, original/default). O seletor antigo escolhia a primeira faixa por taxa de bits, caindo na faixa em inglês.
- `formatService` agora usa o idioma informado pelo yt-dlp (`info.language`) e as marcas `original`/`default`/`dubbed` do `format_note` para escolher a faixa. A seleção atual para esse vídeo é `audio=140-1` em todas as qualidades e no MP3.
- Após nova reinicialização, o vídeo 720p foi entregue novamente: 48.225.516 bytes, com a faixa portuguesa selecionada.

### Entregas reais concluídas

- 360p / Big Buck Bunny: 34.770.802 bytes.
- MP3 / Big Buck Bunny: 15.231.212 bytes.
- 720p / Big Buck Bunny: 40.289.126 bytes.
- 720p / vídeo `4Inenz1duLw` (idioma corrigido): 48.225.516 bytes.

Todas registraram `Entrega pelo Telegram: OK` e `Limpeza: OK`, sem arquivos temporários residuais.

## Fase 4 — Preparação para hospedagem

- `discloud.config` definido com `TYPE=bot`, `MAIN=dist/index.js`, `BUILD=npm run build`, `START=npm run start`, `APT=tools, ffmpeg, yt-dlp`, `VERSION=latest` e `RAM=1024`.
- `.discloudignore` corrigido para conter apenas nomes exatos, sem wildcards.
- Conforme a documentação atual da Discloud, `dist/` é reservada ao build da plataforma; portanto o ZIP **não inclui `dist/`**. A validação do build foi feita separadamente a partir do conteúdo do pacote, gerando `dist/index.js`.
- `README.md` criado em português com instalação, `.env`, testes, build, pacote de deploy, limites e instruções manuais de hospedagem.
- Pacote de deploy preparado em `/tmp/opencode/telegram-video-bot-deploy/` com `src/`, `package.json`, `tsconfig.json`, `discloud.config`, `.discloudignore`, `.env.example` e `README.md`.
- Validação confirmou que o pacote compila e gera `dist/index.js`; não contém `.env`, `node_modules`, `temp`, `test`, `scripts`, logs, credenciais ou token Telegram.
- ZIP de deploy gerado em `/tmp/opencode/telegram-video-bot.zip`, com conteúdo e integridade verificados.
- Nenhum deploy foi realizado; o proprietário enviará o ZIP manualmente.

## Pendências

- Confirmar no painel da Discloud a RAM contratada. O valor atual `RAM=1024` exige plano Gold ou superior; se o plano for Free (100 MB), o valor deverá ser ajustado antes do envio.
- Confirmar com o usuário se o último vídeo 720p chegou com áudio em português.

## Como retomar

1. Executar `npm test` e `npm run build`.
2. Usar `env DROP_PENDING_UPDATES=false LOG_LEVEL=DEBUG npm start` para operar localmente.
3. Usar `env TEST_CHAT_ID=6595871433 LIVE_VIDEO_URL=https://www.youtube.com/watch?v=4Inenz1duLw LIVE_QUALITY=720 node scripts/live-check.js` para verificação real controlada.
4. Não implantar automaticamente; o ZIP pronto deve ser enviado manualmente ao painel da Discloud.
