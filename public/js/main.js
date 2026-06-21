'use strict';

/**
 * @module main
 * Точка входа клиента: связывает сеть, состояние и view-модули. Содержит
 * оркестратор render(), привязку DOM-событий и сценарии входа/выхода.
 * Клиент только отправляет намерения и отрисовывает состояние сервера (§2.1).
 */

import { $, $$ } from './util/dom.js';
import { IS_ADMIN } from './util/admin.js';
import { DEFAULTS, WORDS } from './config.js';
import { LS } from './storage/localStore.js';
import { IN, OUT } from './net/messages.js';
import { connect, send, setMessageHandler, isOpen, closeSocket } from './net/socket.js';
import { getState, setState, resetSig, sigChanged, me } from './state/store.js';
import { ensureAudio, handleSound, soundClue } from './audio/sound.js';
import { show } from './ui/screens.js';
import { showToast } from './ui/toast.js';
import { renderTeams, bindTeamActions } from './ui/teams.view.js';
import { renderBoard } from './ui/board.view.js';
import { renderStatus } from './ui/status.view.js';
import { renderControls } from './ui/controls.view.js';
import { renderSettings, readSettingsForm } from './ui/settings.view.js';
import { renderLog } from './ui/log.view.js';
import { renderWin, copyFeedback, openNickModal } from './ui/modals.js';

const playerId = LS.id;
let pendingRoom = '';       // комната из ссылки-приглашения
let manualJoin = false;     // была ли последняя попытка входа явной (см. joinRoom)
// Отслеживание переходов между состояниями (для тостов/подсветки).
let prevHostId = undefined;
// Был ли игрок капитаном в активной игре на прошлом кадре — чтобы подсветить
// карты ровно в момент «захода за лидера» (старт партии или смена роли на паузе),
// а не на каждом структурном перерендере.
let prevSpyInGame = false;
// Кол-во подсказок в истории на прошлом кадре — рост означает, что лидер отправил
// слово (см. render → soundClue). undefined на первом кадре, чтобы тихо
// синхронизироваться при переподключении посреди партии без ложного звука.
let prevClueCount = undefined;

// ---------- Обработка входящих сообщений ----------
/**
 * Разбирает сообщение сервера: ошибка, подтверждение входа или состояние.
 * @param {Object} msg
 * @returns {void}
 */
function handleMessage(msg) {
  if (msg.type === OUT.ERROR) { handleRoomError(msg.message); return; }
  if (msg.type === OUT.JOINED) {
    manualJoin = false;       // успешный вход — последующие сбои уже «тихие»
    LS.room = msg.code;
    // Сразу отражаем комнату в адресной строке — ссылку можно скопировать/
    // отправить из URL без открытия меню (в т. ч. сразу после создания комнаты).
    try { history.replaceState({}, '', '?room=' + msg.code); } catch (_) {}
    resetSig();
    show('screen-room');
    return;
  }
  if (msg.type === OUT.STATE) { setState(msg); render(); }
}

/**
 * Обрабатывает ошибку входа в комнату (типичный случай — сервер перезапустили,
 * и сохранённой комнаты больше нет). Сбрасывает устаревший код комнаты, чтобы
 * socket.onclose перестал бесконечно переподключаться, закрывает сокет, чистит
 * URL и возвращает игрока на главный экран (или на вход). Текст ошибки показываем
 * только если вход был явной попыткой пользователя (`manualJoin`): при тихом
 * восстановлении сессии (`LS.room`) ошибку не показываем — иначе на старте
 * приложения пользователь видит «Комната не найдена», ничего не вводив.
 * Без этого клиент завис бы на пустом экране несуществующей комнаты — без ника
 * и кода, потому что STATE с сервера так и не пришёл.
 * @param {string} [message] - текст ошибки от сервера
 * @returns {void}
 */
function handleRoomError(message) {
  const wasManual = manualJoin;
  manualJoin = false;
  LS.room = '';                 // прекращаем авто-переподключение к мёртвой комнате
  closeSocket();
  setState(null); resetSig();
  cleanUrl();
  $('#home-error').textContent = wasManual ? (message || 'Комната недоступна') : '';
  if (LS.nick) { $('#home-nick').textContent = LS.nick; show('screen-home'); }
  else { show('screen-login'); $('#login-nick').focus(); }
}

