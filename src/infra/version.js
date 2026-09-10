'use strict';

/**
 * @module infra/version
 * Версия запущенного приложения: номер из package.json плюс короткий хеш и
 * ветка git. Реально развёрнутое состояние определяет именно ревизия — её же
 * сравнивает обновление (см. infra/updater). Значения читаются один раз при
 * загрузке модуля и кэшируются, поэтому запросы версии не дёргают процессы.
 * Экспорт: getVersion.
 */

const { execFileSync } = require('child_process');
const path = require('path');

// Корень репозитория: __dirname указывает на src/infra/.
const REPO_DIR = path.join(__dirname, '..', '..');
const GIT_TIMEOUT = 5000;

/**
 * Синхронно спрашивает git. Аргументы заданы в коде, поэтому shell не нужен.
 *
 * @param {string[]} args - аргументы git
 * @returns {?string} вывод без крайних пробелов или null, если git недоступен
 *   (репозитория может не быть — например, развёртывание из архива)
 */
function git(args) {
  try {
    const out = execFileSync('git', args, {
      cwd: REPO_DIR,
      timeout: GIT_TIMEOUT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return String(out).trim() || null;
  } catch (_) {
    return null;
  }
}

const info = (() => {
  let version = null;
  try { version = require('../../package.json').version || null; } catch (_) {}
  return {
    version,
    revision: git(['rev-parse', '--short', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'])
  };
})();

/**
 * @returns {{version: ?string, revision: ?string, branch: ?string}} версия
 *   запущенного приложения (одни и те же значения на весь срок процесса)
 */
function getVersion() {
  return info;
}

module.exports = { getVersion };
