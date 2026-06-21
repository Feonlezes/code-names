'use strict';

/**
 * @module ui/teams.view
 * Рендер карточек команд: списки игроков (капитан/агенты), счёт, кнопки выбора
 * стороны, а также подвал карточки — ввод подсказки капитаном (task 7), история
 * подсказок команды (task 4) и кнопка «Пропустить ход» (task 1: голосование с
 * кружками агентов и 2-сек лоадером единогласия). Карточка команды, чей сейчас
 * ход, получает неоновую подсветку (task 4). Выбор стороны/роли доступен в лобби
 * и на паузе (task 2). Лидеру комнаты и /admin при наведении на строку игрока
 * показывается плавающее меню модерации (task 1): «Сделать админом» (передать
 * корону) и «Переместить в наблюдатели».
 */

import { $, $$, escapeHtml } from '../util/dom.js';
import { getState, me } from '../state/store.js';
import { send } from '../net/socket.js';
import { IN } from '../net/messages.js';
import { avatarColor } from '../util/color.js';
import { IS_ADMIN } from '../util/admin.js';

// Сколько имён наблюдателей показываем в шапке до сворачивания в «+N».
const OBSERVERS_SHOWN = 6;

// Индекс подсказки, которую капитан сейчас редактирует инлайн, по командам (null —
// не редактируем). Пока идёт правка, список истории НЕ перестраиваем при рендере,
// чтобы не потерять поле ввода (task 1: редактирование подсказок во время игры).
const editingClue = { red: null, blue: null };

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
      // id игрока на строке — по нему меню модерации (task 1) знает, кого двигать.
      li.dataset.pid = p.id;
      if (p.id === state.you) li.classList.add('you');
      if (!p.connected) li.classList.add('offline');
      const host = p.id === state.hostId ? ' 👑' : '';
      const dot = `<span class="player-dot" style="background:${avatarColor(p.id)}"></span>`;
      const youTag = p.id === state.you ? '<span class="you-tag">это вы</span>' : '';
      const nick = escapeHtml(p.nickname);
      // Ник в отдельном .nick-text: переносится максимум в 2 строки, дальше —
      // многоточием (CSS line-clamp), а полный ник доступен в тултипе (title).
      // Корона хоста — отдельным несжимаемым элементом, чтобы её не срезало.
      li.innerHTML = `<span class="player-name">${dot}` +
        `<span class="nick-text" title="${nick}">${nick}</span>` +
        `${host ? `<span class="host-crown">${host}</span>` : ''}</span>${youTag}`;
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
    renderClueHistory(state, my, team, canGiveClue);
    renderClueInput(state, my, team, canGiveClue);
    renderSkip(state, my, team);
  }
}

/**
 * Рисует историю подсказок команды (слово + число) в блоке у низа её карточки.
 * Поле ввода подсказки живёт внутри этого же блока (под списком слов), поэтому
 * блок виден, если есть хотя бы одна подсказка ИЛИ капитану сейчас нужно её
 * вводить (`showInput`) — иначе на самой первой подсказке поле было бы скрыто.
 * Капитану СВОЕЙ команды во время игры к каждой подсказке добавляется кнопка-
 * карандаш для инлайн-редактирования (task 1). Пока правка открыта
 * (`editingClue[team]`), список НЕ перестраиваем, чтобы не потерять поле ввода.
 * @param {Object} state - снимок состояния
 * @param {Object|undefined} my - запись текущего игрока
 * @param {('red'|'blue')} team
 * @param {boolean} showInput - капитан текущей команды вправе дать подсказку
 * @returns {void}
 */