// ---------- Действия входа ----------
/** Создаёт комнату с дефолтными настройками. @returns {void} */
function createRoom() {
  connect(() => send({ type: IN.CREATE_ROOM, playerId, nickname: LS.nick, settings: DEFAULTS, admin: IS_ADMIN }));
}
/**
 * Входит в комнату по коду.
 * @param {string} code - код комнаты
 * @param {boolean} [manual=false] - попытка инициирована пользователем (ввод кода
 *   или переход по ссылке-приглашению). Только для таких попыток показываем
 *   «Комната не найдена»; при тихом восстановлении сессии (`LS.room`) ошибку не
 *   показываем — иначе на старте приложения пользователь видит ошибку, ничего не
 *   вводив.
 * @returns {void}
 */
function joinRoom(code, manual = false) {
  manualJoin = manual;
  $('#home-error').textContent = '';
  // Флаг admin шлём только на первом входе; авто-переподключение (socket.js) его
  // не несёт, но сервер сохраняет право на игроке (roomService.addPlayer).
  connect(() => send({ type: IN.JOIN_ROOM, code: code.toUpperCase(), playerId, nickname: LS.nick, admin: IS_ADMIN }));
}

// ---------- Рендер ----------
/**
 * Оркестратор отрисовки. Полный (структурный) рендер выполняется только при
 * изменении структурной сигнатуры; статус/таймер — на каждый кадр. Здесь же
 * вычисляются переходы состояния для тостов, мигания и подсветки.
 * @returns {void}
 */
function render() {
  const state = getState();
  if (!state) return;
  $('#room-nick').textContent = LS.nick;
  $('#room-code').textContent = state.code;

  const inGame = state.phase === 'clue' || state.phase === 'guess';
  // Стал лидером комнаты — показываем уведомление.
  if (prevHostId !== undefined && prevHostId !== state.hostId && state.hostId === state.you) {
    showToast('👑 Вы стали лидером комнаты');
  }
  // Заход за лидера: игрок стал капитаном в активной игре (старт партии или
  // смена роли на паузе). Подсвечиваем его карты только в этот переход, иначе
  // анимация перезапускалась бы на каждом структурном рендере (голоса, таймер).
  const my = me();
  const spyInGame = !!(my && my.role === 'spymaster' && inGame);
  const enteredSpymaster = spyInGame && !prevSpyInGame;

  if (sigChanged()) {
    renderTeams();
    renderBoard(enteredSpymaster);
    renderControls();
    renderSettings();
    renderLog();
    renderWin();
  }
  renderStatus();   // таймер обновляется каждую секунду
  renderStop();     // оверлей F9-стоп-паузы (вне структурной сигнатуры — мгновенно)
  renderAdmin();    // подпись кнопки X-ray (в режиме /admin)
  handleSound(state);

  // Звук отправки подсказки лидером: считаем подсказки в истории обеих команд;
  // рост счётчика = лидер только что отправил слово. Сравниваем с прошлым кадром,
  // чтобы звук был ровно в момент новой подсказки (повторные рендеры не дублируют).
  const ch = state.clueHistory || { red: [], blue: [] };
  const clueCount = (ch.red ? ch.red.length : 0) + (ch.blue ? ch.blue.length : 0);
  if (prevClueCount !== undefined && clueCount > prevClueCount) soundClue();
  prevClueCount = clueCount;

  prevHostId = state.hostId;
  prevSpyInGame = spyInGame;
}

/**
 * Показывает/прячет оверлей F9-«стоп-паузы» (task 3) по общему флагу state.stopped.
 * Вызывается на каждом кадре (вне структурной сигнатуры), чтобы реагировать
 * мгновенно. Текст кнопки X-ray в админ-модалке обновляется отдельно (renderAdmin).
 * @returns {void}
 */
function renderStop() {
  const state = getState();
  $('#stop-overlay').classList.toggle('hidden', !(state && state.stopped));
}

/**
 * Обновляет состояние элементов админ-режима: подпись кнопки X-ray по флагу
 * state.xray. Сама кнопка «Админ меню» показывается один раз при входе (см. init).
 * @returns {void}
 */
function renderAdmin() {
  if (!IS_ADMIN) return;
  const state = getState();
  const on = !!(state && state.xray);
  $('#admin-xray').textContent = on ? '🙈 Выключить X-ray' : '👁 Включить X-ray';
  $('#admin-xray').classList.toggle('btn-warning', on);
}

// ---------- Привязка событий ----------
/**
 * Навешивает обработчики на все интерактивные элементы интерфейса.
 * @returns {void}
 */
