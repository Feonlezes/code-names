'use strict';

/**
 * @module util/admin
 * Признак «режима администратора»: страница открыта по пути /admin
 * (например, /admin/?room=JSXA). Вычисляется один раз из location.pathname и
 * используется клиентом, чтобы показать админ-кнопку/меню модерации и пометить
 * вход флагом admin (сервер по нему выдаёт права, см. messageRouter). Вычисление
 * вынесено сюда, чтобы и main.js, и teams.view брали один и тот же признак.
 * Экспорт: IS_ADMIN.
 */

/** @type {boolean} страница открыта по пути /admin */
export const IS_ADMIN = location.pathname.startsWith('/admin');
