import asyncio
import json
import datetime
import os
from datetime import timedelta
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import Command
from aiogram.types import WebAppInfo, PreCheckoutQuery, LabeledPrice
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from aiohttp import web

# --- ДОБАВЛЕНЫ BigInteger и text ---
from sqlalchemy import select, Integer, String, DateTime, Boolean, BigInteger, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import insert

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
ADMIN_ID = int(os.getenv("ADMIN_ID", 0))
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://github.com")
DATABASE_URL = os.getenv("DATABASE_URL")
PORT = int(os.getenv("PORT", 8080))

if DATABASE_URL:
    if DATABASE_URL.startswith("postgresql://"):
        DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)

if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set!")

PLANS = {
    "1_month": {"stars": 150, "days": 30, "name": "1 Month Premium"},
    "6_months": {"stars": 700, "days": 180, "name": "6 Months Premium"},
    "1_year": {"stars": 1000, "days": 365, "name": "1 Year Premium"}
}

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

async_engine = create_async_engine(DATABASE_URL)
async_session = async_sessionmaker(async_engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = 'users'
    # ИСПРАВЛЕНИЕ: Используем BigInteger для длинных ID Телеграма
    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    username: Mapped[str] = mapped_column(String, nullable=True)
    subscription_end: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=True)
    notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    trial_used: Mapped[bool] = mapped_column(Boolean, default=False)

class Promocode(Base):
    __tablename__ = 'promocodes'
    code: Mapped[str] = mapped_column(String, primary_key=True)
    duration_days: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

async def init_db():
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # АВТО-МИГРАЦИЯ: Безопасно меняем тип колонки на BIGINT
        try:
            await conn.execute(text("ALTER TABLE users ALTER COLUMN user_id TYPE BIGINT;"))
        except Exception as e:
            pass  # Если колонка уже обновлена, пропускаем

async def add_user(user_id, username):
    async with async_session() as session:
        stmt = insert(User).values(user_id=user_id, username=username).on_conflict_do_nothing(index_elements=['user_id'])
        await session.execute(stmt)
        await session.commit()

async def get_user(user_id):
    async with async_session() as session:
        return await session.get(User, user_id)

async def update_subscription(user_id, days, username=None):
    async with async_session() as session:
        user = await session.get(User, user_id)
        now = datetime.datetime.now()
        
        # Если юзер не был найден, создаем его
        if not user:
            user = User(user_id=user_id, username=username, subscription_end=now)
            session.add(user)

        current_end = user.subscription_end or now

        if current_end > now:
            new_end = current_end + timedelta(days=days)
        else:
            new_end = now + timedelta(days=days)

        if days >= 36500:
            new_end = now + timedelta(days=36500)

        user.subscription_end = new_end
        await session.commit()
        return new_end

async def toggle_notifications(user_id, status: bool):
    async with async_session() as session:
        user = await session.get(User, user_id)
        if user:
            user.notifications_enabled = status
            await session.commit()

async def get_users_for_report():
    async with async_session() as session:
        result = await session.execute(select(User.user_id).where(User.notifications_enabled == True))
        return result.scalars().all()

async def create_promocode(code, duration_days):
    async with async_session() as session:
        try:
            new_promo = Promocode(code=code, duration_days=duration_days)
            session.add(new_promo)
            await session.commit()
            return True
        except IntegrityError:
            await session.rollback()
            return False

async def use_promocode(code):
    async with async_session() as session:
        result = await session.execute(select(Promocode).where(Promocode.code == code, Promocode.is_active == True))
        promo = result.scalar_one_or_none()
        if promo:
            promo.is_active = False
            await session.commit()
            return promo.duration_days
        return None

async def set_trial_used(user_id):
    async with async_session() as session:
        user = await session.get(User, user_id)
        if user:
            user.trial_used = True
            await session.commit()

@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    user_id = message.from_user.id
    username = message.from_user.username
    await add_user(user_id, username)
    user = await get_user(user_id)

    # Получаем имя бота автоматически
    bot_me = await bot.get_me()
    bot_username = bot_me.username

    args = message.text.split()
    if len(args) > 1:
        payload = args[1]
        if payload.startswith("pay_"):
            plan_id = payload.replace("pay_", "")
            if plan_id in PLANS:
                plan = PLANS[plan_id]
                prices = [LabeledPrice(label=plan["name"], amount=plan["stars"])]
                return await bot.send_invoice(
                    chat_id=message.chat.id, title="FiMax Premium",
                    description=f"Subscription: {plan['name']}",
                    payload=plan_id, provider_token="", currency="XTR", prices=prices
                )

    sub_end_iso = "none"
    if user and user.subscription_end:
        sub_end_iso = user.subscription_end.isoformat()

    # Передаем имя бота в WebApp
    sync_url = f"{WEBAPP_URL}?sub_end={sub_end_iso}&bot={bot_username}"

    keyboard = types.ReplyKeyboardMarkup(
        keyboard=[[types.KeyboardButton(text="📱 Open FiMax", web_app=WebAppInfo(url=sync_url))]],
        resize_keyboard=True
    )
    await message.answer(
        "Welcome to FiMax! 📊\n\nTrack your portfolio and get AI insights. Click the button below to open.",
        reply_markup=keyboard
    )