function bindEvents() {
  // Разблокировка звука по первому действию пользователя.
  document.addEventListener('click', ensureAudio);
  document.addEventListener('keydown', ensureAudio);

  // login
  $('#login-btn').addEventListener('click', doLogin);
  $('#login-nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  // home
  $('#create-room-btn').addEventListener('click', createRoom);
  $('#join-room-btn').addEventListener('click', () => {
    const code = $('#join-code').value.trim();
    if (code.length === 4) joinRoom(code, true);
    else $('#home-error').textContent = 'Введите код из 4 символов';
  });
  $('#join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const c = $('#join-code').value.trim(); if (c.length === 4) joinRoom(c, true); }
  });
  $('#home-edit-nick').addEventListener('click', openNickModal);

  // room header
  $('#room-edit-nick').addEventListener('click', openNickModal);
  $('#leave-btn').addEventListener('click', () => $('#leave-modal').classList.remove('hidden'));
  $('#copy-link').addEventListener('click', () => copyFeedback('#copy-link', '🔗', location.origin + '/?room=' + getState().code));
  $('#settings-gear').addEventListener('click', () => $('#settings-modal').classList.remove('hidden'));
  $('#settings-close').addEventListener('click', () => $('#settings-modal').classList.add('hidden'));

  // controls
  $('#start-btn').addEventListener('click', () => send({ type: IN.START_GAME, words: WORDS }));
  $('#newgame-btn').addEventListener('click', () => send({ type: IN.NEW_GAME, words: WORDS }));
  $('#lobby-btn').addEventListener('click', () => send({ type: IN.BACK_TO_LOBBY }));
  // Одна кнопка паузы-переключателя: шлёт RESUME, если уже на паузе, иначе PAUSE.
  $('#pause-btn').addEventListener('click', () => send({ type: getState().paused ? IN.RESUME : IN.PAUSE }));
  $('#shuffle-btn').addEventListener('click', () => send({ type: IN.SHUFFLE_TEAMS }));
  // Дублёр «Перемешать команды» из модалки настроек (task 2) — то же сообщение.
  $('#shuffle-settings').addEventListener('click', () => send({ type: IN.SHUFFLE_TEAMS }));
  // «Сохранить и начать игру»: одним сообщением применяем настройки из формы и
  // (пере)запускаем партию с ними — работает и в лобби, и во время игры (сервер
  // применит настройки перед startGame). Закрываем модалку, чтобы показать поле.
  $('#save-settings').addEventListener('click', () => {
    send({ type: IN.NEW_GAME, words: WORDS, settings: readSettingsForm() });
    $('#settings-modal').classList.add('hidden');
  });
  // Перезапуск партии из модалки настроек — та же логика, что «Новая игра».
  $('#restart-game').addEventListener('click', () => send({ type: IN.NEW_GAME, words: WORDS }));
  // Завершить партию и вернуться в лобби (та же логика, что «В лобби»). Закрываем
  // модалку, чтобы открыть стартовый экран с кнопками начала игры (task 2).
  $('#finish-game').addEventListener('click', () => {
    send({ type: IN.BACK_TO_LOBBY });
    $('#settings-modal').classList.add('hidden');
  });

  // team/role buttons (действуют в лобби и на паузе — сервер тоже это проверяет)
  $$('.btn-team').forEach(btn => {
    btn.addEventListener('click', () => send({ type: IN.SET_TEAM_ROLE, team: btn.dataset.team, role: btn.dataset.role }));
  });

  // Подвалы команд: ввод подсказки и кнопки пропуска хода (статичный DOM).
  bindTeamActions();

  // nick modal
  $('#nick-cancel').addEventListener('click', () => $('#nick-modal').classList.add('hidden'));
  $('#nick-save').addEventListener('click', saveNick);
  $('#nick-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveNick(); });

  // leave/logout modal
  $('#leave-cancel').addEventListener('click', () => $('#leave-modal').classList.add('hidden'));
  $('#leave-confirm').addEventListener('click', logout);

  // Закрытие модалок кликом вне их области (по затемнённому фону). Срабатывает
  // только если клик пришёлся на сам оверлей, а не на его содержимое (modal-box).
  ['#settings-modal', '#nick-modal', '#leave-modal', '#admin-modal'].forEach(sel => {
    const overlay = $(sel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });
  });

  // F9 — общая «стоп-пауза» с картинкой (task 3): переключатель для всех в
  // комнате. Шлём только когда игрок уже в комнате (есть состояние).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F9') { e.preventDefault(); if (getState()) send({ type: IN.TOGGLE_STOP }); }
  });

  bindAdminActions();
}

/**
 * Навешивает обработчики админ-панели (task 2). DOM кнопок статичен, поэтому
 * привязка одноразовая. Все действия защищены и на сервере (проверка player.admin).
 * @returns {void}
 */