function renderClueHistory(state, my, team, showInput) {
  const wrap = $('#' + team + '-clue-history-wrap');
  const ul = $('#' + team + '-clue-history');
  const hist = (state.clueHistory && state.clueHistory[team]) || [];
  wrap.classList.toggle('hidden', !hist.length && !showInput);
  // Идёт инлайн-правка подсказки этой команды — не трогаем DOM списка, иначе
  // перестройка innerHTML затёрла бы открытое поле ввода (task 1).
  if (editingClue[team] !== null) return;
  // Карандаш редактирования — только капитану СВОЕЙ команды и только во время
  // партии (клуэ/гесс). Чужие подсказки и не-капитаны его не видят.
  const canEdit = !!my && my.role === 'spymaster' && my.team === team &&
                  (state.phase === 'clue' || state.phase === 'guess');
  // Без числа-ориентира (капитан ввёл только слово) показываем «?».
  ul.innerHTML = hist.map((c, i) =>
    `<li><span class="ch-word">${escapeHtml(c.word)}</span>` +
    `<span class="ch-num">${c.number == null ? '?' : c.number}</span>` +
    (canEdit ? `<button class="clue-edit" data-team="${team}" data-index="${i}" title="Редактировать подсказку">✎</button>` : '') +
    `</li>`
  ).join('');
}

/**
 * Открывает инлайн-редактор подсказки: заменяет её строку в истории на поле ввода
 * «слово + цифра» с кнопками сохранить/отмена. Пока редактор открыт, рендер не
 * перестраивает список (см. editingClue). Enter — сохранить, Esc — отмена (task 1).
 * @param {('red'|'blue')} team
 * @param {number} index - позиция подсказки в истории команды
 * @returns {void}
 */
function startEditClue(team, index) {
  const state = getState();
  const hist = (state.clueHistory && state.clueHistory[team]) || [];
  const c = hist[index];
  if (!c) return;
  const ul = $('#' + team + '-clue-history');
  const li = ul.children[index];
  if (!li) return;
  editingClue[team] = index;
  const val = c.number == null ? c.word : `${c.word} ${c.number}`;
  li.classList.add('editing');
  li.innerHTML =
    `<input class="input clue-input clue-edit-input" type="text" maxlength="40" value="${escapeHtml(val)}" aria-label="Редактирование подсказки">` +
    `<button class="clue-edit-save" title="Сохранить">✓</button>` +
    `<button class="clue-edit-cancel" title="Отмена">✕</button>`;
  const input = li.querySelector('.clue-edit-input');
  input.focus();
  input.select();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEditClue(team); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEditClue(team); }
  });
  li.querySelector('.clue-edit-save').addEventListener('click', () => saveEditClue(team));
  li.querySelector('.clue-edit-cancel').addEventListener('click', () => cancelEditClue(team));
}

/**
 * Валидирует и отправляет отредактированную подсказку (тот же parseClue, что и при
 * вводе). При ошибке оставляет редактор открытым и подсвечивает поле. При успехе
 * закрывает редактор; новый текст придёт обратным состоянием от сервера (task 1).
 * @param {('red'|'blue')} team
 * @returns {void}
 */
function saveEditClue(team) {
  const index = editingClue[team];
  if (index === null) return;
  const ul = $('#' + team + '-clue-history');
  const li = ul.children[index];
  const input = li && li.querySelector('.clue-edit-input');
  if (!input) { editingClue[team] = null; renderTeams(); return; }
  const res = parseClue(input.value);
  if (res.error) { input.classList.add('invalid'); return; } // оставляем поле открытым
  send({ type: IN.EDIT_CLUE, index, word: res.word, number: res.number });
  editingClue[team] = null;
  renderTeams(); // вернуть строку в обычный вид сразу (сервер пришлёт финальный текст)
}

/**
 * Закрывает редактор подсказки без сохранения и восстанавливает обычный вид строки.
 * @param {('red'|'blue')} team
 * @returns {void}
 */
function cancelEditClue(team) {
  editingClue[team] = null;
  renderTeams();
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
  // Делегирование клика по карандашу редактирования подсказки: сами кнопки
  // пересоздаются на каждом рендере, поэтому слушатель вешаем один раз на список.
  for (const team of ['red', 'blue']) {
    $('#' + team + '-clue-history').addEventListener('click', (e) => {
      const btn = e.target.closest('.clue-edit');
      if (btn) startEditClue(btn.dataset.team, +btn.dataset.index);
    });
  }
  bindPlayerMenu();
}

