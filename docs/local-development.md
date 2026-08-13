# Локальная разработка

Для проекта нужен Node.js 24 и pnpm 10.15.0 через Corepack:

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install
```

Запуск локального интерфейса:

```bash
pnpm --dir apps/web dev
```

Web-команды `dev`, `test`, `typecheck`, `build` и `e2e` перед запуском автоматически собирают `@personal-plan/core` и `@personal-plan/sync`; предварительно созданные каталоги `dist` не требуются. То же относится к основным командам Android и relay.

Основные проверки:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm --dir apps/web test
pnpm --dir apps/web typecheck
pnpm --dir apps/web build
```

Для браузерного acceptance-теста Chromium устанавливается и запускается из одного и того же локального каталога:

```bash
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/personal-plan-playwright pnpm --dir apps/web exec playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/personal-plan-playwright pnpm --dir apps/web e2e
```

Без relay план продолжает работать локально. Для синхронизации между устройствами запустите relay по инструкции [sync operations](sync-operations.md); перед публикацией наружу обязательно добавьте TLS.
