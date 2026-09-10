'use strict';

/**
 * @module infra/updater
 * Обновление приложения из git: проверка новой ревизии, подтягивание кода,
 * добор зависимостей и перезапуск процесса. Это слой инфраструктуры — запуск
 * внешних процессов и выход из процесса; доменные сервисы такого не делают
 * (см. CLAUDE.md §2.2, docs/architecture.md).
 * Экспорт: runUpdate.
 */

const { execFile } = require('child_process');
const path = require('path');

// Корень репозитория: __dirname указывает на src/infra/.
const REPO_DIR = path.join(__dirname, '..', '..');

// Потолки времени на внешние команды: git ходит в сеть, npm ставит пакеты.
const GIT_TIMEOUT = 60000;
const NPM_TIMEOUT = 300000;

// Пауза перед выходом из процесса: даём последнему сообщению уйти в сокет,
// иначе клиент не увидит «приложение обновлено».
const EXIT_DELAY = 400;

// В Windows npm — это npm.cmd, а .cmd исполняется только через shell.
const NPM_CMD = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Одно обновление за раз: параллельные git-операции в одном рабочем каталоге
// ломают индекс репозитория.
let running = false;

/**
 * Запускает внешнюю команду в каталоге репозитория. Аргументы всегда заданы в
 * коде — данные от клиента сюда не попадают, поэтому shell не нужен.
 *
 * @param {string} cmd - исполняемый файл
 * @param {string[]} args - аргументы
 * @param {number} timeout - потолок времени, мс
 * @param {boolean} [useShell] - выполнять через shell (нужно для npm.cmd)
 * @returns {Promise<string>} stdout без крайних пробелов
 */
function run(cmd, args, timeout, useShell) {
  return new Promise((resolve, reject) => {
    const opts = { cwd: REPO_DIR, timeout, windowsHide: true, shell: !!useShell };
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) {
        const text = String(stderr || err.message || '').trim();
        reject(new Error(text || 'команда завершилась с ошибкой'));
        return;
      }
      resolve(String(stdout).trim());
    });
  });
}

/**
 * Может ли процесс перезапустить себя сам. Под systemd выход из процесса
 * означает перезапуск (в unit задан Restart=always), а при запуске руками
 * (`npm start`) поднимать процесс заново некому.
 *
 * @returns {boolean} true, если процессом управляет systemd
 */
function canRestart() {
  return !!process.env.INVOCATION_ID;
}

/**
 * Проверяет обновления и, если новая ревизия есть, обновляет приложение:
 * `git pull --ff-only`, при изменении `package-lock.json` — `npm ci`, затем
 * выход из процесса под перезапуск systemd.
 *
 * О каждом шаге сообщает через колбэк (побочный эффект — рассылка вызывающим
 * слоем). Стадии: `checking`, `uptodate`, `updating`, `updated`, `error`.
 *
 * @param {(info: {stage: string, version?: string, from?: string, to?: string, deps?: boolean, restart?: boolean, message?: string}) => void} onStage - приёмник стадий
 * @returns {Promise<void>} мутирует рабочий каталог и может завершить процесс
 */
async function runUpdate(onStage) {
  if (running) {
    onStage({ stage: 'error', message: 'Обновление уже идёт' });
    return;
  }
  running = true;
  try {
    onStage({ stage: 'checking' });

    const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], GIT_TIMEOUT);
    // Отсоединённый HEAD: обновлять нечего — непонятно, за какой ветвью следить.
    if (branch === 'HEAD') throw new Error('репозиторий не на ветке (detached HEAD)');

    await run('git', ['fetch', '--quiet', 'origin', branch], GIT_TIMEOUT);
    const local = await run('git', ['rev-parse', 'HEAD'], GIT_TIMEOUT);
    const remote = await run('git', ['rev-parse', `origin/${branch}`], GIT_TIMEOUT);

    if (local === remote) {
      onStage({ stage: 'uptodate', version: local.slice(0, 7) });
      return;
    }

    onStage({ stage: 'updating', from: local.slice(0, 7), to: remote.slice(0, 7) });

    // Зависимости добираем только когда изменился package-lock.json: npm ci
    // занимает десятки секунд, а меняется файл редко.
    const changed = await run('git', ['diff', '--name-only', local, remote], GIT_TIMEOUT);
    const needDeps = changed.split('\n').some(f => f.trim() === 'package-lock.json');

    await run('git', ['pull', '--ff-only', 'origin', branch], GIT_TIMEOUT);
    if (needDeps) await run(NPM_CMD, ['ci', '--omit=dev'], NPM_TIMEOUT, process.platform === 'win32');

    const restart = canRestart();
    onStage({ stage: 'updated', version: remote.slice(0, 7), deps: needDeps, restart });
    if (restart) setTimeout(() => process.exit(0), EXIT_DELAY);
  } catch (e) {
    // Наружу отдаём одну строку: полный вывод git в тост не поместится.
    const message = String(e && e.message || 'неизвестная ошибка').split('\n')[0].slice(0, 200);
    onStage({ stage: 'error', message });
  } finally {
    running = false;
  }
}

module.exports = { runUpdate };