@dp.message(F.web_app_data)
async def handle_webapp_data(message: types.Message):
    try:
        data = json.loads(message.web_app_data.data)
        user_id = message.from_user.id
        if data.get("action") == "promo_code":
            code = data.get("code")
            days = await use_promocode(code)
            if days:
                new_end = await update_subscription(user_id, days, message.from_user.username)
                
                bot_me = await bot.get_me()
                sync_url = f"{WEBAPP_URL}?sub_end={new_end.isoformat()}&bot={bot_me.username}"
                
                kb = types.ReplyKeyboardMarkup(
                    keyboard=[[types.KeyboardButton(text="📱 Open FiMax (Premium)", web_app=WebAppInfo(url=sync_url))]],
                    resize_keyboard=True
                )
                
                await message.answer(
                    f"✅ Promo code applied! {days} days added.\nValid until: <b>{new_end.strftime('%Y-%m-%d')}</b>",
                    parse_mode="HTML", 
                    reply_markup=kb
                )
            else:
                await message.answer("❌ Invalid or expired promo code.")
    except Exception as e:
        print(f"Error handling webapp data: {e}")

@dp.pre_checkout_query()
async def process_pre_checkout(pre_checkout_query: PreCheckoutQuery):
    await bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)

@dp.message(F.successful_payment)
async def process_successful_payment(message: types.Message):
    plan_id = message.successful_payment.invoice_payload
    user_id = message.from_user.id
    await add_user(user_id, message.from_user.username)

    if plan_id in PLANS:
        days = PLANS[plan_id]["days"]
        new_end = await update_subscription(user_id, days, message.from_user.username)
        
        bot_me = await bot.get_me()
        sync_url = f"{WEBAPP_URL}?sub_end={new_end.isoformat()}&bot={bot_me.username}"
        
        kb = types.ReplyKeyboardMarkup(
            keyboard=[[types.KeyboardButton(text="📱 Open FiMax (Premium)", web_app=WebAppInfo(url=sync_url))]],
            resize_keyboard=True
        )
        await message.answer(
            f"✅ Payment successful! You purchased {PLANS[plan_id]['name']}!\n\n"
            f"Premium active until: <b>{new_end.strftime('%Y-%m-%d')}</b>",
            parse_mode="HTML", reply_markup=kb
        )

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
    if await create_promocode(code, int(days_str)):
        await message.answer(f"✅ Promocode {code} for {days_str} days created!")
    else:
        await message.answer("❌ This code already exists.")

@dp.message(Command("use"))
async def cmd_use_promo(message: types.Message):
    args = message.text.split()
    if len(args) != 2:
        return await message.answer("Usage: /use <CODE>")
    code = args[1].upper()
    days = await use_promocode(code)
    if days:
        new_end = await update_subscription(message.from_user.id, days, message.from_user.username)
        await message.answer(f"✅ Promo code applied! {days} days added.\nValid until: {new_end.strftime('%Y-%m-%d')}")
    else:
        await message.answer("❌ Invalid or expired promo code.")

async def send_weekly_reports():
    users_to_notify = await get_users_for_report()
    for user_id in users_to_notify:
        try:
            bot_me = await bot.get_me()
            sync_url = f"{WEBAPP_URL}?bot={bot_me.username}"
            keyboard = types.InlineKeyboardMarkup(inline_keyboard=[
                [types.InlineKeyboardButton(text="📊 View Weekly Summary", web_app=WebAppInfo(url=sync_url))]
            ])
            await bot.send_message(
                user_id,
                "📅 <b>Your Weekly Summary is ready!</b>\n\nOpen FiMax to check how your portfolio performed this week.",
                parse_mode="HTML",
                reply_markup=keyboard
            )
        except Exception as e:
            print(f"Failed to send report to {user_id}: {e}")

async def health_handler(request):
    return web.json_response({"status": "ok", "bot": "running"})

async def start_http_server():
    app = web.Application()
    app.router.add_get('/', health_handler)
    app.router.add_get('/health', health_handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', PORT)
    await site.start()
    print(f"HTTP server started on port {PORT}")

async def main():
    print("Initializing Database...")
    await init_db()

    print("Starting Weekly Report Scheduler...")
    scheduler = AsyncIOScheduler(timezone="Europe/Moscow")
    scheduler.add_job(send_weekly_reports, trigger="cron", day_of_week="fri", hour=18, minute=0)
    scheduler.start()

    print("Starting HTTP server for Render...")
    await start_http_server()

    print("Bot is polling...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
