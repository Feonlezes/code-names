'use strict';

/**
 * @module core/rng
 * Чистые генераторы случайности без побочных эффектов и без знания о домене.
 * Экспорт: shuffle, randomInt, randomCode.
 */

/**
 * Перемешивает массив на месте алгоритмом Фишера—Йетса.
 * Мутирует переданный массив и возвращает его же (для удобства цепочек).
 *
 * @param {Array<*>} arr - массив для перемешивания
 * @returns {Array<*>} тот же массив, элементы переставлены случайно
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Возвращает случайное целое в диапазоне [0, maxExclusive).
 *
 * @param {number} maxExclusive - верхняя граница (не включается)
 * @returns {number} случайное целое
 */
function randomInt(maxExclusive) {
  return Math.floor(Math.random() * maxExclusive);
}

/**
 * Генерирует код комнаты из 4 символов. Алфавит без похожих символов
 * (нет 0/O, 1/I), чтобы код было легко продиктовать. Повторяет генерацию,
 * пока isTaken сообщает, что код уже занят.
 *
 * @param {(code: string) => boolean} isTaken - предикат «код уже используется»
 * @returns {string} уникальный код комнаты
 */
function randomCode(isTaken) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[randomInt(chars.length)];
  } while (isTaken(code));
  return code;
}

module.exports = { shuffle, randomInt, randomCode };
