# FiMax Telegram Bot

Telegram bot for FiMax portfolio tracker with Premium subscription support via Telegram Stars.

## Features

- 📱 WebApp integration for portfolio tracking
- ⭐ Premium subscriptions via Telegram Stars
- 🎁 Promo codes system
- 📊 Weekly reports scheduler
- 🆓 7-day free trial for new users

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/fimax-bot.git
cd fimax-bot
```

### 2. Create virtual environment

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:
- `BOT_TOKEN` - Get from [@BotFather](https://t.me/BotFather)
- `ADMIN_ID` - Your Telegram user ID (get from [@userinfobot](https://t.me/userinfobot))
- `WEBAPP_URL` - Your GitHub Pages URL

### 5. Run the bot

```bash
python bot.py
```

## Deployment with Docker

### Build and run

```bash
docker build -t fimax-bot .
docker run -d --env-file .env fimax-bot
```

### Docker Compose

```bash
docker-compose up -d
```

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot and open WebApp |
| `/promo <CODE> <DAYS>` | Create promocode (Admin only) |
| `/use <CODE>` | Activate promocode |

## Subscription Plans

| Plan | Stars | Duration |
|------|-------|----------|
| 1 Month | 150 ⭐ | 30 days |
| 6 Months | 700 ⭐ | 180 days |
| 1 Year | 1000 ⭐ | 365 days |

## License

MIT
