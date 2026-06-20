'use strict';

/**
 * @module ui/teams.view
 * Рендер карточек команд: списки игроков (капитан/агенты), счёт, кнопки выбора
 * стороны, а также подвал карточки — ввод подсказки капитаном (task 7), история
 * подсказок команды (task 4) и кнопка «Пропустить ход» (task 1: голосование с
 * кружками агентов и 2-сек лоадером единогласия). Карточка команды, чей сейчас
 * ход, получает неоновую подсветку (task 4). Выбор стороны/роли доступен в лобби
 * и на паузе (task 2).
 */

import { $, $$, escapeHtml } from '../util/dom.js';
import { getState, me } from '../state/store.js';
import { send } from '../net/socket.js';
import { IN } from '../net/messages.js';
import { avatarColor } from '../util/color.js';

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
  // Чья сейчас очередь ходить — для неоновой подсветки карточки (task 4).
  const activeTeam = (state.phase === 'clue' || state.phase === 'guess') && !state.paused
    ? state.currentTeam : null;
  for (const team of ['red', 'blue']) {
    // Неоновая подсветка карточки активной команды (task 4).
    $('#team-' + team).classList.toggle('active-turn', activeTeam === team);

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

    // Капитан текущей команды в фазе clue (вне паузы) вправе дать подсказку —
    // от этого зависит и видимость блока истории (поле ввода живёт внутри него).
    const canGiveClue = my && my.team === team && my.role === 'spymaster' &&
                        state.phase === 'clue' && state.currentTeam === team && !state.paused;
    renderClueHistory(state, team, canGiveClue);
    renderClueInput(state, my, team, canGiveClue);
    renderSkip(state, my, team);
  }
}

/**
 * Рисует историю подсказок команды (слово + число) в блоке у низа её карточки.
 * Поле ввода подсказки живёт внутри этого же блока (под списком слов), поэтому
 * блок виден, если есть хотя бы одна подсказка ИЛИ капитану сейчас нужно её
 * вводить (`showInput`) — иначе на самой первой подсказке поле было бы скрыто.
 * @param {Object} state - снимок состояния
 * @param {('red'|'blue')} team
 * @param {boolean} showInput - капитан текущей команды вправе дать подсказку
 * @returns {void}
 */
function renderClueHistory(state, team, showInput) {
  const wrap = $('#' + team + '-clue-history-wrap');
  const ul = $('#' + team + '-clue-history');
  const hist = (state.clueHistory && state.clueHistory[team]) || [];
  wrap.classList.toggle('hidden', !hist.length && !showInput);
  // Без числа-ориентира (капитан ввёл только слово) показываем «?».
  ul.innerHTML = hist.map(c =>
    `<li><span class="ch-word">${escapeHtml(c.word)}</span>` +
    `<span class="ch-num">${c.number == null ? '?' : c.number}</span></li>`
  ).join('');
}

/**
 * Показывает поле ввода подсказки (внутри блока истории, под списком слов) только
 * капитану текущей команды в фазе clue (вне паузы). Поле статично в DOM — значение
 * не затирается при перерисовке.
 * @param {Object} state - снимок состояния
 * @param {Object|undefined} my - запись текущего игрока
 * @param {('red'|'blue')} team
 * @param {boolean} canGiveClue - капитан текущей команды вправе дать подсказку
 * @returns {void}
 */
function renderClueInput(state, my, team, canGiveClue) {
  const wrap = $('#' + team + '-clue-input-wrap');
  const wasHidden = wrap.classList.contains('hidden');
  wrap.classList.toggle('hidden', !canGiveClue);
  if (canGiveClue && wasHidden) {
    $('#' + team + '-clue-error').textContent = '';
    $('#' + team + '-clue-input').focus();
  }
}

/**
 * Управляет кнопкой «Пропустить ход» как голосованием (task 1). Кнопка видна
 * агентам текущей команды в фазе угадывания (вне паузы); под ней — кружки
 * проголосовавших за пропуск и 2-сек лоадер, когда за пропуск проголосовали все.
 * Клик отправляет голос (повторный — снимает), а сам переход хода делает сервер
 * по единогласию. Состояние лоадера приходит из state.pendingVote, поэтому
 * посекундный тик его не сбрасывает.
 * @param {Object} state - снимок состояния
 * @param {Object|undefined} my - запись текущего игрока
 * @param {('red'|'blue')} team
 * @returns {void}
 */
function renderSkip(state, my, team) {
  const isCurrentGuess = state.phase === 'guess' && state.currentTeam === team && !state.paused;
  const btn = $('#' + team + '-skip-btn');
  const dots = $('#' + team + '-skip-dots');
  const loader = $('#' + team + '-skip-loader');

  // Кнопка — только агентам текущей команды (капитан не голосует).
  const showSkip = isCurrentGuess && my && my.team === team && my.role === 'operative';
  btn.classList.toggle('hidden', !showSkip);

  // Кружки проголосовавших за пропуск (видны всем, пока идёт ход команды).
  const skipVoters = isCurrentGuess ? ((state.votes && state.votes.skip) || []) : [];
  dots.innerHTML = skipVoters.map(id =>
    `<span class="vote-dot${id === state.you ? ' mine' : ''}" style="background:${avatarColor(id)}"></span>`
  ).join('');
  // Подсветим саму кнопку, если я уже отдал голос за пропуск.
  btn.classList.toggle('voted', !!my && skipVoters.includes(my.id));

  // 2-сек лоадер при единогласии за пропуск. Появление (display:none→block)
  // перезапускает CSS-анимацию; при этом прокручиваем кнопку в зону видимости.
  const pendingSkip = isCurrentGuess && state.pendingVote && state.pendingVote.kind === 'skip';
  loader.classList.toggle('hidden', !pendingSkip);
  if (pendingSkip && loader.dataset.shown !== '1') {
    btn.scrollIntoView({ block: 'nearest' });
  }
  loader.dataset.shown = pendingSkip ? '1' : '';
}

/**
 * Разбирает строку ввода подсказки в «слово + (необязательно) цифру». Правила:
 * ровно одно слово; необязательная одна цифра 0–9 через пробел; два слова
 * запрещены. Если цифры нет — number остаётся null (в истории отрисуется «?»).
 * @param {string} raw - сырой текст из поля ввода
 * @returns {{word:string, number:(number|null)}|{error:string}}
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
  if (words.length > 1) return { error: 'Можно ввести только одно слово' };
  if (number !== null && (number.length > 1 || +number < 0 || +number > 9)) {
    return { error: 'Цифра должна быть от 0 до 9' };
  }
  // Слово без цифры — допустимо: число остаётся null и покажется как «?».
  return { word: words[0], number: number === null ? null : +number };
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
  // Клик по «Пропустить ход» — это голос (повторный снимает). Команду сервер
  // берёт из игрока, поэтому тело сообщения пустое (task 1).
  $$('.skip-btn').forEach(btn => {
    btn.addEventListener('click', () => send({ type: IN.END_TURN }));
  });
}
