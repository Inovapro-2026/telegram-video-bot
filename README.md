# Telegram Video Bot

Bot Telegram independente para receber links do YouTube, mostrar apenas qualidades reais disponíveis, processar com `yt-dlp`/FFmpeg e entregar o arquivo pelo próprio Telegram.

Este projeto **não faz parte do ClipBR** e não usa Neon, Supabase ou qualquer outro serviço do projeto principal.

## Importante

- Use somente vídeos próprios ou autorizados.
- O bot não contorna DRM, login, cookies pessoais, bloqueios regionais, restrições de idade, proxies ou sistemas antiautomação.
- Se o YouTube bloquear o acesso, o bot informa o bloqueio e encerra a operação sem tentar evasão.
- Nenhuma credencial é gravada no código, nos testes, nos logs ou no pacote de deploy.

## Requisitos

- Node.js 18 ou superior.
- `yt-dlp` acessível no `PATH` (ou configurado em `YT_DLP_PATH`).
- `ffmpeg` e `ffprobe` acessíveis no `PATH` (ou configurados em `FFMPEG_PATH` e `FFPROBE_PATH`).
- Um token de bot obtido no [@BotFather](https://t.me/BotFather).

## Instalação local

```bash
cd telegram-video-bot
npm install
cp .env.example .env
# edite .env e defina TELEGRAM_BOT_TOKEN
npm run build
npm start
```

O bot usa **long polling**; não é necessário configurar webhook nem domínio público.

Se `.env` estiver vazio, o código tenta ler apenas o `TELEGRAM_BOT_TOKEN` do `.env` da pasta pai. Na Discloud, defina as variáveis diretamente no painel da aplicação.

## Configuração

Arquivo `.env` (exemplo sem valor real):

```ini
TELEGRAM_BOT_TOKEN=123456:COLOQUE_AQUI
MAX_FILE_SIZE_MB=47
MAX_CONCURRENT_DOWNLOADS=1
DOWNLOAD_TIMEOUT_SECONDS=900
ENABLE_MP3=true
SESSION_TTL_MINUTES=15
MAX_REQUESTS_PER_MINUTE=5
DROP_PENDING_UPDATES=true
LOG_LEVEL=INFO
```

Variáveis com suporte:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | — | Token do bot. Obrigatório. |
| `MAX_FILE_SIZE_MB` | `47` | Limite antes do envio (47 MiB ≈ 49,3 MB), abaixo do limite de 50 MB da Bot API. |
| `MAX_CONCURRENT_DOWNLOADS` | `1` | Máximo de downloads simultâneos por processo. |
| `DOWNLOAD_TIMEOUT_SECONDS` | `900` | Timeout de cada download/conversão. |
| `ENABLE_MP3` | `true` | Habilita a opção de extrair áudio MP3. |
| `SESSION_TTL_MINUTES` | `15` | Validade do teclado de qualidade. |
| `MAX_REQUESTS_PER_MINUTE` | `5` | Limite de links por usuário por minuto. |
| `DROP_PENDING_UPDATES` | `true` | Descarta updates antigos ao iniciar. |
| `TEMP_DIR` | `temp` | Pasta de arquivos temporários. |
| `TEMP_MAX_AGE_HOURS` | `6` | Limpeza de resíduos antigos na inicialização. |
| `ALLOWED_USER_IDS` | vazio | Lista opcional de IDs permitidos, separados por vírgula. |
| `YT_DLP_PATH` | `yt-dlp` | Caminho do executável. |
| `FFMPEG_PATH` | `ffmpeg` | Caminho do executável. |
| `FFPROBE_PATH` | `ffprobe` | Caminho do executável. |
| `LOG_LEVEL` | `INFO` | Use `DEBUG` para diagnóstico local. |

## Comandos

- `/start` — apresentação e instruções.
- `/help` — ajuda e limites.
- `/cancel` — cancela o processamento em andamento.

Fluxo: envie um link legítimo do YouTube → o bot consulta os formatos reais → escolha uma qualidade no teclado inline → acompanhe o progresso → receba o arquivo. O teclado é removido após a escolha; cliques tardios recebem apenas um aviso curto.

Quando o vídeo tem várias faixas de áudio, o bot prefere a faixa original/padrão e o idioma informado nos metadados, evitando áudios dublados automáticos.

## Testes

```bash
npm test
```

Os testes usam tokens fictícios e `fetch` simulado: não acessam o Telegram nem baixam vídeos.

Para uma verificação real e controlada:

```bash
npm run build
env TEST_CHAT_ID=SEU_ID LIVE_QUALITY=360 node scripts/live-check.js
env TEST_CHAT_ID=SEU_ID LIVE_QUALITY=mp3 node scripts/live-check.js
```

`LIVE_VIDEO_URL` pode ser definido para outro vídeo autorizado. O padrão é um vídeo CC-BY de teste.

## Deploy na Discloud

O pacote ZIP deve conter a raiz do projeto diretamente nele, sem uma pasta envoltória. Inclui `src/`, `package.json`, `tsconfig.json`, `discloud.config`, `.discloudignore` e esta documentação.

O `discloud.config` usa:

```ini
NAME=Telegram Video Bot
TYPE=bot
MAIN=dist/index.js
BUILD=npm run build
START=npm run start
RAM=1024
VERSION=latest
APT=tools, ffmpeg, yt-dlp
```

A Discloud reserva `dist/` para o processo de build. Por isso, **o ZIP não inclui `dist/`**: a plataforma executa `npm run build` e gera `dist/index.js` antes de iniciar o bot.

Antes de enviar:

1. Confirme no painel a RAM do seu plano. `RAM=1024` exige plano Gold ou superior; em planos menores, ajuste o valor no `discloud.config` antes do upload.
2. Configure `TELEGRAM_BOT_TOKEN` em **Variáveis de Ambiente** no painel da Discloud. Nunca anexe o `.env`.
3. Envie o ZIP pelo painel. Não use webhook.

Nenhum deploy automático é feito por este repositório.

## Limites e limpeza

- Arquivos acima de `MAX_FILE_SIZE_MB` são recusados antes do envio.
- Se o Telegram recusar o arquivo por tamanho, o bot avisa sem reenviar.
- Se `sendVideo`/`sendAudio` falhar por formato não suportado, o bot tenta uma única vez como documento.
- Cada tarefa tem timeout, pode ser cancelada e remove seu diretório temporário ao finalizar.
- Ao iniciar, resíduos temporários mais antigos que `TEMP_MAX_AGE_HOURS` são removidos.
