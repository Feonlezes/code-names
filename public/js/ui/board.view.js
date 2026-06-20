'use strict';

/**
 * @module ui/board.view
 * Рендер игрового поля: слова, открытые/известные капитану цвета, голосование
 * агентов (кружки проголосовавших + 2-сек лоадер перед открытием карты, task 1),
 * клики ОЖИДАЮЩЕЙ команды по картам (task 5: тот же клик/звук/пульс, но карта не
 * открывается и видно только своей команде) и подсветка карт капитану при заходе
 * за лидера (пульсирующее свечение в цвет карты). Для капитана уже открытые карты
 * гасятся в серый (task 3), чтобы внимание было на оставшихся.
 */

import { $ } from '../util/dom.js';
import { getState, me } from '../state/store.js';
import { send } from '../net/socket.js';
import { IN } from '../net/messages.js';
import { avatarColor } from '../util/color.js';
import { soundCardClick, soundReveal } from '../audio/sound.js';

// Подписи прошлого кадра — чтобы отличить «голос только что изменился» (играем
// эффект клика по карте у всех в команде) и «карта только что открылась» (звук
// выбора). null до первого рендера, чтобы не звучать/мигать при входе в комнату.
let prevVoteSig = null;   // Map<number,string> — кто голосовал за карту i
let prevRevealed = null;  // Set<number> — какие карты были открыты
let prevMarkSig = null;   // Map<number,string> — кто из ожидающей команды кликнул карту i (task 5)

/**
 * Перерисовывает поле по текущему состоянию.
 * @param {boolean} spotlightSpymaster - игрок только что зашёл за лидера в
 *   активной игре (старт партии или смена роли на паузе) — подсвечиваем
 *   капитану его карты миганием в цвет карточки
 * @returns {void}
 */
