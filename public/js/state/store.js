'use strict';

/**
 * @module state/store
 * Единое хранилище последнего состояния от сервера и его производных. Клиент
 * не держит игровую логику — всё это снимок (см. CLAUDE.md §2.6).
 * Экспорт: getState, setState, me, structuralSig, sigChanged, resetSig.
 */

let state = null;     // последнее состояние от сервера
let lastSig = '';     // сигнатура «структурных» данных (для частичного рендера)

/** @returns {Object|null} текущее состояние */
export function getState() { return state; }

/** Сохраняет новое состояние. @param {Object} s @returns {void} */
export function setState(s) { state = s; }

/** @returns {Object|undefined} запись текущего игрока в state.players */
export function me() { return state.players.find(p => p.id === state.you); }

/**
 * Сигнатура «структурных» данных — без таймера, чтобы посекундный тик не
 * перерисовывал поле ввода подсказки (иначе с него слетает фокус каждую секунду).
 * @returns {string}
 */
export function structuralSig() {
  return JSON.stringify({
    phase: state.phase,
    cur: state.currentTeam,
    clue: state.clue,
    // Полные истории подсказок — чтобы карточки перерисовывались не только при
    // появлении новой подсказки, но и при РЕДАКТИРОВАНИИ существующей (task 1:
    // капитан правит своё слово/число). Таймер по-прежнему вне сигнатуры.
    clueHist: state.clueHistory ? [state.clueHistory.red, state.clueHistory.blue] : null,
    // Голоса агентов и идущий отсчёт (task 1) — чтобы кружки и лоадер появлялись/
    // исчезали при изменении голосования (таймер по-прежнему вне сигнатуры).
    votes: state.votes,
    pendingVote: state.pendingVote,
    paused: state.paused,
    stopped: state.stopped,
    winner: state.winner,
    host: state.hostId,
    you: state.you,
    settings: state.settings,
    players: state.players,
    board: state.board,
    remaining: state.remaining,
    logLen: state.log.length,
    logLast: state.log.length ? state.log[state.log.length - 1].text : ''
  });
}

/**
 * Сравнивает текущую структурную сигнатуру с предыдущей; при изменении
 * запоминает новую и возвращает true (значит, нужен полный перерендер).
 * @returns {boolean}
 */
export function sigChanged() {
  const sig = structuralSig();
  if (sig !== lastSig) { lastSig = sig; return true; }
  return false;
}

/** Сбрасывает сигнатуру, чтобы следующий рендер был полным. @returns {void} */
export function resetSig() { lastSig = ''; }
