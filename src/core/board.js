'use strict';

/**
 * @module core/board
 * Раскладка цветов карт по правилам Codenames. Чистая логика без I/O.
 * Экспорт: layoutFor.
 */

const { shuffle } = require('./rng');

/**
 * Строит перемешанный массив цветов карт для поля заданного размера.
 * Числа взяты из правил Codenames: стартовая команда получает на одну карту
 * больше, плюс ровно один «убийца», остальное — нейтральные карты.
 *
 * @param {number} size - сторона поля (5 или 6)
 * @param {('red'|'blue')} startingTeam - команда, которая ходит первой
 * @returns {Array<('red'|'blue'|'neutral'|'assassin')>} цвета карт в случайном порядке
 */
function layoutFor(size, startingTeam) {
  const total = size * size;
  let startCount, otherCount, assassins;
  // Поле 6×6 крупнее, поэтому карт у команд больше; убийца всегда один.
  if (size === 6) {
    startCount = 11; otherCount = 10; assassins = 1;
  } else {
    startCount = 9; otherCount = 8; assassins = 1;
  }
  const neutral = total - startCount - otherCount - assassins;
  const colors = [];
  const other = startingTeam === 'red' ? 'blue' : 'red';
  for (let i = 0; i < startCount; i++) colors.push(startingTeam);
  for (let i = 0; i < otherCount; i++) colors.push(other);
  for (let i = 0; i < neutral; i++) colors.push('neutral');
  for (let i = 0; i < assassins; i++) colors.push('assassin');
  return shuffle(colors);
}

module.exports = { layoutFor };