export function renderBoard(spotlightSpymaster) {
  const state = getState();
  const board = $('#board');
  board.className = 'board size-' + (state.settings.boardSize);
  // Пометка текущей команды на поле — задаёт цвет лоадера выбора карты (см.
  // .board.turn-red/blue .cell-loader-bar в CSS).
  if (state.currentTeam) board.classList.add('turn-' + state.currentTeam);
  board.innerHTML = '';
  const my = me();
  const canGuess = my && state.phase === 'guess' && my.team === state.currentTeam &&
                   my.role === 'operative' && !state.paused;
  // Клик ожидающей команды (task 5): агент команды, чьего хода сейчас НЕТ, может
  // кликать карты в активной фазе (показать своей команде, что хочет открыть).
  const canMark = my && (state.phase === 'clue' || state.phase === 'guess') &&
                  (my.team === 'red' || my.team === 'blue') && my.team !== state.currentTeam &&
                  my.role === 'operative' && !state.paused;
  // Капитан видит цвета; уже открытые карты для него гасим в серый (task 3),
  // но не в конце игры — там поле остаётся цветным для всех.
  const dimGuessed = my && my.role === 'spymaster' && state.phase !== 'over';
  const votes = state.votes || { cards: {}, skip: [] };
  const pending = state.pendingVote;
  // Клики ожидающей команды — сервер прислал ТОЛЬКО клики моей команды (task 5).
  const marks = state.marks || {};

  if (!state.board.length) {
    board.innerHTML = '<p class="muted board-waiting" style="grid-column:1/-1;align-self:center;text-align:center">Ожидание начала игры…</p>';
    prevVoteSig = null; prevRevealed = null; prevMarkSig = null; // сброс между партиями (лобби)
    return;
  }

  // Текущие подписи голосов/открытых карт и флаг «появилась новая открытая карта».
  const curVoteSig = new Map();
  const curRevealed = new Set();
  let revealedNew = false;
  // Подписи кликов ожидающей команды + флаг «кто-то только что кликнул» (task 5):
  // по нему проигрываем звук клика у ВСЕХ в команде (не только у кликнувшего).
  const curMarkSig = new Map();
  let markAdded = false;

  state.board.forEach((c, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.textContent = c.word;
    const voters = votes.cards[i] || [];
    const sig = voters.join(',');
    curVoteSig.set(i, sig);
    if (c.revealed) {
      cell.classList.add('revealed', 'c-' + c.color);
      if (dimGuessed) cell.classList.add('dim-guessed');
      curRevealed.add(i);
      if (prevRevealed && !prevRevealed.has(i)) revealedNew = true;
    } else if (c.color) {
      cell.classList.add('know-' + c.color); // капитан видит цвета
    }
    // Эффект клика, видимый всей команде: если набор проголосовавших за эту
    // (ещё закрытую) карту изменился с прошлого кадра — кто-то только что
    // кликнул, кратко «пульсируем» картой у всех (см. .vote-pulse в CSS).
    if (!c.revealed && prevVoteSig && (prevVoteSig.get(i) || '') !== sig) {
      cell.classList.add('vote-pulse');
    }
    // При заходе за лидера подсвечиваем капитану его карты (мигание в цвет карты).
    if (spotlightSpymaster && my && my.role === 'spymaster' && !c.revealed && c.color === my.team) {
      cell.classList.add('spotlight');
    }
    if (canGuess && !c.revealed) {
      cell.classList.add('clickable');
      // Клик — это ГОЛОС за карту (повторный клик его снимает). Открытие — только
      // после единогласия команды (логика на сервере, task 1). Звук клика — из файла.
      cell.addEventListener('click', () => { soundCardClick(); send({ type: IN.GUESS, index: i }); });
    } else if (canMark && !c.revealed) {
      // task 5: клик ожидающей команды. Карту НЕ открывает — лишь шлёт серверу
      // отметку, видимую своей команде. Звук НЕ играем здесь: он прозвучит у всех
      // в команде по приходу обновления (детект markAdded ниже), чтобы клик было
      // слышно всем, а не только кликнувшему.
      cell.classList.add('clickable');
      cell.addEventListener('click', () => { send({ type: IN.MARK_CARD, index: i }); });
    }
    // Кружки агентов, проголосовавших за эту карту.
    if (voters.length) {
      const wrap = document.createElement('div');
      wrap.className = 'vote-dots';
      for (const id of voters) {
        const dot = document.createElement('span');
        dot.className = 'vote-dot';
        if (id === state.you) dot.classList.add('mine');
        dot.style.background = avatarColor(id);
        wrap.appendChild(dot);
      }
      cell.appendChild(wrap);
    }
    // Клики ожидающей команды (task 5): те же кружки, что и у голосов, но в
    // другом углу (низ-слева), чтобы не накладываться на голоса соперника
    // (видны всем) в верх-справа. Открытую карту не помечаем.
    const markers = (!c.revealed && marks[i]) ? marks[i] : [];
    const markSig = markers.join(',');
    curMarkSig.set(i, markSig);
    if (markers.length) {
      const mwrap = document.createElement('div');
      mwrap.className = 'mark-dots';
      for (const id of markers) {
        const dot = document.createElement('span');
        dot.className = 'vote-dot';
        if (id === state.you) dot.classList.add('mine');
        dot.style.background = avatarColor(id);
        mwrap.appendChild(dot);
      }
      cell.appendChild(mwrap);
    }
    // Клик кого-то из команды только что изменил набор: пульсируем картой у всех
    // (тот же эффект, что у голосов) и, если кто-то ДОБАВИЛ клик, играем звук у
    // всех в команде. Снятие/сброс (только удаление) звук не издаёт.
    if (!c.revealed && prevMarkSig && (prevMarkSig.get(i) || '') !== markSig) {
      cell.classList.add('vote-pulse');
      const prevIds = (prevMarkSig.get(i) || '').split(',').filter(Boolean);
      if (markers.some(id => !prevIds.includes(id))) markAdded = true;
    }
    // Лоадер единогласия снизу карты, по которой идёт отсчёт (1.5 с, task 1).
    if (pending && pending.kind === 'guess' && pending.index === i) {
      const loader = document.createElement('div');
      loader.className = 'cell-loader';
      loader.innerHTML = '<div class="cell-loader-bar"></div>';
      cell.appendChild(loader);
    }
    board.appendChild(cell);
  });

  // Звук выбора карты: команда открыла новую карту (по единогласию) — звучит у
  // всех. На первом кадре (prevRevealed === null) молчим, чтобы не звучать при
  // входе/переподключении посреди партии с уже открытыми картами.
  if (revealedNew) soundReveal();
  // Звук клика ожидающей команды (task 5): у ВСЕХ в команде, когда кто-то
  // добавил клик. На первом кадре (prevMarkSig === null) молчим.
  if (markAdded) soundCardClick();
  prevVoteSig = curVoteSig;
  prevRevealed = curRevealed;
  prevMarkSig = curMarkSig;
}
