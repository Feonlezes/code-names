'use strict';

/**
 * @module util/color
 * Чистые помощники для цвета. Вынесены отдельно, чтобы и карточки команд
 * (teams.view), и поле (board.view) рисовали кружок игрока одним и тем же цветом.
 * Экспорт: avatarColor.
 */

/**
 * Возвращает стабильный «случайный» цвет игрока по его id. Детерминированный
 * (один и тот же id → один и тот же цвет), чтобы кружок не мигал при каждом
 * перерендере. Цвет в HSL с фиксированной насыщенностью/светлотой.
 * @param {string} id - идентификатор игрока
 * @returns {string} CSS-цвет вида `hsl(...)`
 */
export function avatarColor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}
