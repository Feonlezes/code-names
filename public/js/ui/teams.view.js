'use strict';

/**
 * @module ui/teams.view
 * Рендер карточек команд: списки игроков (капитан/агенты), счёт, кнопки выбора
 * стороны, а также подвал карточки — ввод подсказки капитаном (task 7), история
 * подсказок команды (task 4) и кнопка «Пропустить ход» с 3-секундным лоадером
 * (task 5). Выбор стороны/роли доступен в лобби и на паузе (task 2).
 */

import { $, $$, escapeHtml } from '../util/dom.js';
import { getState, me } from '../state/store.js';
import { send } from '../net/socket.js';
import { IN } from '../net/messages.js';

// Длительность лоадера кнопки пропуска хода, мс (task 5: «полоса в 3 секунды»).
const SKIP_DELAY_MS = 3000;

// Команда, у которой сейчас «крутится» лоадер пропуска хода (или null). Состояние
// лоадера живёт между рендерами: посекундный тик не должен его сбрасывать.
let pendingSkipTeam = null;
let skipTimer = null;

/**
 * Возвращает стабильный «случайный» цвет для игрока по его id. Детерминированный
 * (один и тот же id → один и тот же цвет), чтобы кружок не мигал при каждом
 * перерендере. Цвет в HSL с фиксированной насыщенностью/светлотой.
 * @param {string} id - идентификатор игрока
 * @returns {string} CSS-цвет вида `hsl(...)`
 */
function avatarColor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

// Сколько имён наблюдателей показываем в шапке до сворачивания в «+N».
const OBSERVERS_SHOWN = 6;

/**
 * Рисует карточку «Наблюдатели:» в шапке — игроки без команды (team === null),
 * перечисленные через запятую. Показываем максимум OBSERVERS_SHOWN имён, остальные
 * сворачиваем в «+N». Если наблюдателей нет — карточка скрыта.
 * @param {Object} state - снимок состояния
 * @returns {void}
 */