function bindAdminActions() {
  $('#admin-btn').addEventListener('click', () => $('#admin-modal').classList.remove('hidden'));
  $('#admin-close').addEventListener('click', () => $('#admin-modal').classList.add('hidden'));
  // Добавить бота за команду/наблюдателем.
  $('#admin-add-red').addEventListener('click', () => send({ type: IN.ADMIN_ADD_PLAYER, team: 'red' }));
  $('#admin-add-blue').addEventListener('click', () => send({ type: IN.ADMIN_ADD_PLAYER, team: 'blue' }));
  $('#admin-add-obs').addEventListener('click', () => send({ type: IN.ADMIN_ADD_PLAYER, team: null }));
  // Добавить подсказку в историю команды. Подсказка появляется в блоке истории
  // карточки команды (мелким текстом внизу), поэтому даём админу мгновенный
  // локальный тост-подтверждение, чтобы действие было заметно.
  $('#admin-clue-red').addEventListener('click', () => { send({ type: IN.ADMIN_ADD_CLUE, team: 'red' }); showToast('💡 Ответ добавлен красным'); });
  $('#admin-clue-blue').addEventListener('click', () => { send({ type: IN.ADMIN_ADD_CLUE, team: 'blue' }); showToast('💡 Ответ добавлен синим'); });
  // Имитация победы команды.
  $('#admin-win-red').addEventListener('click', () => send({ type: IN.ADMIN_WIN, team: 'red' }));
  $('#admin-win-blue').addEventListener('click', () => send({ type: IN.ADMIN_WIN, team: 'blue' }));
  // Переключить личный X-ray (подпись кнопки обновит renderAdmin по state.xray).
  $('#admin-xray').addEventListener('click', () => send({ type: IN.ADMIN_XRAY }));
}

// ---------- Сценарии входа/выхода ----------
/** Подтверждает ник на экране входа и переходит дальше (с учётом приглашения). @returns {void} */
function doLogin() {
  const nick = $('#login-nick').value.trim();
  if (!nick) { $('#login-nick').focus(); return; }
  LS.nick = nick;
  $('#home-nick').textContent = nick;
  if (pendingRoom) { show('screen-home'); joinRoom(pendingRoom, true); cleanUrl(); pendingRoom = ''; }
  else show('screen-home');
}

/** Сохраняет новый ник и (если в комнате) сообщает серверу. @returns {void} */
function saveNick() {
  const nick = $('#nick-input').value.trim();
  if (!nick) return;
  LS.nick = nick;
  $('#home-nick').textContent = nick;
  $('#room-nick').textContent = nick;
  $('#nick-modal').classList.add('hidden');
  if (isOpen() && LS.room) send({ type: IN.CHANGE_NICKNAME, nickname: nick });
}

/** Выход из аккаунта: покидает комнату, сбрасывает данные и возвращает на вход. @returns {void} */
function logout() {
  send({ type: IN.LEAVE });
  LS.room = '';
  LS.nick = '';
  closeSocket();
  setState(null); resetSig();
  $('#leave-modal').classList.add('hidden');
  $('#login-nick').value = '';
  show('screen-login');
  $('#login-nick').focus();
}

/** Убирает query-параметры из URL (после обработки приглашения). @returns {void} */
function cleanUrl() {
  try { history.replaceState({}, '', location.pathname); } catch (_) {}
}

// ---------- Старт ----------
/**
 * Инициализация приложения: навешивает события, обрабатывает ссылку-приглашение
 * и восстанавливает сессию по сохранённому нику/комнате.
 * @returns {void}
 */
function init() {
  setMessageHandler(handleMessage);
  bindEvents();
  // В режиме /admin показываем кнопку админ-меню (она в шапке экрана комнаты).
  if (IS_ADMIN) $('#admin-btn').classList.remove('hidden');
  pendingRoom = (new URLSearchParams(location.search).get('room') || '').toUpperCase();

  if (LS.nick) {
    $('#login-nick').value = LS.nick;
    $('#home-nick').textContent = LS.nick;
    if (pendingRoom) { show('screen-home'); joinRoom(pendingRoom, true); cleanUrl(); pendingRoom = ''; }
    else if (LS.room) { show('screen-room'); connect(() => send({ type: IN.JOIN_ROOM, code: LS.room, playerId, nickname: LS.nick })); }
    else show('screen-home');
  } else {
    show('screen-login');
    $('#login-nick').focus();
  }
}

init();
