import asyncio
import json
import sqlite3
import datetime
import os
from datetime import timedelta
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import Command
from aiogram.types import WebAppInfo, PreCheckoutQuery, LabeledPrice
from apscheduler.schedulers.asyncio import AsyncIOScheduler

# Load environment variables
load_dotenv()

# ==========================================
# === НАСТРОЙКИ БОТА ===
# ==========================================
BOT_TOKEN = os.getenv("BOT_TOKEN")
ADMIN_ID = int(os.getenv("ADMIN_ID", 0))
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://github.com")

# Цены в Telegram Stars
PLANS = {
    "1_month": {"stars": 150, "days": 30, "name": "1 Month Premium"},
    "6_months": {"stars": 700, "days": 180, "name": "6 Months Premium"},
    "1_year": {"stars": 1000, "days": 365, "name": "1 Year Premium"}
}

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# ==========================================
# === РАБОТА С БАЗОЙ ДАННЫХ (SQLite) ===
# ==========================================
DB_FILE = 'fimax_bot.db'

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            subscription_end TIMESTAMP,
            notifications_enabled BOOLEAN DEFAULT 1,
            trial_used BOOLEAN DEFAULT 0
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS promocodes (
            code TEXT PRIMARY KEY,
            duration_days INTEGER,
            is_active BOOLEAN DEFAULT 1
        )
    ''')
    conn.commit()
    conn.close()

def add_user(user_id, username):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)', (user_id, username))
    conn.commit()
    conn.close()

def get_user(user_id):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE user_id = ?', (user_id,))
    user = cursor.fetchone()
    conn.close()
    return user

def update_subscription(user_id, days):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    user = get_user(user_id)
    if not user:
        return False
        
    current_end = user[2]
    now = datetime.datetime.now()
    
    if current_end and datetime.datetime.fromisoformat(current_end) > now:
        new_end = datetime.datetime.fromisoformat(current_end) + timedelta(days=days)
    else:
        new_end = now + timedelta(days=days)
        
    if days >= 36500: # Пожизненная подписка
        new_end = now + timedelta(days=36500)
        
    cursor.execute('UPDATE users SET subscription_end = ? WHERE user_id = ?', (new_end.isoformat(), user_id))
    conn.commit()
    conn.close()
    return new_end

def toggle_notifications(user_id, status: bool):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('UPDATE users SET notifications_enabled = ? WHERE user_id = ?', (status, user_id))
    conn.commit()
    conn.close()

def get_users_for_report():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('SELECT user_id FROM users WHERE notifications_enabled = 1')
    users = cursor.fetchall()
    conn.close()
    return [u[0] for u in users]

def create_promocode(code, duration_days):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute('INSERT INTO promocodes (code, duration_days) VALUES (?, ?)', (code, duration_days))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def use_promocode(code):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('SELECT duration_days FROM promocodes WHERE code = ? AND is_active = 1', (code,))
    result = cursor.fetchone()
    if result:
        cursor.execute('UPDATE promocodes SET is_active = 0 WHERE code = ?', (code,))
        conn.commit()
        conn.close()
        return result[0]
    conn.close()
    return None

def set_trial_used(user_id):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('UPDATE users SET trial_used = 1 WHERE user_id = ?', (user_id,))
    conn.commit()
    conn.close()

# ==========================================
# === ЛОГИКА ТЕЛЕГРАМ БОТА ===
# ==========================================

@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    user_id = message.from_user.id
    username = message.from_user.username
    add_user(user_id, username)
    user = get_user(user_id)
    
    args = message.text.split()
    
    # === 1. ОБРАБОТКА ДИПЛИНКОВ (ОПЛАТА) ИЗ СВЕРНУТОГО ПРИЛОЖЕНИЯ ===
    if len(args) > 1:
        payload = args[1]
        
        if payload.startswith("pay_"):
            plan_id = payload.replace("pay_", "")
            if plan_id in PLANS:
                plan = PLANS[plan_id]
                prices = [LabeledPrice(label=plan["name"], amount=plan["stars"])]
                return await bot.send_invoice(
                    chat_id=message.chat.id, title="FiMax Premium",
                    description=f"Подписка: {plan['name']}",
                    payload=plan_id, provider_token="", currency="XTR", prices=prices
                )

    # === 2. ОБЫЧНЫЙ СТАРТ И СИНХРОНИЗАЦИЯ ===
    # Берем дату окончания подписки (если есть)
    sub_end = user[2] if user and user[2] else "none"
    
    # Приклеиваем статус подписки к ссылке WebApp
    sync_url = f"{WEBAPP_URL}?sub_end={sub_end}"
    
    keyboard = types.ReplyKeyboardMarkup(
        keyboard=[[types.KeyboardButton(text="📱 Open FiMax", web_app=WebAppInfo(url=sync_url))]],
        resize_keyboard=True
    )
    
    await message.answer(
        "Welcome to FiMax! 📊\n\nTrack your portfolio and get AI insights. Click the button below to open.",
        reply_markup=keyboard
    )

# === 3. СКРЫТЫЙ ПРИЕМ ПРОМОКОДОВ ИЗ ПРИЛОЖЕНИЯ (БЕЗ ЗАКРЫТИЯ) ===
@dp.message(F.web_app_data)
async def handle_webapp_data(message: types.Message):
    try:
        data = json.loads(message.web_app_data.data)
        user_id = message.from_user.id
        
        if data.get("action") == "promo_code":
            code = data.get("code")
            days = use_promocode(code)
            
            if days:
                new_end = update_subscription(user_id, days)
                # Бот молча применяет код. Приложение само покажет успех.
            else:
                pass # Бот ничего не пишет при ошибке
    except Exception as e:
        print(f"Error handling webapp data: {e}")

@dp.pre_checkout_query()
async def process_pre_checkout(pre_checkout_query: PreCheckoutQuery):
    await bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)

@dp.message(F.successful_payment)
async def process_successful_payment(message: types.Message):
    plan_id = message.successful_payment.invoice_payload
    user_id = message.from_user.id

    if not get_user(user_id):
        add_user(user_id, message.from_user.username)

    if plan_id in PLANS:
        days = PLANS[plan_id]["days"]
        new_end = update_subscription(user_id, days)

        # Кнопка для возврата в приложение, которая мгновенно обновит статус Premium
        kb = types.InlineKeyboardMarkup(inline_keyboard=[[
            types.InlineKeyboardButton(text="📱 Открыть FiMax (Premium)", web_app=WebAppInfo(url=f"{WEBAPP_URL}?sub_end={new_end.isoformat()}"))
        ]])

        await message.answer(
            f"✅ Оплата успешна! Вы купили {PLANS[plan_id]['name']}!\n\n"
            f"Premium активен до: <b>{new_end.strftime('%Y-%m-%d')}</b>",
            parse_mode="HTML", reply_markup=kb
        )

# --- ПРОМОКОДЫ (Для админа и пользователей) ---
@dp.message(Command("promo"))
async def cmd_create_promo(message: types.Message):
    if message.from_user.id != ADMIN_ID:
        return await message.answer("⛔️ No access.")
        
    args = message.text.split()
    if len(args) != 3:
        return await message.answer("Usage: /promo <CODE> <DAYS>")
        
    code, days_str = args[1].upper(), args[2]
    if not days_str.isdigit():
        return await message.answer("Days must be a number.")
        
    if create_promocode(code, int(days_str)):
        await message.answer(f"✅ Promocode {code} for {days_str} days created!")
    else:
        await message.answer("❌ This code already exists.")

@dp.message(Command("use"))
async def cmd_use_promo(message: types.Message):
    args = message.text.split()
    if len(args) != 2:
        return await message.answer("Usage: /use <CODE>")
        
    code = args[1].upper()
    days = use_promocode(code)
    
    if days:
        new_end = update_subscription(message.from_user.id, days)
        await message.answer(f"✅ Promo code applied! {days} days added.\nValid until: {new_end.strftime('%Y-%m-%d')}")
    else:
        await message.answer("❌ Invalid or expired promo code.")

# --- ЕЖЕНЕДЕЛЬНАЯ РАССЫЛКА ---
async def send_weekly_reports():
    users_to_notify = get_users_for_report()
    for user_id in users_to_notify:
        try:
            keyboard = types.InlineKeyboardMarkup(inline_keyboard=[
                [types.InlineKeyboardButton(text="📊 View Weekly Summary", web_app=WebAppInfo(url=WEBAPP_URL))]
            ])
            await bot.send_message(
                user_id,
                "📅 <b>Your Weekly Summary is ready!</b>\n\nOpen FiMax to check how your portfolio performed this week.",
                parse_mode="HTML",
                reply_markup=keyboard
            )
        except Exception as e:
            print(f"Failed to send report to {user_id}: {e}")

# ==========================================
# === ЗАПУСК ===
# ==========================================
async def main():
    print("Initializing Database...")
    init_db()
    
    print("Starting Weekly Report Scheduler...")
    scheduler = AsyncIOScheduler(timezone="Europe/Moscow")
    scheduler.add_job(send_weekly_reports, trigger="cron", day_of_week="fri", hour=18, minute=0)
    scheduler.start()
    
    print("Bot is polling...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