// ---------- Меню модерации при наведении на игрока (task 1) ----------

// Таймер скрытия меню: даёт время увести курсор со строки в само меню, не теряя
// его (между строкой и меню возможен крошечный зазор).
let menuHideTimer = null;

/**
 * Вправе ли текущий зритель модерировать игроков: лидер комнаты или /admin.
 * Сервер проверяет это же право повторно (messageRouter.canModerate).
 * @returns {boolean}
 */
function canModerateNow() {
  const state = getState();
  if (!state) return false;
  const my = me();
  return IS_ADMIN || !!(my && my.id === state.hostId);
}

/**
 * Показывает плавающее меню модерации сбоку от строки игрока: для красной команды
 * (левая карточка) — справа от строки, для синей (правая карточка) — слева, чтобы
 * меню не уходило за край экрана. Кнопка «Сделать админом» скрывается, если игрок
 * уже лидер. Меню — fixed-элемент в body, поэтому не обрезается overflow карточки.
 * @param {HTMLElement} li - строка игрока (с data-pid)
 * @returns {void}
 */
function showPlayerMenu(li) {
  const menu = $('#player-menu');
  const pid = li.dataset.pid;
  if (!pid) return;
  clearTimeout(menuHideTimer);
  menu.dataset.pid = pid;
  // «Сделать админом» прячем для текущего лидера (передавать ему нечего).
  const state = getState();
  menu.querySelector('.pm-host').classList.toggle('hidden', state && pid === state.hostId);

  const blue = !!li.closest('.team-blue');
  const rect = li.getBoundingClientRect();
  menu.classList.remove('hidden');           // показать до замеров (нужна ширина)
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  // По горизонтали — сбоку от строки (синие — слева, красные — справа).
  let left = blue ? rect.left - mw - 6 : rect.right + 6;
  left = Math.max(6, Math.min(left, window.innerWidth - mw - 6));
  // По вертикали — у верха строки, но не вылезая за нижний край экрана.
  let top = Math.min(rect.top, window.innerHeight - mh - 6);
  top = Math.max(6, top);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

/** Скрывает меню модерации. @returns {void} */
function hidePlayerMenu() {
  $('#player-menu').classList.add('hidden');
}

/**
 * Одноразовая привязка меню модерации: наведение на строку игрока открывает меню,
 * уход — закрывает (с задержкой, чтобы успеть зайти в меню). Кнопки шлют действия
 * по data-pid меню. Делегирование на карточках команд (строки пересоздаются при
 * каждом рендере, а карточки и само меню — статичны).
 * @returns {void}
 */
function bindPlayerMenu() {
  const menu = $('#player-menu');
  for (const team of ['red', 'blue']) {
    const block = $('#team-' + team);
    block.addEventListener('mouseover', (e) => {
      const li = e.target.closest('li[data-pid]');
      if (li && canModerateNow()) showPlayerMenu(li);
    });
    block.addEventListener('mouseout', (e) => {
      // Не прячем, если курсор уходит в само меню.
      if (menu.contains(e.relatedTarget)) return;
      menuHideTimer = setTimeout(hidePlayerMenu, 180);
    });
  }
  menu.addEventListener('mouseenter', () => clearTimeout(menuHideTimer));
  menu.addEventListener('mouseleave', hidePlayerMenu);
  menu.querySelector('.pm-host').addEventListener('click', () => {
    if (menu.dataset.pid) send({ type: IN.SET_HOST, playerId: menu.dataset.pid });
    hidePlayerMenu();
  });
  menu.querySelector('.pm-observer').addEventListener('click', () => {
    if (menu.dataset.pid) send({ type: IN.MOVE_OBSERVER, playerId: menu.dataset.pid });
    hidePlayerMenu();
  });
}