function renderObservers(state) {
  const observers = state.players.filter(p => p.team !== 'red' && p.team !== 'blue');
  const wrap = $('#observers');
  const list = $('#observers-list');
  if (!observers.length) { wrap.classList.add('hidden'); list.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  const names = observers.slice(0, OBSERVERS_SHOWN).map(p => escapeHtml(p.nickname)).join(', ');
  const hidden = observers.length - OBSERVERS_SHOWN;
  list.innerHTML = names + (hidden > 0 ? ` <span class="obs-more">+${hidden}</span>` : '');
}

/**
 * Перерисовывает обе команды, счёт, наблюдателей, кнопки выбора стороны и подвал
 * карточек (ввод подсказки/история/пропуск хода).
 * @returns {void}
 */
export function renderTeams() {
  const state = getState();
  const my = me();
  const lists = { 'red-spymasters': [], 'red-operatives': [], 'blue-spymasters': [], 'blue-operatives': [] };
  for (const p of state.players) {
    const key = `${p.team}-${p.role === 'spymaster' ? 'spymasters' : 'operatives'}`;
    if (lists[key]) lists[key].push(p);
  }
  for (const [id, arr] of Object.entries(lists)) {
    const ul = $('#' + id);
    ul.innerHTML = '';
    for (const p of arr) {
      const li = document.createElement('li');
      if (p.id === state.you) li.classList.add('you');
      if (!p.connected) li.classList.add('offline');
      const host = p.id === state.hostId ? ' 👑' : '';
      const dot = `<span class="player-dot" style="background:${avatarColor(p.id)}"></span>`;
      const youTag = p.id === state.you ? '<span class="you-tag">это вы</span>' : '';
      li.innerHTML = `<span class="player-name">${dot}${escapeHtml(p.nickname)}${host}</span>${youTag}`;
      ul.appendChild(li);
    }
  }
  renderObservers(state);

  const inLobby = state.phase === 'lobby';
  // Выбирать команду/роль можно в лобби и на паузе (task 2).
  const canPick = inLobby || state.paused;
  for (const team of ['red', 'blue']) {
    // Счёт оставшихся карт показываем только в игре (вне лобби).
    const scoreEl = $('#score-' + team);
    scoreEl.classList.toggle('hidden', inLobby);
    if (!inLobby) scoreEl.textContent = state.remaining[team];

    // «Стать капитаном» — пока в команде нет капитана (правило одного капитана,
    // task 1) и пока разрешён выбор стороны. «Войти в команду» — при разрешённом
    // выборе. Если капитан уже есть (в т. ч. ты сам), ссылка-капитан скрыта.
    const teamHasSpymaster = lists[team + '-spymasters'].length > 0;
    $('#' + team + '-join-spymaster').classList.toggle('hidden', !canPick || teamHasSpymaster);
    $('#' + team + '-join-operative').classList.toggle('hidden', !canPick);

    renderClueHistory(state, team);
    renderClueInput(state, my, team);
    renderSkip(state, my, team);
  }
}

/**
 * Рисует историю подсказок команды (слово + число) в подвале её карточки.
 * Скрывает блок, если подсказок ещё не было.
 * @param {Object} state - снимок состояния
 * @param {('red'|'blue')} team
 * @returns {void}
 */
function renderClueHistory(state, team) {
  const wrap = $('#' + team + '-clue-history-wrap');
  const ul = $('#' + team + '-clue-history');
  const hist = (state.clueHistory && state.clueHistory[team]) || [];
  if (!hist.length) { wrap.classList.add('hidden'); ul.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  ul.innerHTML = hist.map(c =>
    `<li><span class="ch-word">${escapeHtml(c.word)}</span>` +
    `<span class="ch-num">${c.number === 0 ? '∞' : c.number}</span></li>`
  ).join('');
}

/**
 * Показывает поле ввода подсказки только капитану текущей команды в фазе clue
 * (вне паузы). Поле статично в DOM — значение не затирается при перерисовке.
 * @param {Object} state - снимок состояния
 * @param {Object|undefined} my - запись текущего игрока
 * @param {('red'|'blue')} team
 * @returns {void}
 */
function renderClueInput(state, my, team) {
  const wrap = $('#' + team + '-clue-input-wrap');
  const canGiveClue = my && my.team === team && my.role === 'spymaster' &&
                      state.phase === 'clue' && state.currentTeam === team && !state.paused;
  const wasHidden = wrap.classList.contains('hidden');
  wrap.classList.toggle('hidden', !canGiveClue);
  if (canGiveClue && wasHidden) {
    $('#' + team + '-clue-error').textContent = '';
    $('#' + team + '-clue-input').focus();
  }
}

/**
 * Управляет кнопкой «Пропустить ход» и её лоадером. Кнопка видна членам текущей
 * команды в фазе угадывания (вне паузы). Если лоадер для команды уже запущен —
 * не трогаем его (анимация идёт независимо от посекундных рендеров); если ход
 * команды закончился, лоадер отменяем.
 * @param {Object} state - снимок состояния
 * @param {Object|undefined} my - запись текущего игрока
 * @param {('red'|'blue')} team
 * @returns {void}
 */
function renderSkip(state, my, team) {
  const isCurrentGuess = state.phase === 'guess' && state.currentTeam === team && !state.paused;
  // Ход команды закончился, а лоадер ещё «крутится» — отменяем.
  if (pendingSkipTeam === team && !isCurrentGuess) cancelSkip();

  const btn = $('#' + team + '-skip-btn');
  const loader = $('#' + team + '-skip-loader');
  if (pendingSkipTeam === team) {
    // Лоадер в процессе: кнопка скрыта, полосу не трогаем.
    btn.classList.add('hidden');
    return;
  }
  const showSkip = isCurrentGuess && my && my.team === team;
  btn.classList.toggle('hidden', !showSkip);
  loader.classList.add('hidden');
}

/**
 * Разбирает строку ввода подсказки в «слово + (необязательно) цифру». Правила
 * (task 4): ровно одно слово; необязательная одна цифра 0–9 через пробел; два
 * слова запрещены.
 * @param {string} raw - сырой текст из поля ввода
 * @returns {{word:string, number:number}|{error:string}}
 */
function parseClue(raw) {
  const parts = String(raw || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { error: 'Введите подсказку' };
  let number = null;
  let words = parts;
  // Последний токен из цифр — это число-ориентир.
  if (/^\d+$/.test(parts[parts.length - 1])) {
    number = parts[parts.length - 1];
    words = parts.slice(0, -1);
  }
  if (words.length === 0) return { error: 'Введите слово, а не только цифру' };
  if (words.length > 1) return { error: 'Нельзя вводить два слова — только одно слово и цифру' };
  if (number !== null && (number.length > 1 || +number < 0 || +number > 9)) {
    return { error: 'Цифра должна быть от 0 до 9' };
  }
  return { word: words[0], number: number === null ? 0 : +number };
}

/**
 * Считывает поле ввода подсказки команды, валидирует и отправляет на сервер.
 * Ошибку показывает под полем; при успехе очищает поле.
 * @param {('red'|'blue')} team
 * @returns {void}
 */
function submitClue(team) {
  const input = $('#' + team + '-clue-input');
  const errEl = $('#' + team + '-clue-error');
  const res = parseClue(input.value);
  if (res.error) { errEl.textContent = res.error; return; }
  errEl.textContent = '';
  send({ type: IN.GIVE_CLUE, word: res.word, number: res.number });
  input.value = '';
}

/**
 * Запускает 3-секундный лоадер на кнопке пропуска и по его завершении передаёт
 * ход (endTurn). Повторный клик во время лоадера игнорируется.
 * @param {('red'|'blue')} team
 * @returns {void}
 */
function startSkip(team) {
  if (pendingSkipTeam) return;
  pendingSkipTeam = team;
  $('#' + team + '-skip-btn').classList.add('hidden');
  const loader = $('#' + team + '-skip-loader');
  const bar = $('#' + team + '-skip-loader-bar');
  loader.classList.remove('hidden');
  // Перезапуск CSS-перехода: ширина 0 → 100% за SKIP_DELAY_MS.
  bar.style.transition = 'none';
  bar.style.width = '0%';
  void bar.offsetWidth; // форсируем reflow, чтобы переход проиграл с нуля
  bar.style.transition = `width ${SKIP_DELAY_MS}ms linear`;
  bar.style.width = '100%';
  skipTimer = setTimeout(() => {
    skipTimer = null;
    pendingSkipTeam = null;
    loader.classList.add('hidden');
    send({ type: IN.END_TURN });
  }, SKIP_DELAY_MS);
}

/**
 * Отменяет запущенный лоадер пропуска хода и возвращает кнопку/полосу в исходное
 * состояние (например, ход команды закончился раньше по другой причине).
 * @returns {void}
 */
function cancelSkip() {
  if (skipTimer) { clearTimeout(skipTimer); skipTimer = null; }
  const team = pendingSkipTeam;
  pendingSkipTeam = null;
  if (team) {
    const loader = $('#' + team + '-skip-loader');
    const bar = $('#' + team + '-skip-loader-bar');
    loader.classList.add('hidden');
    bar.style.transition = 'none';
    bar.style.width = '0%';
  }
}

/**
 * Навешивает обработчики на интерактивные элементы подвалов команд (ввод
 * подсказки и кнопки пропуска). DOM этих элементов статичен, поэтому привязка
 * выполняется один раз при старте.
 * @returns {void}
 */
export function bindTeamActions() {
  for (const team of ['red', 'blue']) {
    $('#' + team + '-clue-add').addEventListener('click', () => submitClue(team));
    $('#' + team + '-clue-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitClue(team);
    });
  }
  $$('.skip-btn').forEach(btn => {
    btn.addEventListener('click', () => startSkip(btn.dataset.team));
  });
}
