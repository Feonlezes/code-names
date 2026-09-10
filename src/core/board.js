'use strict';

/**
 * @module core/board
 * Сборка игрового поля Codenames: слова, их цвета и порядок карт. Чистая
 * логика без I/O. Экспорт: buildBoard.
 */

const { shuffle, randomInt } = require('./rng');
const { THEME_NAMES, THEME_WORDS } = require('./dictionary');
const { WORD_GROUPS } = require('../config');

/**
 * Считает, сколько карт каждого цвета на поле заданного размера.
 * Числа взяты из правил Codenames: стартовая команда получает на одну карту
 * больше, убийца всегда один, остальное — нейтральные карты. Поле 6×6 крупнее,
 * поэтому карт у команд больше.
 *
 * @param {number} size - сторона поля (5 или 6)
 * @returns {{start: number, other: number, neutral: number, assassins: number}} количества карт по цветам
 */
function colorCounts(size) {
  const total = size * size;
  const start = size === 6 ? 11 : 9;
  const other = size === 6 ? 10 : 8;
  const assassins = 1;
  return { start, other, neutral: total - start - other - assassins, assassins };
}

/**
 * Случайное целое в диапазоне [min, max] включительно.
 *
 * @param {number} min - нижняя граница
 * @param {number} max - верхняя граница
 * @returns {number} случайное целое
 */
function randomBetween(min, max) {
  return min + randomInt(max - min + 1);
}

/**
 * Набирает тематические группы слов для одной команды: берёт свободные темы и
 * выхватывает из каждой по 2-3 слова. Ради этого поле и собирается: капитан
 * должен иметь возможность накрыть несколько своих карт одной подсказкой
 * («еда 2»). Мутирует freeThemes (взятые темы уходят из пула).
 *
 * @param {Array<string>} freeThemes - перемешанный пул ещё не занятых тем
 * @param {number} cardCount - сколько карт у команды на поле
 * @returns {{words: Array<string>, themes: Array<string>}} слова групп и занятые ими темы
 */
function pickGroups(freeThemes, cardCount) {
  const cfg = WORD_GROUPS;
  // Потолок нужен, чтобы группы не съели все карты команды: три группы по три
  // слова — это уже 9 карт, то есть вся команда при поле 5×5.
  const budget = Math.min(cfg.maxGroupedPerTeam, cardCount - 1);
  const groupCount = randomBetween(cfg.minGroups, cfg.maxGroups);
  const words = [];
  const themes = [];
  for (let i = 0; i < groupCount; i++) {
    const left = budget - words.length;
    if (left < cfg.minGroupSize) break;
    const theme = freeThemes.pop();
    if (!theme) break;
    const size = Math.min(randomBetween(cfg.minGroupSize, cfg.maxGroupSize), left);
    words.push(...shuffle(THEME_WORDS[theme].slice()).slice(0, size));
    themes.push(theme);
  }
  return { words, themes };
}

/**
 * Выбирает слова-ловушки для нейтральных карт: слова из тем, уже занятых
 * группами команд. Подсказка «еда 2» становится риском, а не гарантией — в
 * теме на поле может лежать и чужое слово.
 *
 * @param {Array<string>} usedThemes - темы, из которых набраны группы
 * @param {Set<string>} usedWords - уже занятые словами карты (исключаются)
 * @param {number} limit - сколько нейтральных карт вообще есть
 * @returns {Array<string>} слова-ловушки (может быть пустым)
 */
function pickTraps(usedThemes, usedWords, limit) {
  const cfg = WORD_GROUPS;
  const count = Math.min(randomBetween(cfg.minTraps, cfg.maxTraps), limit, usedThemes.length);
  const themes = shuffle(usedThemes.slice()).slice(0, count);
  const traps = [];
  for (const theme of themes) {
    const free = THEME_WORDS[theme].filter(w => !usedWords.has(w));
    if (!free.length) continue;
    const word = free[randomInt(free.length)];
    usedWords.add(word);
    traps.push(word);
  }
  return traps;
}

/**
 * Собирает поле: набирает командам тематические группы, добивает остальные
 * клетки словами из незанятых тем, раскрашивает и перемешивает карты.
 *
 * Порядок важен: слова и цвета выбираются вместе, иначе группа одной темы
 * рассыпалась бы по обеим командам и подсказка на 2-3 слова была бы невозможна.
 *
 * @param {number} size - сторона поля (5 или 6)
 * @param {('red'|'blue')} startingTeam - команда, которая ходит первой
 * @returns {Array<{word: string, color: ('red'|'blue'|'neutral'|'assassin'), revealed: boolean}>} карты в случайном порядке
 */
function buildBoard(size, startingTeam) {
  const counts = colorCounts(size);
  const otherTeam = startingTeam === 'red' ? 'blue' : 'red';
  const usedWords = new Set();

  // Тема достаётся только одной команде: иначе подсказка указывала бы разом на
  // свои и чужие карты. Взятая тема уходит из пула целиком.
  const freeThemes = shuffle(THEME_NAMES.filter(t => THEME_WORDS[t].length >= WORD_GROUPS.minGroupSize));
  const usedThemes = [];
  const teamWords = {};
  for (const [team, cardCount] of [[startingTeam, counts.start], [otherTeam, counts.other]]) {
    const picked = pickGroups(freeThemes, cardCount);
    picked.words.forEach(w => usedWords.add(w));
    usedThemes.push(...picked.themes);
    teamWords[team] = picked.words;
  }

  const traps = pickTraps(usedThemes, usedWords, counts.neutral);

  // Заполнитель берётся только из незанятых тем: случайное «свободное» слово из
  // темы группы попало бы к чужим и испортило подсказку. Роль такого слова
  // отдана ловушкам выше — их количество игра контролирует сама.
  const filler = shuffle(freeThemes.reduce((acc, t) => acc.concat(THEME_WORDS[t]), [])
    .filter(w => !usedWords.has(w)));

  /**
   * Достаёт следующее свободное слово; заглушка на случай пустого словаря.
   *
   * @returns {string} слово для карты
   */
  const nextWord = () => filler.pop() || 'СЛОВО ' + (usedWords.size + 1);

  const cards = [];
  /**
   * Добавляет карты одного цвета: сперва заранее выбранные слова, затем добор.
   *
   * @param {('red'|'blue'|'neutral'|'assassin')} color - цвет карт
   * @param {number} count - сколько карт этого цвета на поле
   * @param {Array<string>} preset - слова, которые обязаны получить этот цвет
   * @returns {void}
   */
  const addCards = (color, count, preset) => {
    for (let i = 0; i < count; i++) {
      const word = i < preset.length ? preset[i] : nextWord();
      cards.push({ word, color, revealed: false });
    }
  };

  addCards(startingTeam, counts.start, teamWords[startingTeam]);
  addCards(otherTeam, counts.other, teamWords[otherTeam]);
  addCards('neutral', counts.neutral, traps);
  addCards('assassin', counts.assassins, []);

  return shuffle(cards);
}

module.exports = { buildBoard };
